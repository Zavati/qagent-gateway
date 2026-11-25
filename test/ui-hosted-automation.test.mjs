import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import { createUiExecutionBatch, uiExecutions, uiExecutionDetail } from '../src/handlers/uiExecutions.js';
import { automationRuns } from '../src/handlers/automationRuns.js';
import { createAutomationRun, reconcileAutomationRuns } from '../src/services/automationRunService.js';
import { dispatchUiBatch, requestRunnerDispatch, reconcileUiDispatches } from '../src/services/uiRunnerDispatch.js';
import { UiExecutionRepository } from '../src/repositories/uiExecutionRepository.js';
import { createSuiteRunV1, getSuiteRunV1 } from '../src/services/suiteRunService.js';
import { getSuiteRun, getSuiteRunDispatch } from '../src/repositories/suiteRunRepository.js';
import { executionProfiles, hashBytes, EXECUTION_LEASE_MS } from '../src/services/uiExecutionContract.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v2.json', import.meta.url), 'utf8'));
const scope = golden.source.scope;
const migrations = ['0015_foundation_07_7_10_b_suite_run_orchestration.sql', '0016_foundation_07_7_10_b_fix_2_mutation_safety.sql', '0022_ui_execution_control_plane.sql', '0023_ui_hosted_automation.sql'].map(n => readFileSync(new URL('../migrations/' + n, import.meta.url), 'utf8'));
class Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  async run() { return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) } }; }
}
class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON'); for (const sql of migrations) this.sqlite.exec(sql); }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) { this.sqlite.exec('BEGIN IMMEDIATE'); try { const result = []; for (const statement of statements) result.push(await statement.run()); this.sqlite.exec('COMMIT'); return result; } catch (e) { this.sqlite.exec('ROLLBACK'); throw e; } }
}
class Bucket {
  rows = new Map();
  async put(key, raw) { this.rows.set(key, typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)); return { key }; }
  async get(key) { const bytes = this.rows.get(key); return bytes ? { body: new Response(bytes).body } : null; }
}
async function fixture() {
  let now = Date.now(); const db = new D1(), sent = [], token = 'test-ui-machine-token-12345678901234567890';
  const profile = { profileId: 'profile_stg', name: 'STG', scope, targetBaseUrl: 'https://stg.example.test/', allowedOrigins: ['https://stg.example.test'], preparationMode: 'UNAUTHENTICATED', viewport: { width: 1280, height: 720 } };
  const env = { QAGENT_DB: db, UI_EXECUTION_RESULTS: new Bucket(), UI_EXECUTION_PROFILES_JSON: JSON.stringify([profile]), UI_EXECUTION_TOKENS_JSON: JSON.stringify([{ ...scope, tokenSha256: await hashBytes(token), permissions: ['read', 'create', 'execute'] }]), log: () => {},
    SUITE_ORCHESTRATOR_QUEUE: { send: async message => { sent.push(message); } } };
  const common = { now: () => now, organization: async () => ({ status: 'active' }), environment: async () => ({ environmentId: scope.environmentId, status: 'active', environmentType: 'STG' }) };
  const uiDependencies = { ...common, source: async () => ({ source: golden.source }), request: async () => ({ domain: 'UI', testDesignId: 'uitd_test', testDesignVersionId: 'uitdv_test', version: 1, contentHash: golden.specificationHash, source: golden.source, compilation: golden }) };
  const apiDeps = { getEnvironment: common.environment, getSuiteExecutionSlice: async () => ({ totalItems: 1, suite: { suiteId: 'suite_test', version: 1, inventoryFingerprint: 'a'.repeat(64), endpointCount: 1, scenarioCount: 1 } }),
    ensureLearningCycle: async () => null, getLearningCycle: async () => null, refresh: async () => null,
    getProgress: async (env, org, project, id) => ({ suiteRun: await getSuiteRun(env, org, project, id), dispatch: await getSuiteRunDispatch(env, org, project, id), counts: {}, children: [] }) };
  const deps = { ...common, uiDependencies,
    createApi: args => createSuiteRunV1({ ...args, deps: apiDeps }), getApi: args => getSuiteRunV1({ ...args, deps: apiDeps }),
    tenant: async () => ({ organizationId: scope.organizationId, organizationRole: 'member', user: { userId: 'usr_test' } }) };
  const input = { operationId: 'operation_combined', api: { suiteVersionId: 'suitev_test', confirmDiscoveredRuntime: true, confirmProductionMutation: false }, ui: { profileId: profile.profileId, targetBuildRef: 'commit:123', testDesignVersionIds: ['uitdv_test'] } };
  const create = (body = input, overrides = {}) => createAutomationRun(env, scope, 'usr_test', body, { ...deps, ...overrides });
  return { env, db, sent, token, profile, common, uiDependencies, deps, input, create, now: () => now, advance: ms => { now += ms; } };
}
const count = (f, table) => Number(f.db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);

test('joint admission uses production API SuiteRun service and real UI admission, pinned once across duplicate clicks', async () => {
  const f = await fixture(), createApi = f.deps.createApi;
  f.deps.createApi = async input => { assert.equal(count(f, 'automation_runs'), 1); return createApi(input); };
  const first = await f.create(), repeated = await f.create();
  assert.equal(first.api.admission, 'ADMITTED'); assert.equal(first.ui.admission, 'ADMITTED');
  assert.equal(first.api.suiteRun.suiteRun.suiteVersionId, f.input.api.suiteVersionId);
  assert.equal(first.ui.batch.items[0].testDesignVersionId, 'uitdv_test');
  assert.equal(first.ui.batch.hosting.mode, 'EXTERNAL');
  assert.equal(repeated.automationRunId, first.automationRunId); assert.equal(repeated.reused, true);
  assert.equal(count(f, 'suite_runs'), 1); assert.equal(count(f, 'ui_execution_batches'), 1); assert.equal(f.sent.length, 1);
  await assert.rejects(f.create({ ...f.input, ui: { ...f.input.ui, targetBuildRef: 'different' } }), { status: 409 });
});

test('API queue ACK failure after durable API root is recovered without duplicating API or UI execution', async () => {
  const f = await fixture(); let fail = true;
  f.env.SUITE_ORCHESTRATOR_QUEUE.send = async message => { f.sent.push(message); if (fail) throw new Error('queue unavailable'); };
  const first = await f.create();
  assert.equal(first.api.admission, 'PENDING'); assert.equal(first.ui.admission, 'ADMITTED');
  assert.equal(count(f, 'suite_runs'), 1); assert.equal(count(f, 'ui_execution_batches'), 1);
  const id = f.db.sqlite.prepare('SELECT suite_run_id FROM suite_runs').get().suite_run_id;
  fail = false; f.advance(60000); await reconcileAutomationRuns(f.env, f.deps);
  const second = await f.create(); assert.equal(second.api.admission, 'ADMITTED'); assert.equal(second.api.suiteRun.suiteRun.suiteRunId, id);
  assert.equal(second.ui.batch.batchId, first.ui.batch.batchId); assert.equal(count(f, 'suite_runs'), 1);
});

test('concurrent combined admission has one durable parent and one child per domain', async () => {
  const f = await fixture(); const values = await Promise.all([f.create(), f.create(), f.create()]);
  assert.equal(new Set(values.map(v => v.automationRunId)).size, 1);
  assert.equal(count(f, 'automation_runs'), 1); assert.equal(count(f, 'suite_runs'), 1); assert.equal(count(f, 'ui_execution_batches'), 1);
  assert.equal(f.sent.length, 1);
});

test('UI transient failure leaves API admitted and is recovered with the exact original design selection', async () => {
  const f = await fixture(); let fail = true, calls = 0;
  const createUi = async (...args) => { calls++; if (fail) throw Object.assign(new Error('upstream timeout'), { status: 503, code: 'UI_TEST_DESIGN_UPSTREAM_TIMEOUT' }); return createUiExecutionBatch(...args); };
  const first = await f.create(f.input, { createUi }); assert.equal(first.api.admission, 'ADMITTED'); assert.equal(first.ui.admission, 'PENDING');
  fail = false; f.advance(60000); await reconcileAutomationRuns(f.env, { ...f.deps, createUi });
  const second = await f.create(); assert.equal(second.ui.batch.items[0].testDesignVersionId, 'uitdv_test');
  assert.equal(count(f, 'suite_runs'), 1); assert.equal(f.sent.length, 1); assert.equal(calls, 2);
});

test('permanent child admission failure is explicit and does not block the other requested domain', async () => {
  const f = await fixture(); let attempts = 0;
  const createUi = async () => { attempts++; throw Object.assign(new Error('source revoked'), { status: 410, code: 'UI_SOURCE_REVOKED' }); };
  const first = await f.create(f.input, { createUi }); assert.equal(first.api.admission, 'ADMITTED'); assert.equal(first.ui.admission, 'ERROR');
  assert.equal(first.ui.errorCode, 'UI_SOURCE_REVOKED'); f.advance(300000);
  await reconcileAutomationRuns(f.env, { ...f.deps, createUi }); assert.equal(attempts, 1);
});

test('transient child read failure preserves admitted identifiers and remains pollable', async () => {
  const f = await fixture(), first = await f.create();
  const second = await f.create(f.input, { getApi: async () => { throw Object.assign(new Error('upstream'), { status: 503, code: 'SUITE_READ_UNAVAILABLE' }); }, getUi: async () => { throw Object.assign(new Error('r2'), { status: 503, code: 'UI_EXECUTION_STORED_OBJECT_UNAVAILABLE' }); } });
  assert.equal(second.status, 'PENDING'); assert.equal(second.api.admission, 'ADMITTED'); assert.equal(second.ui.admission, 'ADMITTED');
  assert.equal(second.api.suiteRunId, first.api.suiteRun.suiteRun.suiteRunId); assert.equal(second.ui.batchId, first.ui.batch.batchId);
  assert.equal(second.api.suiteRun, null); assert.equal(second.ui.batch, null); assert.equal(count(f, 'suite_runs'), 1);
});

test('UI-only and API-only have independent admission; missing selection or bad flags are rejected', async () => {
  const f = await fixture(); const ui = await f.create({ ...f.input, api: null });
  assert.equal(ui.api.admission, 'NOT_REQUESTED'); assert.equal(ui.ui.admission, 'ADMITTED'); assert.equal(count(f, 'suite_runs'), 0);
  const api = await f.create({ ...f.input, operationId: 'operation_api_only', ui: null });
  assert.equal(api.ui.admission, 'NOT_REQUESTED'); assert.equal(api.api.admission, 'ADMITTED');
  await assert.rejects(f.create({ operationId: 'operation_empty' }), { code: 'UI_EXECUTION_AUTOMATION_SELECTION_REQUIRED' });
  await assert.rejects(f.create({ ...f.input, api: { ...f.input.api, confirmProductionMutation: 'true' } }), { status: 400 });
});

test('parent admission survives response close: waitUntil retains work and cron owns pending recovery', async () => {
  const f = await fixture(), tasks = []; let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const result = await f.create(f.input, { waitUntil: task => tasks.push(task), createApi: async args => { await deferred; return f.deps.createApi(args); } });
  assert.equal(count(f, 'automation_runs'), 1); assert.ok(['PENDING', 'RUNNING'].includes(result.status)); assert.equal(tasks.length, 1);
  release(); await Promise.all(tasks); const recovered = await f.create(); assert.equal(recovered.api.admission, 'ADMITTED'); assert.equal(recovered.ui.admission, 'ADMITTED');
});

test('Console routes enforce scope/write role and parent pagination preserves both child references', async () => {
  const f = await fixture(), root = `/v1/console/projects/${scope.projectId}/environments/${scope.environmentId}/automation-runs`;
  const request = (suffix = '', method = 'GET', body, override = {}) => {
    const path = root + suffix, route = resolveGatewayRoute(method, path); assert.equal(route?.name, 'automationRuns');
    return automationRuns(new Request('https://qagent.invalid' + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), f.env, route.params, { ...f.deps, ...override });
  };
  await assert.rejects(request('', 'POST', f.input, { tenant: async () => ({ organizationId: scope.organizationId, organizationRole: 'viewer' }) }), { status: 403 });
  const created = (await (await request('', 'POST', f.input)).json()).data;
  const detail = (await (await request('/' + created.automationRunId)).json()).data; assert.equal(detail.ui.batch.batchId, created.ui.batch.batchId);
  const list = (await (await request()).json()).data; assert.equal(list.items.length, 1); assert.equal(list.nextCursor, null);
  await assert.rejects(request('/' + created.automationRunId, 'GET', undefined, { tenant: async () => ({ organizationId: 'org_other', organizationRole: 'member' }) }), { status: 404 });
  assert.equal(resolveGatewayRoute('POST', root + '/' + created.automationRunId), null);
  assert.equal(resolveGatewayRoute('POST', root.replace('/console/', '/automation/')), null, 'UI bearer permissions do not silently acquire API execution authority');
});

test('UNAUTHENTICATED is explicit; old profiles still require their preparation adapter', async () => {
  const f = await fixture(); assert.equal(executionProfiles(f.env, scope)[0].preparationMode, 'UNAUTHENTICATED');
  f.env.UI_EXECUTION_PROFILES_JSON = JSON.stringify([{ ...f.profile, preparationMode: undefined, preparationKey: 'prepare_old' }]);
  assert.equal(executionProfiles(f.env, scope)[0].preparationMode, 'REQUIRE_ADAPTER');
  f.env.UI_EXECUTION_PROFILES_JSON = JSON.stringify([{ ...f.profile, preparationMode: 'IGNORE_AUTH' }]); assert.throws(() => executionProfiles(f.env, scope));
});

test('hosted dispatch signs exact body/path/time, validates ACK and bounds an unresponsive binding', async () => {
  const f = await fixture(), secret = 'dispatch-secret-for-local-tests-1234567890123456'; f.env.UI_RUNNER_DISPATCH_SECRET = secret;
  f.env.UI_RUNNER = { fetch: async request => {
    const body = await request.text(), stamp = request.headers.get('X-QAgent-Runner-Time'), path = new URL(request.url).pathname;
    const expected = createHmac('sha256', secret).update(`QAGENT_UI_RUNNER_HTTP_V1\nPOST\n${path}\n${stamp}\n${createHash('sha256').update(body).digest('hex')}`).digest('hex');
    assert.equal(request.headers.get('X-QAgent-Runner-Signature'), expected); assert.deepEqual(JSON.parse(body).scope, scope);
    return Response.json({ status: 'ok', data: { accepted: true, batchId: 'uieb_test' } }, { status: 202 });
  } };
  await requestRunnerDispatch(f.env, scope, 'uieb_test', f.now());
  await assert.rejects(requestRunnerDispatch(f.env, scope, 'uieb_wrong', f.now()), { code: 'UI_EXECUTION_RUNNER_DISPATCH_RECEIPT_INVALID' });
  f.env.UI_RUNNER.fetch = async () => new Promise(() => {});
  await assert.rejects(requestRunnerDispatch(f.env, scope, 'uieb_test', f.now(), 15), { code: 'UI_EXECUTION_RUNNER_DISPATCH_TIMEOUT' });
});

test('standalone UI batch publishes durable wakeup; failed wake recovers and concurrent dispatch never double starts', async () => {
  const f = await fixture(); let attempts = 0, fail = true;
  f.env.UI_RUNNER_DISPATCH_SECRET = 'dispatch-secret-for-local-tests-1234567890123456';
  f.env.UI_RUNNER = { fetch: async req => { attempts++; if (fail) throw new Error('unavailable'); const body = await req.json(); return Response.json({ status: 'ok', data: { accepted: true, batchId: body.batchId } }, { status: 202 }); } };
  const batch = await createUiExecutionBatch(f.env, scope, 'usr_test', { operationId: 'op_standalone', ...f.input.ui }, f.uiDependencies);
  assert.equal(batch.hosting.status, 'UNAVAILABLE'); assert.equal(count(f, 'ui_execution_dispatches'), 1); assert.equal(attempts, 1);
  fail = false; f.advance(60000);
  await Promise.all([dispatchUiBatch(f.env, scope, batch.batchId, { ...f.common, now: f.now() }), dispatchUiBatch(f.env, scope, batch.batchId, { ...f.common, now: f.now() })]);
  assert.equal(attempts, 2); assert.equal(f.db.sqlite.prepare('SELECT status FROM ui_execution_dispatches').get().status, 'ACCEPTED');
});

test('cron adopts prehosting batches and terminalizes expired ownership without ever requeueing Live', async () => {
  const f = await fixture(), first = await f.create({ ...f.input, api: null }), batchId = first.ui.batch.batchId;
  f.db.sqlite.prepare('DELETE FROM ui_execution_dispatches').run();
  const repo = new UiExecutionRepository(f.env), claim = await repo.claim(scope, batchId, 'worker_test', 'a'.repeat(64), f.now(), EXECUTION_LEASE_MS);
  assert.equal(claim.status, 'RUNNING'); f.advance(EXECUTION_LEASE_MS + 1);
  let starts = 0; f.env.UI_RUNNER = { fetch: async () => { starts++; throw new Error(); } }; f.env.UI_RUNNER_DISPATCH_SECRET = 'dispatch-secret-for-local-tests-1234567890123456';
  await reconcileUiDispatches(f.env, { ...f.common, now: f.now() });
  assert.equal(starts, 0); assert.equal(f.db.sqlite.prepare('SELECT status FROM ui_execution_items').get().status, 'ERROR');
  assert.equal(f.db.sqlite.prepare('SELECT status FROM ui_execution_dispatches').get().status, 'COMPLETE');
  assert.equal(await repo.claim(scope, batchId, 'worker_again', 'b'.repeat(64), f.now(), EXECUTION_LEASE_MS), null);
});

test('partial evidence remains downloadable with mode/kind after lease loss; stale writes remain rejected', async () => {
  const f = await fixture(), first = await f.create({ ...f.input, api: null }), batchId = first.ui.batch.batchId;
  const params = { surface: 'automation', projectId: scope.projectId, environmentId: scope.environmentId, resource: 'batches', batchId, action: 'claim' };
  const req = (body, headers = {}) => new Request('https://qagent.invalid', { method: 'POST', headers: { Authorization: 'Bearer ' + f.token, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const claim = (await (await uiExecutions(req({ workerId: 'worker_test' }), f.env, params, f.uiDependencies)).json()).data.claim;
  const bytes = '{"checkpoint":"captured"}', headers = { 'X-QAgent-Claim-Token': claim.claimToken, 'X-QAgent-SHA256': await hashBytes(bytes), 'Content-Type': 'application/json', 'X-QAgent-Evidence-Mode': 'UI_REPLAY', 'X-QAgent-Evidence-Kind': 'CHECKPOINT' };
  const evidenceParams = { ...params, action: 'evidence', itemId: claim.itemId, evidenceId: 'evidence_partial' };
  await uiExecutions(req(bytes, headers), f.env, evidenceParams, f.uiDependencies); f.advance(EXECUTION_LEASE_MS + 1);
  const detail = await uiExecutionDetail(f.env, new UiExecutionRepository(f.env), scope, batchId, f.now());
  assert.equal(detail.items[0].status, 'ERROR'); assert.equal(detail.items[0].result, null); assert.equal(detail.items[0].partialEvidence, true);
  assert.equal(detail.items[0].evidence[0].mode, 'UI_REPLAY'); assert.equal(detail.items[0].evidence[0].kind, 'CHECKPOINT');
  await assert.rejects(uiExecutions(req(bytes, headers), f.env, evidenceParams, f.uiDependencies), { code: 'UI_EXECUTION_STALE_CLAIM' });
  const download = await uiExecutions(new Request('https://qagent.invalid', { headers: { Authorization: 'Bearer ' + f.token } }), f.env, evidenceParams, f.uiDependencies);
  assert.equal(await download.text(), bytes);
});
