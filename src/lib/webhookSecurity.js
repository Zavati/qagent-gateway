function parseSignatureHeader(rawHeader) {
  const raw = String(rawHeader || '').trim();
  if (!raw) return null;

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const out = {};
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    const key = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }

  if (!out.t || !out.v1) return null;
  const ts = Number(out.t);
  if (!Number.isFinite(ts)) return null;

  return { ts, v1: out.v1 };
}

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toHex(new Uint8Array(signature));
}

function equalSafe(a, b) {
  const aStr = String(a || '');
  const bStr = String(b || '');
  if (aStr.length !== bStr.length) return false;
  let out = 0;
  for (let i = 0; i < aStr.length; i++) {
    out |= aStr.charCodeAt(i) ^ bStr.charCodeAt(i);
  }
  return out === 0;
}

export async function verifyWebhookSignatureOrThrow({
  env,
  route,
  signatureHeader,
  rawBody,
  nowMs = Date.now(),
}) {
  const secret = String(env?.WEBHOOK_SIGNING_SECRET || '').trim();
  if (!secret) {
    const err = new Error('Webhook signing secret não configurado.');
    err.status = 500;
    throw err;
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    const err = new Error('Assinatura do webhook ausente ou inválida.');
    err.status = 401;
    throw err;
  }

  const maxSkewSec = Number(env?.WEBHOOK_MAX_SKEW_SEC || 300);
  const driftMs = Math.abs(nowMs - (parsed.ts * 1000));
  if (driftMs > maxSkewSec * 1000) {
    const err = new Error('Assinatura expirada (timestamp fora da janela).');
    err.status = 401;
    throw err;
  }

  const payloadToSign = `${parsed.ts}.${rawBody}`;
  const expected = await hmacSha256Hex(secret, payloadToSign);
  if (!equalSafe(expected, parsed.v1)) {
    const err = new Error('Assinatura do webhook inválida.');
    err.status = 401;
    throw err;
  }

  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  const replayFingerprint = await sha256Hex(`${route}:${parsed.ts}:${parsed.v1}`);
  const replayKey = `webhook_replay:${replayFingerprint}`;
  const seen = await env.QAGENT_KV.get(replayKey);
  if (seen) {
    const err = new Error('Requisição de webhook repetida (replay detectado).');
    err.status = 409;
    throw err;
  }

  const replayTtlSec = Number(env?.WEBHOOK_REPLAY_TTL_SEC || Math.max(600, maxSkewSec * 2));
  await env.QAGENT_KV.put(replayKey, JSON.stringify({ route, ts: parsed.ts, seenAt: new Date(nowMs).toISOString() }), { expirationTtl: replayTtlSec });
}
