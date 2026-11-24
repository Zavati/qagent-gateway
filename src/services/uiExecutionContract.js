import { canonicalUiJson, uiError, uiId } from './uiTestDesignClient.js';

export const EXECUTION_LEASE_MS = 90000;
export const RESULT_MAX_BYTES = 1024 * 1024;
export const EVIDENCE_MAX_BYTES = 16 * 1024 * 1024;
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const scopeValues = s => [s.organizationId, s.projectId, s.environmentId];
export const sameScope = (a, b) => !!a && scopeValues(b).every((v, i) => scopeValues(a)[i] === v);
export const executionError = (code, status = 400) => uiError('UI_EXECUTION_' + code, status);
export const executionId = value => uiId(value, 'UI_EXECUTION_ID_INVALID');
export function object(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) throw executionError('INPUT_INVALID');
  return value;
}
export const encode = new TextEncoder();
export async function hashBytes(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encode.encode(value) : value)), b => b.toString(16).padStart(2, '0')).join('');
}
export const isHash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function textValue(v, max = 512) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw executionError('INPUT_INVALID');
  return v;
}
function number(v, min, max) {
  if (!Number.isFinite(v) || v < min || v > max) throw executionError('PROFILE_INVALID', 503);
  return v;
}
export function httpUrl(value, exactOrigin = false) {
  let u; try { u = new URL(value); } catch { throw executionError('PROFILE_INVALID', 503); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.hash || u.hostname.includes('*') || (exactOrigin && value !== u.origin)) throw executionError('PROFILE_INVALID', 503);
  return u;
}
function jsonConfig(env, key) {
  let list; try { list = JSON.parse(env[key]); } catch { throw executionError(key === 'UI_EXECUTION_TOKENS_JSON' ? 'AUTH_NOT_CONFIGURED' : 'PROFILES_NOT_CONFIGURED', 503); }
  if (!Array.isArray(list)) throw executionError('CONFIG_INVALID', 503);
  return list;
}
export function executionProfiles(env, scope) {
  const list = jsonConfig(env, 'UI_EXECUTION_PROFILES_JSON'), ids = new Set(), output = [];
  for (const raw of list) {
    object(raw, ['profileId', 'name', 'scope', 'targetBaseUrl', 'allowedOrigins', 'originMap', 'preparationKey', 'viewport', 'deviceScaleFactor', 'locale', 'timezoneId', 'stepTimeoutMs', 'modeTimeoutMs'],
      ['profileId', 'name', 'scope', 'targetBaseUrl', 'allowedOrigins', 'preparationKey', 'viewport']);
    object(raw.scope, ['organizationId', 'projectId', 'environmentId']);
    scopeValues(raw.scope).forEach(executionId);
    const profileId = executionId(raw.profileId), key = scopeValues(raw.scope).join('/') + '/' + profileId;
    if (ids.has(key)) throw executionError('PROFILE_DUPLICATE', 503); ids.add(key);
    if (!sameScope(raw.scope, scope)) continue;
    const target = httpUrl(textValue(raw.targetBaseUrl, 2048));
    if (target.search) throw executionError('PROFILE_INVALID', 503);
    if (!Array.isArray(raw.allowedOrigins) || !raw.allowedOrigins.length || raw.allowedOrigins.length > 100) throw executionError('PROFILE_INVALID', 503);
    const allowedOrigins = [...new Set(raw.allowedOrigins.map(value => httpUrl(value, true).origin))];
    if (!allowedOrigins.includes(target.origin)) throw executionError('PROFILE_ORIGIN_INVALID', 503);
    const originMap = raw.originMap ?? {};
    if (!originMap || typeof originMap !== 'object' || Array.isArray(originMap)) throw executionError('PROFILE_INVALID', 503);
    for (const [from, to] of Object.entries(originMap)) {
      httpUrl(from, true); if (!allowedOrigins.includes(httpUrl(to, true).origin)) throw executionError('PROFILE_ORIGIN_INVALID', 503);
    }
    object(raw.viewport, ['width', 'height']);
    const width = number(raw.viewport.width, 240, 7680), height = number(raw.viewport.height, 240, 7680);
    if (!Number.isInteger(width) || !Number.isInteger(height)) throw executionError('PROFILE_INVALID', 503);
    const locale = textValue(raw.locale ?? 'en-US', 80), timezoneId = textValue(raw.timezoneId ?? 'UTC', 100);
    try { new Intl.DateTimeFormat(locale, { timeZone: timezoneId }); } catch { throw executionError('PROFILE_INVALID', 503); }
    const stepTimeoutMs = number(raw.stepTimeoutMs ?? 7000, 1000, 120000), modeTimeoutMs = number(raw.modeTimeoutMs ?? 600000, 10000, 3600000);
    if (!Number.isSafeInteger(stepTimeoutMs) || !Number.isSafeInteger(modeTimeoutMs) || modeTimeoutMs < stepTimeoutMs) throw executionError('PROFILE_INVALID', 503);
    output.push({ ...raw, profileId, targetBaseUrl: target.href, allowedOrigins, originMap: { ...originMap }, viewport: { width, height },
      name: textValue(raw.name, 160), preparationKey: executionId(raw.preparationKey),
      deviceScaleFactor: number(raw.deviceScaleFactor ?? 1, 0.5, 4), locale, timezoneId,
      stepTimeoutMs, modeTimeoutMs, browser: 'chromium' });
  }
  return output;
}
export async function machineAuthority(request, env, params, permission) {
  const bearer = request.headers.get('authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._~-]{32,512}$/.test(bearer)) throw executionError('AUTH_REQUIRED', 401);
  const digest = await hashBytes(bearer.slice(7)), list = jsonConfig(env, 'UI_EXECUTION_TOKENS_JSON');
  const seen = new Set(); let grant;
  for (const row of list) {
    object(row, ['tokenSha256', 'organizationId', 'projectId', 'environmentId', 'permissions']);
    if (!isHash(row.tokenSha256) || seen.has(row.tokenSha256) || !Array.isArray(row.permissions) || !row.permissions.length || row.permissions.some(v => !['read', 'create', 'execute'].includes(v))) throw executionError('AUTH_CONFIG_INVALID', 503);
    scopeValues(row).forEach(executionId); seen.add(row.tokenSha256);
    if (row.tokenSha256 === digest) grant = row;
  }
  if (!grant) throw executionError('AUTH_INVALID', 401);
  if (grant.projectId !== params.projectId || grant.environmentId !== params.environmentId || !grant.permissions.includes(permission)) throw executionError('AUTH_FORBIDDEN', 403);
  return { scope: { organizationId: grant.organizationId, projectId: grant.projectId, environmentId: grant.environmentId }, actor: 'machine:' + digest.slice(0, 16) };
}
export function canonical(value) { return canonicalUiJson(value); }
export async function readBytes(message, limit, { signal = null } = {}) {
  if (signal?.aborted) { message.body?.cancel().catch(() => {}); throw executionError('SOURCE_TIMEOUT', 503); }
  const len = message.headers.get('content-length');
  if (len !== null && (!/^\d+$/.test(len) || Number(len) > limit)) { message.body?.cancel().catch(() => {}); throw executionError('PAYLOAD_TOO_LARGE', 413); }
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader(), chunks = []; let size = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) { const part = await reader.read(); if (signal?.aborted) throw executionError('SOURCE_TIMEOUT', 503); if (part.done) break; size += part.value.length;
      if (size > limit) throw executionError('PAYLOAD_TOO_LARGE', 413); chunks.push(part.value); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return bytes;
  } catch (e) { reader.cancel().catch(() => {}); throw e; } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}
export async function readJson(message, limit = 65536, options = {}) {
  const bytes = await readBytes(message, limit, options);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw executionError('JSON_INVALID'); }
}
