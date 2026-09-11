import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observedBaselineGenerationEnabled } from '../src/intelligence/observedBaselineFeature.js';
import { generateCatalogTestDesignV1 } from '../src/intelligence/testDesignService.js';
import { getConsoleTestDesign } from '../src/handlers/consoleIntelligence.js';
import { postConsoleLearningResolutionAnalyze } from '../src/handlers/consoleLearningResolution.js';
import { assessExploratoryLearning, learningBlockerCodes } from '../src/learningScenarioEligibility.js';
import { prepareExploratoryLearningData } from '../src/services/exploratoryLearningData.js';
import { resolveObservedTestDataForRun } from '../src/services/observedTestDataRuntimeResolver.js';
import { materializeExecutionPlanV1 } from '../src/services/executionPlanMaterializerService.js';

export const scope={organizationId:'org_learning',projectId:'prj_learning',endpointId:'cep_learning',environmentId:'env_learning'};
export const scenarios=JSON.parse(readFileSync(new URL('./fixtures/learning-readiness-fix2-1.json',import.meta.url)));
const find=id=>structuredClone(scenarios.find(s=>s.scenarioId===id));
export const sample={environmentId:scope.environmentId,sampleFingerprint:'f'.repeat(64),observationCount:2,successCount:2,lastSeenAt:'2026-09-11T15:00:00Z',values:[{target:'PATH_PARAM',selector:'id',segmentIndex:6,occurrence:0,valueType:'STRING',value:'17'}]};
const request=body=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)});
let aiCalls=0;
const dataDeps={requireTenant:async()=>({organizationId:scope.organizationId,organizationRole:'owner',user:{userId:'usr_learning'}}),getProject:async()=>({}),
 getLatest:async()=>({exists:true,testDesign:{versionId:'tdv_learning',specification:{scenarios}}}),
 listResults:async()=>({items:[],page:{hasMore:false}}),resolveTestDataBindings:async()=>[],
 resolveObservedTestData:args=>resolveObservedTestDataForRun({...args,loadSamples:async()=>[sample],loadValues:async()=>{throw Error('path scalar fallback forbidden');}}),
 aiAssess:async()=>{aiCalls++;throw Error('no results must not call model');}};
const analyze=(ids,deps={})=>postConsoleLearningResolutionAnalyze(request({environmentId:scope.environmentId,selections:ids.map(scenarioId=>({endpointId:scope.endpointId,testDesignVersionId:'tdv_learning',scenarioId}))}),{},{projectId:scope.projectId},{...dataDeps,...deps});

test('global switch ignores stale allowlist, but false/missing stays disabled',()=>{
 for(const flag of [true,'true','TRUE',' true ','1',1]) assert.equal(observedBaselineGenerationEnabled({OBSERVED_BASELINE_GENERATION_ENABLED:flag,OBSERVED_BASELINE_PROJECT_IDS:'prj_other'}),true);
 for(const flag of [false,'false','0','',undefined,'yes']) assert.equal(observedBaselineGenerationEnabled({OBSERVED_BASELINE_GENERATION_ENABLED:flag}),false);
});
test('real generation branch loads baselines for any project under true',async()=>{
 let loads=0;const sentinel=Object.assign(new Error('stop before generation'),{code:'TEST_STOP'});
 await assert.rejects(generateCatalogTestDesignV1({...scope,env:{OBSERVED_BASELINE_GENERATION_ENABLED:'true',OBSERVED_BASELINE_PROJECT_IDS:'prj_other'},contextBuilder:async()=>({context:{},contextFingerprint:'a'.repeat(64)}),loadBaselines:async()=>{loads++;throw sentinel;},loadPrevious:async()=>({exists:false})}),e=>e===sentinel);
 assert.equal(loads,1);
});
test('source read uses same global gate and exact authenticated scope',async()=>{
 let reads=0;
 const r=await getConsoleTestDesign(new Request('https://test.invalid'),{OBSERVED_BASELINE_GENERATION_ENABLED:'true',OBSERVED_BASELINE_PROJECT_IDS:'prj_other'},scope,{requireTenant:dataDeps.requireTenant,getProject:dataDeps.getProject,loadLatest:async()=>({exists:false}),loadBaselines:async input=>{reads++;assert.equal(input.projectId,scope.projectId);assert.equal(input.organizationId,scope.organizationId);return {items:[]};}});
 assert.equal(reads,1);assert.deepEqual(r.data.observedBaselineSources,[]);
});
test('four reported scenarios: 003/006 can learn; 002/007 retain condition-specific blockers',async()=>{
 const before=JSON.stringify(scenarios);const r=await analyze(['test_002','test_003','test_006','test_007']);
 assert.deepEqual(r.data.items.map(x=>x.status),['BLOCKED','LEARNING_AVAILABLE','LEARNING_AVAILABLE','BLOCKED']);
 assert.equal(r.data.items[0].reason,'LEARNING_NONEXISTENT_RESOURCE_NOT_ESTABLISHED');
 assert.equal(r.data.items[3].reason,'LEARNING_EMPTY_STATE_NOT_ESTABLISHED');
 for(const i of r.data.items.filter(x=>x.status==='LEARNING_AVAILABLE')){assert.equal(i.learning.dataResolution.bindings[0].source,'OBSERVED');assert.equal(i.learning.requiresRuntimePreflight,true);}
 assert.equal(JSON.stringify(scenarios),before);assert.equal(aiCalls,0);assert.equal(r.data.executionStarted,false);assert.equal(r.data.appliedByThisOperation,false);
 assert.equal(JSON.stringify(r).includes('sampleFingerprint'),false);assert.equal(JSON.stringify(r).includes('fixedValue'),false);
});
test('translated old blockers do not vanish from a denied result',()=>{
 const s=find('test_002');assert.ok(learningBlockerCodes(s).includes('LEARNING_NONEXISTENT_RESOURCE_NOT_ESTABLISHED'));
 assert.ok(assessExploratoryLearning(s).blockers.length>0);
});
test('unknown review text is neither disclosed nor silently ignored',async()=>{
 const s=find('test_006');s.automation.blockers=['Contact password=my-secret'];
 const r=await analyze(['test_006'],{getLatest:async()=>({exists:true,testDesign:{versionId:'tdv_learning',specification:{scenarios:[s]}}})});
 assert.equal(r.data.items[0].status,'BLOCKED');assert.equal(r.data.items[0].reason,'LEARNING_REVIEW_REASON_UNCLASSIFIED');assert.equal(JSON.stringify(r).includes('my-secret'),false);
});
test('missing or cross-environment samples block using resolver-specific code',async()=>{
 for(const samples of [[],[{...sample,environmentId:'env_other'}]]){
  const r=await analyze(['test_003'],{resolveObservedTestData:a=>resolveObservedTestDataForRun({...a,loadSamples:async()=>samples})});
  assert.equal(r.data.items[0].status,'BLOCKED');assert.equal(r.data.items[0].reason,'RUN_OBSERVED_TEST_DATA_CORRELATED_SAMPLE_MISSING');
 }
});
test('upstream failure is ERROR, not a fake missing data diagnosis',async()=>{
 const r=await analyze(['test_006'],{resolveTestDataBindings:async()=>{throw Object.assign(new Error('hidden'),{status:503,code:'CONFIG_UNAVAILABLE'});}});
 assert.equal(r.data.items[0].status,'ERROR');assert.equal(r.data.items[0].errorCode,'CONFIG_UNAVAILABLE');
});
test('explicit fixed configuration overrides observed without any values in analysis',async()=>{
 const c={target:'PATH_PARAM',selector:'id',sourceType:'FIXED',valueType:'STRING',fixedValue:'explicit-only-8',bindingId:'tdb_learning',origin:'USER_DEFINED'};
 const r=await analyze(['test_006'],{resolveTestDataBindings:async()=>[c],resolveObservedTestData:async()=>{throw Error('must not consult observation');}});
 assert.equal(r.data.items[0].status,'LEARNING_AVAILABLE');assert.equal(r.data.items[0].learning.dataResolution.bindings[0].source,'FIXED');assert.equal(JSON.stringify(r).includes('explicit-only-8'),false);
});
test('secret binding without a secret reference remains blocked',async()=>{
 const s=find('test_006');s.spec.testData.bindings[0].source='SECRET';s.spec.testData.bindings[0].bindingKey='PATH_PARAM:id';
 assert.throws(()=>prepareExploratoryLearningData(s,[{target:'PATH_PARAM',selector:'id',sourceType:'SECRET',valueType:'STRING',secretId:null}]),{code:'RUN_TEST_DATA_SECRET_NOT_CONFIGURED'});
});
test('unauthenticated intent is preserved and contradictory auth is blocked',()=>{
 const s=find('test_003');const prepared=prepareExploratoryLearningData(s,[]);assert.equal(prepared.spec.auth.requirement,'UNAUTHENTICATED');assert.equal(prepared.spec.auth.authProfileRef,null);
 s.spec.auth.authProfileRef='authp_wrong';assert.equal(assessExploratoryLearning(s).reason,'LEARNING_AUTH_INTENT_CONFLICT');
});
test('repeated placeholders use existing positional binding identity',()=>{
 const s=find('test_003');s.spec.target.path='/companies/{id}/people/{id}';const p=prepareExploratoryLearningData(s,[]);
 assert.deepEqual(p.spec.testData.bindings.map(b=>b.bindingKey),['PATH_PARAM:id@1:0','PATH_PARAM:id@3:1']);
});
test('an existing literal is not overwritten by observed fallback',()=>{
 const s=find('test_006');delete s.spec.testData;s.spec.request.pathParams.id='literal17';assert.equal(prepareExploratoryLearningData(s,[]).spec.request.pathParams.id,'literal17');
});
test('mutation or unresolved actual auth are not admitted',()=>{
 let s=find('test_006');s.spec.target.method='DELETE';assert.equal(assessExploratoryLearning(s).allowed,false);
 s=find('test_006');s.spec.auth.authProfileRef=null;assert.equal(assessExploratoryLearning(s).reason,'LEARNING_AUTH_CONFIGURATION_REQUIRED');
});

export function materializeArgs(ids=['test_003','test_006']){
 const specification={contractVersion:'qagent.test-design.v1',specificationVersion:'qagent.test-spec.v1',source:{...scope,type:'CATALOG_ENDPOINT'},scenarios:structuredClone(scenarios)};
 return {...scope,artifact:{...scope,specificationVersion:'qagent.test-spec.v1',testDesignId:'td_learning',testDesignVersionId:'tdv_learning',version:2,contextFingerprint:'f'.repeat(64),specification},requestedScenarioIds:ids,purpose:'LEARNING',runId:'run_learning',executionPlanId:'xplan_learning',runtimeSnapshotId:'rts_learning',createdAt:'2026-09-11T16:00:00.000Z',
 resolveRuntime:async()=>({environment:{environmentId:scope.environmentId,environmentType:'STG',name:'Test'},apiServices:{svc_learning:{baseUrl:'https://learning.example.com',apiServiceId:'svc_learning',name:'Test API'}},authProfiles:{authp_learning:{authProfileId:'authp_learning',type:'api_key',config:{placement:'header',name:'Authorization',prefix:'Bearer '},credentialsConfigured:true}}}),
 resolveTestDataBindings:async()=>[],resolveObservedTestData:dataDeps.resolveObservedTestData,
 loadSchemas:async()=>{throw Error('unexpected schema read');},loadEndpoint:async()=>{throw Error('unexpected discovery read');}};
}
test('real materializer preserves REVIEW_REQUIRED, assertions and frozen observed values in LEARNING',async()=>{
 const args=materializeArgs();const original=JSON.stringify(args.artifact);const p=await materializeExecutionPlanV1(args);
 assert.equal(p.executionPlan.purpose,'LEARNING');assert.deepEqual(p.executionPlan.scenarios.map(s=>s.readiness),['REVIEW_REQUIRED','REVIEW_REQUIRED']);
 assert.equal(p.executionPlan.scenarios[0].spec.auth.requirement,'UNAUTHENTICATED');assert.equal(p.executionPlan.scenarios[1].spec.auth.requirement,'REQUIRED');
 assert.equal(p.runtimeSnapshot.testData.fixed['PATH_PARAM:id@6:0'].value,'17');assert.equal(JSON.stringify(args.artifact),original);
 assert.deepEqual(p.executionPlan.scenarios[1].spec.assertions,find('test_006').spec.assertions);
});
test('normal REGRESSION still refuses review and learning never admits unrelated negatives',async()=>{
 await assert.rejects(materializeExecutionPlanV1({...materializeArgs(['test_006']),purpose:'REGRESSION'}),{code:'RUN_SCENARIO_NOT_EXECUTABLE'});
 await assert.rejects(materializeExecutionPlanV1(materializeArgs(['test_002'])),{code:'RUN_SCENARIO_NOT_EXECUTABLE'});
});
