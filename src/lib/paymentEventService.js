export function paymentEventKey(provider, eventId) {
  return `payment_event:${provider}:${eventId}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function kvGetJson(env, key) {
  const raw = await env.QAGENT_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function kvPutJson(env, key, value) {
  await env.QAGENT_KV.put(key, JSON.stringify(value));
}

export async function getPaymentEvent(env, provider, eventId) {
  return await kvGetJson(env, paymentEventKey(provider, eventId));
}

export async function savePaymentEvent(env, payload) {
  const key = paymentEventKey(payload.provider, payload.eventId);
  const current = await kvGetJson(env, key);
  if (current) return { event: current, created: false };

  const event = {
    ...payload,
    receivedAt: payload.receivedAt || nowIso(),
    processedAt: payload.processedAt || nowIso(),
    status: payload.status || 'processed',
  };
  await kvPutJson(env, key, event);
  return { event, created: true };
}
