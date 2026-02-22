export function safeId(value) {
  const s = String(value || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function randomBase62(len) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function generateClientKey(environment = 'live') {
  const mode = String(environment || 'live').toLowerCase() === 'test' ? 'test' : 'live';
  return `qag_${mode}_${randomBase62(40)}`;
}

export function validateClientKeyFormat(clientKey) {
  const v = String(clientKey || '').trim();
  return /^qag_(live|test)_[A-Za-z0-9]{24,}$/.test(v);
}

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashClientKey(clientKey) {
  const value = String(clientKey || '').trim();
  if (!value) {
    const err = new Error('clientKey ausente.');
    err.status = 400;
    throw err;
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

export function generateAccessToken(prefix = 'access', len = 48) {
  return `${prefix}_${randomBase62(len)}`;
}

export async function hashAccessToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    const err = new Error('access token ausente.');
    err.status = 400;
    throw err;
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

export function isAdminToken(env, token) {
  const raw = (env?.QAGENT_ADMIN_TOKENS || "").trim();
  if (!raw) return false;
  return raw.split(",").map((s) => s.trim()).filter(Boolean).includes(token);
}
