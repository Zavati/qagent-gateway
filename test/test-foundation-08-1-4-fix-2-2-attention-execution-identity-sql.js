import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listLearningAttentionV1 } from '../src/services/learningCycleService.js';

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
sqlite.exec(`
  CREATE TABLE suite_runs(suite_run_id TEXT PRIMARY KEY);
  INSERT INTO suite_runs VALUES('srun_identity_12345678');
  CREATE TABLE execution_plans (
    execution_plan_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    runtime_snapshot_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    test_design_version_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    plan_hash TEXT NOT NULL,
    scenario_count INTEGER NOT NULL,
    schema_snapshot_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);
for(const migration of [
  '0019_foundation_08_1_4_continuous_learning_cycle.sql',
  '0020_foundation_08_1_4_fix_1_durable_learning_workspace.sql',
  '0021_foundation_08_1_4_fix_2_attention_resolution_pending_verification.sql',
]) sqlite.exec(fs.readFileSync(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));

sqlite.exec(`
  INSERT INTO continuous_learning_cycles(
    learning_cycle_id,organization_id,project_id,suite_run_id,suite_version_id,suite_version,
    environment_id,contract_version,status,started_at,created_at,updated_at
  ) VALUES(
    'lcycle_identity','org','prj','srun_identity_12345678','suitev_18',18,
    'env_a','qagent.continuous-learning-cycle.v1','WAITING_REVIEW',
    '2026-09-09T05:00:00Z','2026-09-09T05:00:00Z','2026-09-09T05:00:00Z'
  );
`);

function insertAttention({id,runId,scenarioId,endpointId,method=null,path=null,updatedAt}){
  sqlite.prepare(`
    INSERT INTO continuous_learning_scenarios(
      learning_scenario_id,learning_cycle_id,organization_id,project_id,
      source_result_set_id,source_run_id,scenario_id,endpoint_id,
      source_test_design_version_id,source_test_design_version,
      request_method,request_path,source_outcome,http_outcome,status_code,
      assertion_failed_count,inspection_state,request_issue_detected,effective_state,
      attention_status,first_seen_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,'lcycle_identity','org','prj',`rset_${id}`,runId,scenarioId,endpointId,
    `tdv_${id}`,4,method,path,'FAILED','RESPONSE',422,0,'ANALYZED',1,'REVIEW_REQUIRED',
    'OPEN',updatedAt,updatedAt,
  );
}
function insertPlan({id,runId,scenarioId,method,path}){
  const plan={contractVersion:'qagent.execution-plan.v1',scenarios:[{scenarioId,spec:{target:{method,path}}}]};
  sqlite.prepare(`
    INSERT INTO execution_plans(
      execution_plan_id,run_id,runtime_snapshot_id,organization_id,project_id,
      test_design_version_id,environment_id,contract_version,plan_json,plan_hash,
      scenario_count,schema_snapshot_count,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `eplan_${id}`,runId,`rts_${id}`,'org','prj',`tdv_${id}`,'env_a',
    'qagent.execution-plan.v1',JSON.stringify(plan),`hash_${id}`,1,0,'2026-09-09T05:00:00Z',
  );
}

insertAttention({id:'post',runId:'run_post',scenarioId:'test_post',endpointId:'cep_post',updatedAt:'2026-09-09T05:03:00Z'});
insertPlan({id:'post',runId:'run_post',scenarioId:'test_post',method:'POST',path:'/web/index.php/api/v2/leave/leave-requests'});
insertAttention({id:'patch',runId:'run_patch',scenarioId:'test_patch',endpointId:'cep_patch',updatedAt:'2026-09-09T05:02:00Z'});
insertPlan({id:'patch',runId:'run_patch',scenarioId:'test_patch',method:'PATCH',path:'/web/index.php/api/v2/employees/{id}'});
insertAttention({id:'delete',runId:'run_delete',scenarioId:'test_delete',endpointId:'cep_delete',updatedAt:'2026-09-09T05:01:00Z'});
insertPlan({id:'delete',runId:'run_delete',scenarioId:'test_delete',method:'DELETE',path:'/web/index.php/api/v2/employees/{id}'});

// Already persisted identity must stay untouched even if a historical Execution Plan differs.
insertAttention({id:'existing',runId:'run_existing',scenarioId:'test_existing',endpointId:'cep_existing',method:'POST',path:'/canonical/already-persisted',updatedAt:'2026-09-09T05:04:00Z'});
insertPlan({id:'existing',runId:'run_existing',scenarioId:'test_existing',method:'GET',path:'/must-not-overwrite'});

const env={QAGENT_DB:new D1DatabaseShim(sqlite)};
const response=await listLearningAttentionV1({env,organizationId:'org',projectId:'prj',status:'OPEN',limit:120});
assert.equal(response.summary.openCount,4);
assert.equal(response.items.length,4);
const byScenario=new Map(response.items.map((item)=>[item.scenarioId,item]));
assert.equal(byScenario.get('test_post').method,'POST');
assert.equal(byScenario.get('test_post').path,'/web/index.php/api/v2/leave/leave-requests');
assert.equal(byScenario.get('test_patch').method,'PATCH');
assert.equal(byScenario.get('test_patch').path,'/web/index.php/api/v2/employees/{id}');
assert.equal(byScenario.get('test_delete').method,'DELETE');
assert.equal(byScenario.get('test_delete').path,'/web/index.php/api/v2/employees/{id}');
assert.equal(byScenario.get('test_existing').method,'POST');
assert.equal(byScenario.get('test_existing').path,'/canonical/already-persisted');

console.log('08.1.4 FIX-2.2 Attention execution identity recovery SQLite: PASS');
