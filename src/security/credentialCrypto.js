const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBytes(value) {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function normalizeKeyVersion(value) {
  const version = String(value || 'v1').trim().toLowerCase();
  if (!/^v[1-9][0-9]*$/.test(version)) {
    const err = new Error('Versão da chave de criptografia inválida.');
    err.status = 500;
    err.code = 'AI_CREDENTIALS_KEY_VERSION_INVALID';
    throw err;
  }
  return version;
}

function keyEnvName(version) {
  return `AI_CREDENTIALS_KEY_${normalizeKeyVersion(version).toUpperCase()}`;
}

function getRawMasterKey(env, version) {
  const name = keyEnvName(version);
  const raw = String(env?.[name] || '').trim();
  if (!raw) {
    const err = new Error(`${name} não configurado no ambiente.`);
    err.status = 500;
    err.code = 'AI_CREDENTIALS_ENCRYPTION_KEY_MISSING';
    throw err;
  }
  return raw;
}

async function importAesKey(env, version) {
  let keyBytes;
  try {
    keyBytes = base64UrlToBytes(getRawMasterKey(env, version));
  } catch (e) {
    if (e?.code) throw e;
    const err = new Error('Chave de criptografia das credenciais de IA inválida.');
    err.status = 500;
    err.code = 'AI_CREDENTIALS_ENCRYPTION_KEY_INVALID';
    throw err;
  }

  if (keyBytes.byteLength !== 32) {
    const err = new Error('Chave de criptografia das credenciais de IA deve possuir 32 bytes.');
    err.status = 500;
    err.code = 'AI_CREDENTIALS_ENCRYPTION_KEY_INVALID';
    throw err;
  }

  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function getActiveCredentialKeyVersion(env) {
  return normalizeKeyVersion(env?.AI_CREDENTIALS_ACTIVE_KEY_VERSION || 'v1');
}

export async function encryptCredentialPayload(env, credentials, { keyVersion } = {}) {
  const version = normalizeKeyVersion(keyVersion || getActiveCredentialKeyVersion(env));
  const key = await importAesKey(env, version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(credentials || {}));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));

  return {
    ciphertext: bytesToBase64Url(encrypted),
    iv: bytesToBase64Url(iv),
    keyVersion: version,
  };
}

export async function decryptCredentialPayload(env, encryptedRecord) {
  const version = normalizeKeyVersion(encryptedRecord?.keyVersion || 'v1');
  const key = await importAesKey(env, version);
  try {
    const iv = base64UrlToBytes(encryptedRecord?.iv || '');
    const ciphertext = base64UrlToBytes(encryptedRecord?.ciphertext || '');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const parsed = JSON.parse(decoder.decode(plaintext));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid payload');
    return parsed;
  } catch {
    const err = new Error('Não foi possível descriptografar as credenciais de IA.');
    err.status = 500;
    err.code = 'AI_CREDENTIALS_DECRYPT_FAILED';
    throw err;
  }
}
