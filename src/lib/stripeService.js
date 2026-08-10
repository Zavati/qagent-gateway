import { hmacSha256Hex } from './webhookSecurity.js';
import { hashClientKey } from './keyService.js';

// Stripe adapter kept dependency-light for Cloudflare Workers.
// Responsibilities:
// - create Checkout Sessions
// - verify Stripe webhook signatures
// - normalize Stripe snapshot events to QAgent's internal billing contract

async function toHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stableStringify(obj) {
  if (obj == null) return 'null';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => `${k}:${stableStringify(obj[k])}`).join(',') + '}';
}

async function computeDeterministicIdempotencyKey(clientKey, priceId, quantity, metadata, mode, successUrl, cancelUrl) {
  try {
    const metaStr = stableStringify(metadata || {});
    const input = `${clientKey}|${priceId}|${String(quantity)}|${String(mode || '')}|${metaStr}|${successUrl || ''}|${cancelUrl || ''}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return `idem_${(await toHex(digest)).slice(0, 32)}`;
  } catch {
    try { return `idem_${crypto.randomUUID()}`; } catch { return `idem_${Date.now()}`; }
  }
}

export async function createCheckoutSession(env, { clientKey, priceId, successUrl, cancelUrl, quantity = 1, metadata = {}, idempotencyKey = null }) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY missing');

  // Resolve the price type so recurring prices create a subscription Checkout Session.
  let detectedMode = 'payment';
  try {
    const priceRes = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const priceText = await priceRes.text();
    try {
      const priceParsed = JSON.parse(priceText);
      if (priceParsed && priceParsed.recurring) detectedMode = 'subscription';
    } catch {
      console.warn('stripeService: failed to parse price lookup response', { status: priceRes.status });
    }
  } catch (e) {
    console.warn('stripeService: price lookup failed, defaulting to `payment` mode', e?.message || String(e));
  }

  // A clientKey is an authentication credential. Never persist the raw value in Stripe metadata.
  // We only send the irreversible SHA-256 key hash for reconciliation.
  const keyHash = await hashClientKey(clientKey);
  const safeMetadata = { ...metadata, qagentKeyHash: keyHash };

  const body = {
    mode: detectedMode,
    line_items: [{ price: priceId, quantity }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: keyHash,
    metadata: safeMetadata,
  };

  // In subscription mode, propagate QAgent reconciliation metadata to the underlying
  // Subscription. Stripe snapshots this metadata into subscription invoice events.
  if (detectedMode === 'subscription') {
    body.subscription_data = { metadata: safeMetadata };
  }

  let idem = idempotencyKey || null;
  if (!idem && clientKey) {
    idem = await computeDeterministicIdempotencyKey(clientKey, priceId, quantity, metadata, detectedMode, successUrl, cancelUrl);
  }

  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idem) headers['Idempotency-Key'] = idem;

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers,
    body: new URLSearchParams(flattenForForm(body)).toString(),
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('Stripe: non-json response', { status: res.status });
    throw Object.assign(new Error('Stripe API error'), { status: res.status });
  }
  if (!res.ok) {
    try { console.error('Stripe API error', { status: res.status, type: parsed?.error?.type || null, code: parsed?.error?.code || null }); } catch {}
    throw Object.assign(new Error('Stripe API error'), { status: res.status, body: parsed });
  }
  return parsed;
}

function flattenForForm(obj, prefix = '') {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const el = v[i];
        const arrKey = `${key}[${i}]`;
        if (el == null) continue;
        if (typeof el === 'object' && !Array.isArray(el)) {
          Object.assign(out, flattenForForm(el, arrKey));
        } else if (Array.isArray(el)) {
          out[arrKey] = JSON.stringify(el);
        } else {
          out[arrKey] = String(el);
        }
      }
    } else if (typeof v === 'object') {
      Object.assign(out, flattenForForm(v, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

function equalSafe(a, b) {
  const aStr = String(a || '');
  const bStr = String(b || '');
  if (aStr.length !== bStr.length) return false;
  let out = 0;
  for (let i = 0; i < aStr.length; i++) out |= aStr.charCodeAt(i) ^ bStr.charCodeAt(i);
  return out === 0;
}

export async function verifyStripeWebhook(req, env) {
  const sigHeader = req.headers.get('Stripe-Signature') || req.headers.get('stripe-signature');
  const secret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  const bodyText = await req.clone().text();
  if (!sigHeader || !secret) return { ok: false, reason: 'missing_signature_or_secret' };

  const timestamps = [];
  const v1Signatures = [];
  for (const part of sigHeader.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (key === 't') timestamps.push(value);
    if (key === 'v1') v1Signatures.push(value);
  }

  const timestamp = timestamps[0];
  const tsNumber = Number(timestamp);
  if (!timestamp || !Number.isFinite(tsNumber) || v1Signatures.length === 0) {
    return { ok: false, reason: 'invalid_sig_header' };
  }

  const maxSkewSec = Number(env.STRIPE_WEBHOOK_MAX_SKEW_SEC || 300);
  if (!Number.isFinite(maxSkewSec) || maxSkewSec <= 0) return { ok: false, reason: 'invalid_tolerance' };
  if (Math.abs(Date.now() - (tsNumber * 1000)) > maxSkewSec * 1000) {
    return { ok: false, reason: 'timestamp_outside_tolerance' };
  }

  const computed = await hmacSha256Hex(secret, `${timestamp}.${bodyText}`);
  if (!v1Signatures.some((candidate) => equalSafe(computed, candidate))) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true, payloadText: bodyText };
}

function isoFromUnix(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value != null && String(value).trim()) return value;
  }
  return null;
}

function extractSubscriptionPeriod(subscription) {
  const directStart = isoFromUnix(subscription?.current_period_start);
  const directEnd = isoFromUnix(subscription?.current_period_end);
  if (directStart || directEnd) return { periodStart: directStart, periodEnd: directEnd };

  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const starts = items.map((item) => Number(item?.current_period_start)).filter((n) => Number.isFinite(n) && n > 0);
  const ends = items.map((item) => Number(item?.current_period_end)).filter((n) => Number.isFinite(n) && n > 0);
  return {
    periodStart: starts.length ? isoFromUnix(Math.min(...starts)) : null,
    periodEnd: ends.length ? isoFromUnix(Math.max(...ends)) : null,
  };
}

function extractInvoicePeriod(invoice) {
  // Prefer invoice line service periods. Stripe notes invoice.period_* is not always
  // the actual subscription service period, especially around prorations.
  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  const starts = [];
  const ends = [];
  for (const line of lines) {
    const start = Number(line?.period?.start);
    const end = Number(line?.period?.end);
    if (Number.isFinite(start) && start > 0) starts.push(start);
    if (Number.isFinite(end) && end > 0) ends.push(end);
  }
  if (starts.length || ends.length) {
    return {
      periodStart: starts.length ? isoFromUnix(Math.min(...starts)) : null,
      periodEnd: ends.length ? isoFromUnix(Math.max(...ends)) : null,
    };
  }
  return {
    periodStart: isoFromUnix(invoice?.period_start),
    periodEnd: isoFromUnix(invoice?.period_end),
  };
}

function extractInvoiceSubscriptionId(invoice) {
  return firstNonEmpty(
    invoice?.parent?.subscription_details?.subscription,
    invoice?.subscription_details?.subscription,
    invoice?.subscription
  );
}

function extractInvoiceMetadata(invoice) {
  return {
    ...(invoice?.metadata || {}),
    ...(invoice?.subscription_details?.metadata || {}),
    ...(invoice?.parent?.subscription_details?.metadata || {}),
  };
}

function normalizeSubscriptionStatus(status) {
  const raw = String(status || '').toLowerCase();
  if (raw === 'active' || raw === 'trialing') return 'active';
  if (raw === 'past_due' || raw === 'incomplete') return 'past_due';
  if (raw === 'canceled' || raw === 'cancelled' || raw === 'unpaid' || raw === 'incomplete_expired' || raw === 'paused') return 'canceled';
  return null;
}

function buildReference({ metadata = {}, fallbackReference = null, customerId = null, subscriptionId = null, invoiceId = null }) {
  const keyHash = firstNonEmpty(metadata.qagentKeyHash, metadata.keyHash, fallbackReference);
  // Legacy sessions created before Foundation 05.2 can still contain raw clientKey.
  const clientKey = firstNonEmpty(metadata.clientKey);
  return {
    clientKey,
    keyHash,
    providerCustomerId: customerId || null,
    providerSubscriptionId: subscriptionId || null,
    providerInvoiceId: invoiceId || null,
  };
}

export function normalizeStripeEvent(payloadJson) {
  const providerEventType = String(payloadJson?.type || '');
  const obj = payloadJson?.data?.object || {};
  const occurredAt = payloadJson?.created ? new Date(payloadJson.created * 1000).toISOString() : new Date().toISOString();

  const base = {
    provider: 'stripe',
    eventId: payloadJson?.id || obj?.id || null,
    eventType: providerEventType || 'unknown',
    providerEventType: providerEventType || 'unknown',
    occurredAt,
    reference: {},
    billing: { status: 'unknown' },
    processing: { action: 'ignore', sendAccessToken: false },
  };

  if (providerEventType === 'checkout.session.completed') {
    const metadata = obj.metadata || {};
    base.eventType = 'payment.completed';
    base.reference = buildReference({
      metadata,
      fallbackReference: obj.client_reference_id,
      customerId: obj.customer || null,
      subscriptionId: obj.subscription || null,
    });
    base.customer = { customerId: obj.customer || null, email: obj?.customer_details?.email || null };
    base.billing = {
      amount: obj.amount_total ?? null,
      currency: obj.currency || null,
      status: obj.payment_status === 'unpaid' ? 'past_due' : 'active',
      periodStart: null,
      periodEnd: null,
    };
    base.processing = obj.payment_status === 'unpaid'
      ? { action: 'mapping_only', sendAccessToken: false, kind: 'initial_checkout_unpaid' }
      : { action: 'transition', sendAccessToken: true, kind: 'initial_checkout' };
    return base;
  }

  if (providerEventType === 'invoice.paid' || providerEventType === 'invoice.payment_succeeded') {
    const metadata = extractInvoiceMetadata(obj);
    const period = extractInvoicePeriod(obj);
    base.eventType = 'invoice.paid';
    base.reference = buildReference({
      metadata,
      customerId: obj.customer || null,
      subscriptionId: extractInvoiceSubscriptionId(obj),
      invoiceId: obj.id || null,
    });
    base.customer = { customerId: obj.customer || null, email: obj.customer_email || null };
    base.billing = {
      amount: obj.amount_paid ?? obj.total ?? null,
      currency: obj.currency || null,
      status: 'active',
      ...period,
    };
    base.processing = { action: 'transition', sendAccessToken: false, kind: 'invoice_paid' };
    return base;
  }

  if (providerEventType === 'invoice.payment_failed') {
    const metadata = extractInvoiceMetadata(obj);
    const period = extractInvoicePeriod(obj);
    base.eventType = 'invoice.payment_failed';
    base.reference = buildReference({
      metadata,
      customerId: obj.customer || null,
      subscriptionId: extractInvoiceSubscriptionId(obj),
      invoiceId: obj.id || null,
    });
    base.customer = { customerId: obj.customer || null, email: obj.customer_email || null };
    base.billing = {
      amount: obj.amount_due ?? obj.total ?? null,
      currency: obj.currency || null,
      status: 'past_due',
      ...period,
    };
    base.processing = { action: 'transition', sendAccessToken: false, kind: 'invoice_failed' };
    return base;
  }

  if (providerEventType === 'customer.subscription.created') {
    const period = extractSubscriptionPeriod(obj);
    base.reference = buildReference({
      metadata: obj.metadata || {},
      customerId: obj.customer || null,
      subscriptionId: obj.id || null,
    });
    base.customer = { customerId: obj.customer || null, email: null };
    base.billing = {
      status: normalizeSubscriptionStatus(obj.status) || 'unknown',
      ...period,
      cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
      cancelAt: isoFromUnix(obj.cancel_at),
    };
    // Creation is intentionally mapping-only. Initial access is granted by a successful
    // Checkout/invoice event, never merely because a Subscription object was created.
    base.processing = { action: 'mapping_only', sendAccessToken: false, kind: 'subscription_created' };
    return base;
  }

  if (providerEventType === 'customer.subscription.updated') {
    const period = extractSubscriptionPeriod(obj);
    const status = normalizeSubscriptionStatus(obj.status);
    base.reference = buildReference({
      metadata: obj.metadata || {},
      customerId: obj.customer || null,
      subscriptionId: obj.id || null,
    });
    base.customer = { customerId: obj.customer || null, email: null };
    base.billing = {
      status: status || 'unknown',
      ...period,
      cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
      cancelAt: isoFromUnix(obj.cancel_at),
    };
    base.processing = status
      ? { action: 'transition', sendAccessToken: false, kind: 'subscription_sync' }
      : { action: 'mapping_only', sendAccessToken: false, kind: 'subscription_sync_unknown_status' };
    return base;
  }

  if (providerEventType === 'customer.subscription.deleted') {
    const period = extractSubscriptionPeriod(obj);
    base.reference = buildReference({
      metadata: obj.metadata || {},
      customerId: obj.customer || null,
      subscriptionId: obj.id || null,
    });
    base.customer = { customerId: obj.customer || null, email: null };
    base.billing = {
      status: 'canceled',
      ...period,
      cancelAtPeriodEnd: false,
      cancelAt: isoFromUnix(obj.canceled_at) || isoFromUnix(obj.ended_at),
    };
    base.processing = { action: 'transition', sendAccessToken: false, kind: 'subscription_deleted' };
    return base;
  }

  // payment_intent.succeeded and all unrelated Stripe events are deliberately ignored.
  // Subscription entitlement changes are driven by Checkout, Invoice and Subscription events.
  return base;
}
