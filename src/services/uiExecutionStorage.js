import { canonical, hashBytes, executionError, readBytes, readJson, SOURCE_MAX_BYTES, EVIDENCE_MAX_BYTES, scopeValues } from './uiExecutionContract.js';

export function executionBucket(env) {
  if (!env.UI_EXECUTION_RESULTS?.put || !env.UI_EXECUTION_RESULTS?.get) throw executionError('STORAGE_NOT_CONFIGURED', 503);
  return env.UI_EXECUTION_RESULTS;
}
export const objectPrefix = scope => 'ui-execution/v1/' + scopeValues(scope).join('/');
export async function putJson(env, prefix, value) {
  const raw = canonical(value), hash = await hashBytes(raw), key = prefix + '/' + hash + '.json';
  await executionBucket(env).put(key, raw, { httpMetadata: { contentType: 'application/json' }, customMetadata: { sha256: hash } });
  return { key, hash };
}
export async function getJson(env, key, hash, limit = 1024 * 1024) {
  const stored = await executionBucket(env).get(key);
  if (!stored) throw executionError('STORED_OBJECT_UNAVAILABLE', 503);
  const bytes = await readBytes(new Response(stored.body), limit);
  if (await hashBytes(bytes) !== hash) throw executionError('STORED_OBJECT_HASH_MISMATCH', 503);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw executionError('STORED_OBJECT_INVALID', 503); }
}
/** Closed service destination; the client never selects a URL, source, or plan. */
export async function executionSourceRequest(env, scope, design, artifactId = null) {
  const secret = env.UI_EXECUTION_SECRET;
  if (!env.UI_SERVICE?.fetch || typeof secret !== 'string' || secret.length < 32 || secret.length > 512) throw executionError('SOURCE_NOT_CONFIGURED', 503);
  const path = '/internal/ui/v1/execution/' + (artifactId ? 'artifact' : 'source');
  const compilation = design.compilation;
  const body = JSON.stringify({ scope, source: compilation.source, specification: compilation.specification, specificationHash: compilation.specificationHash,
    ...(artifactId ? { artifactId } : {}) });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const encoder = new TextEncoder(), key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = `QAGENT_UI_BUNDLE_HTTP_V1\nexecution\nPOST\n${path}\n${timestamp}\n${await hashBytes(body)}`;
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signed))), b => b.toString(16).padStart(2, '0')).join('');
  const controller = new AbortController(); let timer, response, expired = false;
  const operation = (async () => {
    response = await env.UI_SERVICE.fetch(new Request('https://qagent-ui.internal' + path, { method: 'POST', redirect: 'manual', signal: controller.signal, body,
      headers: { 'Content-Type': 'application/json', 'X-QAgent-Bundle-Principal': 'execution', 'X-QAgent-Bundle-Time': timestamp, 'X-QAgent-Bundle-Signature': signature } }));
    if (expired) { response.body?.cancel().catch(() => {}); throw executionError('SOURCE_TIMEOUT', 503); }
    if (!response.ok) {
      const error = await readJson(response, 16384, { signal: controller.signal }).catch(() => null);
      throw executionError(/^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'SOURCE_UNAVAILABLE', response.status >= 400 && response.status <= 599 ? response.status : 502);
    }
    if (artifactId) {
      const bytes = await readBytes(response, EVIDENCE_MAX_BYTES, { signal: controller.signal });
      return new Response(bytes, { headers: { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    return readJson(response, SOURCE_MAX_BYTES, { signal: controller.signal });
  })();
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => {
    expired = true; controller.abort(); response?.body?.cancel().catch(() => {}); reject(executionError('SOURCE_TIMEOUT', 503));
  }, 45000); })]); } finally { clearTimeout(timer); }
}
