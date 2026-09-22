import assert from 'node:assert/strict';
import { materializeExecutionPlanV1 } from '../src/services/executionPlanMaterializerService.js';

const organizationId='org_fix3',projectId='prj_fix3',environmentId='env_fix3';
const scenario={scenarioId:'scenario_a',title:'Scenario local request',automation:{readiness:'READY',blockers:[]},spec:{dslVersion:'qagent.api-test-dsl.v1',type:'api',target:{catalogEndpointId:'cep_fix3',apiServiceKey:'core-api',method:'POST',path:'/orders'},auth:{requirement:'NONE',authProfileRef:null},request:{pathParams:{},query:{},headers:{},body:{}},assertions:[{type:'STATUS',expectedStatusCodes:[200]}],extract:[],testData:{contractVersion:'qagent.test-data-bindings.v1',bindings:[
 {target:'BODY',selector:'$.quantity',source:'FIXED',valueType:'INTEGER',bindingKey:'SCENARIO:scenario_a:BODY:$.quantity',fixedValue:7,provenance:{origin:'USER_DEFINED'}},
 {target:'BODY',selector:'$.executionDate',source:'GENERATED',valueType:'STRING',generator:{kind:'CURRENT_DATE',config:{timezone:'America/Sao_Paulo',offsetDays:0}},provenance:{origin:'USER_DEFINED'}},
]}}};
const artifact={organizationId,projectId,endpointId:'cep_fix3',testDesignId:'td_fix3',testDesignVersionId:'tdv_fix3',version:2,contextFingerprint:'f'.repeat(64),specificationVersion:'qagent.test-spec.v1',specification:{contractVersion:'qagent.test-design.v1',specificationVersion:'qagent.test-spec.v1',source:{organizationId,projectId,endpointId:'cep_fix3'},scenarios:[scenario]}};
const runtime={organizationId,projectId,environment:{environmentId,name:'STG',slug:'stg',environmentType:'STG'},apiServices:{'core-api':{apiServiceId:'svc',name:'Core',baseUrl:'https://api.example.test'}},variables:{},authProfiles:{}};
const out=await materializeExecutionPlanV1({env:{},organizationId,projectId,artifact,environmentId,requestedScenarioIds:['scenario_a'],runId:'run_fix3',executionPlanId:'xplan_fix3',runtimeSnapshotId:'rts_fix3',createdAt:'2026-09-13T12:34:56.789Z',resolveRuntime:async()=>runtime,loadSchemas:async()=>[]});
assert.equal(out.runtimeSnapshot.testData.fixed['SCENARIO:scenario_a:BODY:$.quantity'].value,7);
const planned=out.executionPlan.scenarios[0].spec.testData.bindings;
assert.equal(Object.prototype.hasOwnProperty.call(planned.find(x=>x.selector==='$.quantity'),'fixedValue'),false);
assert.equal(planned.find(x=>x.selector==='$.executionDate').generator.kind,'CURRENT_DATE');
console.log('08.1.6 FIX-3 scenario runtime materialization: ok');
