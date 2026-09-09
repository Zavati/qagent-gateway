import assert from 'node:assert/strict';
import { createHumanRequestRepairV1 } from '../src/services/humanRequestRepairService.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

const resultData={resultSet:{resultSetId:'rset_1',runId:'run_1',testDesignVersionId:'tdv_6',endpointId:'cep_1',environmentId:'env_1'},scenarios:[{scenarioResultId:'sres_1',scenarioId:'test_001',evidence:{request:{bodyFields:[{path:'$.leaveTypeId',redacted:false}]}}}]};
const inspection={sourceTestDesignVersionId:'tdv_6',scenarios:[{scenarioId:'test_001',requestIssueDetected:true,requestIssue:{fields:[{target:'BODY',selector:'$.leaveTypeId',bindingSource:'OBSERVED'}]}}]};
const artifact={endpointId:'cep_1',specification:{scenarios:[{scenarioId:'test_001',spec:{testData:{bindings:[{target:'BODY',selector:'$.leaveTypeId',source:'OBSERVED',valueType:'STRING',bindingKey:'BODY:$.leaveTypeId'}]}}}]}};
let createdBindingInput=null,registryPayload=null,rerunInput=null;
const out=await createHumanRequestRepairV1({env:{},organizationId:'org_1',projectId:'prj_1',userId:'usr_1',input:{contractVersion:'qagent.human-request-repair-create.v1',resultSetId:'rset_1',scenarioId:'test_001',sourceTestDesignVersionId:'tdv_6',changes:[{target:'BODY',selector:'$.leaveTypeId',operation:'SET_FIXED',valueType:'INTEGER',value:1}],reason:'correct rejected id',rerun:true},deps:{
  getResult:async()=>resultData,inspect:async()=>inspection,getArtifact:async()=>artifact,listBindings:async()=>[],
  createBinding:async(_env,args)=>{createdBindingInput=args;return{bindingId:'tdb_1',status:'active',scopeType:'ENDPOINT',environmentId:'env_1',target:'BODY',selector:'$.leaveTypeId',sourceType:'FIXED',valueType:'INTEGER',origin:'USER_DEFINED'};},
  createRegistryVersion:async(args)=>{registryPayload=args.payload;return{testDesign:{id:'td_1',versionId:'tdv_7',version:7}};},
  createRerun:async(args)=>{rerunInput=args;return{run:{runId:'run_2',status:'CREATED'},evolutionRuntimeReuse:{strategy:'CONFIRMED_SOURCE_RUNTIME_TARGET'}};},
}});
assert.equal(out.contractVersion,'qagent.human-request-repair-result.v1');
assert.equal(out.testDesign.testDesignVersion,7);assert.equal(out.rerun.status,'CREATED');
assert.equal(createdBindingInput.input.scopeType,'ENDPOINT');assert.equal(createdBindingInput.input.environmentId,'env_1');assert.equal(createdBindingInput.input.value,1);assert.equal(createdBindingInput.input.sourceType,'FIXED');
assert.equal(registryPayload.changes[0].currentSource,'OBSERVED');assert.equal(registryPayload.changes[0].valueType,'INTEGER');assert.equal(registryPayload.repair.approvedByUserId,'usr_1');
assert.equal(rerunInput.testDesignVersionId,'tdv_7');assert.equal(rerunInput.scenarioId,'test_001');assert.match(rerunInput.idempotencyKey,/^human-request-repair-rerun:hrr_/);
const route=resolveGatewayRoute('POST','/v1/console/projects/prj_1/test-evolution/request-repairs');assert.equal(route.name,'consoleHumanRequestRepairPost');
console.log('08.1.3-C FIX-3 human-guided request repair: PASS');
await assert.rejects(
  ()=>createHumanRequestRepairV1({env:{},organizationId:'org_1',projectId:'prj_1',userId:null,input:{contractVersion:'qagent.human-request-repair-create.v1',resultSetId:'rset_1',scenarioId:'test_001',sourceTestDesignVersionId:'tdv_6',changes:[{target:'BODY',selector:'$.leaveTypeId',operation:'SET_FIXED',valueType:'INTEGER',value:1}]},deps:{}}),
  (error)=>error?.code==='HUMAN_REQUEST_REPAIR_ACTOR_REQUIRED'&&error?.status===403,
);
