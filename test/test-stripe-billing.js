import assert from 'node:assert';
import worker from '../src/index.js';
import { createCheckoutSession, normalizeStripeEvent, verifyStripeWebhook } from '../src/lib/stripeService.js';
import { hashClientKey } from '../src/lib/keyService.js';
import { getLicenseByKeyHash } from '../src/lib/licenseService.js';
import { hmacSha256Hex } from '../src/lib/webhookSecurity.js';

function createEnv() {
  const mem = new Map();
  return {
    mem,
    env: {
      ENVIRONMENT: 'development',
      CLIENT_KEY_MODE: 'test',
      STRIPE_WEBHOOK_SECRET: 'whsec_unit_test',
      STRIPE_WEBHOOK_MAX_SKEW_SEC: '300',
      MAX_BODY_BYTES: '250000',
      QAGENT_KV: {
        async get(key) { return mem.has(key) ? mem.get(key) : null; },
        async put(key, value) { mem.set(key, value); },
      },
    },
  };
}

async function stripeSignature(secret, body, ts = Math.floor(Date.now() / 1000), extraV1 = null) {
  const signature = await hmacSha256Hex(secret, `${ts}.${body}`);
  return `t=${ts},v1=${extraV1 || '0'.repeat(64)},v1=${signature}`;
}

async function postStripeEvent(env, payload, { eventTimestamp = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(payload);
  const sig = await stripeSignature(env.STRIPE_WEBHOOK_SECRET, raw, eventTimestamp);
  const req = new Request('https://api.apiqagent.com/v1/webhooks/payment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Stripe-Signature': sig,
    },
    body: raw,
  });
  const res = await worker.fetch(req, env);
  const json = await res.json();
  return { res, json };
}

function stripeEvent(type, object, id) {
  return {
    id,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
}

async function testCheckoutMetadataUsesHash() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/v1/prices/')) {
      return new Response(JSON.stringify({ id: 'price_monthly', recurring: { interval: 'month' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.test/session' }), { status: 200 });
  };

  try {
    const clientKey = 'qag_test_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
    const expectedHash = await hashClientKey(clientKey);
    await createCheckoutSession(
      { STRIPE_SECRET_KEY: 'sk_test_fake' },
      {
        clientKey,
        priceId: 'price_monthly',
        successUrl: 'https://portal-qagent.com.br/billing/success',
        cancelUrl: 'https://portal-qagent.com.br/billing/cancel',
      }
    );

    assert.strictEqual(calls.length, 2);
    const checkoutBody = String(calls[1].init.body);
    const params = new URLSearchParams(checkoutBody);
    assert.strictEqual(params.get('metadata[qagentKeyHash]'), expectedHash);
    assert.strictEqual(params.get('subscription_data[metadata][qagentKeyHash]'), expectedHash);
    assert.strictEqual(params.get('client_reference_id'), expectedHash);
    assert.strictEqual(params.get('metadata[clientKey]'), null);
    assert.ok(!checkoutBody.includes(clientKey), 'raw clientKey must never be sent to Stripe');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function testCurrentStripeEventNormalization() {
  const start = 1786200000;
  const end = 1788878400;
  const event = stripeEvent('invoice.payment_succeeded', {
    id: 'in_001',
    object: 'invoice',
    customer: 'cus_001',
    customer_email: 'qa@example.com',
    amount_paid: 5900,
    total: 5900,
    currency: 'brl',
    parent: {
      type: 'subscription_details',
      subscription_details: {
        subscription: 'sub_001',
        metadata: { qagentKeyHash: 'sha256:abc123' },
      },
    },
    lines: {
      data: [
        { period: { start, end } },
      ],
    },
  }, 'evt_invoice_current');

  const normalized = normalizeStripeEvent(event);
  assert.strictEqual(normalized.eventType, 'invoice.paid');
  assert.strictEqual(normalized.providerEventType, 'invoice.payment_succeeded');
  assert.strictEqual(normalized.reference.keyHash, 'sha256:abc123');
  assert.strictEqual(normalized.reference.providerCustomerId, 'cus_001');
  assert.strictEqual(normalized.reference.providerSubscriptionId, 'sub_001');
  assert.strictEqual(normalized.reference.providerInvoiceId, 'in_001');
  assert.strictEqual(normalized.billing.periodStart, new Date(start * 1000).toISOString());
  assert.strictEqual(normalized.billing.periodEnd, new Date(end * 1000).toISOString());
  assert.strictEqual(normalized.processing.action, 'transition');
  assert.strictEqual(normalized.processing.sendAccessToken, false);

  const subscriptionUpdated = normalizeStripeEvent(stripeEvent('customer.subscription.updated', {
    id: 'sub_001',
    object: 'subscription',
    customer: 'cus_001',
    status: 'active',
    cancel_at_period_end: true,
    cancel_at: end,
    metadata: { qagentKeyHash: 'sha256:abc123' },
    items: {
      data: [
        { current_period_start: start, current_period_end: end },
      ],
    },
  }, 'evt_sub_updated'));

  assert.strictEqual(subscriptionUpdated.billing.status, 'active');
  assert.strictEqual(subscriptionUpdated.billing.cancelAtPeriodEnd, true);
  assert.strictEqual(subscriptionUpdated.billing.periodEnd, new Date(end * 1000).toISOString());
}

async function testSignatureMultipleV1AndTolerance() {
  const secret = 'whsec_unit_test';
  const raw = JSON.stringify({ id: 'evt_sig', type: 'ping', data: { object: {} } });
  const now = Math.floor(Date.now() / 1000);
  const sig = await stripeSignature(secret, raw, now, 'f'.repeat(64));
  const req = new Request('https://api.apiqagent.com/v1/webhooks/payment', {
    method: 'POST',
    headers: { 'Stripe-Signature': sig },
    body: raw,
  });
  const ok = await verifyStripeWebhook(req, { STRIPE_WEBHOOK_SECRET: secret, STRIPE_WEBHOOK_MAX_SKEW_SEC: '300' });
  assert.strictEqual(ok.ok, true);

  const oldTs = now - 1000;
  const oldSig = await stripeSignature(secret, raw, oldTs);
  const oldReq = new Request('https://api.apiqagent.com/v1/webhooks/payment', {
    method: 'POST',
    headers: { 'Stripe-Signature': oldSig },
    body: raw,
  });
  const old = await verifyStripeWebhook(oldReq, { STRIPE_WEBHOOK_SECRET: secret, STRIPE_WEBHOOK_MAX_SKEW_SEC: '300' });
  assert.strictEqual(old.ok, false);
  assert.strictEqual(old.reason, 'timestamp_outside_tolerance');
}

async function testNativeSubscriptionLifecycle() {
  const { env } = createEnv();

  const signupReq = new Request('https://api.apiqagent.com/v1/signup-trial', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'billing.lifecycle@example.com',
      name: 'Billing Lifecycle',
      company: 'QAgent Test',
      source: 'billing-foundation-05-2',
      acceptTerms: true,
      acceptPrivacy: true,
    }),
  });
  const signupRes = await worker.fetch(signupReq, env);
  assert.strictEqual(signupRes.status, 201);
  const signup = await signupRes.json();
  const clientKey = signup.credentials.clientKey;
  const keyHash = await hashClientKey(clientKey);

  // Subscription creation only establishes reconciliation. It must never grant paid access
  // before a successful Checkout/Invoice event.
  const subscriptionCreated = stripeEvent('customer.subscription.created', {
    id: 'sub_lifecycle',
    object: 'subscription',
    customer: 'cus_lifecycle',
    status: 'active',
    metadata: { qagentKeyHash: keyHash },
    items: { data: [] },
  }, 'evt_sub_created');
  const createdResult = await postStripeEvent(env, subscriptionCreated);
  assert.strictEqual(createdResult.res.status, 200);
  assert.strictEqual(createdResult.json.mappingOnly, true);
  let license = await getLicenseByKeyHash(env, keyHash);
  assert.strictEqual(license.status, 'trial');

  const ignoredPaymentIntent = stripeEvent('payment_intent.succeeded', {
    id: 'pi_lifecycle',
    object: 'payment_intent',
    customer: 'cus_lifecycle',
  }, 'evt_payment_intent');
  const ignoredResult = await postStripeEvent(env, ignoredPaymentIntent);
  assert.strictEqual(ignoredResult.res.status, 200);
  assert.strictEqual(ignoredResult.json.processed, false);
  assert.strictEqual(ignoredResult.json.ignored, true);

  // Invoice can arrive BEFORE checkout.session.completed. The subscription metadata hash
  // must be sufficient to reconcile and activate the correct QAgent license.
  const period1Start = Math.floor(Date.now() / 1000);
  const period1End = period1Start + (31 * 24 * 60 * 60);
  const firstInvoice = stripeEvent('invoice.payment_succeeded', {
    id: 'in_first',
    object: 'invoice',
    customer: 'cus_lifecycle',
    customer_email: signup.customer.email,
    amount_paid: 5900,
    total: 5900,
    currency: 'brl',
    parent: {
      type: 'subscription_details',
      subscription_details: {
        subscription: 'sub_lifecycle',
        metadata: { qagentKeyHash: keyHash },
      },
    },
    lines: { data: [{ period: { start: period1Start, end: period1End } }] },
  }, 'evt_first_invoice');

  const first = await postStripeEvent(env, firstInvoice);
  assert.strictEqual(first.res.status, 200);
  assert.strictEqual(first.json.transition.finalStatus, 'active');

  license = await getLicenseByKeyHash(env, keyHash);
  const exactFirstEnd = new Date(period1End * 1000).toISOString();
  assert.strictEqual(license.currentPeriodEnd, exactFirstEnd);
  assert.strictEqual(license.expiresAt, exactFirstEnd);
  assert.strictEqual(license.providerSubscriptionId, 'sub_lifecycle');

  // Checkout completes afterwards and has no period. It must not replace the precise
  // invoice period with an arbitrary +30 day window.
  const checkout = stripeEvent('checkout.session.completed', {
    id: 'cs_lifecycle',
    object: 'checkout.session',
    mode: 'subscription',
    payment_status: 'paid',
    customer: 'cus_lifecycle',
    subscription: 'sub_lifecycle',
    amount_total: 5900,
    currency: 'brl',
    client_reference_id: keyHash,
    metadata: { qagentKeyHash: keyHash },
    customer_details: { email: signup.customer.email },
  }, 'evt_checkout_after_invoice');

  const checkoutResult = await postStripeEvent(env, checkout);
  assert.strictEqual(checkoutResult.res.status, 200);
  license = await getLicenseByKeyHash(env, keyHash);
  assert.strictEqual(license.currentPeriodEnd, exactFirstEnd);
  assert.strictEqual(license.expiresAt, exactFirstEnd);

  // Exact event replay is checked before mutation.
  const replay = await postStripeEvent(env, firstInvoice);
  assert.strictEqual(replay.res.status, 200);
  assert.strictEqual(replay.json.processed, false);
  assert.strictEqual(replay.json.idempotent, true);

  // A failed renewal changes state but MUST NOT extend the paid entitlement period.
  const failedStart = period1End;
  const failedEnd = failedStart + (30 * 24 * 60 * 60);
  const failedInvoice = stripeEvent('invoice.payment_failed', {
    id: 'in_failed',
    object: 'invoice',
    customer: 'cus_lifecycle',
    amount_due: 5900,
    total: 5900,
    currency: 'brl',
    parent: {
      type: 'subscription_details',
      subscription_details: {
        subscription: 'sub_lifecycle',
        metadata: { qagentKeyHash: keyHash },
      },
    },
    lines: { data: [{ period: { start: failedStart, end: failedEnd } }] },
  }, 'evt_failed_invoice');

  const failed = await postStripeEvent(env, failedInvoice);
  assert.strictEqual(failed.res.status, 200);
  assert.strictEqual(failed.json.transition.finalStatus, 'past_due');
  license = await getLicenseByKeyHash(env, keyHash);
  assert.strictEqual(license.currentPeriodEnd, exactFirstEnd);
  assert.strictEqual(license.expiresAt, exactFirstEnd);
  assert.ok(license.lastPaymentFailedAt);

  // Successful next invoice reactivates and advances to Stripe's real service period.
  const period2Start = failedStart;
  const period2End = failedEnd;
  const renewal = stripeEvent('invoice.paid', {
    id: 'in_renewed',
    object: 'invoice',
    customer: 'cus_lifecycle',
    amount_paid: 5900,
    currency: 'brl',
    parent: {
      type: 'subscription_details',
      subscription_details: {
        subscription: 'sub_lifecycle',
        metadata: { qagentKeyHash: keyHash },
      },
    },
    lines: { data: [{ period: { start: period2Start, end: period2End } }] },
  }, 'evt_renewal_paid');

  const renewed = await postStripeEvent(env, renewal);
  assert.strictEqual(renewed.res.status, 200);
  assert.strictEqual(renewed.json.transition.finalStatus, 'active');
  license = await getLicenseByKeyHash(env, keyHash);
  assert.strictEqual(license.currentPeriodEnd, new Date(period2End * 1000).toISOString());

  // Active subscription scheduled to cancel stays active until its paid period ends.
  const updated = stripeEvent('customer.subscription.updated', {
    id: 'sub_lifecycle',
    object: 'subscription',
    customer: 'cus_lifecycle',
    status: 'active',
    cancel_at_period_end: true,
    cancel_at: period2End,
    metadata: { qagentKeyHash: keyHash },
    items: { data: [{ current_period_start: period2Start, current_period_end: period2End }] },
  }, 'evt_sub_cancel_scheduled');

  const updatedResult = await postStripeEvent(env, updated);
  assert.strictEqual(updatedResult.res.status, 200);
  assert.strictEqual(updatedResult.json.transition.finalStatus, 'active');
  license = await getLicenseByKeyHash(env, keyHash);
  assert.strictEqual(license.cancelAtPeriodEnd, true);

  const deleted = stripeEvent('customer.subscription.deleted', {
    id: 'sub_lifecycle',
    object: 'subscription',
    customer: 'cus_lifecycle',
    status: 'canceled',
    canceled_at: period2End,
    metadata: { qagentKeyHash: keyHash },
    items: { data: [{ current_period_start: period2Start, current_period_end: period2End }] },
  }, 'evt_sub_deleted');

  const deletedResult = await postStripeEvent(env, deleted);
  assert.strictEqual(deletedResult.res.status, 200);
  assert.strictEqual(deletedResult.json.transition.finalStatus, 'canceled');

  // Out-of-order delivery: an older paid invoice arriving after cancellation must
  // never reactivate the license.
  const stalePaid = stripeEvent('invoice.paid', {
    id: 'in_stale',
    object: 'invoice',
    customer: 'cus_lifecycle',
    amount_paid: 5900,
    currency: 'brl',
    parent: {
      type: 'subscription_details',
      subscription_details: {
        subscription: 'sub_lifecycle',
        metadata: { qagentKeyHash: keyHash },
      },
    },
    lines: { data: [{ period: { start: period1Start, end: period1End } }] },
  }, 'evt_stale_paid');
  stalePaid.created = period1Start - 120; // older than the cancellation event applied above
  const staleResult = await postStripeEvent(env, stalePaid);
  assert.strictEqual(staleResult.res.status, 200);
  assert.strictEqual(staleResult.json.transition.updated, false);
  assert.strictEqual(staleResult.json.transition.reason, 'stale_event');
  license = await getLicenseByKeyHash(env, keyHash);
  assert.strictEqual(license.status, 'canceled');

  // A new paid Checkout after cancellation can reactivate the same license.
  const reactivate = stripeEvent('checkout.session.completed', {
    id: 'cs_reactivate',
    object: 'checkout.session',
    mode: 'subscription',
    payment_status: 'paid',
    customer: 'cus_lifecycle',
    subscription: 'sub_lifecycle_2',
    currency: 'brl',
    client_reference_id: keyHash,
    metadata: { qagentKeyHash: keyHash },
    customer_details: { email: signup.customer.email },
  }, 'evt_reactivate');

  const reactivated = await postStripeEvent(env, reactivate);
  assert.strictEqual(reactivated.res.status, 200);
  assert.strictEqual(reactivated.json.transition.finalStatus, 'active');
}

await testCheckoutMetadataUsesHash();
testCurrentStripeEventNormalization();
await testSignatureMultipleV1AndTolerance();
await testNativeSubscriptionLifecycle();

console.log('Stripe subscription billing tests passed ✅');
