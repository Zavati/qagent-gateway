import assert from 'node:assert';
import worker from '../src/index.js';

async function signWebhookPayload(secret, ts, payloadText) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = `${ts}.${payloadText}`;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${ts},v1=${hex}`;
}

function createInMemoryEnv() {
  const mem = new Map();
  const env = {
    ENVIRONMENT: 'development',
    CLIENT_KEY_MODE: 'test',
    WEBHOOK_SIGNING_SECRET: 'unit-test-secret',
    WEBHOOK_MAX_SKEW_SEC: '300',
    WEBHOOK_REPLAY_TTL_SEC: '900',
    MAX_BODY_BYTES: '250000',
    QAGENT_KV: {
      async get(key) { return mem.has(key) ? mem.get(key) : null; },
      async put(key, val) { mem.set(key, val); },
    },
  };
  return { env, mem };
}

async function signupTrialAndGetCredentials(env) {
  const signupReq = new Request('https://api.apiqagent.com/v1/signup-trial', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'contract.webhook@empresa.com',
      name: 'Contract Webhook',
      company: 'Empresa Teste',
      source: 'contract-suite',
      acceptTerms: true,
      acceptPrivacy: true,
    }),
  });

  const signupRes = await worker.fetch(signupReq, env);
  assert.strictEqual(signupRes.status, 201);
  const signupJson = await signupRes.json();
  assert.ok(signupJson?.credentials?.clientKey);
  return signupJson;
}

async function postSignedPaymentWebhook({ env, payload, timestamp }) {
  const body = JSON.stringify(payload);
  const sig = await signWebhookPayload(env.WEBHOOK_SIGNING_SECRET, timestamp, body);
  const req = new Request('https://api.apiqagent.com/v1/webhooks/payment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-QAgent-Signature': sig,
    },
    body,
  });
  const res = await worker.fetch(req, env);
  const json = await res.json();
  return { res, json };
}

async function getLicenseStatus(env, clientKey) {
  const req = new Request('https://api.apiqagent.com/v1/license', {
    method: 'GET',
    headers: { Authorization: `Bearer ${clientKey}` },
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  return body?.license?.status;
}

function assertContractShape(body) {
  assert.strictEqual(typeof body, 'object');
  assert.strictEqual(body.status, 'ok');
  assert.strictEqual(typeof body.processed, 'boolean');
  if (body.processed) {
    assert.strictEqual(typeof body.idempotent, 'boolean');
    assert.strictEqual(typeof body.transition, 'object');
    assert.strictEqual(typeof body.transition.updated, 'boolean');
    assert.strictEqual(typeof body.transition.blocked, 'boolean');
    assert.ok('finalStatus' in body.transition);
  }
}

export async function runWebhookContractTests() {
  const { env } = createInMemoryEnv();
  const signup = await signupTrialAndGetCredentials(env);
  const clientKey = signup.credentials.clientKey;

  let ts = Math.floor(Date.now() / 1000);
  const basePayload = {
    provider: 'stripe',
    occurredAt: new Date().toISOString(),
    customer: {
      customerId: signup.customer.customerId,
      email: signup.customer.email,
    },
    reference: {
      clientKey,
      providerCustomerId: 'cus_contract_1',
      providerSubscriptionId: 'sub_contract_1',
    },
    billing: {
      plan: 'pro',
      currency: 'BRL',
      amount: 5900,
      interval: 'month',
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
    },
  };

  const approvedPayload = {
    ...basePayload,
    eventId: 'evt_contract_approved_1',
    eventType: 'checkout.session.completed',
    billing: { ...basePayload.billing, status: 'active' },
  };
  const approvedResult = await postSignedPaymentWebhook({ env, payload: approvedPayload, timestamp: ts++ });
  assert.strictEqual(approvedResult.res.status, 200);
  assertContractShape(approvedResult.json);
  assert.strictEqual(approvedResult.json.processed, true);
  assert.strictEqual(approvedResult.json.transition.finalStatus, 'active');
  assert.strictEqual(await getLicenseStatus(env, clientKey), 'active');

  const approvedReplay = await postSignedPaymentWebhook({ env, payload: approvedPayload, timestamp: ts++ });
  assert.strictEqual(approvedReplay.res.status, 200);
  assertContractShape(approvedReplay.json);
  assert.strictEqual(approvedReplay.json.processed, false);
  assert.strictEqual(approvedReplay.json.idempotent, true);

  const failedPayload = {
    ...basePayload,
    eventId: 'evt_contract_failed_1',
    eventType: 'invoice.payment_failed',
    billing: { ...basePayload.billing, status: 'past_due' },
  };
  const failedResult = await postSignedPaymentWebhook({ env, payload: failedPayload, timestamp: ts++ });
  assert.strictEqual(failedResult.res.status, 200);
  assertContractShape(failedResult.json);
  assert.strictEqual(failedResult.json.processed, true);
  assert.strictEqual(failedResult.json.transition.finalStatus, 'past_due');
  assert.strictEqual(await getLicenseStatus(env, clientKey), 'past_due');

  const renewedPayload = {
    ...basePayload,
    eventId: 'evt_contract_renewed_1',
    eventType: 'invoice.paid',
    billing: { ...basePayload.billing, status: 'active' },
  };
  const renewedResult = await postSignedPaymentWebhook({ env, payload: renewedPayload, timestamp: ts++ });
  assert.strictEqual(renewedResult.res.status, 200);
  assertContractShape(renewedResult.json);
  assert.strictEqual(renewedResult.json.processed, true);
  assert.strictEqual(renewedResult.json.transition.finalStatus, 'active');
  assert.strictEqual(await getLicenseStatus(env, clientKey), 'active');

  const canceledPayload = {
    ...basePayload,
    eventId: 'evt_contract_canceled_1',
    eventType: 'customer.subscription.deleted',
    billing: { ...basePayload.billing, status: 'canceled' },
  };
  const canceledResult = await postSignedPaymentWebhook({ env, payload: canceledPayload, timestamp: ts++ });
  assert.strictEqual(canceledResult.res.status, 200);
  assertContractShape(canceledResult.json);
  assert.strictEqual(canceledResult.json.processed, true);
  assert.strictEqual(canceledResult.json.transition.finalStatus, 'canceled');
  assert.strictEqual(await getLicenseStatus(env, clientKey), 'canceled');
}
