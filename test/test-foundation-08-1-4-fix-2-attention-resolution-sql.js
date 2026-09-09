import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureLearningCycle,
  markLearningScenarioProposalPendingVerification,
  upsertLearningScenario,
  updateLearningScenarioHumanOutcomeByRerun,
  updateLearningScenarioHumanRepair,
  updateLearningScenarioInspection,
  updateLearningScenarioProposal,
} from '../src/repositories/learningCycleRepository.js';
import { listLearningAttentionV1 } from '../src/services/learningCycleService.js';

class D1PreparedShim {constructor(db,sql,params=[]){this.db=db;this.sql=sql;this.params=params;}bind(...params){return new D1PreparedShim(this.db,this.sql,params);}async run(){const r=this.db.prepare(this.sql).run(...this.params);return{meta:{changes:Number(r.changes??0)}};}async first(){return this.db.prepare(this.sql).get(...this.params)??null;}async all(){return{results:this.db.prepare(this.sql).all(...this.params)};}}
class D1DatabaseShim {constructor(db){this.db=db;}prepare(sql){return new D1PreparedShim(this.db,sql);}}
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON;');
sqlite.exec(`CREATE TABLE suite_runs(suite_run_id TEXT PRIMARY KEY);INSERT INTO suite_runs VALUES('srun_fix2_12345678');`);
for(const migration of ['0019_foundation_08_1_4_continuous_learning_cycle.sql','0020_foundation_08_1_4_fix_1_durable_learning_workspace.sql'])sqlite.exec(fs.readFileSync(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));
// Historical FIX-3 behavior: human repair saved without rerun remained REVIEW_REQUIRED.
sqlite.exec(`INSERT INTO continuous_learning_cycles(learning_cycle_id,organization_id,project_id,suite_run_id,suite_version_id,suite_version,environment_id,contract_version,status,started_at,created_at,updated_at) VALUES('lcycle_legacy','org','prj','srun_fix2_12345678','suitev_16',16,'env_a','qagent.continuous-learning-cycle.v1','WAITING_REVIEW','2026-09-08T00:00:00Z','2026-09-08T00:00:00Z','2026-09-08T00:00:00Z');
INSERT INTO continuous_learning_scenarios(learning_scenario_id,learning_cycle_id,organization_id,project_id,source_result_set_id,source_run_id,scenario_id,endpoint_id,source_test_design_version_id,source_test_design_version,source_outcome,http_outcome,status_code,assertion_failed_count,inspection_state,request_issue_detected,human_repair_id,human_repair_test_design_version_id,human_repair_test_design_version,effective_state,first_seen_at,updated_at) VALUES('lcs_legacy','lcycle_legacy','org','prj','rset_legacy','run_legacy','legacy_repair','cep_legacy','tdv_old',4,'FAILED','RESPONSE',422,1,'ANALYZED',1,'hrr_legacy','tdv_fixed',5,'REVIEW_REQUIRED','2026-09-08T00:01:00Z','2026-09-08T00:02:00Z');`);
sqlite.exec(fs.readFileSync(new URL('../migrations/0021_foundation_08_1_4_fix_2_attention_resolution_pending_verification.sql',import.meta.url),'utf8'));
const env={QAGENT_DB:new D1DatabaseShim(sqlite)};
let legacyPending=await listLearningAttentionV1({env,organizationId:'org',projectId:'prj',status:'PENDING_VERIFICATION'});assert.equal(legacyPending.items.some(x=>x.scenarioId==='legacy_repair'),true);
// Use a second Suite Run for current FIX-2 transition tests.
sqlite.exec(`INSERT INTO suite_runs VALUES('srun_fix2_new_12345678');`);
await ensureLearningCycle(env,{learningCycleId:'lcycle_fix2',organizationId:'org',projectId:'prj',suiteRunId:'srun_fix2_new_12345678',suiteVersionId:'suitev_17',suiteVersion:17,environmentId:'env_a',now:'2026-09-09T00:00:00Z'});

async function add({id,resultSet,scenario,endpoint='cep_1',run='run_1',version='tdv_1'}){
  await upsertLearningScenario(env,{learningScenarioId:id,learningCycleId:'lcycle_fix2',organizationId:'org',projectId:'prj',resultSetId:resultSet,runId:run,scenarioId:scenario,endpointId:endpoint,requestMethod:'GET',requestPath:'/v1/a',testDesignVersionId:version,testDesignVersion:1,outcome:'FAILED',httpOutcome:'RESPONSE',statusCode:422,assertionFailedCount:1,now:'2026-09-09T00:01:00Z'});
  await updateLearningScenarioInspection(env,{learningCycleId:'lcycle_fix2',resultSetId:resultSet,scenarioId:scenario,eligible:false,reason:'REQUEST_REJECTION_REQUEST_DATA_REVIEW_REQUIRED',requestIssueDetected:true,effectiveState:'REVIEW_REQUIRED'});
}

await add({id:'lcs_repair',resultSet:'rset_repair',scenario:'test_repair'});
let open=await listLearningAttentionV1({env,organizationId:'org',projectId:'prj'});
assert.equal(open.summary.openCount,1);assert.equal(open.items.length,1);assert.equal(open.items[0].attentionStatus,'OPEN');

await updateLearningScenarioHumanRepair(env,{learningCycleId:'lcycle_fix2',resultSetId:'rset_repair',scenarioId:'test_repair',repairId:'hrr_1',testDesignVersionId:'tdv_2',testDesignVersion:2,humanRerunRunId:null,effectiveState:'PENDING_VERIFICATION'});
open=await listLearningAttentionV1({env,organizationId:'org',projectId:'prj'});
assert.equal(open.summary.openCount,0);assert.equal(open.summary.pendingVerificationCount,2);assert.equal(open.items.length,0);
let pending=await listLearningAttentionV1({env,organizationId:'org',projectId:'prj',status:'PENDING_VERIFICATION'});
const repaired=pending.items.find(x=>x.scenarioId==='test_repair');assert.ok(repaired);assert.equal(repaired.attentionStatus,'PENDING_VERIFICATION');assert.equal(repaired.resolution.kind,'HUMAN_REQUEST_REPAIR');assert.equal(repaired.resolution.testDesignVersion,2);

await add({id:'lcs_rerun',resultSet:'rset_rerun',scenario:'test_rerun',endpoint:'cep_2',run:'run_2'});
await updateLearningScenarioHumanRepair(env,{learningCycleId:'lcycle_fix2',resultSetId:'rset_rerun',scenarioId:'test_rerun',repairId:'hrr_2',testDesignVersionId:'tdv_3',testDesignVersion:3,humanRerunRunId:'run_verify_1',effectiveState:'HUMAN_VERIFYING'});
await updateLearningScenarioHumanOutcomeByRerun(env,{humanRerunRunId:'run_verify_1',effectiveState:'HUMAN_REPAIR_NOT_RECOVERED',verificationOutcome:'NOT_RECOVERED',reasonCode:'HUMAN_REPAIR_RERUN_FAILED_ASSERTIONS'});
open=await listLearningAttentionV1({env,organizationId:'org',projectId:'prj'});
assert.equal(open.summary.openCount,1);assert.equal(open.items[0].scenarioId,'test_rerun');assert.equal(open.items[0].actionType,'VERIFICATION_REVIEW');

await add({id:'lcs_proposal',resultSet:'rset_prop',scenario:'test_prop',endpoint:'cep_3',run:'run_3'});
await updateLearningScenarioProposal(env,{learningCycleId:'lcycle_fix2',resultSetId:'rset_prop',scenarioId:'test_prop',proposalId:'tep_1',classification:'EXPECTATION_DRIFT',decision:'REVIEW_REQUIRED',confidence:90,riskScore:20,riskLevel:'LOW',autoAction:'NONE',evolvedTestDesignVersionId:null,evolvedTestDesignVersion:null,evolutionRerunRunId:null,effectiveState:'REVIEW_REQUIRED'});
await markLearningScenarioProposalPendingVerification(env,{proposalId:'tep_1',testDesignVersionId:'tdv_4',testDesignVersion:4});
open=await listLearningAttentionV1({env,organizationId:'org',projectId:'prj'});
assert.equal(open.items.some(x=>x.scenarioId==='test_prop'),false);
pending=await listLearningAttentionV1({env,organizationId:'org',projectId:'prj',status:'PENDING_VERIFICATION'});
const prop=pending.items.find(x=>x.scenarioId==='test_prop');assert.ok(prop);assert.equal(prop.actionType,'AWAITING_VERIFICATION');assert.equal(prop.resolution.kind,'MANUAL_EVOLUTION_APPROVAL');

console.log('08.1.4 FIX-2 Attention Resolution & Pending Verification SQLite: PASS');
