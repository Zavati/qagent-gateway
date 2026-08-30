import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { normalizeRunnerRejectedInput, RUNNER_REJECTION_PHASES } from '../src/lib/runContracts.js';
import { markRunExecutionDeadLettered, markRunExecutionRejected } from '../src/repositories/runExecutionClaimRepository.js';
import { prepareMutationJournal, recordMutationDispatching, getMutationJournal } from '../src/repositories/mutationExecutionJournalRepository.js';
import { reconcileMutationJournalsAfterDlq } from '../src/services/mutationExecutionJournalService.js';
import { reconcileSuiteRunChildTerminal, getSuiteRunProgress } from '../src/repositories/suiteRunRepository.js';
import { handleRunDlqQueue } from '../src/handlers/runDlqQueue.js';

class D1PreparedShim {
  constructor(db,sql,params=[]){this.db=db;this.sql=sql;this.params=params;}
  bind(...params){return new D1PreparedShim(this.db,this.sql,params);}
  async run(){const r=this.db.prepare(this.sql).run(...this.params);return{meta:{changes:Number(r.changes??0)}};}
  async first(){return this.db.prepare(this.sql).get(...this.params)??null;}
  async all(){return{results:this.db.prepare(this.sql).all(...this.params)};}
}
class D1DatabaseShim {
  constructor(db){this.db=db;} prepare(sql){return new D1PreparedShim(this.db,sql);}
  async batch(stmts){this.db.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}

// Rejection contract and schema must match every phase emitted by Runner.
for (const phase of RUNNER_REJECTION_PHASES) {
  const out=normalizeRunnerRejectedInput({contractVersion:'qagent.runner-rejected.v1',attemptId:'runatt_fix31_12345678',leaseToken:'L'.repeat(43),errorCode:'RUNNER_TEST_ERROR',phase});
  assert.equal(out.phase,phase);
}
const schema=JSON.parse(fs.readFileSync(new URL('../docs/contracts/qagent.runner-rejected.v1.schema.json',import.meta.url),'utf8'));
assert.deepEqual(schema.properties.phase.enum,[...RUNNER_REJECTION_PHASES]);

// Run Control Plane owns terminal recovery from the Runner DLQ.
const gatewayWrangler=fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
assert.match(gatewayWrangler,/\"queue\"\s*:\s*\"qagent-run-dlq\"/);
assert.match(gatewayWrangler,/\"queue\"\s*:\s*\"qagent-suite-run-orchestration\"/);

const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
for(const f of [
  '0002_foundation_07_organization_project_environment.sql',
  '0005_foundation_07_7_2_run_contract_execution_plan.sql',
  '0006_foundation_07_7_3_run_queue_dispatch.sql',
  '0007_foundation_07_7_4_claim_lease_retry.sql',
  '0008_foundation_07_7_5_runtime_integration.sql',
  '0009_foundation_07_7_6_http_executor.sql',
  '0010_foundation_07_7_6_fix_1_http_network_diagnostics.sql',
  '0011_foundation_07_7_7_assertion_engine.sql',
  '0012_foundation_07_7_8_auth_runtime.sql',
  '0013_foundation_07_7_8_c_test_data_runtime.sql',
  '0015_foundation_07_7_10_b_suite_run_orchestration.sql',
  '0016_foundation_07_7_10_b_fix_2_mutation_safety.sql',
  '0017_foundation_07_7_10_b_fix_3_controlled_mutation_http.sql',
]) sqlite.exec(fs.readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
const env={QAGENT_DB:new D1DatabaseShim(sqlite)};const now='2026-08-30T18:30:00.000Z';
sqlite.prepare(`INSERT INTO organizations(organization_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?)`).run('org_fix31','Org','active',now,now);
sqlite.prepare(`INSERT INTO projects(project_id,organization_id,name,slug,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run('prj_fix31','org_fix31','Project','project','active',now,now);
sqlite.prepare(`INSERT INTO environments(environment_id,organization_id,project_id,name,slug,environment_type,is_default,status,created_at,updated_at) VALUES(?,?,?,?,?,?,1,'active',?,?)`).run('env_fix31','org_fix31','prj_fix31','STG','stg','STG',now,now);

function insertRun(runId,{scenario='happy_path_001'}={}){
  const xplan=`xplan_${runId.slice(4)}`,rts=`rts_${runId.slice(4)}`;
  sqlite.prepare(`INSERT INTO runs(run_id,organization_id,project_id,contract_version,test_design_id,test_design_version_id,test_design_version,endpoint_id,environment_id,execution_plan_id,runtime_snapshot_id,status,scenario_count,scenario_ids_json,idempotency_key,request_fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'QUEUED',1,?,?,?, ?,?)`).run(runId,'org_fix31','prj_fix31','qagent.run.v1','td_fix31','tdv_fix31',1,'cep_fix31','env_fix31',xplan,rts,JSON.stringify([scenario]),`idem_${runId}`,`fp_${runId}`,now,now);
  sqlite.prepare(`INSERT INTO runtime_snapshots(runtime_snapshot_id,run_id,organization_id,project_id,environment_id,contract_version,resolution_source,resolution_confidence,requires_execution_confirmation,snapshot_json,snapshot_hash,created_at) VALUES(?,?,?,?,?,'qagent.runtime-snapshot.v1','EXPLICIT_CONFIG','CONFIRMED',0,'{}',?,?)`).run(rts,runId,'org_fix31','prj_fix31','env_fix31','a'.repeat(64),now);
  sqlite.prepare(`INSERT INTO execution_plans(execution_plan_id,run_id,runtime_snapshot_id,organization_id,project_id,test_design_version_id,environment_id,contract_version,plan_json,plan_hash,scenario_count,schema_snapshot_count,created_at) VALUES(?,?,?,?,?,?,?,'qagent.execution-plan.v1',?, ?,1,0,?)`).run(xplan,runId,rts,'org_fix31','prj_fix31','tdv_fix31','env_fix31',JSON.stringify({scenarios:[{scenarioId:scenario}]}),'b'.repeat(64),now);
  sqlite.prepare(`INSERT INTO run_queue_dispatches(run_id,organization_id,project_id,contract_version,execution_plan_id,runtime_snapshot_id,status,dispatch_attempt_count,published_at,created_at,updated_at) VALUES(?,?,?,'qagent.run-requested.v1',?,?,'PUBLISHED',1,?,?,?)`).run(runId,'org_fix31','prj_fix31',xplan,rts,now,now,now);
  const attempt=`runatt_${runId.slice(4)}`;
  sqlite.prepare(`INSERT INTO run_execution_attempts(attempt_id,run_id,organization_id,project_id,attempt_number,status,lease_owner_id,lease_token_hash,lease_acquired_at,lease_expires_at,heartbeat_count,created_at,updated_at) VALUES(?,?,?,?,1,'CLAIMED','rlo_fix31',?,?,?,0,?,?)`).run(attempt,runId,'org_fix31','prj_fix31','c'.repeat(64),now,'2026-08-30T19:30:00.000Z',now,now);
  sqlite.prepare(`INSERT INTO run_execution_claims(run_id,organization_id,project_id,state,current_attempt_id,current_attempt_number,lease_owner_id,lease_token_hash,lease_expires_at,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,1,'rlo_fix31',?,?,?,?)`).run(runId,'org_fix31','prj_fix31',attempt,'c'.repeat(64),'2026-08-30T19:30:00.000Z',now,now);
  return {runId,xplan,rts,attempt};
}

// A normal permanent Runner rejection must terminalize a RUNNING Run; it must not require DLQ fallback.
{
  const normal=insertRun('run_fix31_rej123456');
  sqlite.prepare(`UPDATE runs SET status='RUNNING' WHERE run_id=?`).run(normal.runId);
  const out=await markRunExecutionRejected(env,{organizationId:'org_fix31',projectId:'prj_fix31',runId:normal.runId,attemptId:normal.attempt,leaseTokenHash:'c'.repeat(64),errorCode:'RUNNER_TEST_DATA_CONTRACT_INVALID',rejectedAt:'2026-08-30T18:30:30.000Z'});
  assert.equal(out.updated,true);
  assert.equal(sqlite.prepare(`SELECT status FROM runs WHERE run_id=?`).get(normal.runId).status,'ERROR');
  assert.equal(sqlite.prepare(`SELECT state FROM run_execution_claims WHERE run_id=?`).get(normal.runId).state,'IDLE');
  assert.equal(sqlite.prepare(`SELECT status FROM run_execution_attempts WHERE run_id=?`).get(normal.runId).status,'REJECTED');
}

// DLQ terminalization releases lease and makes run ERROR.
const a=insertRun('run_fix31_a1234567');
await markRunExecutionDeadLettered(env,{organizationId:'org_fix31',projectId:'prj_fix31',runId:a.runId,errorCode:'RUNNER_QUEUE_DLQ_EXHAUSTED',terminalAt:'2026-08-30T18:31:00.000Z'});
assert.equal(sqlite.prepare(`SELECT status FROM runs WHERE run_id=?`).get(a.runId).status,'ERROR');
assert.equal(sqlite.prepare(`SELECT state FROM run_execution_claims WHERE run_id=?`).get(a.runId).state,'IDLE');
assert.equal(sqlite.prepare(`SELECT status FROM run_execution_attempts WHERE run_id=?`).get(a.runId).status,'REJECTED');
assert.equal(sqlite.prepare(`SELECT last_error_code FROM run_queue_dispatches WHERE run_id=?`).get(a.runId).last_error_code,'RUNNER_QUEUE_DLQ_EXHAUSTED');

// DLQ before network dispatch is provably FAILED_BEFORE_DISPATCH.
const b=insertRun('run_fix31_b1234567');
await prepareMutationJournal(env,{mutationExecutionId:'mex_fix31_b',organizationId:'org_fix31',projectId:'prj_fix31',environmentId:'env_fix31',endpointId:'cep_fix31',runId:b.runId,scenarioId:'happy_path_001',attemptId:b.attempt,testDesignVersionId:'tdv_fix31',method:'POST',canonicalPath:'/orders',policyVersionId:null,retryMode:'NO_AUTOMATIC_RETRY',requestFingerprint:'d'.repeat(64),state:'PREPARED'});
let rec=await reconcileMutationJournalsAfterDlq({env,runId:b.runId,attemptId:b.attempt});assert.equal(rec.failedBeforeDispatch,1);
assert.equal((await getMutationJournal(env,b.runId,'happy_path_001')).state,'FAILED_BEFORE_DISPATCH');

// DLQ after DISPATCHING must surface uncertainty and never pretend the request was not sent.
const c=insertRun('run_fix31_c1234567');
await prepareMutationJournal(env,{mutationExecutionId:'mex_fix31_c',organizationId:'org_fix31',projectId:'prj_fix31',environmentId:'env_fix31',endpointId:'cep_fix31',runId:c.runId,scenarioId:'happy_path_001',attemptId:c.attempt,testDesignVersionId:'tdv_fix31',method:'POST',canonicalPath:'/orders',policyVersionId:null,retryMode:'NO_AUTOMATIC_RETRY',requestFingerprint:'e'.repeat(64),state:'PREPARED'});
await recordMutationDispatching(env,{runId:c.runId,scenarioId:'happy_path_001',mutationExecutionId:'mex_fix31_c',attemptId:c.attempt,dispatchFingerprint:'f'.repeat(64)});
rec=await reconcileMutationJournalsAfterDlq({env,runId:c.runId,attemptId:c.attempt});assert.equal(rec.unknownSideEffect,1);
assert.equal((await getMutationJournal(env,c.runId,'happy_path_001')).state,'UNKNOWN_SIDE_EFFECT');

// Suite child must converge to ERROR when its run becomes terminal ERROR.
const d=insertRun('run_fix31_d1234567');
sqlite.prepare(`INSERT INTO suite_runs(suite_run_id,organization_id,project_id,contract_version,suite_id,suite_version_id,suite_version,suite_inventory_fingerprint,environment_id,status,endpoint_count,scenario_count,confirm_discovered_runtime,idempotency_key,request_fingerprint,created_at,updated_at) VALUES('srun_fix31','org_fix31','prj_fix31','qagent.suite-run.v1','suite_fix31','suitev_fix31',1,'inv','env_fix31','RUNNING',1,1,0,'suite-idem','suite-fp',?,?)`).run(now,now);
sqlite.prepare(`INSERT INTO suite_run_dispatches(suite_run_id,organization_id,project_id,contract_version,status,cursor,dispatch_attempt_count,completed_at,created_at,updated_at) VALUES('srun_fix31','org_fix31','prj_fix31','qagent.suite-run-requested.v1','COMPLETED',1,1,?,?,?)`).run(now,now,now);
sqlite.prepare(`INSERT INTO suite_run_children(suite_run_child_id,suite_run_id,organization_id,project_id,ordinal,endpoint_id,test_design_version_id,test_design_version,scenario_count,run_id,status,created_at,updated_at) VALUES('srchild_fix31','srun_fix31','org_fix31','prj_fix31',0,'cep_fix31','tdv_fix31',1,1,?,'RUN_CREATED',?,?)`).run(d.runId,now,now);
await markRunExecutionDeadLettered(env,{organizationId:'org_fix31',projectId:'prj_fix31',runId:d.runId,errorCode:'RUNNER_QUEUE_DLQ_EXHAUSTED',terminalAt:'2026-08-30T18:32:00.000Z'});
const suite=await reconcileSuiteRunChildTerminal(env,d.runId,'RUNNER_QUEUE_DLQ_EXHAUSTED');assert.equal(suite.suiteRun.status,'ERROR');assert.equal(suite.counts.error,1);
assert.equal(sqlite.prepare(`SELECT last_error_code FROM suite_run_children WHERE run_id=?`).get(d.runId).last_error_code,'RUNNER_QUEUE_DLQ_EXHAUSTED');

// Queue fallback acks only after durable terminal callback dependencies succeed.
{
  const msg={body:{contractVersion:'qagent.run-requested.v1',runId:'run_mock_12345678',executionPlanId:'xplan_mock_12345678',runtimeSnapshotId:'rts_mock_12345678'},attempts:1,acks:0,retries:0,ack(){this.acks++},retry(){this.retries++}};
  const events=[];
  const result=await handleRunDlqQueue({queue:'qagent-run-dlq',messages:[msg]}, {}, {
    getBundle:async()=>({run:{runId:'run_mock_12345678',organizationId:'org',projectId:'prj',status:'QUEUED',executionPlanId:'xplan_mock_12345678',runtimeSnapshotId:'rts_mock_12345678'},latestAttempt:{attemptId:'runatt_mock'}}),
    reconcileMutation:async()=>{events.push('mutation');return{failedBeforeDispatch:1,unknownSideEffect:0}},
    markDeadLettered:async()=>events.push('terminal'),reconcileSuite:async()=>{events.push('suite');return{suiteRun:{suiteRunId:'srun_mock',status:'ERROR'}}},
  });
  assert.deepEqual(events,['mutation','terminal','suite']);assert.equal(msg.acks,1);assert.equal(msg.retries,0);assert.equal(result[0].suiteRunStatus,'ERROR');
}

console.log('Foundation 07.7.10-B FIX-3.1 Gateway Terminal Recovery: PASS ✅');
