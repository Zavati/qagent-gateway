export const TEST_GENERATION_INTERNAL_AUTH_VERSION = 'qagent.project-test-generation.internal.v1';
const DEFAULT_MAX_SKEW_SECONDS = 60;

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function normalizeSecret(secret) {
  const value = String(secret || '');
  if (value.length < 32) {
    const error = new Error('Project Test Generation internal HMAC secret is not configured.');
    error.status = 503; error.code = 'PROJECT_TEST_GENERATION_NOT_CONFIGURED'; throw error;
  }
  return value;
}
function canonicalQuery(searchParams) {
  return Array.from(searchParams.entries())
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}
function constantTimeHexEquals(a, b) {
  const aa = String(a || '').toLowerCase(), bb = String(b || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(aa) || !/^[0-9a-f]{64}$/.test(bb)) return false;
  let diff = 0; for (let i = 0; i < aa.length; i += 1) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i); return diff === 0;
}
function maxSkew(env) {
  const parsed = Number.parseInt(String(env?.TEST_GENERATION_INTERNAL_MAX_SKEW_SECONDS ?? ''), 10);
  if (!Number.isInteger(parsed)) return DEFAULT_MAX_SKEW_SECONDS;
  return Math.min(Math.max(parsed, 15), 300);
}
export async function sha256TextHex(text) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text ?? ''))));
}
export function buildTestGenerationInternalSigningPayload({ method, url, organizationId, projectId = '', timestamp, bodyHash }) {
  const parsed = url instanceof URL ? url : new URL(url);
  return [TEST_GENERATION_INTERNAL_AUTH_VERSION, String(method || 'GET').toUpperCase(), parsed.pathname, canonicalQuery(parsed.searchParams), String(organizationId || '').trim(), String(projectId || '').trim(), String(timestamp || '').trim(), String(bodyHash || '').trim()].join('\n');
}
export async function createTestGenerationInternalSignature({ secret, method, url, organizationId, projectId = '', timestamp, rawBody = '' }) {
  const bodyHash = await sha256TextHex(rawBody);
  const payload = buildTestGenerationInternalSigningPayload({ method, url, organizationId, projectId, timestamp, bodyHash });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalizeSecret(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}
export async function buildTestGenerationInternalHeaders({ env, method, url, organizationId, projectId = '', rawBody = '', timestamp = null }) {
  const resolvedTimestamp = String(timestamp ?? Math.floor(Date.now() / 1000));
  const signature = await createTestGenerationInternalSignature({ secret: env?.TEST_GENERATION_INTERNAL_HMAC_SECRET, method, url, organizationId, projectId, timestamp: resolvedTimestamp, rawBody });
  return {
    'X-QAgent-Organization-Id': String(organizationId || ''),
    'X-QAgent-Project-Id': String(projectId || ''),
    'X-QAgent-Test-Generation-Timestamp': resolvedTimestamp,
    'X-QAgent-Test-Generation-Signature': signature,
  };
}
export async function verifyTestGenerationInternalRequest(req, env, { rawBody = '' } = {}) {
  const organizationId = String(req.headers.get('X-QAgent-Organization-Id') || '').trim();
  const projectId = String(req.headers.get('X-QAgent-Project-Id') || '').trim();
  const timestamp = String(req.headers.get('X-QAgent-Test-Generation-Timestamp') || '').trim();
  const signature = String(req.headers.get('X-QAgent-Test-Generation-Signature') || '').trim();
  const epoch = Number.parseInt(timestamp, 10), now = Math.floor(Date.now() / 1000);
  if (!organizationId || !Number.isInteger(epoch) || Math.abs(now - epoch) > maxSkew(env)) {
    const error = new Error('Project Test Generation internal request is unauthorized.'); error.status = 401; error.code = 'PROJECT_TEST_GENERATION_UNAUTHORIZED'; throw error;
  }
  const expected = await createTestGenerationInternalSignature({ secret: env?.TEST_GENERATION_INTERNAL_HMAC_SECRET, method: req.method, url: req.url, organizationId, projectId, timestamp, rawBody });
  if (!constantTimeHexEquals(expected, signature)) {
    const error = new Error('Project Test Generation internal request is unauthorized.'); error.status = 401; error.code = 'PROJECT_TEST_GENERATION_UNAUTHORIZED'; throw error;
  }
  return { organizationId, projectId };
}
