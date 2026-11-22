import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { requestUiDesignService, UI_COMPILER_VERSION, UI_DEFAULT_PROFILE } from '../src/services/uiTestDesignClient.js';

const compilation = JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v1.json', import.meta.url), 'utf8'));
const scope = compilation.source.scope;
const env = { TEST_GENERATION_INTERNAL_HMAC_SECRET: 'test-generation-fixture-secret-32-bytes',
  UI_TEST_DESIGN_SECRET: 'ui-design-fixture-secret-at-least-32-bytes' };
const path = '/internal/ui/v1/test-design/compile';
const body = { scope, bundleVersionId: compilation.source.bundleVersionId, compilerVersion: UI_COMPILER_VERSION,
  profile: { ...UI_DEFAULT_PROFILE } };
const call = (fetch, overrides = {}) => requestUiDesignService({ env: { ...env, UI_SERVICE: { fetch } },
  service: 'ui', scope, path, method: 'POST', body, timeoutMs: 20, ...overrides });
const timeout = error => error.code === 'UI_TEST_DESIGN_UPSTREAM_TIMEOUT' && error.status === 503 && error.retryable === true;
const turn = () => new Promise(resolve => setImmediate(resolve));
function capture(t) {
  const logs = [];
  t.mock.method(console, 'info', raw => logs.push(JSON.parse(raw)));
  return logs;
}

test('compile timeout while awaiting headers remains retryable and identifies the phase', { timeout: 2000 }, async t => {
  const logs = capture(t); let request;
  await assert.rejects(call(value => {
    request = value;
    return new Promise((_, reject) => value.signal.addEventListener('abort',
      () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  }), timeout);
  assert.equal(request.signal.aborted, true);
  assert.equal(logs.at(-1).event, 'compile.upstream.failed');
  assert.equal(logs.at(-1).errorPhase, 'headers');
  assert.equal(logs.at(-1).headersReceived, false);
  assert.equal(logs.at(-1).bodyDone, false);
  assert.equal(logs.at(-1).code, 'UI_TEST_DESIGN_UPSTREAM_TIMEOUT');
});

test('compile deadline rejects a fetch which ignores AbortSignal', { timeout: 2000 }, async t => {
  capture(t); let request;
  await assert.rejects(call(value => { request = value; return new Promise(() => {}); }), timeout);
  assert.equal(request.signal.aborted, true);
});

test('compile timeout during body reading cancels the reader and is never invalid JSON', { timeout: 2000 }, async t => {
  const logs = capture(t); let cancelled = 0;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"unfinished":')); },
    cancel() { cancelled++; return new Promise(() => {}); },
  }));
  await assert.rejects(call(async () => response), timeout);
  await turn();
  assert.equal(cancelled, 1);
  assert.equal(response.body.locked, false);
  assert.equal(logs.at(-1).errorPhase, 'body');
  assert.equal(logs.at(-1).headersReceived, true);
  assert.equal(logs.at(-1).bodyDone, false);
  assert.equal(logs.at(-1).code, 'UI_TEST_DESIGN_UPSTREAM_TIMEOUT');
});

test('a response arriving after timeout is cancelled without body reads or success logs', { timeout: 2000 }, async t => {
  const logs = capture(t); let resolveFetch, cancelled = 0;
  await assert.rejects(call(() => new Promise(resolve => { resolveFetch = resolve; })), timeout);
  const response = new Response(new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }));
  const logCount = logs.length;
  resolveFetch(response);
  await turn();
  assert.equal(cancelled, 1);
  assert.equal(response.body.locked, false);
  assert.equal(logs.length, logCount);
  assert.equal(logs.some(entry => entry.event === 'compile.upstream.headers'), false);
});

test('upstream failure codes and HTTP status survive full body reads without exposing private fields', async t => {
  const logs = capture(t);
  const privateValue = 'https://private.example/observed?token=do-not-log';
  await assert.rejects(call(async () => Response.json({ code: 'UI_TEST_DESIGN_COMPILE_TIMEOUT',
    message: privateValue, secret: env.UI_TEST_DESIGN_SECRET }, { status: 504 }), { timeoutMs: 1000 }),
  error => error.code === 'UI_TEST_DESIGN_COMPILE_TIMEOUT' && error.status === 504 && error.retryable === true
    && !error.message.includes(privateValue));
  await assert.rejects(call(async () => Response.json({ code: 'UI_BUNDLE_ACCESS_REVOKED', message: privateValue },
    { status: 410 }), { timeoutMs: 1000 }), error => error.code === 'UI_BUNDLE_ACCESS_REVOKED' && error.status === 410);
  assert.equal(logs.at(-1).errorPhase, 'response');
  assert.equal(logs.at(-1).headersReceived, true);
  assert.equal(logs.at(-1).bodyDone, true);
  assert.equal(JSON.stringify(logs).includes(privateValue), false);
  assert.equal(JSON.stringify(logs).includes(env.UI_TEST_DESIGN_SECRET), false);
});

test('declared and streamed size limits remain 413 and cancel without waiting on upstream cleanup', { timeout: 2000 }, async t => {
  capture(t);
  for (const declared of [true, false]) {
    let cancelled = 0;
    const response = new Response(new ReadableStream({
      start(controller) { if (!declared) controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel() { cancelled++; return new Promise(() => {}); },
    }), { headers: declared ? { 'content-length': String(1024 * 1024 + 1) } : {} });
    await assert.rejects(call(async () => response, { timeoutMs: 1000 }),
      error => error.code === 'UI_TEST_DESIGN_PAYLOAD_TOO_LARGE' && error.status === 413);
    assert.equal(cancelled, 1);
  }
});

test('compile request bytes, HMAC contract and returned compilation stay deterministic', async t => {
  const logs = capture(t), requests = [];
  for (let index = 0; index < 2; index++) {
    const result = await call(async request => {
      const rawBody = await request.text();
      assert.equal(request.url, 'https://qagent-ui.internal' + path);
      assert.equal(request.method, 'POST');
      assert.equal(request.redirect, 'manual');
      assert.equal(rawBody, JSON.stringify(body));
      const timestamp = request.headers.get('X-QAgent-Bundle-Time');
      const payload = ['QAGENT_UI_BUNDLE_HTTP_V1', 'test-design', 'POST', path, timestamp,
        createHash('sha256').update(rawBody).digest('hex')].join('\n');
      assert.equal(request.headers.get('X-QAgent-Bundle-Principal'), 'test-design');
      assert.equal(request.headers.get('X-QAgent-Bundle-Signature'),
        createHmac('sha256', env.UI_TEST_DESIGN_SECRET).update(payload).digest('hex'));
      const requestId = request.headers.get('X-QAgent-UI-Test-Design-Request-Id');
      assert.match(requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      requests.push({ rawBody, requestId });
      return Response.json(compilation);
    }, { timeoutMs: 1000 });
    assert.deepEqual(result, compilation);
  }
  assert.equal(requests[0].rawBody, requests[1].rawBody);
  assert.notEqual(requests[0].requestId, requests[1].requestId);
  for (const request of requests) {
    const entries = logs.filter(entry => entry.requestId === request.requestId);
    assert.deepEqual(entries.map(entry => entry.event), ['compile.upstream.started', 'compile.upstream.headers', 'compile.upstream.body_done']);
    assert.equal(entries.at(-1).bodyDone, true);
    for (const entry of entries) {
      assert.equal(entry.t, 'qagent_ui_test_design_gateway');
      assert.equal(entry.bundleVersionId, body.bundleVersionId);
      assert.equal(Number.isSafeInteger(entry.elapsedMs) && entry.elapsedMs >= 0, true);
      assert.equal('url' in entry || 'body' in entry || 'headers' in entry, false);
    }
  }
});

test('compile diagnostics sanitize invalid IDs and arbitrary thrown error codes', async t => {
  const logs = capture(t), privateValue = 'https://private.example/secret';
  await assert.rejects(call(async () => { throw Object.assign(new Error(privateValue), { code: privateValue, status: 503 }); },
    { body: { ...body, bundleVersionId: privateValue }, timeoutMs: 1000 }), error => error.code === privateValue);
  assert.equal(logs.every(entry => entry.bundleVersionId === null), true);
  assert.equal(logs.at(-1).code, 'UI_TEST_DESIGN_UPSTREAM_UNAVAILABLE');
  assert.equal(JSON.stringify(logs).includes(privateValue), false);
});

test('source, Registry and Orchestrator calls do not add compile diagnostics or a correlation header', async t => {
  const logs = capture(t);
  for (const service of ['ui', 'registry', 'orchestrator']) {
    const result = { items: [] }, bindingName = { ui: 'UI_SERVICE', registry: 'TEST_REGISTRY_SERVICE',
      orchestrator: 'TEST_GENERATION_ORCHESTRATOR_SERVICE' }[service];
    const configured = { ...env, [bindingName]: { fetch: async request => {
      assert.equal(request.headers.has('X-QAgent-UI-Test-Design-Request-Id'), false);
      return Response.json(service === 'orchestrator' ? { status: 'ok', data: result } : result);
    } } };
    assert.deepEqual(await requestUiDesignService({ env: configured, service, scope,
      path: service === 'ui' ? '/internal/ui/v1/test-design/sources' : '/existing-route',
      method: 'POST', body: { scope }, timeoutMs: 1000 }), result);
  }
  assert.equal(logs.length, 0);
});
