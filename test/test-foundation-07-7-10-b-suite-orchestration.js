import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSuiteRunCreateInput, fingerprintSuiteRunCreateInput, buildSuiteRunRequestedMessage } from '../src/lib/suiteRunContracts.js';
import { createSuiteRunV1, processSuiteRunOrchestrationMessage, resolveSuiteFanoutBatchSize } from '../src/services/suiteRunService.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

const projectId='prj_test123';
assert.deepEqual(resolveGatewayRoute('POST',`/v1/console/projects/${projectId}/suite-runs`),{name:'consoleSuiteRunsCreate',params:{projectId}});
assert.deepEqual(resolveGatewayRoute('GET',`/v1/console/projects/${projectId}/suite-runs/srun_12345678`),{name:'consoleSuiteRunGet',params:{projectId,suiteRunId:'srun_12345678'}});

const input=normalizeSuiteRunCreateInput({contractVersion:'qagent.suite-run-create.v1',suiteVersionId:'suitev_12345678',environmentId:'env_12345678',confirmDiscoveredRuntime:true});
assert.equal((await fingerprintSuiteRunCreateInput(input)).length,64);
assert.equal(buildSuiteRunRequestedMessage({suiteRunId:'srun_12345678',organizationId:'org_x',projectId,expectedCursor:4}).expectedCursor,4);
assert.equal(resolveSuiteFanoutBatchSize({SUITE_ORCHESTRATOR_CHILD_BATCH_SIZE:'999'}),10);

const sent=[];
const fakeRoot={suiteRun:{suiteRunId:'srun_created123',organizationId:'org_test',projectId,contractVersion:'qagent.suite-run.v1',suiteId:'suite_123',suiteVersionId:'suitev_12345678',suiteVersion:2,suiteInventoryFingerprint:'f'.repeat(64),environmentId:'env_12345678',status:'CREATED',endpointCount:2,scenarioCount:3,confirmDiscoveredRuntime:true,idempotencyKey:'suite-key-123',requestFingerprint:'',createdByUserId:'usr_x',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'},dispatch:{status:'PENDING',cursor:0,dispatchAttemptCount:0}};
fakeRoot.suiteRun.requestFingerprint=await fingerprintSuiteRunCreateInput(input);
const created=await createSuiteRunV1({env:{SUITE_ORCHESTRATOR_QUEUE:{send:async(m)=>sent.push(m)}},organizationId:'org_test',projectId,userId:'usr_x',input,idempotencyKey:'suite-key-123',deps:{
 getByIdempotency:async()=>null,getEnvironment:async()=>({environmentId:'env_12345678'}),getSuiteExecutionSlice:async()=>({suite:{suiteId:'suite_123',suiteVersionId:'suitev_12345678',version:2,inventoryFingerprint:'f'.repeat(64),endpointCount:2,scenarioCount:3},totalItems:2}),createRoot:async()=>fakeRoot,markPublished:async()=>{},getProgress:async()=>({...fakeRoot,counts:{materialized:0,active:0,passed:0,failed:0,error:0,cancelled:0,createError:0},children:[]})
}});
assert.equal(created.suiteRun.suiteVersionId,'suitev_12345678');
assert.equal(sent.length,1);
assert.equal(sent[0].expectedCursor,0);


// Durable retry semantics: an initial Queue publish failure can be retried with the
// same idempotency key, but a terminal Suite Run is never republished.
const recoverSent=[]; let recoverMarked=0;
const recoverExisting={...fakeRoot.suiteRun,status:'CREATED'};
const recoverEnvelope=await createSuiteRunV1({env:{SUITE_ORCHESTRATOR_QUEUE:{send:async(m)=>recoverSent.push(m)}},organizationId:'org_test',projectId,userId:'usr_x',input,idempotencyKey:'suite-key-123',deps:{
 getByIdempotency:async()=>recoverExisting,getDispatch:async()=>({status:'FAILED',cursor:0,dispatchAttemptCount:1}),markPublished:async()=>{recoverMarked+=1;},getProgress:async()=>({suiteRun:{...recoverExisting,status:'QUEUED'},dispatch:{status:'PUBLISHED',cursor:0,dispatchAttemptCount:2},counts:{materialized:0,active:0,passed:0,failed:0,error:0,cancelled:0,createError:0},children:[]})
}});
assert.equal(recoverSent.length,1); assert.equal(recoverMarked,1); assert.equal(recoverEnvelope.idempotentReplay,true);
const terminalSent=[];
await createSuiteRunV1({env:{SUITE_ORCHESTRATOR_QUEUE:{send:async(m)=>terminalSent.push(m)}},organizationId:'org_test',projectId,userId:'usr_x',input,idempotencyKey:'suite-key-123',deps:{
 getByIdempotency:async()=>({...recoverExisting,status:'ERROR'}),getDispatch:async()=>({status:'FAILED',cursor:0,dispatchAttemptCount:2,lastErrorCode:'PIN_MISMATCH'}),getProgress:async()=>({suiteRun:{...recoverExisting,status:'ERROR'},dispatch:{status:'FAILED',cursor:0,dispatchAttemptCount:2,lastErrorCode:'PIN_MISMATCH'},counts:{materialized:0,active:0,passed:0,failed:0,error:0,cancelled:0,createError:0},children:[]})
}});
assert.equal(terminalSent.length,0);

const childRuns=[]; const continuations=[]; let advanced=null;
const outcome=await processSuiteRunOrchestrationMessage({env:{SUITE_ORCHESTRATOR_CHILD_BATCH_SIZE:'2',SUITE_ORCHESTRATOR_CHILD_CONCURRENCY:'2',SUITE_ORCHESTRATOR_QUEUE:{send:async(m)=>continuations.push(m)}},message:{contractVersion:'qagent.suite-run-requested.v1',suiteRunId:'srun_x12345678',organizationId:'org_test',projectId,expectedCursor:0},deps:{
 getSuiteRunById:async()=>({suiteRunId:'srun_x12345678',organizationId:'org_test',projectId,status:'QUEUED',suiteVersionId:'suitev_12345678',suiteInventoryFingerprint:'f'.repeat(64),suiteId:'suite_123',suiteVersion:2,environmentId:'env_12345678',endpointCount:3,scenarioCount:4,confirmDiscoveredRuntime:true,createdByUserId:'usr_x'}),
 getDispatch:async()=>({cursor:0,status:'PUBLISHED'}),markProcessing:async()=>{},getSuiteExecutionSlice:async()=>({suite:{inventoryFingerprint:'f'.repeat(64),endpointCount:3},items:[{ordinal:0,endpointId:'cep_a',testDesignVersionId:'tdv_a12345678',testDesignVersion:1,method:'GET',path:'/a',scenarioCount:2,scenarioIds:['test_001','test_002']},{ordinal:1,endpointId:'cep_b',testDesignVersionId:'tdv_b12345678',testDesignVersion:1,method:'GET',path:'/b',scenarioCount:1,scenarioIds:['test_001']}],nextOffset:2,hasMore:true}),
 upsertUnits:async(_env,{units})=>{globalThis.__suiteTestUnits=units;},listUnits:async()=>globalThis.__suiteTestUnits.filter((u)=>u.decision==='EXECUTE').map((u)=>({...u,scenarioCount:u.scenarioIds.length})),upsertChild:async()=>{},createRun:async({input})=>{childRuns.push(input);return {run:{runId:`run_${childRuns.length}12345678`}};},markChildCreated:async()=>{},markUnitCreated:async()=>{},markChildError:async()=>{},markUnitError:async()=>{},advanceCursor:async(_env,args)=>{advanced=args;return true;},refresh:async()=>{}
}});
assert.equal(outcome.processed,true); assert.equal(childRuns.length,2); assert.equal(continuations.length,1); assert.equal(continuations[0].expectedCursor,2); assert.equal(advanced.nextCursor,2); assert.equal(advanced.complete,false);
assert.deepEqual(childRuns.find((x)=>x.scenarioIds.length===2).scenarioIds,['test_001','test_002']);

for (const contract of ['qagent.suite-run-create.v1.schema.json','qagent.suite-run-requested.v1.schema.json','qagent.suite-run.v1.schema.json']) {
  const schema=JSON.parse(fs.readFileSync(new URL(`../docs/contracts/${contract}`,import.meta.url),'utf8'));
  assert.ok(schema.$id);
}
const migration=fs.readFileSync(new URL('../migrations/0015_foundation_07_7_10_b_suite_run_orchestration.sql',import.meta.url),'utf8');
assert.match(migration,/UNIQUE \(organization_id, project_id, idempotency_key\)/);
assert.match(migration,/UNIQUE \(suite_run_id, ordinal\)/);
const repositorySource=fs.readFileSync(new URL('../src/repositories/suiteRunRepository.js',import.meta.url),'utf8');
const queueSource=fs.readFileSync(new URL('../src/handlers/suiteRunQueue.js',import.meta.url),'utf8');
assert.match(repositorySource,/status IN \('PENDING','FAILED'\) THEN 'PUBLISHED'/);
assert.match(repositorySource,/recordSuiteRunOrchestrationError/);
assert.match(repositorySource,/SET status='ERROR',terminal_at=COALESCE/);
assert.match(queueSource,/terminal:nonRetryable/);
console.log('Foundation 07.7.10-B Suite Run orchestration tests passed ✅');
