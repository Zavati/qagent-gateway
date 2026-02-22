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

export function emailEventKey(eventId) {
  return `email_event:${eventId}`;
}

export function emailDispatchedKey(eventId) {
  return `email_dispatched:${eventId}`;
}

export function buildSignupEmailEvent({ customerId, email, keyHash, template = 'trial_welcome' }) {
  return {
    eventId: `mail_${crypto.randomUUID()}`,
    occurredAt: nowIso(),
    type: 'email.dispatch.requested',
    customerId,
    email,
    template,
    metadata: { keyHash },
    status: 'pending',
    createdAt: nowIso(),
  };
}

export async function savePendingEmailEvent(env, event) {
  await kvPutJson(env, emailEventKey(event.eventId), event);
  return event;
}

export async function markEmailEventStatus(env, eventId, status, extra = {}) {
  const key = emailEventKey(eventId);
  const current = await kvGetJson(env, key);
  if (!current) return null;

  const updated = {
    ...current,
    status,
    updatedAt: nowIso(),
    ...extra,
  };
  await kvPutJson(env, key, updated);
  return updated;
}

export async function getEmailDispatchAck(env, eventId) {
  return await kvGetJson(env, emailDispatchedKey(eventId));
}

export async function saveEmailDispatchAck(env, payload) {
  const key = emailDispatchedKey(payload.eventId);
  const current = await kvGetJson(env, key);
  if (current) return { ack: current, created: false };

  const ack = {
    ...payload,
    receivedAt: nowIso(),
  };
  await kvPutJson(env, key, ack);
  return { ack, created: true };
}
