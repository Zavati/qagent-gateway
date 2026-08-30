import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { normalizeMutationPolicyInput } from '../src/lib/mutationContracts.js';
import { putEnvironmentMutationPolicy } from '../src/services/mutationExecutionPolicyService.js';
import { preflightMutationExecution, markMutationDispatching, markMutationResponseReceived, markMutationCompleted } from '../src/services/mutationExecutionJournalService.js';
import { getMutationJournal } from '../src/repositories/mutationExecutionJournalRepository.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

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
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
for(const f of ['0002_foundation_07_organization_project_environment.sql','0015_foundation_07_7_10_b_suite_run_orchestration.sql','0016_foundation_07_7_10_b_fix_2_mutation_safety.sql','0017_foundation_07_7_10_b_fix_3_controlled_mutation_http.sql']) sqlite.exec(fs.readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
const now='2026-08-30T16:00:00.000Z';
sqlite.prepare(`INSERT INTO organizations(organization_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?)`).run('org_fix3','Org','active',now,now);
sqlite.prepare(`INSERT INTO projects(project_id,organization_id,name,slug,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run('prj_fix3','org_fix3','Project','project','active',now,now);
sqlite.prepare(`INSERT INTO environments(environment_id,organization_id,project_id,name,slug,environment_type,is_default,status,created_at,updated_at) VALUES(?,?,?,?,?,?,1,'active',?,?)`).run('env_stg','org_fix3','prj_fix3','STG','stg','STG',now,now);
const env={QAGENT_DB:new D1DatabaseShim(sqlite)};

// Migration is additive and stores no raw request/response/auth material.
{
 const columns=sqlite.prepare(`PRAGMA table_info(mutation_execution_journal)`).all().map((x)=>x.name);
 assert.ok(columns.includes('dispatch_fingerprint'));assert.ok(columns.includes('assertion_outcome'));
 const migration=fs.readFileSync(new URL('../migrations/0017_foundation_07_7_10_b_fix_3_controlled_mutation_http.sql',import.meta.url),'utf8');
 assert.doesNotMatch(migration,/authorization|cookie|password|client_secret|request_body|response_body/i);
}

await putEnvironmentMutationPolicy({env,organizationId:'org_fix3',projectId:'prj_fix3',environmentId:'env_stg',endpointId:'cep_post',method:'POST',input:normalizeMutationPolicyInput({contractVersion:'qagent.mutation-policy.v1',executionDecision:'ALLOW',retryMode:'NO_AUTOMATIC_RETRY'}),userId:'usr_admin'});
await putEnvironmentMutationPolicy({env,organizationId:'org_fix3',projectId:'prj_fix3',environmentId:'env_stg',endpointId:'cep_put',method:'PUT',input:normalizeMutationPolicyInput({contractVersion:'qagent.mutation-policy.v1',executionDecision:'ALLOW',retryMode:'IDEMPOTENCY_HEADER',idempotencyHeaderName:'Idempotency-Key'}),userId:'usr_admin'});

function bundle({runId,endpointId,method}){return {run:{runId,organizationId:'org_fix3',projectId:'prj_fix3',environmentId:'env_stg',endpointId,testDesignVersionId:'tdv_fix3'},latestAttempt:{attemptId:'runatt_fix3',runtimeReadinessStatus:'READY',runtimePlanHash:'a'.repeat(64)}};}
function input(method){return {attemptId:'runatt_fix3',runtimePlanHash:'a'.repeat(64),scenarioId:'test_001',method,canonicalPath:'/resource',requestFingerprint:'b'.repeat(64)};}

// NO_AUTOMATIC_RETRY: once DISPATCHING is durable, a redelivery must become UNKNOWN and never re-dispatch.
{
 const runId='run_no_retry';
 const pre=await preflightMutationExecution({env,bundle:bundle({runId,endpointId:'cep_post',method:'POST'}),input:input('POST')});
 assert.equal(pre.decision,'ALLOW');assert.equal(pre.journalState,'PREPARED');assert.equal(pre.retryMode,'NO_AUTOMATIC_RETRY');
 await markMutationDispatching({env,runId,scenarioId:'test_001',mutationExecutionId:pre.mutationExecutionId,attemptId:'runatt_fix3',dispatchFingerprint:'c'.repeat(64),idempotencyKeyHash:null});
 const replay=await preflightMutationExecution({env,bundle:bundle({runId,endpointId:'cep_post',method:'POST'}),input:input('POST')});
 assert.equal(replay.decision,'DENY');assert.equal(replay.reason,'MUTATION_SIDE_EFFECT_UNKNOWN');
 const journal=await getMutationJournal(env,runId,'test_001');assert.equal(journal.state,'UNKNOWN_SIDE_EFFECT');assert.equal(journal.networkDispatchMayHaveOccurred,true);
}

// Idempotency mode: DISPATCHING redelivery is allowed, but only with the exact same dispatch fingerprint/key hash.
{
 const runId='run_idem';
 const pre=await preflightMutationExecution({env,bundle:bundle({runId,endpointId:'cep_put',method:'PUT'}),input:input('PUT')});
 assert.equal(pre.decision,'ALLOW');assert.equal(pre.retryMode,'IDEMPOTENCY_HEADER');assert.match(pre.idempotencyKeyHash,/^[a-f0-9]{64}$/);
 await markMutationDispatching({env,runId,scenarioId:'test_001',mutationExecutionId:pre.mutationExecutionId,attemptId:'runatt_fix3',dispatchFingerprint:'d'.repeat(64),idempotencyKeyHash:pre.idempotencyKeyHash});
 const replay=await preflightMutationExecution({env,bundle:bundle({runId,endpointId:'cep_put',method:'PUT'}),input:input('PUT')});
 assert.equal(replay.decision,'ALLOW');assert.equal(replay.journalState,'DISPATCHING');assert.equal(replay.retry,true);
 await assert.rejects(()=>markMutationDispatching({env,runId,scenarioId:'test_001',mutationExecutionId:pre.mutationExecutionId,attemptId:'runatt_fix3',dispatchFingerprint:'e'.repeat(64),idempotencyKeyHash:pre.idempotencyKeyHash}),(e)=>e.code==='MUTATION_DISPATCH_FINGERPRINT_CONFLICT');
 await markMutationDispatching({env,runId,scenarioId:'test_001',mutationExecutionId:pre.mutationExecutionId,attemptId:'runatt_fix3',dispatchFingerprint:'d'.repeat(64),idempotencyKeyHash:pre.idempotencyKeyHash});
 await markMutationResponseReceived({env,runId,scenarioId:'test_001',mutationExecutionId:pre.mutationExecutionId,attemptId:'runatt_fix3',httpStatusCode:200});
 await markMutationCompleted({env,runId,scenarioId:'test_001',mutationExecutionId:pre.mutationExecutionId,attemptId:'runatt_fix3',assertionOutcome:'PASSED'});
 const journal=await getMutationJournal(env,runId,'test_001');assert.equal(journal.state,'COMPLETED');assert.equal(journal.httpStatusCode,200);assert.equal(journal.assertionOutcome,'PASSED');assert.equal(journal.dispatchFingerprint,'d'.repeat(64));
}

// Router exposes every internal state transition; these are never Console/browser routes.
for(const [suffix,name] of [
 ['dispatching','internalRunnerMutationDispatchingPost'],['response-received','internalRunnerMutationResponseReceivedPost'],['completed','internalRunnerMutationCompletedPost'],['unknown','internalRunnerMutationUnknownPost'],['failed-before-dispatch','internalRunnerMutationFailedBeforeDispatchPost'],
]){
 const r=resolveGatewayRoute('POST',`/internal/v1/runner/runs/run_x/mutations/test_001/${suffix}`);assert.equal(r?.name,name);
}

console.log('Foundation 07.7.10-B FIX-3 Gateway Controlled Mutation HTTP: PASS ✅');
