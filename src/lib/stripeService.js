import { hmacSha256Hex } from './webhookSecurity.js';

// Minimal Stripe helper: create Checkout session and normalize incoming stripe events
// This file avoids direct stripe-node dependency to keep worker-lightweight; uses fetch.

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

async function computeDeterministicIdempotencyKey(clientKey, priceId, quantity, metadata, mode) {
  try {
    const metaStr = stableStringify(metadata || {});
    const input = `${clientKey}|${priceId}|${String(quantity)}|${String(mode || '')}|${metaStr}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return `idem_${(await toHex(digest)).slice(0, 32)}`;
  } catch (e) {
    // fallback to random uuid-like string
    try { return `idem_${crypto.randomUUID()}`; } catch { return `idem_${Date.now()}`; }
  }
}

export async function createCheckoutSession(env, { clientKey, priceId, successUrl, cancelUrl, quantity = 1, metadata = {}, idempotencyKey = null }) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY missing');

  // Detect whether the price is recurring (subscription) or one-time (payment).
  // If we can fetch the price object, set mode to 'subscription' for recurring prices.
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
    } catch (e) {
      // ignore parse error and fall back to default 'payment'
      console.warn('stripeService: failed to parse price lookup response', { status: priceRes.status, body: priceText });
    }
  } catch (e) {
    console.warn('stripeService: price lookup failed, defaulting to `payment` mode', e && e.message);
  }

  const body = {
    mode: detectedMode,
    line_items: [{ price: priceId, quantity }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { ...metadata, clientKey },
  };

  // determine idempotency key: prefer provided, else compute deterministic key when clientKey present
  let idem = idempotencyKey || null;
  if (!idem && clientKey) {
    idem = await computeDeterministicIdempotencyKey(clientKey, priceId, quantity, metadata, detectedMode);
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
  try { parsed = JSON.parse(text); } catch (e) { console.error('Stripe: non-json response', { status: res.status, body: text }); throw Object.assign(new Error('Stripe API error'), { status: res.status, body: text }); }
  if (!res.ok) {
    // Log full error details to worker console for debugging (do NOT surface secret keys)
    try { console.error('Stripe API error', { status: res.status, body: parsed }); } catch (e) { console.error('Stripe API error - failed to log parsed body', e); }
    throw Object.assign(new Error('Stripe API error'), { status: res.status, body: parsed });
  }
  return parsed;
}

function flattenForForm(obj, prefix = '') {
  // converts nested object to flat form fields required by Stripe e.g. metadata[key]=value
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

export async function verifyStripeWebhook(req, env) {
  // prefer native Stripe signature verification if STRIPE_WEBHOOK_SECRET present
  const sigHeader = req.headers.get('Stripe-Signature') || req.headers.get('stripe-signature');
  const secret = env.STRIPE_WEBHOOK_SECRET;
  const bodyText = await req.clone().text();
  if (!sigHeader || !secret) {
    // fallback: not enough data to verify via Stripe; return false
    return { ok: false, reason: 'missing_signature_or_secret' };
  }

  // Stripe uses its own signing scheme; we do a simple verify by HMAC of payload+timestamp if possible
  // This is a lightweight check: compute HMAC-SHA256 of body and compare to signature tokens (prefers security via STRIPE_WEBHOOK_SECRET)
  const parts = sigHeader.split(',').map(s => s.trim());
  const sigPairs = {};
  for (const p of parts) {
    const [k,v] = p.split('=');
    if (k && v) sigPairs[k] = v;
  }
  if (!sigPairs.t || !sigPairs.v1) return { ok: false, reason: 'invalid_sig_header' };

  const computed = hmacSha256Hex(secret, `${sigPairs.t}.${bodyText}`);
  if (computed !== sigPairs.v1) return { ok: false, reason: 'mismatch' };
  return { ok: true, payloadText: bodyText };
}

export function normalizeStripeEvent(payloadJson) {
  // Normalize fields to internal webhook contract used by /v1/webhooks/payment
  const t = payloadJson.type || '';
  const sess = payloadJson.data?.object || {};
  const provider = 'stripe';
  const base = {
    provider,
    eventId: payloadJson.id || sess.id || null,
    eventType: t,
    occurredAt: payloadJson.created ? new Date(payloadJson.created * 1000).toISOString() : new Date().toISOString(),
    raw: payloadJson,
  };

  // try to extract clientKey from metadata or client_reference_id
  const metadata = sess.metadata || {};
  const clientKey = metadata.clientKey || sess.client_reference_id || null;
  const reference = { clientKey };

  if (t === 'checkout.session.completed') {
    const customerId = sess.customer || (sess.customer_details && sess.customer_details.email) || null;
    const amount = sess.amount_total || null;
    const currency = sess.currency || null;
    // Normalize to internal contract: set billing.status to 'active' so licenseService
    // can infer an active license state directly. Also set a completed-style eventType.
    base.billing = { amount, currency, status: 'active' };
    base.reference = { ...reference, providerCustomerId: customerId, providerSubscriptionId: sess.subscription || null };
    base.eventType = 'payment.completed';
  }

  if (!base.eventType) base.eventType = t || 'unknown';
  return base;
}
