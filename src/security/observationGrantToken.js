const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TOKEN_PREFIX = 'qog_v1';
const ISSUER = 'qagent-gateway';
const AUDIENCE = 'qagent-observation';
const DEFAULT_TTL_SECONDS = 120;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 300;

function base64urlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  // eslint-disable-next-line no-undef
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(value) {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  // eslint-disable-next-line no-undef
  const binary = typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function requireGrantSecret(env) {
  const secret = String(env?.OBSERVATION_GRANT_SECRET || '').trim();
  if (secret.length < 32) {
    const err = new Error('OBSERVATION_GRANT_SECRET não configurado ou muito curto. Use pelo menos 32 caracteres.');
    err.status = 500;
    err.code = 'OBSERVATION_GRANT_SECRET_INVALID';
    throw err;
  }
  return secret;
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function observationGrantTtlSeconds(env) {
  const configured = Number(env?.OBSERVATION_GRANT_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.trunc(configured)));
}

export async function createObservationGrantToken(env, context) {
  const secret = requireGrantSecret(env);
  const ttlSeconds = observationGrantTtlSeconds(env);
  const issuedAt = nowSeconds();
  const expiresAt = issuedAt + ttlSeconds;

  const payload = {
    ver: 1,
    iss: ISSUER,
    aud: AUDIENCE,
    jti: `qogj_${crypto.randomUUID()}`,
    organizationId: context.organizationId,
    projectId: context.projectId,
    environmentId: context.environmentId,
    pluginSessionId: context.pluginSessionId,
    iat: issuedAt,
    exp: expiresAt,
  };

  const encodedPayload = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${TOKEN_PREFIX}.${encodedPayload}`;
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)),
  );

  return {
    token: `${signingInput}.${base64urlEncode(signature)}`,
    payload,
    expiresInSeconds: ttlSeconds,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

// Kept here as the canonical verifier contract for automated tests and for the
// Observation service implementation in 07.4.3-C. qagent-observation must use
// the same secret and audience, but never the Gateway KV or ClientKey.
export async function verifyObservationGrantToken(env, token, options = {}) {
  let secret;
  try {
    secret = requireGrantSecret(env);
  } catch (error) {
    return { ok: false, reason: 'secret_invalid', error };
  }

  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, reason: 'format' };
  }

  const [prefix, encodedPayload, encodedSignature] = parts;
  const signingInput = `${prefix}.${encodedPayload}`;

  let payload;
  let signature;
  try {
    payload = JSON.parse(decoder.decode(base64urlDecode(encodedPayload)));
    signature = base64urlDecode(encodedSignature);
  } catch {
    return { ok: false, reason: 'decode' };
  }

  try {
    const key = await importHmacKey(secret);
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(signingInput),
    );
    if (!validSignature) return { ok: false, reason: 'signature' };
  } catch {
    return { ok: false, reason: 'signature' };
  }

  if (payload?.ver !== 1) return { ok: false, reason: 'version', payload };
  if (payload?.iss !== ISSUER) return { ok: false, reason: 'issuer', payload };
  if (payload?.aud !== AUDIENCE) return { ok: false, reason: 'audience', payload };

  const now = Number(options.nowSeconds ?? nowSeconds());
  if (!Number.isFinite(payload?.iat) || !Number.isFinite(payload?.exp)) {
    return { ok: false, reason: 'claims', payload };
  }
  if (payload.iat > now + 30) return { ok: false, reason: 'issued_in_future', payload };
  if (now >= payload.exp) return { ok: false, reason: 'expired', payload };

  for (const field of ['organizationId', 'projectId', 'environmentId', 'pluginSessionId']) {
    if (!String(payload?.[field] || '').trim()) {
      return { ok: false, reason: `missing_${field}`, payload };
    }
  }

  return { ok: true, payload };
}
