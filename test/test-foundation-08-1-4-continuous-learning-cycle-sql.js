import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  aggregateLearningCycle,
  ensureLearningCycle,
  getLearningCycleBySuiteRunId,
  listLearningCycleEvents,
  listLearningScenarios,
  setLearningCycleStatus,
  updateLearningScenarioInspection,
  updateLearningScenarioProposal,
  updateLearningScenarioVerificationByProposal,
  upsertLearningScenario,
  appendLearningCycleEvent,
} from '../src/repositories/learningCycleRepository.js';

class D1PreparedShim {
  constructor(db,sql,params=[]){this.db=db;this.sql=sql;this.params=params;}
  bind(...params){return new D1PreparedShim(this.db,this.sql,params);}
  async run(){const r=this.db.prepare(this.sql).run(...this.params);return{meta:{changes:Number(r.changes??0)}};}
  async first(){return this.db.prepare(this.sql).get(...this.params)??null;}
  async all(){return{results:this.db.prepare(this.sql).all(...this.params)};}
}
class D1DatabaseShim {constructor(db){this.db=db;}prepare(sql){return new D1PreparedShim(this.db,sql);}}

const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON;');
sqlite.exec(`CREATE TABLE suite_runs(suite_run_id TEXT PRIMARY KEY); INSERT INTO suite_runs(suite_run_id) VALUES('srun_sql_12345678');`);
sqlite.exec(fs.readFileSync(new URL('../migrations/0019_foundation_08_1_4_continuous_learning_cycle.sql',import.meta.url),'utf8'));
const env={QAGENT_DB:new D1DatabaseShim(sqlite)};
const cycle=await ensureLearningCycle(env,{learningCycleId:'lcycle_sql',organizationId:'org_sql',projectId:'prj_sql',suiteRunId:'srun_sql_12345678',suiteVersionId:'suitev_sql',suiteVersion:16,environmentId:'env_sql',now:'2026-09-08T23:00:00.000Z'});
assert.equal(cycle.status,'COLLECTING');
assert.equal((await getLearningCycleBySuiteRunId(env,'org_sql','prj_sql','srun_sql_12345678')).suiteVersion,16);

await upsertLearningScenario(env,{learningScenarioId:'lcs_sql',learningCycleId:'lcycle_sql',organizationId:'org_sql',projectId:'prj_sql',resultSetId:'rset_sql',runId:'run_sql',scenarioResultId:'sres_sql',scenarioId:'test_001',endpointId:'cep_sql',testDesignVersionId:'tdv_sql',testDesignVersion:7,outcome:'FAILED',httpOutcome:'RESPONSE',statusCode:422,assertionFailedCount:1});
await updateLearningScenarioInspection(env,{learningCycleId:'lcycle_sql',resultSetId:'rset_sql',scenarioId:'test_001',eligible:true,reason:null,requestIssueDetected:true,effectiveState:'ANALYZED_ELIGIBLE'});
await updateLearningScenarioProposal(env,{learningCycleId:'lcycle_sql',resultSetId:'rset_sql',scenarioId:'test_001',proposalId:'tep_sql',classification:'TEST_DATA_DRIFT',decision:'EVOLVE_TEST',confidence:95,riskScore:10,riskLevel:'LOW',autoAction:'AUTO_APPLIED',evolvedTestDesignVersionId:'tdv_sql_8',evolvedTestDesignVersion:8,evolutionRerunRunId:'run_rerun_sql',effectiveState:'VERIFYING'});
let agg=await aggregateLearningCycle(env,'lcycle_sql');
assert.equal(agg.scenario_count,1);assert.equal(agg.initial_failed,1);assert.equal(agg.analyzed_count,1);assert.equal(agg.auto_applied_count,1);assert.equal(agg.pending_verification_count,1);
await updateLearningScenarioVerificationByProposal(env,{proposalId:'tep_sql',outcome:'RECOVERED_BY_EVOLUTION',reasonCode:'EVOLVED_RERUN_PASSED',rerunRunId:'run_rerun_sql',effectiveState:'RECOVERED_BY_EVOLUTION'});
agg=await aggregateLearningCycle(env,'lcycle_sql');assert.equal(agg.recovered_evolution_count,1);assert.equal(agg.pending_verification_count,0);
const items=await listLearningScenarios(env,{organizationId:'org_sql',projectId:'prj_sql',learningCycleId:'lcycle_sql'});assert.equal(items[0].classification,'TEST_DATA_DRIFT');assert.equal(items[0].verificationOutcome,'RECOVERED_BY_EVOLUTION');
await appendLearningCycleEvent(env,{eventId:'lce_sql',learningCycleId:'lcycle_sql',learningScenarioId:'lcs_sql',organizationId:'org_sql',projectId:'prj_sql',eventType:'EVOLUTION_VERIFIED',eventKey:'VERIFY:tep_sql',metadata:{outcome:'RECOVERED_BY_EVOLUTION'}});
assert.equal((await listLearningCycleEvents(env,{organizationId:'org_sql',projectId:'prj_sql',learningCycleId:'lcycle_sql'}))[0].metadata.outcome,'RECOVERED_BY_EVOLUTION');
const completed=await setLearningCycleStatus(env,{organizationId:'org_sql',projectId:'prj_sql',learningCycleId:'lcycle_sql',status:'COMPLETED',settled:true,completed:true});assert.ok(completed.settledAt);assert.ok(completed.completedAt);
console.log('08.1.4 Continuous Learning Cycle SQLite persistence: PASS');
