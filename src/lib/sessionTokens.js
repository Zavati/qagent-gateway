// Session token utilities (JWT-like) using HMAC-SHA256
// Designed for Cloudflare Workers / modern runtimes with crypto.subtle

const encoder = new TextEncoder();

function base64urlEncode(bytes) {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // eslint-disable-next-line no-undef
  const b64 = (typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64'));
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(str) {
  let b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  // eslint-disable-next-line no-undef
  const binary = (typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function getSessionSecret(env) {
  const secret = String(env?.SESSION_SECRET || '').trim();
  if (!secret) {
    const err = new Error('SESSION_SECRET não configurado no ambiente.');
    err.status = 500;
    throw err;
  }
  return secret;
}

async function getHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export async function createSessionToken(env, payload, options = {}) {
  const secret = getSessionSecret(env);
  const header = { alg: 'HS256', typ: 'JWT' };

  const iat = nowSeconds();
  const ttl = Number(options.ttlSeconds || env.SESSION_TTL_SEC || 60 * 60 * 12); // default 12h
  const exp = iat + ttl;

  const fullPayload = { ...payload, iat, exp };

  const headerBytes = encoder.encode(JSON.stringify(header));
  const payloadBytes = encoder.encode(JSON.stringify(fullPayload));

  const encodedHeader = base64urlEncode(headerBytes);
  const encodedPayload = base64urlEncode(payloadBytes);
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await getHmacKey(secret);
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)),
  );
  const encodedSig = base64urlEncode(sigBytes);

  return {
    token: `${signingInput}.${encodedSig}`,
    iat,
    exp,
  };
}

export async function verifySessionToken(env, token) {
  const secret = getSessionSecret(env);
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, reason: 'missing' };

  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const [encodedHeader, encodedPayload, encodedSig] = parts;

  let payloadJson;
  try {
    const payloadBytes = base64urlDecode(encodedPayload);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    payloadJson = JSON.parse(payloadStr);
  } catch (e) {
    return { ok: false, reason: 'payload_parse_error' };
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await getHmacKey(secret);
  const computedSigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)),
  );
  const computedSig = base64urlEncode(computedSigBytes);

  const sigBytesProvided = base64urlDecode(encodedSig);
  const sigBytesExpected = base64urlDecode(computedSig);
  if (sigBytesProvided.length !== sigBytesExpected.length) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  let diff = 0;
  for (let i = 0; i < sigBytesProvided.length; i++) {
    diff |= sigBytesProvided[i] ^ sigBytesExpected[i];
  }
  if (diff !== 0) return { ok: false, reason: 'signature_mismatch' };

  const now = nowSeconds();
  if (typeof payloadJson.exp === 'number' && now > payloadJson.exp) {
    return { ok: false, reason: 'expired', payload: payloadJson };
  }

  return { ok: true, payload: payloadJson };
}
