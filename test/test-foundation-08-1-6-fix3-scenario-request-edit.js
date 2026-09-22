import assert from 'node:assert/strict';
import { createScenarioRequestEditV1 } from '../src/services/scenarioRequestEditService.js';

const scenario={scenarioId:'scenario_a',spec:{target:{path:'/orders/{id}'},testData:{bindings:[]}}};
const artifact={endpointId:'cep_orders',specification:{scenarios:[scenario]}};
const base={env:{},organizationId:'org_1',projectId:'prj_1',endpointId:'cep_orders',userId:'usr_1'};

async function run(input,extra={}){let captured=null;const data=await createScenarioRequestEditV1({...base,input,deps:{getArtifact:async()=>structuredClone(artifact),createVersion:async({payload})=>{captured=payload;return{created:true,idempotentReplay:false,testDesign:{id:'td_1',versionId:'tdv_2',version:2}};},...extra}});return{data,captured};}

{
  const {data,captured}=await run({contractVersion:'qagent.scenario-request-edit.v1',sourceTestDesignVersionId:'tdv_1',scenarioId:'scenario_a',changes:[
    {operation:'FIXED',target:'BODY',selector:'$.quantity',valueType:'INTEGER',value:'7'},
    {operation:'GENERATED',target:'BODY',selector:'$.executionDate',valueType:'STRING',generator:{kind:'CURRENT_DATE',config:{timezone:'America/Sao_Paulo',offsetDays:1}}},
    {operation:'OBSERVED',target:'PATH_PARAM',selector:'id',valueType:'STRING'},
  ]});
  assert.equal(data.contractVersion,'qagent.scenario-request-edit-result.v1');assert.equal(data.executionStarted,false);
  assert.equal(captured.changes[0].bindingKey,'SCENARIO:scenario_a:BODY:$.quantity');assert.equal(captured.changes[0].value,7);
  assert.deepEqual(captured.changes[1].generator,{kind:'CURRENT_DATE',config:{timezone:'America/Sao_Paulo',offsetDays:1}});
  assert.equal(captured.changes[2].bindingKey,'PATH_PARAM:id@1:0');
}

{
  const shared={bindingId:'tdb_1',status:'active',environmentId:'env_1',target:'BODY',selector:'$.password',sourceType:'SECRET',valueType:'STRING'};
  const {captured}=await run({contractVersion:'qagent.scenario-request-edit.v1',sourceTestDesignVersionId:'tdv_1',scenarioId:'scenario_a',environmentId:'env_1',changes:[{operation:'SHARED',target:'BODY',selector:'$.password',valueType:'STRING',sharedBindingId:'tdb_1'}]}, {getSharedBinding:async()=>shared,resolveShared:async()=>[shared]});
  assert.equal(captured.changes[0].sourceType,'SECRET');assert.equal(captured.changes[0].sharedBindingId,'tdb_1');
}

await assert.rejects(()=>run({contractVersion:'qagent.scenario-request-edit.v1',sourceTestDesignVersionId:'tdv_1',scenarioId:'scenario_a',changes:[{operation:'FIXED',target:'BODY',selector:'$.password',valueType:'STRING',value:'secret'}]}),e=>e.code==='SCENARIO_REQUEST_EDIT_SECRET_REQUIRED');
await assert.rejects(()=>run({contractVersion:'qagent.scenario-request-edit.v1',sourceTestDesignVersionId:'tdv_1',scenarioId:'scenario_a',changes:[{operation:'OMIT',target:'PATH_PARAM',selector:'id'}]}),e=>e.code==='SCENARIO_REQUEST_EDIT_PATH_OMIT_FORBIDDEN');

console.log('08.1.6 FIX-3 scenario request edit service: ok');

import { prepareExploratoryLearningData } from '../src/services/exploratoryLearningData.js';
{
  const learning={scenarioId:'learn_local',generationClass:'AI_EXPLORATORY',category:'HAPPY_PATH',automation:{readiness:'REVIEW_REQUIRED',blockers:['O status HTTP 200 não foi observado nas evidências selecionadas para este endpoint.']},spec:{target:{method:'GET',path:'/orders',apiServiceKey:'svc'},auth:{requirement:'NONE',authProfileRef:null},request:{pathParams:{},query:{},headers:{}},assertions:[{type:'STATUS',expectedStatusCodes:[200]}],testData:{contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'QUERY',selector:'limit',source:'OBSERVED',valueType:'INTEGER',bindingKey:'QUERY:limit',provenance:{origin:'USER_DEFINED'}}]}}};
  const out=prepareExploratoryLearningData(learning,[{bindingId:'tdb_global',target:'QUERY',selector:'limit',sourceType:'FIXED',valueType:'INTEGER',fixedValue:50,origin:'USER_DEFINED'}]);
  assert.equal(out.spec.testData.bindings[0].source,'OBSERVED');
  assert.equal(out.spec.testData.bindings[0].provenance.origin,'USER_DEFINED');
}
console.log('08.1.6 FIX-3 scenario precedence: ok');

import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
{
  const route=resolveGatewayRoute('POST','/v1/console/projects/prj_1/intelligence/endpoints/cep_orders/test-design/scenario-request');
  assert.equal(route.name,'consoleScenarioRequestEditPost');assert.deepEqual(route.params,{projectId:'prj_1',endpointId:'cep_orders'});
}
console.log('08.1.6 FIX-3 public router: ok');
