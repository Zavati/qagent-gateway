import assert from 'node:assert/strict';
import { processSuiteRunOrchestrationMessage } from '../src/services/suiteRunService.js';

const created=[];
let units=[];
const suiteRun={
  suiteRunId:'srun_mutfanout123', organizationId:'org_x', projectId:'prj_x', status:'RUNNING',
  suiteVersionId:'suitev_mutfanout123', suiteInventoryFingerprint:'f'.repeat(64), endpointCount:1,
  environmentId:'env_x', confirmProductionMutation:true, confirmDiscoveredRuntime:false, createdByUserId:'usr_x',
};
const result=await processSuiteRunOrchestrationMessage({
  env:{SUITE_ORCHESTRATOR_CHILD_CONCURRENCY:'3'},
  message:{contractVersion:'qagent.suite-run-requested.v1',suiteRunId:suiteRun.suiteRunId,organizationId:'org_x',projectId:'prj_x',expectedCursor:0},
  deps:{
    getSuiteRunById:async()=>suiteRun,
    getDispatch:async()=>({cursor:0,status:'PUBLISHED'}),
    markProcessing:async()=>{},
    getSuiteExecutionSlice:async()=>({suite:{inventoryFingerprint:'f'.repeat(64),endpointCount:1},items:[{ordinal:0,endpointId:'cep_post',testDesignVersionId:'tdv_post12345678',testDesignVersion:1,method:'POST',scenarioIds:['test_a','test_b','test_c']}],nextOffset:1,hasMore:false}),
    resolvePolicies:async()=>({environment:{environmentId:'env_x',environmentType:'STG'},decisions:[{endpointId:'cep_post',method:'POST',executionDecision:'ALLOW',policyVersionId:'mpol_x',retryMode:'NO_AUTOMATIC_RETRY'}],policySnapshotHash:'a'.repeat(64)}),
    upsertUnits:async(_env,{units:next})=>{units=next;},
    listUnits:async()=>units.filter((u)=>u.decision==='EXECUTE').map((u)=>({...u,scenarioCount:u.scenarioIds.length})),
    upsertChild:async()=>{},
    createRun:async({input})=>{created.push(input);return {run:{runId:`run_${created.length}12345678`}};},
    markChildCreated:async()=>{}, markUnitCreated:async()=>{}, markChildError:async()=>{}, markUnitError:async()=>{},
    advanceCursor:async()=>true, refresh:async()=>{},
  },
});
assert.equal(result.processed,true);
assert.equal(units.length,3);
assert.ok(units.every((u)=>u.executionKind==='MUTATION_SINGLE'&&u.scenarioIds.length===1&&u.decision==='EXECUTE'));
assert.equal(created.length,3);
assert.deepEqual(created.map((x)=>x.scenarioIds),[['test_a'],['test_b'],['test_c']]);
console.log('07.7.8-D Suite mutation fan-out regression passed ✅');
