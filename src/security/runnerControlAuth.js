export const RUNNER_CONTROL_AUTH_VERSION = 'qagent.runner-control.v1';
const DEFAULT_MAX_SKEW_SECONDS = 60;

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSecret(secret) {
  const value = String(secret || '');
  if (value.length < 32) {
    const error = new Error('Runner Control HMAC secret is not configured.');
    error.status = 503;
    error.code = 'RUNNER_CONTROL_NOT_CONFIGURED';
    throw error;
  }
  return value;
}

function parseSkew(env) {
  const value = Number.parseInt(String(env?.RUNNER_CONTROL_MAX_SKEW_SECONDS ?? ''), 10);
  if (!Number.isFinite(value)) return DEFAULT_MAX_SKEW_SECONDS;
  return Math.min(Math.max(value, 15), 300);
}

function constantTimeHexEquals(a, b) {
  const aa = String(a || '').toLowerCase();
  const bb = String(b || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(aa) || !/^[0-9a-f]{64}$/.test(bb)) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}

export async function sha256TextHex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text ?? '')));
  return bytesToHex(digest);
}

export function buildRunnerControlSigningPayload({ method, url, timestamp, bodyHash }) {
  const parsed = url instanceof URL ? url : new URL(url);
  return [
    RUNNER_CONTROL_AUTH_VERSION,
    String(method || 'GET').toUpperCase(),
    parsed.pathname,
    String(timestamp || '').trim(),
    String(bodyHash || '').trim(),
  ].join('\n');
}

export async function createRunnerControlSignature({ secret, method, url, timestamp, bodyHash }) {
  const normalizedSecret = normalizeSecret(secret);
  const payload = buildRunnerControlSigningPayload({ method, url, timestamp, bodyHash });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

export async function verifyRunnerControlRequest(req, env, { rawBody = '' } = {}) {
  const timestamp = String(req.headers.get('X-QAgent-Runner-Timestamp') || '').trim();
  const signature = String(req.headers.get('X-QAgent-Runner-Signature') || '').trim();
  const epoch = Number.parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const maxSkew = parseSkew(env);

  if (!Number.isInteger(epoch) || Math.abs(now - epoch) > maxSkew) {
    const error = new Error('Runner Control request timestamp is invalid or expired.');
    error.status = 401;
    error.code = 'RUNNER_CONTROL_UNAUTHORIZED';
    throw error;
  }

  const bodyHash = await sha256TextHex(rawBody);
  const expected = await createRunnerControlSignature({
    secret: env?.RUNNER_CONTROL_HMAC_SECRET,
    method: req.method,
    url: req.url,
    timestamp,
    bodyHash,
  });

  if (!constantTimeHexEquals(expected, signature)) {
    const error = new Error('Runner Control signature is invalid.');
    error.status = 401;
    error.code = 'RUNNER_CONTROL_UNAUTHORIZED';
    throw error;
  }

  return true;
}
