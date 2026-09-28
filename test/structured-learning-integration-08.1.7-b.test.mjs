import test from 'node:test';
import assert from 'node:assert/strict';
import { postConsoleLearningResolutionAnalyze } from '../src/handlers/consoleLearningResolution.js';
import { materializeExecutionPlanV1 } from '../src/services/executionPlanMaterializerService.js';
import { resolveObservedTestDataForRun } from '../src/services/observedTestDataRuntimeResolver.js';
import { evaluateScenarioReadinessV2, projectLegacyReadiness } from '../src/readiness/scenarioReadinessV2.js';
import { collectScenarioReadinessIssues } from '../src/readiness/scenarioReadinessFacts.js';
import { buildReadinessIssue } from '../src/readiness/readinessIssues.js';
import { validExploratoryLearningAdmission } from '../src/learningScenarioEligibility.js';
// No monitored application, external service or AI may be contacted by this suite.
globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const scope={organizationId:'org_b',projectId:'prj_b',endpointId:'cep_b',environmentId:'env_b'};
const enabled={SCENARIO_READINESS_V2_ENABLED:'true'};
const makeReq=body=>new Request('https://console.invalid',{method:'POST',body:JSON.stringify(body)});
function scenario({path='/items/{id}',coverage=false,codes=[]}={}){
 const s={scenarioId:'test_b',title:'Verificar sem autenticação',objective:'Status 401',category:'AUTHORIZATION',priority:'HIGH',confidence:'LOW',grounding:{level:'ASSUMED',rationale:[],evidenceRefs:[],schemaRefs:[]},automation:{readiness:'REVIEW_REQUIRED',blockers:['presentation changing freely']},spec:{dslVersion:'qagent.api-test-dsl.v1',type:'api',target:{catalogEndpointId:scope.endpointId,apiServiceKey:'svc_b',method:'GET',path},auth:{requirement:'UNAUTHENTICATED',authProfileRef:null},request:{pathParams:{},query:{},headers:{}},assertions:[{type:'STATUS',expectedStatusCodes:[401]}],extract:[]}};
 if(coverage){s.title='Validar o total';s.objective='$.meta.total deve ser number';s.category='SCHEMA_CONTRACT';s.spec.auth={requirement:'REQUIRED',authProfileRef:'authp_b'};s.spec.assertions=[{type:'STATUS',expectedStatusCodes:[200]},{type:'JSON_PATH_EXISTS',path:'$.meta.total'}];}
 s.readinessV2=evaluateScenarioReadinessV2({issues:[...collectScenarioReadinessIssues(s),...codes.map(c=>buildReadinessIssue(c))],expectation:{status:'HYPOTHESIS',basis:'AI_ASSUMED'},learningPolicyAllows:true});s.automation.readiness=projectLegacyReadiness(s.readinessV2);return s;
}
const sample={environmentId:scope.environmentId,sampleFingerprint:'f'.repeat(64),observationCount:2,successCount:2,lastSeenAt:'2026-09-11T15:00:00Z',values:[{target:'PATH_PARAM',selector:'id',segmentIndex:1,occurrence:0,valueType:'STRING',value:'17'}]};
const observed=arg=>resolveObservedTestDataForRun({...arg,loadSamples:async()=>[sample],loadValues:async()=>{throw Error('no scalar fallback');}});
function dependencies(s){return {
 requireTenant:async()=>({organizationId:scope.organizationId,organizationRole:'owner',user:{userId:'usr_b'}}),getProject:async()=>({}),
 getLatest:async()=>({exists:true,testDesign:{versionId:'tdv_b',specification:{scenarios:[s]}}}),
 listResults:async()=>({items:[],page:{hasMore:false}}),resolveTestDataBindings:async()=>[],resolveObservedTestData:observed,
 aiAssess:async()=>{throw Error('AI_FORBIDDEN');},createRerun:async()=>{throw Error('RUN_FORBIDDEN');},createProposal:async()=>{throw Error('PROPOSAL_FORBIDDEN_WITHOUT_EVIDENCE');},
 };}
async function analyze(s,{env=enabled,deps={},body={}}={}){
 const payload={environmentId:scope.environmentId,selections:[{endpointId:scope.endpointId,testDesignVersionId:'tdv_b',scenarioId:s.scenarioId}],...body};
 return postConsoleLearningResolutionAnalyze(makeReq(payload),env,{projectId:scope.projectId},{...dependencies(s),...deps});
}
function args(s,extra={}){
 const specification={contractVersion:'qagent.test-design.v1',specificationVersion:'qagent.test-spec.v1',source:{...scope,type:'CATALOG_ENDPOINT'},scenarios:[s]};
 return {...scope,env:enabled,artifact:{...scope,specificationVersion:'qagent.test-spec.v1',testDesignId:'td_b',testDesignVersionId:'tdv_b',version:2,contextFingerprint:'a'.repeat(64),specification},requestedScenarioIds:[s.scenarioId],purpose:'LEARNING',runId:'run_b',executionPlanId:'xplan_b',runtimeSnapshotId:'rts_b',createdAt:'2026-09-27T22:00:00.000Z',
 resolveRuntime:async()=>({environment:{environmentId:scope.environmentId,environmentType:'STG',name:'Synthetic test'},apiServices:{svc_b:{baseUrl:'https://test.example.com',apiServiceId:'svc_b',name:'Test API'}},authProfiles:{authp_b:{authProfileId:'authp_b',type:'api_key',config:{placement:'header',name:'Authorization',prefix:'Bearer '},credentialsConfigured:true}}}),
 resolveTestDataBindings:async()=>[],resolveObservedTestData:observed,loadSchemas:async()=>{throw Error('UNEXPECTED_SCHEMA_READ');},loadEndpoint:async()=>{throw Error('UNEXPECTED_CATALOG_READ');},...extra};
}
test('Analyze native 401 resolves ordinary id but never executes/applies/rewrites',async()=>{
 const s=scenario(),before=structuredClone(s),r=await analyze(s),i=r.data.items[0];assert.equal(i.status,'LEARNING_AVAILABLE');assert.equal(i.learning.allowed,true);assert.equal(i.learning.sourceExecutionStatus,'BLOCKED');assert.equal(i.learning.executionStatus,'READY');assert.equal(i.learning.admissionBasis,'STRUCTURED_READINESS_V2');assert.deepEqual(i.learning.resolvedIssueCodes,['PATH_PARAM_UNRESOLVED']);assert.equal(i.semanticDiagnostics.basis,'SYSTEM_STRUCTURED_READINESS_V2');assert.equal(i.learning.requiresRuntimePreflight,true);assert.equal(i.learning.dataResolution.noValuesExposed,true);assert.equal(r.data.executionStarted,false);assert.equal(r.data.appliedByThisOperation,false);assert.deepEqual(s,before);assert.ok(!JSON.stringify(r).includes('sampleFingerprint'));assert.ok(!JSON.stringify(r).includes('fixedValue'));
});
test('Analyze native coverage uses codes despite arbitrary legacy blockers',async()=>{
 const r=await analyze(scenario({coverage:true}));assert.equal(r.data.items[0].status,'LEARNING_AVAILABLE');assert.equal(r.data.items[0].learning.coverageStatus,'PARTIAL');assert.equal(r.data.items[0].learning.confirmationRequiresCoverage,true);
});
test('Analyze missing/cross-environment observed data is blocked without a run',async()=>{
 for(const samples of [[],[{...sample,environmentId:'env_other'}]]){
  const r=await analyze(scenario(),{deps:{resolveObservedTestData:a=>resolveObservedTestDataForRun({...a,loadSamples:async()=>samples})}});assert.equal(r.data.items[0].status,'BLOCKED');assert.equal(r.data.items[0].learning.allowed,false);assert.equal(r.data.items[0].learning.dataResolution.status,'UNRESOLVED');
 }
});
test('Analyze honors explicit FIXED and reveals no configured value',async()=>{
 const fixed={target:'PATH_PARAM',selector:'id',sourceType:'FIXED',valueType:'STRING',fixedValue:'explicit-value-private-13',bindingId:'tdb_b',origin:'USER_DEFINED'};
 const r=await analyze(scenario(),{deps:{resolveTestDataBindings:async()=>[fixed],resolveObservedTestData:async()=>{throw Error('OBSERVED_OVERRIDE_FORBIDDEN');}}});assert.equal(r.data.items[0].status,'LEARNING_AVAILABLE');assert.equal(r.data.items[0].learning.dataResolution.bindings[0].source,'FIXED');assert.ok(!JSON.stringify(r).includes(fixed.fixedValue));
});
test('Analyze never promotes invalid auth/fault injection into a data probe',async()=>{
 for(const code of ['AUTH_STRATEGY_NOT_MODELED','UNSUPPORTED_FAULT_INJECTION','SECRET_REQUIRED']){
  let reads=0;const r=await analyze(scenario({codes:[code]}),{deps:{resolveTestDataBindings:async()=>{reads++;return [];}}});assert.equal(r.data.items[0].status,'BLOCKED');assert.equal(reads,0);
 }
});
test('Analyze forbids forged browser admission input',async()=>{
 await assert.rejects(analyze(scenario(),{body:{readinessV2:{execution:{status:'READY'}}}}),{code:'LEARNING_RESOLUTION_INPUT_INVALID'});
});
test('Analyze refuses stale version and reader role without changing source',async()=>{
 const s=scenario();let r=await analyze(s,{deps:{getLatest:async()=>({exists:true,testDesign:{versionId:'tdv_other'}})}});assert.equal(r.data.items[0].errorCode,'LEARNING_SOURCE_VERSION_STALE');
 await assert.rejects(analyze(s,{deps:{requireTenant:async()=>({organizationId:scope.organizationId,organizationRole:'viewer'})}}),{code:'LEARNING_RESOLUTION_FORBIDDEN'});
});
test('materialization freezes observed id, preserves unauthenticated intent and v1 wire',async()=>{
 const s=scenario(),a=args(s),before=structuredClone(a.artifact);const out=await materializeExecutionPlanV1(a),p=out.executionPlan.scenarios[0];assert.equal(p.readiness,'NEEDS_DATA');assert.equal(out.executionPlan.purpose,'LEARNING');assert.equal(p.spec.auth.requirement,'UNAUTHENTICATED');assert.equal(p.spec.auth.authProfileRef,null);assert.equal(p.spec.testData.bindings[0].source,'FIXED');assert.equal(out.runtimeSnapshot.testData.fixed['PATH_PARAM:id@1:0'].value,'17');assert.equal(validExploratoryLearningAdmission(p),true);assert.deepEqual(a.artifact,before);assert.equal(p.readinessV2,undefined);assert.equal(out.executionPlan.contractVersion,'qagent.execution-plan.v1');
});
test('materialized partial coverage is executable without gaining regression maturity',async()=>{
 const s=scenario({coverage:true}),out=await materializeExecutionPlanV1(args(s));const p=out.executionPlan.scenarios[0];assert.ok(p.learningAdmission.deferredBlockers.includes('LEARNING_ASSERTION_COVERAGE_GAP'));assert.equal(validExploratoryLearningAdmission(p),true);assert.deepEqual(p.spec.assertions,s.spec.assertions);assert.equal(s.readinessV2.regression.status,'BLOCKED');
});
test('Run cannot bypass structured blocker with legacy READY label',async()=>{
 const s=scenario({path:'/items',codes:['AUTH_STRATEGY_NOT_MODELED']});s.automation={readiness:'READY',blockers:[]};await assert.rejects(materializeExecutionPlanV1(args(s)),e=>e.code==='RUN_SCENARIO_NOT_EXECUTABLE'&&e.publicDetails.blockers.includes('AUTH_STRATEGY_NOT_MODELED'));
});
test('materializer independently rejects missing runtime auth, wrong environment and missing samples',async()=>{
 const s=scenario({coverage:true});const a=args(s);const config=await a.resolveRuntime();delete config.authProfiles.authp_b;
 await assert.rejects(materializeExecutionPlanV1({...a,resolveRuntime:async()=>config}));
 await assert.rejects(materializeExecutionPlanV1(args(s,{resolveRuntime:async()=>({environment:{environmentId:'env_other'}})})),{code:'RUN_RUNTIME_SCOPE_MISMATCH'});
 await assert.rejects(materializeExecutionPlanV1(args(s,{resolveObservedTestData:x=>resolveObservedTestDataForRun({...x,loadSamples:async()=>[]})})),{code:'RUN_OBSERVED_TEST_DATA_CORRELATED_SAMPLE_MISSING'});
});
test('materializer refuses unresolved secret even when v2 metadata is permissive',async()=>{
 const s=scenario();s.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'PATH_PARAM',selector:'id',source:'SECRET',bindingKey:'PATH_PARAM:id',valueType:'STRING'}]};
 await assert.rejects(materializeExecutionPlanV1(args(s,{resolveTestDataBindings:async()=>[{target:'PATH_PARAM',selector:'id',sourceType:'SECRET',valueType:'STRING',secretId:null}]})),{code:'RUN_TEST_DATA_SECRET_NOT_CONFIGURED'});
});
test('native mutation, foreign artifact and implicit learning selection remain refused',async()=>{
 const s=scenario({path:'/items'});s.spec.target.method='POST';await assert.rejects(materializeExecutionPlanV1(args(s)),{code:'RUN_LEARNING_MUTATION_BLOCKED'});
 const a=args(scenario({path:'/items'}));a.artifact.organizationId='org_other';await assert.rejects(materializeExecutionPlanV1(a),{code:'RUN_TEST_DESIGN_INVALID'});
 await assert.rejects(materializeExecutionPlanV1(args(scenario({path:'/items'}),{requestedScenarioIds:null})),{code:'RUN_LEARNING_SELECTION_REQUIRED'});
});
test('REGRESSION policy is unchanged: v2 availability does not admit REVIEW_REQUIRED',async()=>{
 await assert.rejects(materializeExecutionPlanV1(args(scenario({path:'/items'}),{purpose:'REGRESSION'})),{code:'RUN_SCENARIO_NOT_EXECUTABLE'});
 const s=scenario({path:'/items'});s.automation={readiness:'READY',blockers:[]};const out=await materializeExecutionPlanV1(args(s,{purpose:'REGRESSION'}));assert.equal(out.executionPlan.scenarios[0].learningAdmission,undefined);
});
test('flag rollback returns legacy admission without deleting persisted native data',async()=>{
 const s=scenario({path:'/items'}),before=structuredClone(s);const r=await analyze(s,{env:{SCENARIO_READINESS_V2_ENABLED:'false'}});assert.equal(r.data.items[0].status,'BLOCKED');assert.equal(r.data.items[0].reason,'LEARNING_REVIEW_REASON_UNCLASSIFIED');await assert.rejects(materializeExecutionPlanV1(args(s,{env:{SCENARIO_READINESS_V2_ENABLED:'false'}})),{code:'RUN_SCENARIO_NOT_EXECUTABLE'});assert.deepEqual(s,before);
});
