import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { normalizeMutationPolicyInput } from '../src/lib/mutationContracts.js';
import { putEnvironmentMutationPolicy, resolveMutationPoliciesBatch } from '../src/services/mutationExecutionPolicyService.js';
import { prepareMutationJournal, transitionMutationJournal, getMutationJournal } from '../src/repositories/mutationExecutionJournalRepository.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { processSuiteRunOrchestrationMessage } from '../src/services/suiteRunService.js';
import { upsertSuiteRunExecutionUnits } from '../src/repositories/suiteRunRepository.js';

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
const now='2026-08-29T20:00:00.000Z';
sqlite.prepare(`INSERT INTO organizations(organization_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?)`).run('org_fix2','Org','active',now,now);
sqlite.prepare(`INSERT INTO projects(project_id,organization_id,name,slug,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run('prj_fix2','org_fix2','Project','project','active',now,now);
sqlite.prepare(`INSERT INTO environments(environment_id,organization_id,project_id,name,slug,environment_type,is_default,status,created_at,updated_at) VALUES(?,?,?,?,?,?,1,'active',?,?)`).run('env_stg','org_fix2','prj_fix2','STG','stg','STG',now,now);
sqlite.prepare(`INSERT INTO environments(environment_id,organization_id,project_id,name,slug,environment_type,is_default,status,created_at,updated_at) VALUES(?,?,?,?,?,?,0,'active',?,?)`).run('env_prod','org_fix2','prj_fix2','PROD','prod','PROD',now,now);
const env={QAGENT_DB:new D1DatabaseShim(sqlite)};

// Migration + data-minimization contract.
for(const t of ['mutation_execution_policies','mutation_execution_policy_versions','mutation_execution_journal','mutation_execution_events','suite_run_execution_units']) assert.equal(Number(sqlite.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?`).get(t).n),1);
const migration=fs.readFileSync(new URL('../migrations/0016_foundation_07_7_10_b_fix_2_mutation_safety.sql',import.meta.url),'utf8');
assert.doesNotMatch(migration,/authorization|cookie|password|client_secret|request_body|response_body/i);

// Missing policy always fail-closes.
{
 const r=await resolveMutationPoliciesBatch({env,organizationId:'org_fix2',projectId:'prj_fix2',environmentId:'env_stg',targets:[{endpointId:'cep_post',method:'POST'}]});
 assert.equal(r.decisions[0].executionDecision,'DENY');assert.equal(r.decisions[0].reason,'MISSING_EXPLICIT_POLICY');
}

// Explicit STG policy is immutable-versioned and can ALLOW.
{
 const input=normalizeMutationPolicyInput({contractVersion:'qagent.mutation-policy.v1',executionDecision:'ALLOW',retryMode:'NO_AUTOMATIC_RETRY',reason:'STG controlled test'});
 const p1=await putEnvironmentMutationPolicy({env,organizationId:'org_fix2',projectId:'prj_fix2',environmentId:'env_stg',endpointId:'cep_post',method:'POST',input,userId:'usr_admin'});
 assert.equal(p1.version,1);assert.equal(p1.executionDecision,'ALLOW');
 const input2=normalizeMutationPolicyInput({contractVersion:'qagent.mutation-policy.v1',executionDecision:'DENY',retryMode:'NO_AUTOMATIC_RETRY',reason:'hold'});
 const p2=await putEnvironmentMutationPolicy({env,organizationId:'org_fix2',projectId:'prj_fix2',environmentId:'env_stg',endpointId:'cep_post',method:'POST',input:input2,userId:'usr_admin'});
 assert.equal(p2.version,2);assert.notEqual(p1.policyVersionId,p2.policyVersionId);
 assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM mutation_execution_policy_versions WHERE policy_id=?').get(p2.policyId).n),2);
}

// PROD policy requires explicit policy-level confirmation before becoming ALLOW.
{
 const base={contractVersion:'qagent.mutation-policy.v1',executionDecision:'ALLOW',retryMode:'NO_AUTOMATIC_RETRY'};
 await putEnvironmentMutationPolicy({env,organizationId:'org_fix2',projectId:'prj_fix2',environmentId:'env_prod',endpointId:'cep_put',method:'PUT',input:normalizeMutationPolicyInput(base),userId:'usr_admin'});
 let r=await resolveMutationPoliciesBatch({env,organizationId:'org_fix2',projectId:'prj_fix2',environmentId:'env_prod',targets:[{endpointId:'cep_put',method:'PUT'}]});
 assert.equal(r.decisions[0].executionDecision,'DENY');assert.equal(r.decisions[0].reason,'PRODUCTION_POLICY_CONFIRMATION_REQUIRED');
 await putEnvironmentMutationPolicy({env,organizationId:'org_fix2',projectId:'prj_fix2',environmentId:'env_prod',endpointId:'cep_put',method:'PUT',input:normalizeMutationPolicyInput({...base,productionConfirmation:true}),userId:'usr_admin'});
 r=await resolveMutationPoliciesBatch({env,organizationId:'org_fix2',projectId:'prj_fix2',environmentId:'env_prod',targets:[{endpointId:'cep_put',method:'PUT'}]});
 assert.equal(r.decisions[0].executionDecision,'ALLOW');
}

// Journal is idempotent for same request, conflicts on divergent fingerprint, and UNKNOWN_SIDE_EFFECT is terminal.
{
 const base={organizationId:'org_fix2',projectId:'prj_fix2',environmentId:'env_stg',endpointId:'cep_post',runId:'run_journal',scenarioId:'test_001',attemptId:'runatt_1',testDesignVersionId:'tdv_1',method:'POST',canonicalPath:'/orders',policyVersionId:null,retryMode:'NO_AUTOMATIC_RETRY',idempotencyHeaderName:null,idempotencyKeyHash:null,requestFingerprint:'a'.repeat(64),state:'PREPARED'};
 const a=await prepareMutationJournal(env,base);assert.equal(a.created,true);assert.equal(a.journal.state,'PREPARED');
 const replay=await prepareMutationJournal(env,base);assert.equal(replay.created,false);assert.equal(replay.journal.mutationExecutionId,a.journal.mutationExecutionId);
 await assert.rejects(()=>prepareMutationJournal(env,{...base,requestFingerprint:'b'.repeat(64)}),(e)=>e.code==='MUTATION_JOURNAL_CONFLICT');
 await transitionMutationJournal(env,{runId:base.runId,scenarioId:base.scenarioId,attemptId:'runatt_1',toState:'DISPATCHING',eventCode:'DISPATCHING',networkDispatchMayHaveOccurred:true});
 await transitionMutationJournal(env,{runId:base.runId,scenarioId:base.scenarioId,attemptId:'runatt_1',toState:'UNKNOWN_SIDE_EFFECT',eventCode:'NETWORK_OUTCOME_UNKNOWN',networkDispatchMayHaveOccurred:true,lastErrorCode:'NETWORK_LOST'});
 const unknown=await getMutationJournal(env,base.runId,base.scenarioId);assert.equal(unknown.state,'UNKNOWN_SIDE_EFFECT');assert.equal(unknown.networkDispatchMayHaveOccurred,true);
 await assert.rejects(()=>transitionMutationJournal(env,{runId:base.runId,scenarioId:base.scenarioId,attemptId:'runatt_1',toState:'COMPLETED'}),(e)=>e.code==='MUTATION_UNKNOWN_SIDE_EFFECT_TERMINAL');
 assert.ok(Number(sqlite.prepare('SELECT COUNT(*) n FROM mutation_execution_events WHERE mutation_execution_id=?').get(unknown.mutationExecutionId).n)>=3);
}


// Policy-held units are not counted as executable child units, otherwise a Suite Run would wait forever for children that must never exist.
{
 sqlite.prepare(`INSERT INTO suite_runs(suite_run_id,organization_id,project_id,contract_version,suite_id,suite_version_id,suite_version,suite_inventory_fingerprint,environment_id,status,endpoint_count,scenario_count,confirm_discovered_runtime,idempotency_key,request_fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'DISPATCHING',?,?,?,?,?,?,?)`).run('srun_count','org_fix2','prj_fix2','qagent.suite-run.v1','suite_x','suitev_x',1,'d'.repeat(64),'env_stg',2,3,1,'idem_count','e'.repeat(64),now,now);
 const sr={suiteRunId:'srun_count',organizationId:'org_fix2',projectId:'prj_fix2'};
 await upsertSuiteRunExecutionUnits(env,{suiteRun:sr,policySnapshotHash:'f'.repeat(64),eligibilityPolicyVersion:'qagent.suite-run-eligibility.v2',units:[
   {executionUnitId:'sru_exec',sourceSuiteItemOrdinal:0,ordinal:0,endpointId:'cep_get',testDesignVersionId:'tdv_get',testDesignVersion:1,method:'GET',scenarioIds:['test_get'],executionKind:'READ_ONLY_BATCH',decision:'EXECUTE'},
   {executionUnitId:'sru_hold1',sourceSuiteItemOrdinal:1,ordinal:1001,endpointId:'cep_post',testDesignVersionId:'tdv_post',testDesignVersion:1,method:'POST',scenarioIds:['test_post1'],executionKind:'MUTATION_SINGLE',decision:'POLICY_HOLD',policyVersionId:null,retryMode:'NO_AUTOMATIC_RETRY'},
   {executionUnitId:'sru_hold2',sourceSuiteItemOrdinal:1,ordinal:1002,endpointId:'cep_post',testDesignVersionId:'tdv_post',testDesignVersion:1,method:'POST',scenarioIds:['test_post2'],executionKind:'MUTATION_SINGLE',decision:'POLICY_HOLD',policyVersionId:null,retryMode:'NO_AUTOMATIC_RETRY'},
 ]});
 const c=sqlite.prepare('SELECT execution_unit_count AS executionUnitCount,policy_held_scenario_count AS held,executable_scenario_count AS executable FROM suite_runs WHERE suite_run_id=?').get('srun_count');
 assert.equal(Number(c.executionUnitCount),1);assert.equal(Number(c.held),2);assert.equal(Number(c.executable),1);
}

// Router exposes Console governance and internal Runner preflight boundaries.
{
 const a=resolveGatewayRoute('GET','/v1/console/projects/prj_fix2/environments/env_stg/mutation-policies');assert.equal(a.name,'consoleMutationPoliciesList');
 const b=resolveGatewayRoute('PUT','/v1/console/projects/prj_fix2/environments/env_stg/mutation-policies/cep_post/POST');assert.equal(b.name,'consoleMutationPolicyPut');
 const c=resolveGatewayRoute('POST','/internal/v1/runner/runs/run_x/mutations/test_001/preflight');assert.equal(c.name,'internalRunnerMutationPreflightPost');
}

// Suite Run Eligibility v2: mutations are isolated one scenario per execution unit; missing policy produces no child.
{
 const children=[];const units=[];
 const suiteRun={suiteRunId:'srun_test',organizationId:'org_fix2',projectId:'prj_fix2',suiteVersionId:'suitev_test',suiteInventoryFingerprint:'f'.repeat(64),endpointCount:1,environmentId:'env_stg',createdByUserId:'usr',confirmDiscoveredRuntime:true,confirmProductionMutation:false,status:'QUEUED'};
 const result=await processSuiteRunOrchestrationMessage({env:{SUITE_ORCHESTRATOR_CHILD_BATCH_SIZE:'4'},message:{contractVersion:'qagent.suite-run-requested.v1',suiteRunId:'srun_test',organizationId:'org_fix2',projectId:'prj_fix2',expectedCursor:0},deps:{
   getSuiteRunById:async()=>suiteRun,getDispatch:async()=>({cursor:0,status:'PUBLISHED'}),markProcessing:async()=>{},
   getSuiteExecutionSlice:async()=>({suite:{inventoryFingerprint:'f'.repeat(64),endpointCount:1},items:[{ordinal:0,endpointId:'cep_mut',testDesignVersionId:'tdv_mut',testDesignVersion:1,method:'POST',scenarioIds:['test_001','test_002']}],nextOffset:1,hasMore:false}),
   resolvePolicies:async()=>({environment:{environmentType:'STG'},decisions:[{endpointId:'cep_mut',method:'POST',executionDecision:'DENY',policyVersionId:null,retryMode:'NO_AUTOMATIC_RETRY'}],policySnapshotHash:'c'.repeat(64)}),
   upsertUnits:async(_e,{units:u})=>{units.push(...u);},listUnits:async()=>[],advanceCursor:async()=>true,refresh:async()=>{},
 }});
 assert.equal(result.processed,true);assert.equal(units.length,2);assert.ok(units.every((u)=>u.executionKind==='MUTATION_SINGLE'&&u.scenarioIds.length===1&&u.decision==='POLICY_HOLD'));assert.equal(children.length,0);
}

// Automatic Suite execution with ALLOW policy must fan out mutation scenarios into one child Run each.
{
 const units=[];const childInputs=[];const createdChildren=[];
 const suiteRun={suiteRunId:'srun_allow',organizationId:'org_fix2',projectId:'prj_fix2',suiteVersionId:'suitev_allow',suiteInventoryFingerprint:'a'.repeat(64),endpointCount:1,environmentId:'env_stg',createdByUserId:'usr',confirmDiscoveredRuntime:true,confirmProductionMutation:false,status:'QUEUED'};
 const result=await processSuiteRunOrchestrationMessage({env:{SUITE_ORCHESTRATOR_CHILD_BATCH_SIZE:'4',SUITE_ORCHESTRATOR_CHILD_CONCURRENCY:'3'},message:{contractVersion:'qagent.suite-run-requested.v1',suiteRunId:'srun_allow',organizationId:'org_fix2',projectId:'prj_fix2',expectedCursor:0},deps:{
   getSuiteRunById:async()=>suiteRun,getDispatch:async()=>({cursor:0,status:'PUBLISHED'}),markProcessing:async()=>{},
   getSuiteExecutionSlice:async()=>({suite:{inventoryFingerprint:'a'.repeat(64),endpointCount:1},items:[{ordinal:0,endpointId:'cep_mut',testDesignVersionId:'tdv_mut',testDesignVersion:1,method:'POST',scenarioIds:['test_001','test_002','test_003']}],nextOffset:1,hasMore:false}),
   resolvePolicies:async()=>({environment:{environmentType:'STG'},decisions:[{endpointId:'cep_mut',method:'POST',executionDecision:'ALLOW',policyVersionId:'mpv_1',retryMode:'NO_AUTOMATIC_RETRY'}],policySnapshotHash:'b'.repeat(64)}),
   upsertUnits:async(_e,{units:u})=>{units.push(...u);},
   listUnits:async()=>units.map((u)=>({...u,scenarioCount:u.scenarioIds.length})),
   upsertChild:async(_e,payload)=>{createdChildren.push(payload);},
   createRun:async({input,idempotencyKey})=>{childInputs.push({input,idempotencyKey});return{run:{runId:`run_${input.scenarioIds[0]}`}};},
   markChildCreated:async()=>{},markUnitCreated:async()=>{},advanceCursor:async()=>true,refresh:async()=>{},
 }});
 assert.equal(result.processed,true);
 assert.equal(units.length,3);
 assert.ok(units.every((u)=>u.executionKind==='MUTATION_SINGLE'&&u.decision==='EXECUTE'&&u.scenarioIds.length===1));
 assert.equal(childInputs.length,3);
 assert.deepEqual(childInputs.flatMap((x)=>x.input.scenarioIds).sort(),['test_001','test_002','test_003']);
 assert.ok(childInputs.every((x)=>x.input.scenarioIds.length===1));
 assert.equal(createdChildren.length,3);
}

console.log('Foundation 07.7.10-B FIX-2 Gateway Mutation Safety: PASS ✅');
