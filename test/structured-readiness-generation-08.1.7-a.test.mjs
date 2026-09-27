import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCatalogTestDesignV1 } from '../src/intelligence/testDesignService.js';
import { validateTestDesignModelOutputV1, validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';
import { applySemanticGroundingGuardV1 } from '../src/intelligence/semanticGroundingGuard.js';
import { applyObservedAuthSignalBridgeV1 } from '../src/intelligence/observedAuthSignalBridge.js';
import { applyTestDataPlannerV1 } from '../src/intelligence/testDataPlanner.js';
import { attachNativeScenarioReadiness } from '../src/intelligence/structuredReadiness.js';
const contextTemplate = {
  contractVersion: 'qagent.test-design.v1',
  organizationId: 'org_0763',
  projectId: 'prj_0763',
  endpoint: {
    endpointId: 'cep_token_list',
    serviceId: 'svc_gateway',
    serviceName: 'apigtw.example.com',
    classification: 'FIRST_PARTY_API',
    classificationConfidence: 94,
    method: 'GET',
    normalizedPath: '/core-api/api-token-list',
    discoveryConfidenceScore: 79,
    discoveryConfidenceLevel: 'HIGH',
    lifecycleState: 'DISCOVERED',
    observationCount: 31,
    sessionCount: 2,
    environmentCount: 1,
    successRatePct: 100,
    latencyAvgMs: 534.26,
    firstSeenAt: '2026-08-16T17:48:43.913Z',
    lastSeenAt: '2026-08-17T00:15:01.187Z',
  },
  schemas: [
    {
      trackId: 'track_response_200',
      direction: 'RESPONSE',
      statusCode: 200,
      currentVersionId: 'sv_response_2',
      currentSchemaHash: 'hash_response_2',
      contentTypes: ['application/json'],
      schema: { type: 'object', properties: { contents: { type: 'array' }, count: { type: 'integer' } } },
      versions: [
        { versionId: 'sv_response_2', schemaHash: 'hash_response_2', observationCount: 6, introducedAt: '2026-08-17T00:00:00.000Z' },
        { versionId: 'sv_response_1', schemaHash: 'hash_response_1', observationCount: 25, introducedAt: '2026-08-16T17:48:43.913Z' },
      ],
    },
  ],
  evidence: [
    {
      evidenceId: 'ev_200_latest', observedAt: '2026-08-17T00:15:01.187Z', environmentId: 'env_hml',
      outcome: 'HTTP_2XX', statusCode: 200, latencyMs: 481, sourceHost: 'apigtw.example.com', sessionId: 'obs_1',
      requestSchemaVersionId: null, responseSchemaVersionId: 'sv_response_2',
    },
  ],
  environments: [
    { environmentId: 'env_hml', name: 'Homologação', observationCount: 31, successRatePct: 100, lastSeenAt: '2026-08-17T00:15:01.187Z' },
  ],
  runtime: {
    apiServiceKey: null,
    defaultAuthProfileRef: null,
    availableAuthProfileRefs: [],
  },
};
function context() {
 const c=structuredClone(contextTemplate);c.runtime.apiServiceKey='svc_orders';c.endpoint.normalizedPath='/orders';
 c.schemas[0].schema={type:'object',properties:{meta:{type:'object',properties:{total:{type:'number'}}}}};
 return c;
}
function output() {
 return {title:'Observed orders',objective:'Validate the observed API',assumptions:[],scenarios:[{
  scenarioId:'s1',title:'Observed response',objective:'Validate observed HTTP status',category:'HAPPY_PATH',priority:'HIGH',confidence:'HIGH',
  grounding:{level:'OBSERVED',rationale:['Observed evidence'],evidenceRefs:['ev_200_latest'],schemaRefs:[]},preconditions:[],authRequirement:'NONE',
  request:{pathParams:{},query:{},headers:{},body:null},assertions:[{type:'STATUS',expectedStatusCodes:[200]}],extract:[],
  automationHints:{needsData:false,reviewRequired:false,reasons:[]}}]};
}
async function generate(model=output(),c=context(),enabled=true) {
 const logs=[], calls=[];
 const env={SCENARIO_READINESS_V2_ENABLED:String(enabled),OBSERVED_BASELINE_GENERATION_ENABLED:'false',log:(event,fields)=>logs.push({event,...fields})};
 const result=await generateCatalogTestDesignV1({env,organizationId:c.organizationId,projectId:c.projectId,endpointId:c.endpoint.endpointId,accountId:'account_fixture',
  aiEngine:{generateJson:async()=>{calls.push('generate');return {json:structuredClone(model),provider:'openai',model:'fixture'};},repairJson:async()=>{throw new Error('Unexpected model repair');}},
  contextBuilder:async()=>({context:c,contextFingerprint:'a'.repeat(64),diagnostics:{}}),
  resolveAiConfig:async()=>({source:'account',provider:'openai',model:'fixture',credentials:{apiKey:'SECRET_SENTINEL'}}),
  now:()=>new Date('2026-09-27T12:00:00Z')});
 return {...result,logs,calls};
}
test('generation A1: unobserved 401/ASSUMED remains operationally ready but not regression',async()=>{
 const o=output(),s=o.scenarios[0];s.title='Sem autenticação';s.objective='Validar resposta 401 sem autenticação';s.category='AUTHORIZATION';s.confidence='MEDIUM';s.authRequirement='UNAUTHENTICATED';s.grounding={level:'ASSUMED',rationale:['Hipótese ainda não observada'],evidenceRefs:[],schemaRefs:[]};s.assertions=[{type:'STATUS',expectedStatusCodes:[401]}];s.automationHints.reviewRequired=true;
 const result=await generate(o),r=result.specification.scenarios[0].readinessV2;
 assert.deepEqual([r.execution.status,r.expectation.status,r.coverage.status,r.review.status,r.regression.status],['READY','HYPOTHESIS','COMPLETE','LEARNING_AVAILABLE','BLOCKED']);assert.equal(result.specification.scenarios[0].automation.readiness,'REVIEW_REQUIRED');
});
test('generation A2: objective number plus presence assertion creates coverage gap',async()=>{
 const o=output();o.scenarios[0].title='meta.total number';o.scenarios[0].objective='Validar que $.meta.total é number';o.scenarios[0].assertions.push({type:'JSON_PATH_EXISTS',path:'$.meta.total'});o.scenarios[0].grounding.schemaRefs=['sv_response_2'];
 const r=(await generate(o)).specification.scenarios[0].readinessV2;assert.equal(r.execution.status,'READY');assert.equal(r.coverage.status,'PARTIAL');assert.equal(r.review.status,'LEARNING_AVAILABLE');assert.ok(r.issues.some(i=>i.code==='ASSERTION_TYPE_REQUIRED'));
});
test('generation A3: final planner owns unresolved id data',async()=>{
 const c=context();c.endpoint.normalizedPath='/orders/{id}';const o=output();o.scenarios[0].request.pathParams={id:'{id}'};
 const r=(await generate(o,c)).specification.scenarios[0].readinessV2;assert.equal(r.execution.status,'BLOCKED');assert.ok(r.issues.some(i=>i.kind==='DATA_DEPENDENCY'&&i.code==='PATH_PARAM_UNRESOLVED'));
});
test('generation A4: invalid credential intent cannot borrow a normal profile',async()=>{
 const o=output();o.scenarios[0].title='Autenticação inválida';o.scenarios[0].objective='Validar token expirado';
 const r=(await generate(o)).specification.scenarios[0].readinessV2;assert.equal(r.execution.status,'BLOCKED');assert.equal(r.review.status,'HUMAN_REQUIRED');assert.ok(r.issues.some(i=>i.code==='AUTH_STRATEGY_NOT_MODELED'));
});
test('generation A5: fault injection is a capability/operational blocker',async()=>{
 const o=output();o.scenarios[0].title='Fault injection';o.scenarios[0].objective='Simular erro interno do servidor';o.scenarios[0].category='NEGATIVE';o.scenarios[0].assertions=[{type:'STATUS',expectedStatusCodes:[500]}];
 const r=(await generate(o)).specification.scenarios[0].readinessV2;assert.equal(r.execution.status,'BLOCKED');assert.equal(r.coverage.status,'UNSUPPORTED');assert.equal(r.review.status,'HUMAN_REQUIRED');assert.ok(r.issues.some(i=>i.code==='UNSUPPORTED_FAULT_INJECTION'&&i.source==='SEMANTIC_GUARD'));
});
test('AI review hint alone is not a native authority; flag off retains original output',async()=>{
 const o=output();o.scenarios[0].automationHints={needsData:false,reviewRequired:true,reasons:['Arbitrary model uncertainty']};
 const on=await generate(o),off=await generate(o,context(),false),clear=output();const clean=await generate(clear);
 assert.deepEqual(on.specification.scenarios[0].readinessV2,clean.specification.scenarios[0].readinessV2);assert.equal(on.specification.scenarios[0].automation.readiness,'READY');assert.deepEqual(on.specification.scenarios[0].automation.blockers,[]);
 assert.equal(off.specification.scenarios[0].automation.readiness,'REVIEW_REQUIRED');assert.ok(!Object.hasOwn(off.specification.scenarios[0],'readinessV2'));assert.ok(on.logs.some(l=>l.event==='scenario_readiness_v2_computed'&&l.ignoredAiReviewHintCount===1));assert.ok(!JSON.stringify(on).includes('SECRET_SENTINEL'));assert.deepEqual(on.calls,['generate']);
});
test('AI cannot supply readinessV2, structured issues or false verification',()=>{
 for(const extra of [{readinessV2:{}},{issues:[]},{uncertaintyHints:[]}]){const o=output();Object.assign(o.scenarios[0],extra);assert.throws(()=>validateTestDesignModelOutputV1(o,context()));}
});
test('all semantic issues survive the old 40-item diagnostic truncation',()=>{
 const o=output(),base=o.scenarios[0];o.scenarios=Array.from({length:20},(_,i)=>({...structuredClone(base),scenarioId:'s'+i,title:'Fault injection',objective:'Simular erro interno do servidor',assertions:[{type:'STATUS',expectedStatusCodes:[500]},{type:'JSON_PATH_EXISTS',path:'$.unmodeled'}]}));
 const result=applySemanticGroundingGuardV1(o,context());assert.ok(result.diagnostics.issueCount>40);assert.equal(result.diagnostics.issues.length,40);assert.ok(result.readinessIssuesByScenarioId.s19.some(i=>i.code==='UNSUPPORTED_FAULT_INJECTION'));
});
test('auth bridge emits structured configuration/mixed-observation issues',()=>{
 const c=context();c.runtime.authObservation={status:'REQUIRED',scheme:'BEARER',evidenceRefs:[]};let r=applyObservedAuthSignalBridgeV1(output(),c);assert.ok(r.readinessIssuesByScenarioId.s1.some(i=>i.code==='AUTH_PROFILE_REQUIRED'));
 c.runtime.authObservation.status='MIXED';r=applyObservedAuthSignalBridgeV1(output(),c);assert.ok(r.readinessIssuesByScenarioId.s1.some(i=>i.code==='AUTH_OBSERVATION_MIXED'));
});
test('planner emits structured missing-data issues independently from hints',()=>{
 const c=context();c.endpoint.normalizedPath='/orders/{id}';const o=output();o.scenarios[0].request.pathParams={id:'{id}'};
 const r=applyTestDataPlannerV1(o,c);assert.ok(r.readinessIssuesByScenarioId.s1.some(i=>i.code==='PATH_PARAM_UNRESOLVED'&&i.source==='TEST_DATA_PLANNER'));
});
test('native legacy projection and summary pass complete specification validation',async()=>{
 const c=context(),r=await generate(output(),c);assert.doesNotThrow(()=>validateTestSpecificationV1(r.specification,c));assert.equal(r.specification.summary.readyCount,1);
 const s=r.specification.scenarios[0];s.readinessV2.execution.status='BLOCKED';assert.throws(()=>validateTestSpecificationV1(r.specification,c));
});
test('mutation receives no Learning candidate/admission expansion',async()=>{
 const c=context();c.endpoint.method='POST';const r=(await generate(output(),c)).specification.scenarios[0].readinessV2;assert.notEqual(r.review.status,'LEARNING_AVAILABLE');assert.equal(r.evaluationScope,'TEST_DESIGN_ONLY');
});

test('native baseline fallback preserves protected provenance, assertions and references',async()=>{
 const fs=await import('node:fs');const f=JSON.parse(fs.readFileSync(new URL('./fixtures/baseline-fixture.json',import.meta.url)));const c=f.context,sourceBefore=JSON.stringify(f.source);
 const result=await generateCatalogTestDesignV1({env:{SCENARIO_READINESS_V2_ENABLED:'true',OBSERVED_BASELINE_GENERATION_ENABLED:'true',log:()=>{}},organizationId:c.organizationId,projectId:c.projectId,endpointId:c.endpoint.endpointId,accountId:'fixture',
  contextBuilder:async()=>({context:c,contextFingerprint:'a'.repeat(64),diagnostics:{}}),loadBaselines:async()=>({items:[f.source]}),loadPrevious:async()=>null,
  resolveAiConfig:async()=>({source:'account',provider:'openai',model:'fixture',credentials:{apiKey:'SECRET_SENTINEL'}}),aiEngine:{generateJson:async()=>{throw Object.assign(new Error('Offline fixture'),{code:'AI_UNAVAILABLE'});}},now:()=>new Date('2026-09-27T12:00:00Z')});
 const s=result.specification.scenarios[0];assert.equal(s.generationClass,'OBSERVED_BASELINE');assert.equal(s.readinessV2.basis,'NATIVE_V2');assert.equal(s.readinessV2.expectation.status,'EVIDENCED');assert.equal(s.readinessV2.regression.status,'READY');assert.equal(JSON.stringify(f.source),sourceBefore);
 assert.deepEqual(s.spec.assertions,f.specification.scenarios[0].spec.assertions);assert.deepEqual(s.baseline.source,f.specification.scenarios[0].baseline.source);assert.doesNotThrow(()=>validateTestSpecificationV1(result.specification,c));assert.ok(!JSON.stringify(result).includes('SECRET_SENTINEL'));
});
