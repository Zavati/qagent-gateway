/** Test-only D1 adapter. Real SQLite, existing migrations, real Run repository.
 * Runtime configuration/Results/HTTP are synthetic. No external network or Runner.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { createRunArtifacts, getRunBundle } from '../../src/repositories/runRepository.js';
import { createRunV1 } from '../../src/services/runService.js';
import { createEvolutionRerunV1 } from '../../src/services/evolutionRerunService.js';
import { materializeExecutionPlanV1 } from '../../src/services/executionPlanMaterializerService.js';
import { fingerprintRunCreateInput, sha256Hex } from '../../src/lib/runContracts.js';
import { evolutionVerificationKey } from '../../src/lib/evolutionVerificationRetry.js';
import { evaluateScenarioReadinessV2, projectLegacyReadiness } from '../../src/readiness/scenarioReadinessV2.js';
import { collectScenarioReadinessIssues } from '../../src/readiness/scenarioReadinessFacts.js';
import { readinessScenarioHash, reconcileReadinessFacts } from '../../src/readiness/readinessReconciliation.js';

export class RetrySQLiteD1 {
  constructor() { this.raw = new DatabaseSync(':memory:'); this.raw.exec('PRAGMA foreign_keys=ON'); this.beforeBatch = null; }
  prepare(sql) {
    const raw = this.raw;
    const stmt = args => ({
      bind: (...xs) => stmt(xs),
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args), success: true }),
      run: async () => { const r = raw.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      syncRun: () => { const r = raw.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    });
    return stmt([]);
  }
  async batch(statements) {
    if (this.beforeBatch) await this.beforeBatch(statements);
    this.raw.exec('BEGIN IMMEDIATE');
    try { const out = statements.map(s => s.syncRun()); this.raw.exec('COMMIT'); return out; }
    catch (e) { this.raw.exec('ROLLBACK'); throw e; }
  }
  close() { this.raw.close(); }
}
export const retryScope = { organizationId: 'org_retry', projectId: 'prj_retry', endpointId: 'cep_retry', environmentId: 'env_retry' };
export const retryFlags = { SCENARIO_READINESS_V2_ENABLED: 'true', SCENARIO_READINESS_RECONCILIATION_ENABLED: 'true' };
const iso = ms => new Date(ms).toISOString();
export function newRetryScenario() {
  const s = { scenarioId: 'test_002', title: 'Verificar sem autenticação', objective: 'Rejeitar ausência de autenticação com 401.',
    category: 'AUTHORIZATION', priority: 'HIGH', confidence: 'LOW', grounding: { level: 'ASSUMED', rationale: ['Hipótese.'], evidenceRefs: [], schemaRefs: [] },
    automation: { readiness: 'REVIEW_REQUIRED', blockers: [] }, preconditions: [],
    learning: { kind: 'HYPOTHESIS_CONFIRMATION', phase: 'PENDING_VERIFICATION', proposalId: 'tep_retry', environmentId: retryScope.environmentId },
    spec: { dslVersion: 'qagent.api-test-dsl.v1', type: 'api', target: { catalogEndpointId: retryScope.endpointId, apiServiceKey: 'svc_retry', method: 'GET', path: '/items/{id}' },
      auth: { requirement: 'UNAUTHENTICATED', authProfileRef: null }, request: { pathParams: { id: '81' }, headers: {}, query: {} },
      assertions: [{ type: 'STATUS', expectedStatusCodes: [401] }], extract: [] } };
  s.readinessV2 = evaluateScenarioReadinessV2({ issues: collectScenarioReadinessIssues(s), expectation: { status: 'HYPOTHESIS', basis: 'DERIVATION_PENDING_VERIFICATION' }, learningPolicyAllows: true });
  s.automation.readiness = projectLegacyReadiness(s.readinessV2);
  return s;
}

export async function retryFixture() {
  const db = new RetrySQLiteD1();
  try {
    const migrationRoot = new URL('../../migrations/', import.meta.url);
    for (const name of readdirSync(migrationRoot).filter(n => n.endsWith('.sql')).sort()) db.raw.exec(readFileSync(new URL(name, migrationRoot), 'utf8'));
    const scope = { ...retryScope }, now = Date.now(), appliedAt = iso(now - 240000), initialCreated = iso(now - 120000), terminal = iso(now - 60000);
    db.raw.prepare("INSERT INTO organizations(organization_id,name,created_at,updated_at) VALUES(?,'Retry',?,?)").run(scope.organizationId, appliedAt, appliedAt);
    db.raw.prepare("INSERT INTO projects(project_id,organization_id,name,slug,created_at,updated_at) VALUES(?,?,'Retry','retry',?,?)").run(scope.projectId, scope.organizationId, appliedAt, appliedAt);
    db.raw.prepare("INSERT INTO environments(environment_id,organization_id,project_id,name,slug,environment_type,created_at,updated_at) VALUES(?,?,?,'STG','stg','STG',?,?)").run(scope.environmentId, scope.organizationId, scope.projectId, appliedAt, appliedAt);
    const scenario = newRetryScenario(), targetId = 'tdv_retry_17';
    const artifact = { ...scope, contractVersion: 'qagent.runner-test-artifact.v1', testDesignId: 'td_retry', testDesignVersionId: targetId, version: 17,
      createdAt: appliedAt, contextFingerprint: 'a'.repeat(64), specificationVersion: 'qagent.test-spec.v1',
      specification: { contractVersion: 'qagent.test-design.v1', specificationVersion: 'qagent.test-spec.v1', source: { type: 'CATALOG_ENDPOINT', ...scope }, scenarios: [scenario] } };
    const proposal = { proposalId: 'tep_retry', status: 'APPLIED', appliedAt, source: { testDesignId: 'td_retry', testDesignVersionId: 'tdv_retry_16', testDesignVersion: 16,
      endpointId: scope.endpointId, scenarioId: scenario.scenarioId, runId: 'run_retry_source', resultSetId: 'rset_retry_source', scenarioResultId: 'sres_retry_source' },
      result: { testDesignVersionId: targetId, testDesignVersion: 17 }, changes: [{ changeType: 'SCENARIO_READINESS_CONFIRMATION', proposed: {} }], outcomeVerification: null };
    const sent = [], results = new Map(); let sendsFail = 0, externalCalls = 0;
    const env = { ...retryFlags, QAGENT_DB: db, log: () => {}, RUN_QUEUE: { async send(message) { if (sendsFail > 0) { sendsFail--; throw Error('SYNTHETIC_SEND_FAILURE'); } sent.push(structuredClone(message)); } } };
    const fixture = { db, scope, env, artifact, proposal, scenario, sent, results, externalCalls, initialRunId: 'run_retry_initial',
      failSends(n = 1) { sendsFail = n; }, close() { db.close(); } };
    async function seed(runId, key, versionId, version, createdAt) {
      const run = { ...scope, runId, contractVersion: 'qagent.run.v1', testDesignId: 'td_retry', testDesignVersionId: versionId, testDesignVersion: version,
        executionPlanId: 'xplan_' + runId, runtimeSnapshotId: 'rts_' + runId, scenarioIds: [scenario.scenarioId], scenarioCount: 1, idempotencyKey: key,
        createdByUserId: 'usr_retry', createdAt, updatedAt: createdAt };
      run.requestFingerprint = await fingerprintRunCreateInput({ contractVersion: 'qagent.run-create.v1', testDesignVersionId: versionId, environmentId: scope.environmentId,
        scenarioIds: [scenario.scenarioId], purpose: 'LEARNING', confirmDiscoveredRuntime: false });
      const runtime = { contractVersion: 'qagent.runtime-snapshot.v1', runId, runtimeSnapshotId: run.runtimeSnapshotId, organizationId: scope.organizationId, projectId: scope.projectId,
        environment: { environmentId: scope.environmentId, environmentType: 'STG', name: 'Synthetic' }, resolution: { source: 'DISCOVERED_OBSERVATION', confidence: 'HIGH', requiresExecutionConfirmation: false },
        apiServices: { svc_retry: { serviceKey: 'svc_retry', baseUrl: 'https://fixture.example' } }, authProfiles: {}, createdAt };
      runtime.snapshotHash = await sha256Hex(runtime);
      const plan = { contractVersion: 'qagent.execution-plan.v1', purpose: 'LEARNING', runId, organizationId: scope.organizationId, projectId: scope.projectId,
        executionPlanId: run.executionPlanId, runtimeSnapshotId: run.runtimeSnapshotId, environmentId: scope.environmentId,
        testDesign: { testDesignId: run.testDesignId, testDesignVersionId: versionId, version, endpointId: scope.endpointId },
        scenarios: [{ scenarioId: scenario.scenarioId, spec: structuredClone(scenario.spec) }], schemaSnapshots: [], createdAt };
      plan.planHash = await sha256Hex(plan);
      await createRunArtifacts(env, { run, runtimeSnapshot: runtime, executionPlan: plan });
      return getRunBundle(env, scope.organizationId, scope.projectId, runId);
    }
    fixture.seed = seed;
    async function finish(runId, { outcome = 'TIMEOUT', completedAt = iso(Date.now()), statusCode = 401 } = {}) {
      const b = await getRunBundle(env, scope.organizationId, scope.projectId, runId), r = b.run, assertions = b.executionPlan.plan.scenarios[0].spec.assertions;
      const timeout = outcome === 'TIMEOUT', failed = outcome === 'FAILED';
      const state = timeout ? 'ERROR' : failed ? 'FAILED' : 'PASSED';
      db.raw.prepare('UPDATE runs SET status=?,updated_at=? WHERE run_id=?').run(state, completedAt, runId);
      db.raw.prepare("UPDATE run_queue_dispatches SET status='RECEIVED',published_at=COALESCE(published_at,?),runner_received_at=? WHERE run_id=?").run(r.createdAt, completedAt, runId);
      const attempt = { attempt_id: 'runatt_' + runId, run_id: runId, organization_id: scope.organizationId, project_id: scope.projectId, attempt_number: 1, status: 'RECEIVED',
        lease_owner_id: 'synthetic-worker', lease_token_hash: 'b'.repeat(64), lease_acquired_at: r.createdAt, lease_expires_at: iso(Date.parse(completedAt) + 60000),
        received_at: completedAt, terminal_at: completedAt, created_at: r.createdAt, updated_at: completedAt,
        runtime_readiness_status: 'READY', runtime_target_count: 1, runtime_materialized_at: r.createdAt,
        test_data_runtime_status: 'COMPLETED', test_data_binding_count: 1, test_data_fixed_count: 1,
        http_execution_status: 'COMPLETED', http_request_count: 1, http_response_count: timeout ? 0 : 1, http_network_error_count: 0,
        http_timeout_count: timeout ? 1 : 0, http_redirect_count: 0, http_duration_ms: timeout ? 10000 : 100, http_executed_at: completedAt,
        http_primary_diagnostic_kind: timeout ? 'TIMEOUT' : 'HTTP_RESPONSE', http_primary_error_code: timeout ? 'RUNNER_HTTP_TIMEOUT' : null,
        http_primary_scenario_id: scenario.scenarioId, http_primary_status_code: timeout ? null : statusCode,
        assertion_execution_status: 'COMPLETED', assertion_outcome: state, assertion_count: assertions.length, assertion_passed_count: timeout || failed ? 0 : assertions.length,
        assertion_failed_count: failed ? assertions.length : 0, assertion_not_evaluated_count: timeout ? assertions.length : 0,
        assertion_scenario_count: 1, assertion_scenario_passed_count: timeout || failed ? 0 : 1, assertion_scenario_failed_count: failed ? 1 : 0,
        assertion_scenario_not_evaluated_count: timeout ? 1 : 0, assertion_primary_error_code: timeout ? 'ASSERTION_HTTP_RESPONSE_UNAVAILABLE' : null };
      const keys = Object.keys(attempt); db.raw.prepare(`INSERT INTO run_execution_attempts(${keys.join(',')}) VALUES(${keys.map(() => '?')})`).run(...Object.values(attempt));
      const data = { contractVersion: 'qagent.execution-results-read.v1', resultSet: { ...scope, resultSetId: runId === proposal.source.runId ? proposal.source.resultSetId : 'rset_' + runId,
        runId, testDesignId: r.testDesignId, testDesignVersionId: r.testDesignVersionId, testDesignVersion: r.testDesignVersion, outcome: state, completedAt },
        scenarios: [{ scenarioId: scenario.scenarioId, scenarioResultId: runId === proposal.source.runId ? proposal.source.scenarioResultId : 'sres_' + runId,
          outcome: timeout ? 'NOT_EVALUATED' : state, assertionFailedCount: failed ? assertions.length : 0, assertionPassedCount: timeout || failed ? 0 : assertions.length,
          assertionNotEvaluatedCount: timeout ? assertions.length : 0, http: { method: scenario.spec.target.method, outcome: timeout ? 'TIMEOUT' : 'RESPONSE', statusCode: timeout ? null : statusCode, errorCode: timeout ? 'RUNNER_HTTP_TIMEOUT' : null },
          assertions: assertions.map((a, i) => ({ assertionIndex: i, type: a.type, outcome: timeout ? 'NOT_EVALUATED' : state, errorCode: timeout ? 'ASSERTION_HTTP_RESPONSE_UNAVAILABLE' : null })) }] };
      results.set(runId, data); return data;
    }
    fixture.finish = finish;
    await seed(proposal.source.runId, 'learning-original', proposal.source.testDesignVersionId, 16, iso(now - 600000));
    await finish(proposal.source.runId, { outcome: 'PASSED', completedAt: iso(now - 300000) });
    await seed(fixture.initialRunId, evolutionVerificationKey(proposal.proposalId, targetId), targetId, 17, initialCreated);
    await finish(fixture.initialRunId, { completedAt: terminal });
    fixture.bundle = id => getRunBundle(env, scope.organizationId, scope.projectId, id);
    const getArtifact = async () => structuredClone(artifact);
    const project = async () => {
      const raw = reconcileReadinessFacts({ scenario, derivedVersion: true });
      return { contractVersion: 'qagent.test-readiness-reconciliation.v1', ...scope, testDesignId: artifact.testDesignId, testDesignVersionId: targetId, testDesignVersion: 17,
        computedAt: iso(Date.now()), complete: true, executionStarted: false, versionsModified: false, appliedByThisOperation: false, aiCalled: false,
        items: [{ scenarioId: scenario.scenarioId, readiness: scenario.automation.readiness, readinessV2: raw.readinessV2,
          effectiveReadiness: raw.effectiveLegacyReadiness, readinessReconciliation: { contractVersion: 'qagent.readiness-reconciliation.v1', scenarioId: scenario.scenarioId,
            testDesignVersionId: targetId, environmentId: scope.environmentId, sourceScenarioHash: await readinessScenarioHash(scenario), state: raw.state, complete: true,
            reasonCodes: [], resolvedIssueCodes: [], evidence: null, proposal: null, verification: null, examinedResultCount: 0, historyLimit: 5, snapshotPersisted: false } }] };
    };
    const materialize = args => materializeExecutionPlanV1({ ...args,
      resolveRuntime: async () => ({ environment: { environmentId: scope.environmentId, environmentType: 'STG', name: 'Synthetic' },
        apiServices: { svc_retry: { baseUrl: 'https://fixture.example', apiServiceId: 'svc_retry', name: 'Synthetic' } }, authProfiles: {} }),
      resolveTestDataBindings: async () => [], reconcileReadiness: project,
      loadSchemas: async () => { throw Error('UNEXPECTED_SCHEMA'); }, loadEndpoint: async () => { throw Error('UNEXPECTED_CATALOG'); } });
    fixture.runDeps = { getRunnerTestArtifact: getArtifact, materializeExecutionPlan: materialize };
    const createRerun = args => createEvolutionRerunV1({ ...args, deps: { getArtifact, createRun: a => createRunV1({ ...a, deps: fixture.runDeps }) } });
    fixture.deps = { getProposal: async () => proposal, getSourceResult: async () => structuredClone(results.get(proposal.source.runId)),
      getArtifact, getFailedResult: async ({ runId }) => structuredClone(results.get(runId)), createRerun, runDeps: fixture.runDeps };
    // For the real queue/BFF clients; no fetch reaches the network.
    env.TEST_REGISTRY_SERVICE = { async fetch() { return Response.json({ status: 'ok', data: { contractVersion: 'qagent.runner-test-artifact.v1', artifact } }); } };
    env.RESULTS_SERVICE = { async fetch(req) {
      const path = new URL(req.url).pathname;
      const data = path.endsWith('/latest-result-set') ? results.get(path.split('/').at(-2)) : [...results.values()].find(d => d.resultSet.resultSetId === path.split('/').at(-1));
      return data ? Response.json({ status: 'ok', data }) : Response.json({ status: 'error', code: 'RESULT_SET_NOT_FOUND' }, { status: 404 });
    } };
    fixture.args = { ...scope, env, userId: 'usr_retry', proposal, retryOfRunId: fixture.initialRunId, deps: fixture.deps };
    return fixture;
  } catch (e) { db.close(); throw e; }
}
