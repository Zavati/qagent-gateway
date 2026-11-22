/** UI Test Design transport. No AI provider, Catalog lookup, or browser execution. */
import { buildTestGenerationInternalHeaders, sha256TextHex } from '../security/testGenerationInternalAuth.js';

export const UI_COMPILER_VERSION = 'qagent_ui_test_design_compiler_v1';
export const UI_COMPILATION_VERSION = 'qagent.ui-test-design-compilation.v1';
export const UI_COMPILATION_MAX_BYTES = 768 * 1024;
export const UI_DEFAULT_PROFILE = Object.freeze({
  contractVersion: 'qagent.ui-test-design-profile.v1', revision: 1,
  comparisonPolicyVersion: 'qagent_ui_observed_comparison_v1', layoutTolerancePx: 2,
  maxChecks: 2000, maxNodes: 25000, maxArtifactBytes: 33554432,
});

export function uiError(code, status = 400) {
  const error = new Error(code); error.code = code; error.status = status;
  error.retryable = status === 429 || status >= 500; return error;
}
export function uiId(value, code = 'UI_TEST_DESIGN_SCOPE_INVALID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,179}$/.test(value)) throw uiError(code);
  return value;
}
export function uiObject(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) throw uiError('UI_TEST_DESIGN_INPUT_INVALID');
  return value;
}
export function normalizeUiProfile(input) {
  if (input === undefined || (input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0)) return { ...UI_DEFAULT_PROFILE };
  const keys = Object.keys(UI_DEFAULT_PROFILE), profile = uiObject(input, keys, keys);
  if (profile.contractVersion !== UI_DEFAULT_PROFILE.contractVersion || profile.revision !== 1
    || profile.comparisonPolicyVersion !== UI_DEFAULT_PROFILE.comparisonPolicyVersion) throw uiError('UI_TEST_DESIGN_PROFILE_UNSUPPORTED');
  if (typeof profile.layoutTolerancePx !== 'number' || !Number.isFinite(profile.layoutTolerancePx)
    || profile.layoutTolerancePx < 0 || profile.layoutTolerancePx > 20) throw uiError('UI_TEST_DESIGN_PROFILE_INVALID');
  for (const [key, min, max] of [['maxChecks', 1, 5000], ['maxNodes', 1, 50000], ['maxArtifactBytes', 1024, 67108864]]) {
    if (!Number.isSafeInteger(profile[key]) || profile[key] < min || profile[key] > max) throw uiError('UI_TEST_DESIGN_PROFILE_INVALID');
  }
  return { ...profile };
}
export function canonicalUiJson(input) {
  let nodes = 0;
  function visit(value, depth) {
    if (++nodes > 100000 || depth > 48) throw uiError('UI_TEST_DESIGN_COMPLEXITY_LIMIT', 413);
    if (value === null || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'string') {
      if (!value.isWellFormed()) throw uiError('UI_TEST_DESIGN_JSON_INVALID');
      return JSON.stringify(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw uiError('UI_TEST_DESIGN_JSON_INVALID');
      return '[' + value.map(item => visit(item, depth + 1)).join(',') + ']';
    }
    if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      return '{' + Object.keys(value).sort().map(key => {
        if (['__proto__', 'constructor', 'prototype'].includes(key) || !key.isWellFormed()) throw uiError('UI_TEST_DESIGN_JSON_INVALID');
        return JSON.stringify(key) + ':' + visit(value[key], depth + 1);
      }).join(',') + '}';
    }
    throw uiError('UI_TEST_DESIGN_JSON_INVALID');
  }
  return visit(input, 0);
}
function cancelUiStream(stream) {
  // Cleanup must not wait on an upstream cancel hook or replace the original error.
  try { Promise.resolve(stream?.cancel()).catch(() => {}); } catch {}
}
const upstreamTimeout = () => uiError('UI_TEST_DESIGN_UPSTREAM_TIMEOUT', 503);

export async function readUiText(response, limit = 1024 * 1024, { signal = null } = {}) {
  if (signal?.aborted) { cancelUiStream(response.body); throw upstreamTimeout(); }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    cancelUiStream(response.body); throw uiError('UI_TEST_DESIGN_PAYLOAD_TOO_LARGE', 413);
  }
  if (!response.body) return '';
  const reader = response.body.getReader(), parts = []; let size = 0;
  const abort = () => cancelUiStream(reader);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) { abort(); throw upstreamTimeout(); }
    while (true) {
      const { value, done } = await reader.read();
      if (signal?.aborted) throw upstreamTimeout();
      if (done) break;
      size += value.length;
      if (size > limit) { cancelUiStream(reader); throw uiError('UI_TEST_DESIGN_PAYLOAD_TOO_LARGE', 413); }
      parts.push(value);
    }
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw uiError('UI_TEST_DESIGN_JSON_INVALID'); }
}
export function parseUiJson(raw) {
  try { return JSON.parse(raw); } catch { throw uiError('UI_TEST_DESIGN_JSON_INVALID'); }
}
export function assertUiSource(source, scope, bundleVersionId = null) {
  if (!source || !source.scope || ['organizationId', 'projectId', 'environmentId'].some(key => source.scope[key] !== scope[key])) throw uiError('UI_TEST_DESIGN_SCOPE_MISMATCH', 403);
  uiId(source.captureId); uiId(source.bundleVersionId);
  if (bundleVersionId && source.bundleVersionId !== bundleVersionId) throw uiError('UI_TEST_DESIGN_SOURCE_MISMATCH', 409);
  if (![source.sourceHash, source.manifestHash].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) throw uiError('UI_TEST_DESIGN_SOURCE_INVALID', 502);
  return source;
}
export async function assertUiCompilation(compilation, scope, bundleVersionId = null) {
  if (compilation?.contractVersion !== UI_COMPILATION_VERSION || compilation.compilerVersion !== UI_COMPILER_VERSION
    || compilation.executionPerformed !== false || !['COMPILED', 'NO_DESIGN'].includes(compilation.outcome)) throw uiError('UI_TEST_DESIGN_COMPILATION_INVALID', 502);
  assertUiSource(compilation.source, scope, bundleVersionId);
  if (new TextEncoder().encode(canonicalUiJson(compilation)).length > UI_COMPILATION_MAX_BYTES) throw uiError('UI_TEST_DESIGN_PAYLOAD_TOO_LARGE', 413);
  if (compilation.outcome === 'NO_DESIGN') {
    if (compilation.specification !== null || compilation.specificationHash !== null) throw uiError('UI_TEST_DESIGN_COMPILATION_INVALID', 502);
    return compilation;
  }
  const spec = compilation.specification;
  if (spec?.contractVersion !== 'qagent.ui-test-design.v1' || spec.executionPerformed !== false
    || JSON.stringify(spec.executionModes) !== '["UI_REPLAY","UI_LIVE"]'
    || ['organizationId', 'projectId', 'environmentId'].some(key => spec.scope?.[key] !== scope[key])) throw uiError('UI_TEST_DESIGN_COMPILATION_INVALID', 502);
  if (canonicalUiJson(spec.source) !== canonicalUiJson(compilation.source)
    || await sha256TextHex(canonicalUiJson(spec)) !== compilation.specificationHash) throw uiError('UI_TEST_DESIGN_HASH_MISMATCH', 409);
  return compilation;
}

export function assertUiVersionReceipt(value, contentHash = null) {
  if (value?.domain !== 'UI' || !Number.isSafeInteger(value.version) || value.version < 1
    || !/^uitd_[A-Za-z0-9_-]+$/.test(value.testDesignId || '') || !/^uitdv_[A-Za-z0-9_-]+$/.test(value.testDesignVersionId || '')
    || !/^[a-f0-9]{64}$/.test(value.contentHash || '') || (contentHash !== null && value.contentHash !== contentHash)) throw uiError('UI_TEST_DESIGN_REGISTRY_RECEIPT_INVALID', 502);
  uiId(value.testDesignId); uiId(value.testDesignVersionId);
  return value;
}
export function assertUiDesignPage(value, scope) {
  if (value?.domain !== 'UI' || !value.scope || ['organizationId', 'projectId', 'environmentId'].some(key => value.scope[key] !== scope[key])
    || !Array.isArray(value.items) || value.items.length > 50
    || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && value.nextCursor.length <= 4096))) throw uiError('UI_TEST_DESIGN_REGISTRY_RESPONSE_INVALID', 502);
  for (const item of value.items) { assertUiVersionReceipt(item); assertUiSource(item.source, scope); }
  return value;
}

async function uiHeaders(env, path, rawBody) {
  const secret = env.UI_TEST_DESIGN_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512) throw uiError('UI_TEST_DESIGN_NOT_CONFIGURED', 503);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = `QAGENT_UI_BUNDLE_HTTP_V1\ntest-design\nPOST\n${path}\n${timestamp}\n${await sha256TextHex(rawBody)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  const signature = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return { 'X-QAgent-Bundle-Principal': 'test-design', 'X-QAgent-Bundle-Time': timestamp, 'X-QAgent-Bundle-Signature': signature };
}
/** All destinations are service bindings. Caller cannot select a URL or provide credentials. */
export async function requestUiDesignService({ env, service, scope, path, method = 'GET', body = null, timeoutMs = 30000 }) {
  const bindingName = { ui: 'UI_SERVICE', registry: 'TEST_REGISTRY_SERVICE', orchestrator: 'TEST_GENERATION_ORCHESTRATOR_SERVICE' }[service];
  const binding = env[bindingName];
  if (!binding?.fetch) throw uiError('UI_TEST_DESIGN_NOT_CONFIGURED', 503);
  const base = { ui: 'https://qagent-ui.internal', registry: 'https://qagent-test-registry.internal', orchestrator: 'https://qagent-test-generation-orchestrator.internal' }[service];
  const url = base + path, rawBody = body === null ? '' : JSON.stringify(body);
  if (new TextEncoder().encode(rawBody).length > 1024 * 1024) throw uiError('UI_TEST_DESIGN_PAYLOAD_TOO_LARGE', 413);
  const headers = service === 'ui' ? await uiHeaders(env, path, rawBody)
    : await buildTestGenerationInternalHeaders({ env, method, url, ...scope, rawBody });
  const controller = new AbortController();
  const compileCall = service === 'ui' && path === '/internal/ui/v1/test-design/compile';
  const requestId = compileCall ? crypto.randomUUID() : null;
  const bundleVersionId = compileCall && typeof body?.bundleVersionId === 'string'
    && /^urbv_[A-Za-z0-9_-]{1,175}$/.test(body.bundleVersionId) ? body.bundleVersionId : null;
  const startedAt = Date.now();
  let timer, response, timedOut = false, phase = 'headers', headersReceived = false, bodyDone = false;
  const diagnostic = (event, details = {}) => {
    if (!compileCall) return;
    try {
      console.info(JSON.stringify({ t: 'qagent_ui_test_design_gateway', event, requestId, bundleVersionId,
        elapsedMs: Math.max(0, Date.now() - startedAt), phase, headersReceived, bodyDone, ...details }));
    } catch {}
  };
  diagnostic('compile.upstream.started');
  try {
    const operation = (async () => {
      response = await binding.fetch(new Request(url, { method,
        headers: { ...headers, accept: 'application/json', ...(body === null ? {} : { 'content-type': 'application/json' }),
          ...(requestId ? { 'X-QAgent-UI-Test-Design-Request-Id': requestId } : {}) },
        ...(body === null ? {} : { body: rawBody }), signal: controller.signal, redirect: 'manual' }));
      // A binding can ignore AbortSignal and resolve after the deadline. Dispose of
      // that response without parsing it or emitting a misleading success event.
      if (timedOut || controller.signal.aborted) { cancelUiStream(response?.body); throw upstreamTimeout(); }
      headersReceived = true; phase = 'body';
      diagnostic('compile.upstream.headers', { httpStatus: response.status });
      let payload;
      try {
        const raw = await readUiText(response, 1024 * 1024, { signal: controller.signal });
        if (timedOut || controller.signal.aborted) throw upstreamTimeout();
        bodyDone = true;
        diagnostic('compile.upstream.body_done', { httpStatus: response.status });
        phase = 'parse'; payload = parseUiJson(raw);
      } catch (error) {
        if (timedOut || controller.signal.aborted) throw upstreamTimeout();
        if (error.status === 413) throw error;
        throw uiError('UI_TEST_DESIGN_UPSTREAM_INVALID', 502);
      }
      phase = 'response';
      if (!response.ok) {
        const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(payload?.code || '') ? payload.code : 'UI_TEST_DESIGN_UPSTREAM_FAILED';
        throw uiError(code, response.status >= 400 ? response.status : 502);
      }
      if (service === 'orchestrator') {
        if (payload?.status !== 'ok' || !payload.data) throw uiError('UI_TEST_DESIGN_UPSTREAM_INVALID', 502);
        return payload.data;
      }
      return payload;
    })();
    // Race the entire fetch/read operation, not only headers. Reject before abort
    // so an abort-related stream error cannot mask the deadline's public code.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; const error = upstreamTimeout(); reject(error); controller.abort(error); }, timeoutMs);
    });
    return await Promise.race([operation, deadline]);
  } catch (error) {
    const failure = timedOut || controller.signal.aborted ? upstreamTimeout()
      : typeof error?.code === 'string' && Number.isInteger(error.status) ? error
        : uiError('UI_TEST_DESIGN_UPSTREAM_UNAVAILABLE', 503);
    diagnostic('compile.upstream.failed', { code: /^[A-Z][A-Z0-9_]{2,100}$/.test(failure.code)
      ? failure.code : 'UI_TEST_DESIGN_UPSTREAM_UNAVAILABLE', status: failure.status, errorPhase: phase });
    controller.abort(failure); cancelUiStream(response?.body);
    throw failure;
  } finally { clearTimeout(timer); }
}

export function uiScopeQuery(scope, extra = {}) {
  return new URLSearchParams({ ...scope, ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== null && value !== undefined && value !== '').map(([key, value]) => [key, String(value)])) }).toString();
}
export function uiSourceRequest(env, scope, bundleVersionId, expectedManifestHash) {
  return requestUiDesignService({ env, service: 'ui', scope, path: '/internal/ui/v1/test-design/source', method: 'POST',
    body: { scope, bundleVersionId, ...(expectedManifestHash ? { expectedManifestHash } : {}) } });
}
