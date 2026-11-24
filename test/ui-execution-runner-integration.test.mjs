/** Cross-project wire acceptance. Run from the complete release checkout:
 * node --test qagent-gateway/test/ui-execution-runner-integration.test.mjs
 * A standalone Gateway checkout skips this suite; test:ui-exec1 remains local.
 * Only browser work (UiRunner.runMode) is substituted. Gateway, SQL, auth,
 * client, Worker, immutable-source validation, ArtifactStore and Ledger are real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uiExecutions } from '../src/handlers/uiExecutions.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { hashBytes } from '../src/services/uiExecutionContract.js';

const available = existsSync(new URL('../../qagent-ui-runner/src/worker.js', import.meta.url));
const modules = available ? await Promise.all([
  import('../../qagent-ui-runner/src/client.js'), import('../../qagent-ui-runner/src/worker.js'),
  import('../../qagent-ui-runner/src/engine.js'), import('../../qagent-ui-runner/src/ledger.js'),
  import('../../qagent-ui-runner/test/fixture.js'), import('../../qagent-ui-runner/src/core.js'),
]) : [];
const [{ GatewayClient } = {}, { Worker } = {}, { UiRunner } = {}, { Ledger } = {}, { fixture } = {}, { RunnerError } = {}] = modules;
const integration = (name, fn) => test(name, { skip: available ? false : 'requires sibling qagent-ui-runner from the complete release' }, fn);

class Prepared {
  constructor(db, sql, args = []) { Object.assign(this, { db, sql, args }); }
  bind(...args) { return new Prepared(this.db, this.sql, args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const result = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; }
}
class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON');
    this.sqlite.exec(readFileSync(new URL('../migrations/0022_ui_execution_control_plane.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) { return new Prepared(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const out = statements.map(s => ({ meta: { changes: Number(this.sqlite.prepare(s.sql).run(...s.args).changes) } })); this.sqlite.exec('COMMIT'); return out; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
class MemoryR2 {
  values = new Map();
  async put(key, body) { this.values.set(key, typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)); return { key }; }
  async get(key) { const bytes = this.values.get(key); return bytes ? { body: new Response(bytes).body, size: bytes.length } : null; }
}
async function setup(t, { partial = false, cancel = false, loseResultAck = false, failUpload = false } = {}) {
  const f = fixture(), scope = f.claim.scope, token = 'ui-execution-wire-test-token-01234567890123456789';
  const database = new SqliteD1(), bucket = new MemoryR2(), calls = [], routeErrors = [], artifactsRead = [];
  const directory = await mkdtemp(join(tmpdir(), 'qagent-wire-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); database.sqlite.close(); });
  const env = { QAGENT_DB: database, UI_EXECUTION_RESULTS: bucket,
    UI_EXECUTION_PROFILES_JSON: JSON.stringify([f.profile]),
    UI_EXECUTION_TOKENS_JSON: JSON.stringify([{ ...scope, tokenSha256: await hashBytes(token), permissions: ['read', 'create', 'execute'] }]) };
  const versionId = 'uitdv_wire_sample';
  const deps = { organization: async () => ({ status: 'active' }), environment: async () => ({ status: 'active' }),
    source: async () => ({ source: f.compilation.source }),
    request: async ({ path }) => {
      assert.match(path, new RegExp('/versions/' + versionId + '\\?'));
      return { domain: 'UI', testDesignId: 'uitd_wire_sample', testDesignVersionId: versionId, version: 1,
        contentHash: f.compilation.specificationHash, source: f.compilation.source, compilation: structuredClone(f.compilation) };
    },
    executionSource: async (_env, currentScope, design, artifactId) => {
      assert.deepEqual(currentScope, scope); assert.equal(design.compilation.specificationHash, f.compilation.specificationHash);
      if (!artifactId) return structuredClone(f.response);
      artifactsRead.push(artifactId); const bytes = f.bytes.get(artifactId); assert.ok(bytes);
      return new Response(bytes, { headers: { 'content-type': f.envelope.bundle.artifacts.find(a => a.artifactId === artifactId).contentType } });
    } };
  let lost = false;
  const fetchImpl = async (url, options) => {
    const req = new Request(url, options), parsed = new URL(url), route = resolveGatewayRoute(req.method, parsed.pathname);
    calls.push({ method: req.method, path: parsed.pathname }); assert.equal(route?.name, 'uiExecutions');
    let response;
    try {
      if (failUpload && req.method === 'POST' && parsed.pathname.includes('/evidence/')) throw Object.assign(new Error('UI_EXECUTION_TEST_UPLOAD_REJECTED'), { code: 'UI_EXECUTION_TEST_UPLOAD_REJECTED', status: 409 });
      response = await uiExecutions(req, env, route.params, deps);
    } catch (error) {
      routeErrors.push(error.code);
      return Response.json({ status: 'error', code: error.code, message: error.message }, { status: error.status ?? 500 });
    }
    if (loseResultAck && !lost && parsed.pathname.endsWith('/result')) { lost = true; await response.body.cancel(); throw new TypeError('ACK lost after D1 commit'); }
    return response;
  };
  const client = new GatewayClient({ apiUrl: 'https://gateway.example.test', ...scope, token, fetchImpl, timeoutMs: 5000, maxRetries: 1 });
  let cancelled = false;
  const engineFactory = options => {
    class BrowserBoundaryStub extends UiRunner {
      async runMode({ claim, mode, spec, signal }) {
        const counts = { actionsPlanned: spec.coverage.actionsTotal, actionsExecuted: 0, checkpointsPlanned: spec.coverage.checkpointsTotal, checkpointsReached: 0,
          checksPassed: 0, checksFailed: 0, checksPending: 0, fixturesConsumed: 0, requestsObserved: 0 };
        this.modeProgress = { mode, executionPerformed: false, counts };
        if (partial && mode === 'UI_LIVE') {
          // Simulate a technical failure after the browser acted. Production
          // runPair must preserve the finished Replay and honest Live progress.
          counts.actionsExecuted = 1; this.modeProgress.executionPerformed = true;
          throw new RunnerError('UI_RUNNER_TEST_PARTIAL_FAILURE');
        }
        const ledger = new Ledger(mode, this.outputDirectory, { pageBytes: 220 });
        let executionPerformed = false, status = 'PASSED';
        if (!signal.aborted) {
          executionPerformed = true; this.modeProgress.executionPerformed = true;
          counts.actionsExecuted = counts.actionsPlanned; counts.checkpointsReached = counts.checkpointsPlanned;
          for (let i = 0; i < 4; i++) await ledger.check('WIRE_ASSERTION', 'PASSED', { pointer: '/wire/' + i, manifestHash: spec.source.manifestHash }, i, i);
          await ledger.append('network', { id: 'uirq_wire_' + mode, method: 'GET', url: f.spec.entryUrl, status: 200 });
          await ledger.attachment('SCREENSHOT', Buffer.from('synthetic image'), 'image/png', '.png');
          await ledger.attachment('SCREENSHOT', Buffer.from('synthetic image'), 'image/png', '.png');
        }
        if (cancel && !cancelled) {
          cancelled = true; await client.cancel(claim.batchId);
          await new Promise((resolve, reject) => {
            if (signal.aborted) return resolve();
            const timer = setTimeout(() => reject(new Error('heartbeat did not propagate cancellation')), 1000);
            signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
          });
        }
        if (signal.aborted) { status = 'CANCELLED'; await ledger.pending(null, 'UI_RUNNER_CANCELLED'); }
        const reports = await ledger.finish(); Object.assign(counts, { checksPassed: ledger.statuses.PASSED, checksFailed: ledger.statuses.FAILED, checksPending: ledger.statuses.PENDING, requestsObserved: ledger.lengths.network });
        return { mode: { mode, status, reasonCodes: [...ledger.reasons], executionPerformed, counts, ...reports }, evidence: ledger.evidence };
      }
    }
    return new BrowserBoundaryStub(options);
  };
  const worker = new Worker({ client, preparations: {}, directory, heartbeatMs: 10, engineFactory, log() {} });
  const batch = await client.create({ operationId: 'uiexop_wire_case', testDesignVersionIds: [versionId], profileId: f.profile.profileId, targetBuildRef: 'build_wire' });
  return { client, worker, batch, scope, directory, database, bucket, calls, routeErrors, artifactsRead, f };
}

integration('real Client/Worker/Gateway complete claim, artifact proof, paged evidence, result and canonical JSON/JUnit', async t => {
  const h = await setup(t), outcome = await h.worker.runBatch(h.batch.batchId, { pollMs: 1 });
  assert.equal(outcome.exitCode, 0); assert.equal(outcome.batch.status, 'COMPLETED'); assert.equal(outcome.batch.gate, 'PASSED');
  const item = outcome.batch.items[0], pair = item.result;
  assert.equal(pair.modes.length, 2); assert.deepEqual(pair.modes.map(m => m.counts.requestsObserved), [1, 1]);
  assert.ok(pair.modes.every(m => m.externalized && m.reportPages.filter(p => p.collection === 'checks').length > 1));
  assert.equal(new Set(pair.evidence.map(e => e.evidenceId)).size, pair.evidence.length);
  assert.deepEqual([...new Set(h.artifactsRead)].sort(), [...h.f.bytes.keys()].sort());
  assert.equal(h.database.sqlite.prepare('SELECT COUNT(*) AS n FROM ui_execution_evidence').get().n, pair.evidence.length);
  assert.equal(h.routeErrors.length, 0);
  const report = JSON.parse(await readFile(join(h.directory, h.batch.batchId, 'report.json'), 'utf8'));
  assert.equal(report.gate, 'PASSED'); assert.ok(report.items[0].result.evidence.every(e => e.downloadPath));
  assert.match(await readFile(join(h.directory, h.batch.batchId, 'junit.xml'), 'utf8'), /tests="2" failures="0" errors="0"/);
  const path = report.items[0].result.evidence[0].downloadPath.replace(/^.*\/ui-executions/, '');
  const bytes = await h.client.request(path, { raw: true }); assert.equal(await hashBytes(bytes), report.items[0].result.evidence[0].sha256);
});

integration('lost result ACK retries the canonical result without re-executing browser work', async t => {
  const h = await setup(t, { loseResultAck: true }); const outcome = await h.worker.runBatch(h.batch.batchId, { pollMs: 1 });
  assert.equal(outcome.batch.gate, 'PASSED');
  assert.equal(h.calls.filter(c => c.path.endsWith('/result')).length, 2);
  assert.equal(h.calls.filter(c => c.path.endsWith('/source')).length, 1);
  assert.equal(h.database.sqlite.prepare('SELECT COUNT(*) AS n FROM ui_execution_items WHERE status=\'COMPLETED\'').get().n, 1);
});

integration('Live technical failure preserves executed Replay and partial Live instead of declaring no browser execution', async t => {
  const h = await setup(t, { partial: true }), outcome = await h.worker.runBatch(h.batch.batchId, { pollMs: 1 });
  assert.equal(outcome.exitCode, 2); assert.equal(outcome.batch.gate, 'INCOMPLETE');
  const pair = outcome.batch.items[0].result; assert.equal(pair.executionPerformed, true);
  assert.equal(pair.modes[0].status, 'PASSED'); assert.equal(pair.modes[0].counts.checksPassed, 4);
  assert.equal(pair.modes[1].status, 'ERROR'); assert.equal(pair.modes[1].executionPerformed, true); assert.equal(pair.modes[1].counts.actionsExecuted, 1);
  assert.equal(pair.modes[1].counts.checksPending, 1); assert.ok(pair.evidence.some(e => e.mode === 'UI_REPLAY'));
  assert.match(await readFile(join(h.directory, h.batch.batchId, 'junit.xml'), 'utf8'), /errors="1"/);
  assert.deepEqual(h.routeErrors, []);
});

integration('Console/CI cancellation reaches the Worker via real heartbeat and never exports a passing gate', async t => {
  const h = await setup(t, { cancel: true }), outcome = await h.worker.runBatch(h.batch.batchId, { pollMs: 1 });
  assert.equal(outcome.exitCode, 130); assert.equal(outcome.batch.status, 'CANCELLED'); assert.equal(outcome.batch.gate, 'INCOMPLETE');
  assert.ok(h.calls.some(c => c.path.endsWith('/heartbeat')));
  assert.deepEqual(outcome.batch.items[0].result.modes.map(m => m.status), ['CANCELLED', 'CANCELLED']);
  assert.match(await readFile(join(h.directory, h.batch.batchId, 'junit.xml'), 'utf8'), /errors="2"/);
  assert.deepEqual(h.routeErrors, []);
});

integration('an evidence transport failure retains the complete local executed result and stops heartbeat', async t => {
  const h = await setup(t, { failUpload: true }), { claim } = await h.client.claim(h.batch.batchId, 'uiworker_wire');
  await assert.rejects(h.worker.executeClaim(claim), { code: 'UI_EXECUTION_TEST_UPLOAD_REJECTED' });
  const pair = JSON.parse(await readFile(join(h.directory, claim.batchId, claim.itemId, 'result.json'), 'utf8'));
  assert.equal(pair.executionPerformed, true); assert.deepEqual(pair.modes.map(m => m.status), ['PASSED', 'PASSED']);
  assert.equal(h.calls.filter(c => c.path.endsWith('/result')).length, 0);
  const heartbeats = h.calls.filter(c => c.path.endsWith('/heartbeat')).length;
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(h.calls.filter(c => c.path.endsWith('/heartbeat')).length, heartbeats);
  assert.equal((await h.client.batch(h.batch.batchId)).gate, 'INCOMPLETE');
});
