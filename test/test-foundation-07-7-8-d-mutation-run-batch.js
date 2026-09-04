import assert from 'node:assert/strict';
import { normalizeRunBatchCreateInput } from '../src/lib/runBatchContracts.js';
import { createRunBatchV1, resolveDirectMutationConcurrency } from '../src/services/runBatchService.js';

const baseScenario = (id, method='POST') => ({
  scenarioId:id,
  automation:{readiness:'READY'},
  spec:{target:{method}},
});
const artifact = { specification:{ scenarios:[baseScenario('test_a'),baseScenario('test_b'),baseScenario('test_c')] } };
const input = normalizeRunBatchCreateInput({contractVersion:'qagent.run-batch-create.v1',testDesignVersionId:'tdv_12345678',environmentId:'env_12345678',scenarioIds:['test_a','test_b','test_c']});
assert.equal(resolveDirectMutationConcurrency({}),3);
const calls=[];
const result=await createRunBatchV1({env:{DIRECT_MUTATION_RUN_CONCURRENCY:'2'},organizationId:'org_x',projectId:'prj_x',userId:'usr_x',input,idempotencyKey:'console-batch:12345678',deps:{
  getRunnerTestArtifact:async()=>artifact,
  createRun:async({input,idempotencyKey})=>{calls.push({input,idempotencyKey});return {run:{runId:`run_${calls.length}12345678`,scenarioIds:input.scenarioIds,scenarioCount:input.scenarioIds.length,status:'CREATED'},idempotentReplay:false};},
}});
assert.equal(result.contractVersion,'qagent.run-batch.v1');
assert.equal(result.executionKind,'MUTATION_FANOUT');
assert.equal(result.runCount,3);
assert.equal(result.concurrency,2);
assert.equal(calls.length,3);
assert.deepEqual(result.runs.map((x)=>x.run.scenarioIds),[['test_a'],['test_b'],['test_c']]);
assert.deepEqual(calls.map((x)=>x.input.scenarioIds[0]).sort(),['test_a','test_b','test_c']);
assert.ok(calls.every((x)=>x.input.scenarioIds.length===1));
assert.ok(calls.every((x)=>x.idempotencyKey.startsWith('runbatch:')));

const getArtifact={specification:{scenarios:[baseScenario('test_a','GET'),baseScenario('test_b','GET')]}};
const getCalls=[];
const getResult=await createRunBatchV1({env:{},organizationId:'org_x',projectId:'prj_x',input:{...input,scenarioIds:['test_a','test_b']},idempotencyKey:'console-batch:get12345',deps:{getRunnerTestArtifact:async()=>getArtifact,createRun:async(args)=>{getCalls.push(args);return {run:{runId:'run_get12345678',scenarioIds:args.input.scenarioIds},idempotentReplay:false};}}});
assert.equal(getResult.executionKind,'READ_ONLY_BATCH');
assert.equal(getResult.runCount,1);
assert.deepEqual(getCalls[0].input.scenarioIds,['test_a','test_b']);
console.log('07.7.8-D mutation Run Batch tests passed');
