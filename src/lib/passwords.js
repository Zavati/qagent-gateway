// Password hashing utilities using WebCrypto PBKDF2
// This module is designed for Cloudflare Workers / modern runtimes where `crypto.subtle` is available.

// Cloudflare Workers currently limit PBKDF2 to 100k iterations.
const MAX_ITERATIONS = 100_000;
const DEFAULT_ITERATIONS = 100_000;
const KEY_LEN_BITS = 256; // 32 bytes
const SALT_LEN_BYTES = 16;
const ALGO_LABEL = 'pbkdf2-sha256';

function toBase64(bytes) {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa works in Workers; fall back for safety
  // eslint-disable-next-line no-undef
  return (typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64'));
}

function fromBase64(str) {
  // eslint-disable-next-line no-undef
  const binary = (typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function getTextEncoder() {
  return new TextEncoder();
}

export async function hashPassword(plain, options = {}) {
  const password = String(plain || '');
  if (!password) {
    const err = new Error('Senha vazia não permitida.');
    err.status = 400;
    throw err;
  }

  let iterations = Number(options.iterations || DEFAULT_ITERATIONS);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    iterations = DEFAULT_ITERATIONS;
  }
  if (iterations > MAX_ITERATIONS) {
    iterations = MAX_ITERATIONS;
  }
  const enc = getTextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN_BYTES));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    keyMaterial,
    KEY_LEN_BITS,
  );

  const hashBytes = new Uint8Array(bits);

  return {
    hash: toBase64(hashBytes),
    salt: toBase64(salt),
    iterations,
    algo: ALGO_LABEL,
  };
}

export async function verifyPassword(plain, bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  const { hash, salt, iterations, algo } = bundle;
  if (!hash || !salt || !iterations || algo !== ALGO_LABEL) return false;

  const password = String(plain || '');
  if (!password) return false;

  const enc = getTextEncoder();
  const saltBytes = fromBase64(String(salt));

  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBytes,
        iterations: Number(iterations),
      },
      keyMaterial,
      KEY_LEN_BITS,
    );

    const computed = new Uint8Array(bits);
    const expected = fromBase64(String(hash));

    if (computed.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed[i] ^ expected[i];
    }
    return diff === 0;
  } catch {
    // Se o runtime não suportar o número de iterações (ex: > MAX_ITERATIONS),
    // trate como senha inválida em vez de quebrar a request.
    return false;
  }
}
