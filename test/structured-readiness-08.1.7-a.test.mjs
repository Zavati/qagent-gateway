import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessIssue as issue, READINESS_ISSUE_DEFINITIONS, normalizeReadinessIssues, validateReadinessIssue } from '../src/readiness/readinessIssues.js';
import { evaluateScenarioReadinessV2 as evaluate, projectLegacyReadiness as legacy, validateScenarioReadinessV2 as validate, validateScenarioReadinessAttachment, scenarioReadinessV2Enabled } from '../src/readiness/scenarioReadinessV2.js';
import { collectScenarioReadinessIssues, validateReadinessAgainstScenario } from '../src/readiness/scenarioReadinessFacts.js';
import { adaptLegacyScenarioReadiness as adapt, readScenarioReadinessV2 } from '../src/readiness/legacyReadinessAdapter.js';
import { assessExploratoryLearning } from '../src/learningScenarioEligibility.js';
const evidenced = { status: 'EVIDENCED', basis: 'OBSERVED_EVIDENCE' };
const hypothesis = { status: 'HYPOTHESIS', basis: 'AI_ASSUMED' };
function scenario() {
 return {scenarioId:'s1',title:'List orders',objective:'Validate observed status',category:'HAPPY_PATH',generationClass:'AI_EXPLORATORY',
  grounding:{level:'OBSERVED',evidenceRefs:['ev_1'],schemaRefs:[]},automation:{readiness:'READY',blockers:[]},
  spec:{target:{apiServiceKey:'orders',method:'GET',path:'/orders'},auth:{requirement:'NONE',authProfileRef:null},request:{pathParams:{},query:{},headers:{},body:null},assertions:[{type:'STATUS',expectedStatusCodes:[200]}]}};
}
test('A1: hypothesis is executable, not regression-ready or human-required',()=>{
 const r=evaluate({expectation:hypothesis,learningPolicyAllows:true});
 assert.deepEqual([r.execution.status,r.expectation.status,r.coverage.status,r.review.status,r.regression.status],['READY','HYPOTHESIS','COMPLETE','LEARNING_AVAILABLE','BLOCKED']);assert.equal(legacy(r),'REVIEW_REQUIRED');
});
test('A2: assertion coverage is independent from execution/expectation',()=>{
 const s=scenario();s.objective='Assert $.meta.total is number';s.spec.assertions.push({type:'JSON_PATH_EXISTS',path:'$.meta.total'});
 const r=evaluate({expectation:evidenced,issues:collectScenarioReadinessIssues(s),learningPolicyAllows:true});
 assert.deepEqual([r.execution.status,r.expectation.status,r.coverage.status,r.review.status,r.regression.status],['READY','EVIDENCED','PARTIAL','LEARNING_AVAILABLE','BLOCKED']);assert.ok(r.coverage.gapCodes.includes('ASSERTION_TYPE_REQUIRED'));
});
test('A3: unresolved path blocks request, data precedes other legacy causes',()=>{
 const s=scenario();s.spec.target.path='/orders/{id}';s.spec.auth={requirement:'REQUIRED',authProfileRef:null};
 const r=evaluate({expectation:evidenced,issues:collectScenarioReadinessIssues(s)});assert.equal(r.execution.status,'BLOCKED');assert.equal(legacy(r),'NEEDS_DATA');
 const i=r.issues.find(i=>i.code==='PATH_PARAM_UNRESOLVED');assert.equal(i.kind,'DATA_DEPENDENCY');assert.equal(i.resolution,'REQUEST_DESIGNER');
});
test('A4: invalid authentication strategy requires a human',()=>{
 const s=scenario();s.objective='Validate expired token authentication';const r=evaluate({expectation:hypothesis,issues:collectScenarioReadinessIssues(s),learningPolicyAllows:true});
 assert.equal(r.execution.status,'BLOCKED');assert.equal(r.review.status,'HUMAN_REQUIRED');assert.ok(r.issues.some(i=>i.code==='AUTH_STRATEGY_NOT_MODELED'));
});
test('A5: fault injection unsupported blocks execution and coverage',()=>{
 const r=evaluate({expectation:hypothesis,issues:[issue('UNSUPPORTED_FAULT_INJECTION','SEMANTIC_GUARD')],learningPolicyAllows:true});
 assert.deepEqual([r.execution.status,r.coverage.status,r.review.status,r.regression.status],['BLOCKED','UNSUPPORTED','HUMAN_REQUIRED','BLOCKED']);
});
test('complete supported evidence projects READY',()=>{const r=evaluate({expectation:evidenced});assert.equal(legacy(r),'READY');assert.equal(r.review.status,'NONE');});
test('auth and environment preserve compatibility precedence',()=>{
 const auth=issue('AUTH_PROFILE_REQUIRED'),env=issue('RUNTIME_TARGET_MISSING');assert.equal(legacy(evaluate({issues:[env,auth]})),'NEEDS_AUTH');assert.equal(legacy(evaluate({issues:[env]})),'NEEDS_ENVIRONMENT');
});
test('human-required issue takes precedence over learning and proposals',()=>{
 const r=evaluate({expectation:hypothesis,issues:[issue('HUMAN_BUSINESS_RULE_REQUIRED')],learningPolicyAllows:true,proposalAvailable:true});assert.equal(r.review.status,'HUMAN_REQUIRED');
});
test('unknown expectations never become regression ready',()=>{assert.equal(evaluate().regression.status,'BLOCKED');});
test('all registered issue codes retain fixed safety flags and deterministic derivation',()=>{
 for(const code of Object.keys(READINESS_ISSUE_DEFINITIONS))for(const expectation of [evidenced,hypothesis,{status:'UNKNOWN',basis:'UNDETERMINED'}]) {
  const i=issue(code),r=evaluate({issues:[i],expectation,learningPolicyAllows:true});validate(r);assert.equal(r.execution.status,i.blocksExecution?'BLOCKED':'READY');assert.equal(r.regression.status,'BLOCKED');
 }
});
test('issue catalog is closed and safety flags cannot be weakened',()=>{
 assert.throws(()=>issue('MADE_UP'));assert.throws(()=>issue('AUTH_PROFILE_REQUIRED','AI'));
 const i=issue('PATH_PARAM_UNRESOLVED');for(const key of ['blocksExecution','blocksRegression'])assert.throws(()=>validateReadinessIssue({...i,[key]:false}));
 assert.throws(()=>validateReadinessIssue({...i,detail:'password=SECRET_SENTINEL'}));
});
test('issues are deduplicated, order-independent and do not mutate producers',()=>{
 const issues=[issue('AUTH_PROFILE_REQUIRED'),issue('PATH_PARAM_UNRESOLVED'),issue('AUTH_PROFILE_REQUIRED')],before=structuredClone(issues);
 assert.deepEqual(evaluate({issues}),evaluate({issues:[...issues].reverse()}));assert.equal(normalizeReadinessIssues(issues).length,2);assert.deepEqual(issues,before);
});
test('JSON object property order is not contract meaning',()=>{
 const r=evaluate({expectation:evidenced});r.execution={reasonCodes:[],status:'READY'};assert.doesNotThrow(()=>validate(r));
});
test('invalid enums, unknown fields, inconsistent states and reason codes fail closed',()=>{
 for(const edit of [r=>r.execution.status='MAYBE',r=>r.coverage.status='UNKNOWN',r=>r.expectation.basis='AI_VERIFIED',r=>r.review.reasonCodes=['FAKE'],r=>r.regression.status='READY',r=>r.token='SECRET_SENTINEL']) {
  const r=evaluate({expectation:hypothesis});edit(r);assert.throws(()=>validate(r));
 }
});
test('input issue overflow fails instead of truncating safety authority',()=>{assert.throws(()=>evaluate({issues:Array(2049).fill(issue('AUTH_PROFILE_REQUIRED'))}));});
test('feature flag is global, disabled by default and strict',()=>{
 for(const value of [undefined,'false','yes','',0,'on'])assert.equal(scenarioReadinessV2Enabled({SCENARIO_READINESS_V2_ENABLED:value}),false);
 for(const value of [true,'TRUE',' true ',1,'1'])assert.equal(scenarioReadinessV2Enabled({SCENARIO_READINESS_V2_ENABLED:value}),true);
});
test('legacy ASSUMED adapter is virtual and keeps persisted bytes unchanged',()=>{
 const s=scenario();s.grounding.level='ASSUMED';s.automation={readiness:'REVIEW_REQUIRED',blockers:['O cenário contém hipótese que precisa de revisão humana.']};
 const before=JSON.stringify(s),r=adapt(s);assert.equal(r.basis,'LEGACY_PROJECTION');assert.equal(r.execution.status,'READY');assert.equal(r.expectation.status,'HYPOTHESIS');assert.equal(r.review.status,'LEARNING_AVAILABLE');assert.equal(JSON.stringify(s),before);
});
test('legacy unknown blockers remain fail-closed with value-free issues',()=>{
 const s=scenario();s.automation.blockers=['Unknown policy password=SECRET_SENTINEL'];const r=adapt(s);assert.equal(r.execution.status,'BLOCKED');assert.equal(r.review.status,'HUMAN_REQUIRED');assert.ok(!JSON.stringify(r).includes('SECRET_SENTINEL'));
});
test('missing legacy state remains fail-closed',()=>{const s=scenario();delete s.automation;assert.equal(adapt(s).execution.status,'BLOCKED');});
test('present invalid v2 is rejected rather than silently legacy-projected',()=>{const s=scenario();s.readinessV2=null;assert.throws(()=>readScenarioReadinessV2(s));});
test('native fields cannot hide operational dependencies or inconsistent legacy projection',()=>{
 const s=scenario();s.readinessV2=evaluate({expectation:evidenced});s.spec.target.path='/orders/{id}';assert.throws(()=>validateReadinessAgainstScenario(s));
 s.spec.target.path='/orders';s.automation.readiness='NEEDS_DATA';assert.throws(()=>validateScenarioReadinessAttachment(s));
});
test('phase A rejects persisted VERIFIED/CONTRADICTED/proposal authority on generation',()=>{
 for(const expectation of [{status:'VERIFIED',basis:'VERSION_VERIFICATION'},{status:'CONTRADICTED',basis:'COMPATIBLE_CONTRADICTION'}]) {
  const s=scenario();s.readinessV2=evaluate({expectation});s.automation.readiness=legacy(s.readinessV2);assert.throws(()=>validateScenarioReadinessAttachment(s,{generation:true}));
 }
 const s=scenario();s.readinessV2=evaluate({expectation:hypothesis,proposalAvailable:true});s.automation.readiness='REVIEW_REQUIRED';assert.throws(()=>validateScenarioReadinessAttachment(s,{generation:true}));
});
test('negative and secret guards are independent from AI flags',()=>{
 const s=scenario();s.spec.auth={requirement:'UNAUTHENTICATED',authProfileRef:'profile'};s.spec.request.headers={Authorization:'Bearer SECRET_SENTINEL'};
 const issues=collectScenarioReadinessIssues(s);assert.ok(issues.some(i=>i.code==='AUTH_INTENT_CONFLICT'));assert.ok(issues.some(i=>i.code==='SECRET_REQUIRED'));assert.ok(!JSON.stringify(issues).includes('SECRET_SENTINEL'));
});
test('configured path bindings remain materializable while unconfigured secrets block',()=>{
 const s=scenario();s.spec.target.path='/orders/{id}';s.spec.testData={bindings:[{target:'PATH_PARAM',selector:'id',source:'GENERATED',generator:{kind:'UUID'}}]};
 assert.ok(!collectScenarioReadinessIssues(s).some(i=>i.code==='PATH_PARAM_UNRESOLVED'));s.spec.testData.bindings[0]={target:'PATH_PARAM',selector:'id',source:'SECRET'};assert.ok(collectScenarioReadinessIssues(s).some(i=>i.code==='SECRET_REQUIRED'));
});
test('clones and pending request derivations do not inherit verified maturity',()=>{
 for(const metadata of [{scenarioLifecycle:{kind:'SCENARIO_CLONE'}},{requestManagement:{phase:'PENDING_VERIFICATION'}},{learning:{phase:'PENDING_VERIFICATION'}}]) {
  const s={...scenario(),...metadata};const r=adapt(s);assert.equal(r.expectation.status,'HYPOTHESIS');assert.equal(r.expectation.basis,'DERIVATION_PENDING_VERIFICATION');assert.equal(r.regression.status,'BLOCKED');
 }
});
test('baseline protections/provenance are retained; no baseline Learning expansion',()=>{
 const s=scenario();s.generationClass='OBSERVED_BASELINE';s.baseline={baselineId:'obl1',source:{evidenceId:'ev1'},expiresAt:'2026-01-01T00:00:00Z',requestCoverage:{status:'COMPLETE'},responseCoverage:{status:'COMPLETE'},selfCheck:'PASSED'};
 const r=adapt(s,{nowMs:Date.parse('2026-09-27T00:00:00Z')});assert.equal(r.execution.status,'BLOCKED');assert.notEqual(r.review.status,'LEARNING_AVAILABLE');assert.ok(r.issues.some(i=>i.code==='OBSERVED_BASELINE_SOURCE_EXPIRED'));
});
test('v2 attachment does not authorize or change existing Learning admission',()=>{
 const s=scenario();s.automation={readiness:'REVIEW_REQUIRED',blockers:['opaque human policy']};const old=assessExploratoryLearning(s);
 s.readinessV2=evaluate({expectation:hypothesis,learningPolicyAllows:true});assert.equal(s.readinessV2.review.status,'LEARNING_AVAILABLE');assert.deepEqual(assessExploratoryLearning(s),old);assert.equal(old.allowed,false);
 s.spec.target.method='POST';s.automation={readiness:'READY',blockers:[]};assert.equal(assessExploratoryLearning(s).reason,'LEARNING_MUTATION_NOT_ALLOWED');
});
