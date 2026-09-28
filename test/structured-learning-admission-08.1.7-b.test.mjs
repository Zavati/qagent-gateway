import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLearningAdmission, buildLearningAdmissionForRunner, assessLearningProofSource, STRUCTURED_ADMISSION_BASIS } from '../src/readiness/learningAdmissionV2.js';
import { evaluateScenarioReadinessV2, projectLegacyReadiness } from '../src/readiness/scenarioReadinessV2.js';
import { buildReadinessIssue, READINESS_ISSUE_DEFINITIONS } from '../src/readiness/readinessIssues.js';
import { collectScenarioReadinessIssues } from '../src/readiness/scenarioReadinessFacts.js';
import { assessExploratoryLearning, validExploratoryLearningAdmission } from '../src/learningScenarioEligibility.js';
import { prepareExploratoryLearningData } from '../src/services/exploratoryLearningData.js';
const clone=structuredClone;
function fixture({codes=[],path='/items',method='GET',coverage=false,expectation={status:'HYPOTHESIS',basis:'AI_ASSUMED'}}={}){
 const s={scenarioId:'test_b',title:'Verificar resposta sem autenticação',objective:'Verificar rejeição 401',category:'AUTHORIZATION',priority:'HIGH',confidence:'LOW',grounding:{level:'ASSUMED',rationale:[],evidenceRefs:[],schemaRefs:[]},automation:{readiness:'REVIEW_REQUIRED',blockers:['texto da IA sem autoridade']},spec:{dslVersion:'qagent.api-test-dsl.v1',type:'api',target:{catalogEndpointId:'cep_b',apiServiceKey:'svc_b',method,path},auth:{requirement:'UNAUTHENTICATED',authProfileRef:null},request:{pathParams:{},query:{},headers:{}},assertions:[{type:'STATUS',expectedStatusCodes:[401]}],extract:[]}};
 if(coverage){s.title='Resposta com total';s.objective='$.meta.total deve ser number';s.category='SCHEMA_CONTRACT';s.spec.assertions=[{type:'STATUS',expectedStatusCodes:[200]},{type:'JSON_PATH_EXISTS',path:'$.meta.total'}];}
 s.readinessV2=evaluateScenarioReadinessV2({issues:[...collectScenarioReadinessIssues(s),...codes.map(c=>buildReadinessIssue(c))],expectation,learningPolicyAllows:['GET','HEAD','OPTIONS'].includes(method)});
 s.automation.readiness=projectLegacyReadiness(s.readinessV2);return s;
}
const assess=(s,extra={})=>assessLearningAdmission(s,{enabled:true,...extra});
test('B1 ASSUMED 401 is admitted without regression promotion or source mutation',()=>{
 const s=fixture(),before=clone(s),a=assess(s);assert.equal(a.allowed,true);assert.equal(a.admissionBasis,STRUCTURED_ADMISSION_BASIS);assert.equal(a.executionStatus,'READY');assert.equal(a.expectationStatus,'HYPOTHESIS');assert.deepEqual(a.deferredBlockers,['LEARNING_HYPOTHESIS_UNVERIFIED']);assert.equal(s.readinessV2.regression.status,'BLOCKED');assert.deepEqual(s,before);
});
test('B2 explicit number coverage gap allows evidence collection, not confirmation',()=>{
 const s=fixture({coverage:true}),a=assess(s);assert.equal(a.allowed,true);assert.equal(a.coverageStatus,'PARTIAL');assert.equal(a.confirmationRequiresCoverage,true);assert.ok(a.issueCodes.includes('ASSERTION_TYPE_REQUIRED'));assert.equal(a.coverageGaps[0].expectedType,'number');
});
test('B3 arbitrary presentation text and legacy label cannot change native decision',()=>{
 const s=fixture();const expected=assess(s);
 for(const blockers of [[],['Precisa de revisão'],['random new language'],['LEARNING_MUTATION_NOT_ALLOWED'],['secret=NEVER_ECHO']])for(const readiness of ['READY','REVIEW_REQUIRED','NEEDS_DATA','NEEDS_AUTH','ANY_LABEL']){
  const v=clone(s);v.automation={readiness,blockers};v.automationHints={reviewRequired:true};assert.deepEqual(assess(v),expected);assert.ok(!JSON.stringify(assess(v)).includes('NEVER_ECHO'));
 }
});
test('native policy does not even access automation.blockers',()=>{
 const s=fixture();Object.defineProperty(s.automation,'blockers',{get(){throw Error('legacy parser touched native');}});assert.equal(assess(s).allowed,true);
});
test('B4 unknown legacy blocker fails closed even with READY label',()=>{
 const s=fixture();delete s.readinessV2;s.automation={readiness:'READY',blockers:['unknown rule']};const a=assess(s);assert.equal(a.allowed,false);assert.equal(a.admissionBasis,'LEGACY_PROJECTION');
});
test('legacy known uncertainty still uses conservative adapter',()=>{
 const s=fixture();delete s.readinessV2;s.automation.blockers=['O cenário contém hipótese que precisa de revisão humana.'];const a=assess(s);assert.equal(a.allowed,true);assert.equal(a.admissionBasis,'LEGACY_PROJECTION');
});
for(const method of ['POST','PUT','PATCH','DELETE'])test(`B5 ${method} remains blocked regardless legacy label`,()=>{
 const s=fixture({method});s.automation.readiness='READY';assert.equal(assess(s).allowed,false);assert.equal(assess(s).reason,'LEARNING_MUTATION_NOT_ALLOWED');
});
for(const method of ['GET','HEAD','OPTIONS'])test(`${method} follows the safe path`,()=>assert.equal(assess(fixture({method})).allowed,true));
test('missing id may prepare privately, but is not admitted before resolution',()=>{
 const s=fixture({path:'/items/{id}'}),before=clone(s),first=assess(s);assert.equal(first.allowed,false);assert.equal(first.preparationAllowed,true);assert.equal(first.executionStatus,'BLOCKED');
 const p=prepareExploratoryLearningData(s,[],{readinessV2Enabled:true});const after=assess(s,{preparedScenario:p});assert.equal(after.allowed,true);assert.equal(after.executionStatus,'READY');assert.equal(after.sourceExecutionStatus,'BLOCKED');assert.deepEqual(after.resolvedIssueCodes,['PATH_PARAM_UNRESOLVED']);assert.equal(p.spec.auth.requirement,'UNAUTHENTICATED');assert.equal(p.spec.testData.bindings[0].source,'OBSERVED');assert.deepEqual(s,before);
});
test('inexistent resource cannot borrow a positive observed identifier',()=>{
 const s=fixture({path:'/items/{id}'});s.category='NEGATIVE';s.title='Recurso inexistente';s.objective='Retorna 404 para recurso inexistente';s.spec.assertions[0].expectedStatusCodes=[404];
 const a=assess(s);assert.equal(a.allowed,false);assert.equal(a.preparationAllowed,false);assert.equal(a.reason,'LEARNING_CONDITION_DATA_REQUIRED');
 assert.throws(()=>prepareExploratoryLearningData(s,[],{readinessV2Enabled:true}));
});
test('private preparation cannot change auth, target, assertions or readiness',()=>{
 const s=fixture({path:'/items/{id}'});for(const change of [p=>p.spec.auth.requirement='NONE',p=>p.spec.target.path='/other',p=>p.spec.assertions[0].expectedStatusCodes=[200],p=>p.readinessV2.execution.status='READY']){
  const p=prepareExploratoryLearningData(s,[],{readinessV2Enabled:true});change(p);assert.equal(assess(s,{preparedScenario:p}).reason,'LEARNING_PREPARATION_SOURCE_MISMATCH');
 }
});
test('stale permissive snapshot cannot bypass actual missing auth or inline secrets',()=>{
 const s=fixture();s.spec.auth={requirement:'REQUIRED',authProfileRef:null};assert.equal(assess(s).allowed,false);assert.ok(assess(s).blockers.includes('AUTH_PROFILE_REQUIRED'));
 const t=fixture();t.spec.request.headers.Authorization='NEVER_LOG_CREDENTIAL';assert.equal(assess(t).allowed,false);assert.ok(assess(t).blockers.includes('SECRET_REQUIRED'));assert.ok(!JSON.stringify(assess(t)).includes('NEVER_LOG_CREDENTIAL'));
});
test('A4 invalid auth intent remains HUMAN_REQUIRED and not learnable',()=>{
 const s=fixture();s.title='Autenticação inválida';s.objective='Credencial expirada';assert.equal(assess(s).allowed,false);assert.ok(assess(s).blockers.includes('AUTH_STRATEGY_NOT_MODELED'));
});
test('A5 unsupported fault injection remains blocked',()=>{
 const a=assess(fixture({codes:['UNSUPPORTED_FAULT_INJECTION']}));assert.equal(a.allowed,false);assert.equal(a.coverageStatus,'UNSUPPORTED');
});
test('all technical/human catalog codes fail closed; only ordinary PATH may prepare',()=>{
 for(const [code,d] of Object.entries(READINESS_ISSUE_DEFINITIONS)){
  if(!d.blocksExecution&&!d.humanRequired)continue;
  const a=assess(fixture({codes:[code]}));assert.equal(a.allowed,false,code);if(code!=='PATH_PARAM_UNRESOLVED')assert.equal(a.preparationAllowed,false,code);
 }
});
for(const [label,mutate] of [
 ['null snapshot',s=>s.readinessV2=null],['wrong version',s=>s.readinessV2.contractVersion='unknown'],['unknown enum',s=>s.readinessV2.execution.status='YES'],['unknown field',s=>s.readinessV2.extra='ignore guards'],['weakened issue',s=>s.readinessV2.issues[0].blocksExecution=false],['unknown issue',s=>s.readinessV2.issues[0].code='UNKNOWN_CODE'],['duplicate issue',s=>s.readinessV2.issues.push(s.readinessV2.issues[0])],['unknown basis',s=>s.readinessV2.basis='AI_APPROVED']
])test(`invalid v2 has no legacy downgrade: ${label}`,()=>{const s=fixture({codes:['AUTH_PROFILE_REQUIRED']});s.automation={readiness:'READY',blockers:[]};mutate(s);assert.equal(assess(s).allowed,false);assert.equal(assess(s).reason,'SCENARIO_READINESS_V2_INVALID');});
test('baseline is delegated to existing protected policy, never generic admission',()=>{
 const s=fixture();s.generationClass='OBSERVED_BASELINE';assert.equal(assess(s).reason,'LEARNING_BASELINE_REQUIRES_EXISTING_POLICY');
});
test('contradiction remains blocked; UNKNOWN remains knowledge rather than operational debt',()=>{
 assert.equal(assess(fixture({expectation:{status:'CONTRADICTED',basis:'COMPATIBLE_CONTRADICTION'}})).allowed,false);
 assert.equal(assess(fixture({expectation:{status:'UNKNOWN',basis:'UNDETERMINED'}})).allowed,true);
});
test('flag off preserves exact legacy assessment result',()=>{
 for(const s of [fixture(),fixture({coverage:true}),fixture({path:'/items/{id}'})])assert.deepEqual(assessLearningAdmission(s,{enabled:false}),assessExploratoryLearning(s));
});
test('v1 Runner wire validates native hypothesis and partial coverage without text',()=>{
 for(const s of [fixture(),fixture({coverage:true}),fixture({path:'/items/{id}'})]){
  const p=prepareExploratoryLearningData(s,[],{readinessV2Enabled:true});const a=buildLearningAdmissionForRunner(s,p,{enabled:true});assert.ok(a);
  assert.equal(validExploratoryLearningAdmission({scenarioId:s.scenarioId,title:s.title,category:s.category,spec:p.spec,readiness:a.sourceReadiness,learningAdmission:a}),true);
  assert.deepEqual(Object.keys(a).sort(),['contractVersion','deferredBlockers','sourceReadiness']);
 }
});
test('proof mode is explicit: old proofs retain old policy, marked native proofs use v2',()=>{
 const s=fixture();assert.equal(assessLearningProofSource(s).allowed,false);assert.equal(assessLearningProofSource(s,STRUCTURED_ADMISSION_BASIS).allowed,true);
 delete s.readinessV2;assert.equal(assessLearningProofSource(s,STRUCTURED_ADMISSION_BASIS).allowed,false);
});
