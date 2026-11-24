import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { uiExecutions } from '../src/handlers/uiExecutions.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { UiExecutionRepository } from '../src/repositories/uiExecutionRepository.js';
import { canonical, hashBytes, machineAuthority, executionProfiles, EXECUTION_LEASE_MS } from '../src/services/uiExecutionContract.js';
import { executionSourceRequest } from '../src/services/uiExecutionStorage.js';
import { validatePairResult, ndjsonStats } from '../src/services/uiExecutionResults.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v2.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('../migrations/0022_ui_execution_control_plane.sql', import.meta.url), 'utf8');
const scope = golden.source.scope, token = 'ui-machine-token-for-local-verification-123456789';
const encoder = new TextEncoder();

// This harness executes the production SQL in SQLite, including RETURNING,
// constraints and real transactions. It does not emulate CAS in JavaScript.
class Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  async run() { const result = this.db.prepare(this.sql).run(...this.params); return { meta: { changes: Number(result.changes) } }; }
}
class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON'); this.sqlite.exec(migration); }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const out = statements.map(stmt => { const r = this.sqlite.prepare(stmt.sql).run(...stmt.params); return { meta: { changes: Number(r.changes) } }; }); this.sqlite.exec('COMMIT'); return out; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
class Bucket {
  objects = new Map(); puts = [];
  async put(key, value, options = {}) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
    this.objects.set(key, { bytes: bytes.slice(), options }); this.puts.push(key); return { key };
  }
  async get(key) { const row = this.objects.get(key); return row ? { body: new Response(row.bytes).body, size: row.bytes.length } : null; }
}
function version(id = 'uitdv_execution_a', testDesignId = 'uitd_execution_a', number = 1, compilation = golden) {
  return { domain: 'UI', testDesignId, testDesignVersionId: id, version: number, contentHash: compilation.specificationHash, source: compilation.source, compilation };
}
async function harness({ versions = [version()] } = {}) {
  let now = Date.parse('2026-11-23T12:00:00Z');
  const db = new D1(), bucket = new Bucket(), registry = new Map(versions.map(v => [v.testDesignVersionId, v])), calls = [], selectedVersions = versions.map(v => v.testDesignVersionId);
  const profile = { profileId: 'profile_stg', name: 'STG Chromium', scope, targetBaseUrl: 'https://app.example.test/', allowedOrigins: ['https://app.example.test'], preparationKey: 'prepare_stg', viewport: { width: 1280, height: 720 } };
  const env = { QAGENT_DB: db, UI_EXECUTION_RESULTS: bucket, UI_EXECUTION_TOKENS_JSON: JSON.stringify([{ ...scope, tokenSha256: await hashBytes(token), permissions: ['read', 'create', 'execute'] }]), UI_EXECUTION_PROFILES_JSON: JSON.stringify([profile]) };
  const deps = { now: () => now, tenant: async () => ({ organizationId: scope.organizationId, organizationRole: 'member', user: { userId: 'usr_test' } }), environment: async () => ({ status: 'active' }), organization: async () => ({ status: 'active' }),
    source: async () => ({ source: golden.source }), request: async args => {
      calls.push(args); const url = new URL('https://registry.invalid' + args.path);
      if (url.pathname.includes('/versions/')) { const v = registry.get(decodeURIComponent(url.pathname.split('/').at(-1))); if (!v) throw Object.assign(new Error('not found'), { status: 404 }); return structuredClone(v); }
      return { domain: 'UI', scope, items: [...registry.values()].map(({ compilation, ...rest }) => ({ ...rest, summary: compilation.summary })), nextCursor: null };
    }, executionSource: async (_env, inputScope, design, artifactId) => artifactId ? new Response('verified body', { headers: { 'content-type': 'application/json' } }) : ({ contractVersion: 'qagent.ui-execution-source.v1', source: design.source, specificationHash: design.compilation.specificationHash, envelope: { immutable: true } }) };
  async function request(suffix, method = 'GET', body, { machine = false, requestScope = scope, headers = {}, dependency = {} } = {}) {
    const path = `/v1/${machine ? 'automation' : 'console'}/projects/${requestScope.projectId}/environments/${requestScope.environmentId}/ui-executions` + suffix;
    const route = resolveGatewayRoute(method, new URL('https://gateway.invalid' + path).pathname); assert.equal(route?.name, 'uiExecutions', path);
    const raw = body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body);
    return uiExecutions(new Request('https://gateway.invalid' + path, { method, headers: { ...(machine ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(raw === undefined ? {} : { body: raw }) }), env, route.params, { ...deps, ...dependency });
  }
  const data = async (...args) => (await (await request(...args)).json()).data;
  const create = async (extra = {}) => data('/batches', 'POST', { operationId: 'uiexop_test', profileId: profile.profileId, targetBuildRef: 'commit:abc123', testDesignVersionIds: selectedVersions, ...extra });
  const claim = async batch => (await data(`/batches/${batch.batchId}/claim`, 'POST', { workerId: 'worker_local' }, { machine: true })).claim;
  return { env, db, bucket, registry, profile, deps, calls, request, data, create, claim, now: () => now, advance: ms => { now += ms; } };
}
function result({ status = 'PASSED', checks = [{ id: 'check_1', kind: 'ELEMENT_PRESENT', status: 'PASSED' }], pending = [], network = [] } = {}) {
  const mode = name => ({ mode: name, status, reasonCodes: status === 'PASSED' ? [] : ['UI_EXECUTION_TEST_PENDING'], executionPerformed: true,
    counts: { actionsPlanned: 1, actionsExecuted: 1, checkpointsPlanned: 1, checkpointsReached: 1, checksPassed: checks.filter(c => c.status === 'PASSED').length,
      checksFailed: checks.filter(c => c.status === 'FAILED').length, checksPending: checks.filter(c => c.status === 'PENDING').length, fixturesConsumed: 0, requestsObserved: network.length }, checks, pending, network });
  return { contractVersion: 'qagent.ui-execution-pair-result.v1', runnerVersion: '0.1.0', startedAt: '2026-11-23T12:00:00Z', completedAt: '2026-11-23T12:00:02Z', executionPerformed: true, modes: [mode('UI_REPLAY'), mode('UI_LIVE')], evidence: [] };
}
const itemRoute = (c, action) => `/batches/${c.batchId}/items/${c.itemId}/${action}`;
async function submit(h, c, value = result()) { return h.data(itemRoute(c, 'result'), 'POST', { claimToken: c.claimToken, result: value }, { machine: true }); }

test('migration is repeatable; only machine surface exposes claim/heartbeat/source/result', async () => {
  const h = await harness(); h.db.sqlite.exec(migration);
  const base = `/v1/console/projects/${scope.projectId}/environments/${scope.environmentId}/ui-executions`;
  for (const suffix of ['/batches/batch_test/claim', '/batches/batch_test/items/item_test/heartbeat', '/batches/batch_test/items/item_test/result']) assert.equal(resolveGatewayRoute('POST', base + suffix), null);
  assert.equal(resolveGatewayRoute('GET', base + '/batches/batch_test/items/item_test/artifacts/artifact_test'), null);
});

test('authority binds token, scope, permissions, active organization/environment and Console role', async () => {
  const h = await harness(), params = { ...scope };
  const auth = value => new Request('https://gateway.invalid', { headers: { authorization: 'Bearer ' + value } });
  await assert.rejects(machineAuthority(auth('invalid-but-long-enough-credential-12345'), h.env, params, 'read'), { status: 401 });
  await assert.rejects(machineAuthority(auth(token), h.env, { ...params, environmentId: 'env_other' }, 'read'), { status: 403 });
  h.env.UI_EXECUTION_TOKENS_JSON = JSON.stringify([{ ...scope, tokenSha256: await hashBytes(token), permissions: ['read'] }]);
  await assert.rejects(h.create(undefined).then(async b => h.claim(b)), { status: 403 });
  await assert.rejects(h.data('/profiles', 'GET', undefined, { machine: true, dependency: { organization: async () => null } }), { status: 403 });
  await assert.rejects(h.data('/profiles', 'GET', undefined, { dependency: { environment: async () => { throw Object.assign(new Error('environment'), { status: 404 }); } } }), { status: 404 });
  await assert.rejects(h.data('/batches', 'POST', {}, { dependency: { tenant: async () => ({ organizationId: scope.organizationId, organizationRole: 'viewer' }) } }), { status: 403 });
});

test('execution profiles reject origin wildcards/credentials/cross-origin mappings and preserve scope', async () => {
  const h = await harness(); assert.equal(executionProfiles(h.env, scope)[0].scope.environmentId, scope.environmentId);
  for (const patch of [{ targetBaseUrl: 'https://user:password@app.example.test' }, { targetBaseUrl: 'https://app.example.test/?target=ambiguous' }, { allowedOrigins: ['https://*.example.test'] }, { originMap: { 'https://app.example.test': 'https://elsewhere.example.test' } }, { viewport: { width: 0, height: 20 } }, { stepTimeoutMs: 7000.5 }, { stepTimeoutMs: 120000, modeTimeoutMs: 10000 }]) {
    assert.throws(() => executionProfiles({ ...h.env, UI_EXECUTION_PROFILES_JSON: JSON.stringify([{ ...h.profile, ...patch }]) }, scope));
  }
});

test('admission snapshots exact Registry versions and profile in R2; retry is idempotent and changed operation conflicts', async () => {
  const h = await harness(), first = await h.create(), callCount = h.calls.length;
  assert.equal(first.status, 'QUEUED'); assert.equal(first.gate, 'INCOMPLETE'); assert.equal(first.items.length, 1);
  h.env.UI_EXECUTION_PROFILES_JSON = '[]'; h.registry.clear();
  const repeated = await h.create(); assert.equal(repeated.batchId, first.batchId); assert.equal(repeated.reused, true); assert.equal(h.calls.length, callCount);
  await assert.rejects(h.create({ targetBuildRef: 'commit:different' }), { code: 'UI_EXECUTION_IDEMPOTENCY_CONFLICT' });
  const c = await h.claim(first); assert.equal(c.targetBuildRef, 'commit:abc123'); assert.equal(c.design.compilation.specificationHash, golden.specificationHash); assert.equal(c.profile.profileId, 'profile_stg');
  const cols = h.db.sqlite.prepare('PRAGMA table_info(ui_execution_items)').all().map(x => x.name);
  assert.ok(!cols.includes('result_json') && !cols.includes('compilation_json'));
});

test('D1 atomic admission rolls back every row on a failed item; racing operation produces one complete snapshot', async () => {
  const h = await harness(), repo = new UiExecutionRepository(h.env);
  const b = { id: 'batch_atomic', operationId: 'operation_atomic', requestHash: 'a'.repeat(64), snapshotKey: 'snap', snapshotHash: 'b'.repeat(64), profileId: 'profile_stg', targetBuildRef: 'build', now: h.now(), actor: 'usr_test' };
  const valid = { id: 'item_valid', ordinal: 0, source: golden.source, testDesignId: 'uitd_atomic', testDesignVersionId: 'uitdv_atomic', version: 1, designKey: 'design', designHash: 'c'.repeat(64) };
  await assert.rejects(repo.insert(scope, b, [valid, { ...valid, id: 'item_invalid' }]));
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ui_execution_batches').get().n, 0);
  const outcomes = await Promise.all([h.create(), h.create()]); assert.equal(outcomes[0].batchId, outcomes[1].batchId);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ui_execution_items').get().n, 1);
});

test('wrong Registry source/version/hash cannot enter a batch', async () => {
  const h = await harness();
  h.registry.get('uitdv_execution_a').testDesignVersionId = 'uitdv_different';
  await assert.rejects(h.create(), { code: 'UI_EXECUTION_REGISTRY_VERSION_MISMATCH' });
  h.registry.get('uitdv_execution_a').testDesignVersionId = 'uitdv_execution_a'; h.deps.source = async () => ({ source: { ...golden.source, sourceHash: 'f'.repeat(64) } });
  await assert.rejects(h.create(), { code: 'UI_EXECUTION_SOURCE_MISMATCH' });
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ui_execution_batches').get().n, 0);
});

test('concurrent claims execute real SQLite CAS and never acquire one item twice', async () => {
  const h = await harness({ versions: [version(), version('uitdv_execution_b', 'uitd_execution_b')] }), b = await h.create();
  const claims = await Promise.all([h.claim(b), h.claim(b), h.claim(b), h.claim(b)]), acquired = claims.filter(Boolean);
  assert.equal(acquired.length, 2); assert.equal(new Set(acquired.map(c => c.itemId)).size, 2);
  assert.notEqual(acquired[0].claimToken, acquired[1].claimToken);
  await assert.rejects(h.data(itemRoute(acquired[0], 'heartbeat'), 'POST', { claimToken: acquired[1].claimToken }, { machine: true }), { code: 'UI_EXECUTION_STALE_CLAIM' });
});

test('expired lease becomes terminal ERROR and cannot be re-executed or finalize; recovery is a new explicit batch', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b); h.advance(EXECUTION_LEASE_MS + 1);
  assert.equal(await h.claim(b), null);
  await assert.rejects(submit(h, c), { code: 'UI_EXECUTION_STALE_CLAIM' });
  const after = await h.data('/batches/' + b.batchId); assert.equal(after.items[0].status, 'ERROR'); assert.equal(after.gate, 'INCOMPLETE');
  const next = await h.create({ operationId: 'operation_explicit_retry' }); assert.notEqual(next.batchId, b.batchId); assert.ok(await h.claim(next));
});

test('heartbeat extends current lease only and cross-tenant item/batch reads reveal nothing', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b); h.advance(20000);
  const beat = await h.data(itemRoute(c, 'heartbeat'), 'POST', { claimToken: c.claimToken }, { machine: true }); assert.ok(beat.leaseExpiresAt > c.leaseExpiresAt);
  await assert.rejects(h.data('/batches/' + b.batchId, 'GET', undefined, { dependency: { tenant: async () => ({ organizationId: 'org_other', organizationRole: 'owner' }) } }), { status: 404 });
});

test('cancellation stops queued claims, signals current worker and cannot produce green report', async () => {
  const h = await harness({ versions: [version(), version('uitdv_execution_b', 'uitd_execution_b')] }), b = await h.create(), c = await h.claim(b);
  const cancelled = await h.data('/batches/' + b.batchId + '/cancel', 'POST', {}); assert.equal(cancelled.status, 'CANCELLED'); assert.equal(cancelled.counts.cancelled, 1);
  const beat = await h.data(itemRoute(c, 'heartbeat'), 'POST', { claimToken: c.claimToken }, { machine: true }); assert.equal(beat.cancelRequested, true); assert.ok(beat.leaseExpiresAt <= h.now() + 30000);
  assert.equal(await h.claim(b), null);
  const final = await submit(h, c); assert.equal(final.gate, 'INCOMPLETE'); assert.equal(final.status, 'CANCELLED');
  const xml = await (await h.request('/batches/' + b.batchId + '/report?format=junit')).text(); assert.match(xml, /errors="4"/);
});

test('result finalization is fenced, idempotent after lost ACK, and conflicting concurrent results reject', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b);
  const [first, retry] = await Promise.all([submit(h, c), submit(h, c)]); assert.equal(first.gate, 'PASSED'); assert.equal(retry.gate, 'PASSED');
  const changed = result(); changed.runnerVersion = 'different';
  await assert.rejects(submit(h, c, changed), { code: 'UI_EXECUTION_RESULT_CONFLICT' });
  await assert.rejects(submit(h, { ...c, claimToken: 'uiclaim_stale' }), { code: 'UI_EXECUTION_STALE_CLAIM' });
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ui_execution_items WHERE result_hash IS NOT NULL').get().n, 1);
});

test('zero checks/pending/missing actions/checkpoints/counter tampering cannot claim PASS', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b);
  for (const value of [result({ checks: [] }), result({ pending: [{ reasonCode: 'UI_EXECUTION_PENDING' }] }), result({ checks: [{ id: 'x', kind: 'K', status: 'PENDING' }] })]) await assert.rejects(submit(h, c, value), { code: 'UI_EXECUTION_PASS_GATE_INVALID' });
  for (const field of ['actionsExecuted', 'checkpointsReached']) { const v = result(); v.modes[0].counts[field] = 0; await assert.rejects(submit(h, c, v), { code: 'UI_EXECUTION_PASS_GATE_INVALID' }); }
  const invalid = result(); invalid.modes[0].counts.checksPassed = 25; await assert.rejects(submit(h, c, invalid), { code: 'UI_EXECUTION_RESULT_COUNTS_MISMATCH' });
  const wrongPlan = result(); wrongPlan.modes[0].counts.actionsPlanned = 0; await assert.rejects(submit(h, c, wrongPlan), { code: 'UI_EXECUTION_PLAN_COUNTS_MISMATCH' });
  const queued = await h.data('/batches/' + b.batchId); assert.equal(queued.gate, 'INCOMPLETE');
});

test('blocked technical result preserves honest counts and JUnit reports errors rather than skips/green', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b), value = result({ status: 'BLOCKED', checks: [], pending: [{ reasonCode: 'UI_PREPARATION_MISSING' }] });
  value.executionPerformed = false;
  for (const mode of value.modes) { mode.executionPerformed = false; mode.counts.actionsExecuted = 0; mode.counts.checkpointsReached = 0; }
  const finished = await submit(h, c, value); assert.equal(finished.status, 'COMPLETED'); assert.equal(finished.gate, 'INCOMPLETE');
  const xml = await (await h.request('/batches/' + b.batchId + '/report?format=junit')).text(); assert.match(xml, /tests="2" failures="0" errors="2" skipped="0"/);
});

test('failed assertions cause failed gate and unresolved batch export always contains testcases with errors', async () => {
  const h = await harness(), b = await h.create();
  const before = await (await h.request('/batches/' + b.batchId + '/report?format=junit')).text(); assert.match(before, /tests="2" failures="0" errors="2"/);
  const c = await h.claim(b), value = result({ status: 'FAILED', checks: [{ id: 'failed_1', kind: 'LAYOUT', status: 'FAILED' }] });
  const completed = await submit(h, c, value); assert.equal(completed.gate, 'FAILED');
  const after = await (await h.request('/batches/' + b.batchId + '/report?format=junit')).text(); assert.match(after, /failures="2" errors="0"/);
});

test('evidence upload verifies bytes, tenant/item/claim, idempotency and immutable conflict semantics', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b), bytes = encoder.encode('test evidence'), digest = await hashBytes(bytes);
  const headers = { 'Content-Type': 'image/png', 'X-QAgent-Claim-Token': c.claimToken, 'X-QAgent-SHA256': digest };
  const options = { machine: true, headers };
  const first = await h.data(itemRoute(c, 'evidence/evidence_one'), 'POST', bytes, options);
  assert.equal(first.sha256, digest); assert.equal((await h.data(itemRoute(c, 'evidence/evidence_one'), 'POST', bytes, options)).byteLength, bytes.length);
  const altered = encoder.encode('different');
  await assert.rejects(h.data(itemRoute(c, 'evidence/evidence_one'), 'POST', altered, { machine: true, headers: { ...headers, 'X-QAgent-SHA256': await hashBytes(altered) } }), { code: 'UI_EXECUTION_EVIDENCE_CONFLICT' });
  await assert.rejects(h.data(itemRoute(c, 'evidence/evidence_bad'), 'POST', altered, options), { code: 'UI_EXECUTION_EVIDENCE_HASH_MISMATCH' });
  const downloaded = await h.request(itemRoute(c, 'evidence/evidence_one')); assert.equal(await downloaded.text(), 'test evidence'); assert.equal(downloaded.headers.get('Content-Security-Policy'), "sandbox; default-src 'none'");
  await assert.rejects(h.request(itemRoute(c, 'evidence/evidence_one'), 'GET', undefined, { dependency: { tenant: async () => ({ organizationId: 'org_other', organizationRole: 'owner' }) } }), { status: 404 });
});

test('externalized NDJSON preserves all collections; measured page counts and root receipts gate finalization', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b), value = result();
  for (const [i, mode] of value.modes.entries()) {
    const bytes = encoder.encode(JSON.stringify(mode.checks[0]) + '\n'), hash = await hashBytes(bytes), evidenceId = 'evidence_checks_' + i;
    const ref = await h.data(itemRoute(c, 'evidence/' + evidenceId), 'POST', bytes, { machine: true, headers: { 'Content-Type': 'application/x-ndjson', 'X-QAgent-Claim-Token': c.claimToken, 'X-QAgent-SHA256': hash } });
    value.evidence.push({ ...ref, mode: mode.mode }); mode.externalized = true; mode.reportPages = [{ ...ref, collection: 'checks', count: 1 }]; mode.checks = [];
  }
  const bad = structuredClone(value); bad.modes[0].reportPages[0].count = 2;
  await assert.rejects(submit(h, c, bad), { code: 'UI_EXECUTION_PAGE_COUNTS_MISMATCH' });
  const omitted = structuredClone(value); omitted.evidence.pop();
  await assert.rejects(submit(h, c, omitted), { code: 'UI_EXECUTION_PAGE_REF_MISMATCH' });
  const good = await submit(h, c, value); assert.equal(good.gate, 'PASSED'); assert.equal(good.items[0].result.modes[0].counts.checksPassed, 1);
  const report = await (await h.request('/batches/' + b.batchId + '/report?format=json')).json(); assert.match(report.items[0].result.evidence[0].downloadPath, /\/items\/uiei_.*\/evidence\/evidence_checks_0$/);
  assert.equal(h.db.sqlite.prepare('SELECT page_stats_json FROM ui_execution_evidence LIMIT 1').get().page_stats_json, '{"rows":1,"checks":1,"passed":1,"failed":0,"pending":0}');
});

test('expired claim cannot publish an evidence object even when expiry occurs during R2 upload', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b), bytes = encoder.encode('evidence');
  const original = h.bucket.put.bind(h.bucket); h.bucket.put = async (...args) => { const out = await original(...args); h.advance(EXECUTION_LEASE_MS + 1); return out; };
  await assert.rejects(h.data(itemRoute(c, 'evidence/evidence_late'), 'POST', bytes, { machine: true, headers: { 'Content-Type': 'image/png', 'X-QAgent-Claim-Token': c.claimToken, 'X-QAgent-SHA256': await hashBytes(bytes) } }), { code: 'UI_EXECUTION_STALE_CLAIM' });
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ui_execution_evidence').get().n, 0);
});

test('overlapping check IDs across distinct pages cannot inflate a passing result', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b), value = result();
  const mode = value.modes[0]; mode.externalized = true; mode.checks = []; mode.reportPages = []; mode.counts.checksPassed = 2;
  for (let i = 0; i < 2; i++) {
    const bytes = encoder.encode(JSON.stringify({ id: 'same_logical_check', kind: 'TEXT', status: 'PASSED', actual: 'different_page_' + i }) + '\n');
    const ref = await h.data(itemRoute(c, 'evidence/evidence_overlap_' + i), 'POST', bytes, { machine: true, headers: { 'Content-Type': 'application/x-ndjson', 'X-QAgent-Claim-Token': c.claimToken, 'X-QAgent-SHA256': await hashBytes(bytes) } });
    value.evidence.push(ref); mode.reportPages.push({ ...ref, collection: 'checks', count: 1 });
  }
  await assert.rejects(submit(h, c, value), { code: 'UI_EXECUTION_DUPLICATE_CHECK' });
});

test('pending and network status fields are not mistaken for check rows', () => {
  const stats = ndjsonStats(encoder.encode('{"status":"PENDING","reasonCode":"UI_UNSUPPORTED","sourceRef":{}}\n{"id":"uirq_one","status":200,"method":"GET"}\n'));
  assert.deepEqual(stats, { rows: 2, checks: 0, passed: 0, failed: 0, pending: 0 });
});

test('cancellation/expiry during upstream source read cannot release data using a stale claim', async () => {
  for (const cancelled of [true, false]) {
    const h = await harness(), b = await h.create(), c = await h.claim(b), original = h.deps.executionSource;
    h.deps.executionSource = async (...args) => {
      const output = await original(...args);
      if (cancelled) await new UiExecutionRepository(h.env).cancel(scope, b.batchId, h.now()); else h.advance(EXECUTION_LEASE_MS + 1);
      return output;
    };
    await assert.rejects(h.data(itemRoute(c, 'source'), 'POST', { claimToken: c.claimToken }, { machine: true }), { code: cancelled ? 'UI_EXECUTION_CANCELLED' : 'UI_EXECUTION_STALE_CLAIM' });
  }
});

test('legacy Registry designs remain visible but cannot be admitted for UI execution', async () => {
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v1.json', import.meta.url), 'utf8'));
  const h = await harness({ versions: [version('uitdv_legacy', 'uitd_legacy', 1, legacy)] });
  h.deps.source = async () => ({ source: legacy.source });
  const inventory = await h.data('/inventory'); assert.equal(inventory.items[0].executable, false); assert.equal(inventory.items[0].contractVersion, 'qagent.ui-test-design.v1');
  await assert.rejects(h.create(), { code: 'UI_EXECUTION_LEGACY_DESIGN_UNSUPPORTED' });
});

test('inventory consumes all Registry pages, selects latest exact version and rejects cursor cycles', async () => {
  const h = await harness({ versions: [version(), version('uitdv_execution_b', 'uitd_execution_a', 2)] }), original = h.deps.request;
  let pages = 0;
  h.deps.request = async args => {
    if (args.path.includes('/versions/')) return original(args);
    pages++; const v = version(pages === 1 ? 'uitdv_execution_a' : 'uitdv_execution_b', 'uitd_execution_a', pages);
    return { domain: 'UI', scope, items: [v], nextCursor: pages === 1 ? 'cursor_next' : null };
  };
  const inv = await h.data('/inventory'); assert.equal(pages, 2); assert.equal(inv.inventoryComplete, true); assert.equal(inv.items.length, 1); assert.equal(inv.items[0].version, 2); assert.equal(inv.items[0].executable, true);
  h.deps.request = async args => args.path.includes('/versions/') ? original(args) : { domain: 'UI', scope, items: [], nextCursor: 'repeated_cursor' };
  await assert.rejects(h.data('/inventory'), { code: 'UI_EXECUTION_INVENTORY_CURSOR_CYCLE' });
});

test('source/artifact proxy accepts only current admitted plan, never caller supplied source URLs', async () => {
  const h = await harness(), b = await h.create(), c = await h.claim(b); let received;
  h.deps.executionSource = async (...args) => { received = args; return { contractVersion: 'qagent.ui-execution-source.v1', source: golden.source, specificationHash: golden.specificationHash, envelope: { complete: true } }; };
  const source = await h.data(itemRoute(c, 'source'), 'POST', { claimToken: c.claimToken }, { machine: true }); assert.equal(source.envelope.complete, true); assert.equal(received[2].compilation.specificationHash, golden.specificationHash);
  await assert.rejects(h.data(itemRoute(c, 'source'), 'POST', { claimToken: c.claimToken, url: 'https://attacker.invalid' }, { machine: true }));
  await h.data('/batches/' + b.batchId + '/cancel', 'POST', {});
  await assert.rejects(h.data(itemRoute(c, 'source'), 'POST', { claimToken: c.claimToken }, { machine: true }), { code: 'UI_EXECUTION_CANCELLED' });
});

test('execution source adapter uses separate HMAC principal and supports source envelopes above old 1MiB cap', async () => {
  const secret = 'local-execution-secret-at-least-32-characters'; let call;
  const env = { UI_EXECUTION_SECRET: secret, UI_SERVICE: { fetch: async req => { call = req; return Response.json({ large: 'x'.repeat(2 * 1024 * 1024) }); } } };
  const value = await executionSourceRequest(env, scope, version()); assert.equal(value.large.length, 2 * 1024 * 1024);
  assert.equal(call.headers.get('X-QAgent-Bundle-Principal'), 'execution'); assert.match(call.headers.get('X-QAgent-Bundle-Signature'), /^[a-f0-9]{64}$/);
  const body = await call.text(), timestamp = call.headers.get('X-QAgent-Bundle-Time'), path = new URL(call.url).pathname;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = Uint8Array.from(call.headers.get('X-QAgent-Bundle-Signature').match(/../g), byte => parseInt(byte, 16));
  assert.equal(await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`QAGENT_UI_BUNDLE_HTTP_V1\nexecution\nPOST\n${path}\n${timestamp}\n${await hashBytes(body)}`)), true);
  assert.equal(JSON.parse(body).specificationHash, golden.specificationHash);
});
