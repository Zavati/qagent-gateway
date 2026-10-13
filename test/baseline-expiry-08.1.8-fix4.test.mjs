// FIX-4: synthetic immutable baseline. No network, credentials or external execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateObservedBaseline,validateObservedBaselineScenario,observedBaselineReady,
 baselineExecutionReadiness,baselineLearningEligibility,assertNoProtectedBaselineChanges} from '../src/baselineContract.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/baseline-fixture.json',import.meta.url),'utf8'));
const clone=x=>structuredClone(x), baseline=()=>clone(fixture.specification.scenarios[0]);
const original=baseline(), b=original.baseline, expiredAt=Date.parse(b.expiresAt), after=expiredAt+86400000*366;
const scope={organizationId:b.source.organizationId,projectId:b.source.projectId,endpointId:b.source.endpointId,environmentId:b.source.environmentId};
const AGE='OBSERVED_BASELINE_SOURCE_EXPIRED';
for(const [name,at] of [['before',expiredAt-1],['at',expiredAt],['after',expiredAt+1],['year later',after]])
 test(`saved complete baseline is executable ${name} the old deadline`,()=>{
   const s=baseline(),before=JSON.stringify(s);validateObservedBaselineScenario(s,scope);
   assert.equal(observedBaselineReady(s.baseline,at),true);assert.equal(JSON.stringify(s),before);
 });
for(const [name,change] of [
 ['partial request',s=>s.baseline.requestCoverage.status='PARTIAL'],
 ['partial response',s=>{s.baseline.responseCoverage.status='PARTIAL';s.baseline.selfCheck='PARTIAL';}],
 ['failed self check',s=>s.baseline.selfCheck='FAILED']])
 test(`${name} is not made ready by removing age`,()=>{const s=baseline();change(s);assert.equal(observedBaselineReady(s.baseline,after),false);});
for(const key of ['organizationId','projectId','endpointId','environmentId'])
 test(`old baseline cannot cross ${key}`,()=>{assert.throws(()=>validateObservedBaselineScenario(baseline(),{...scope,[key]:'other'}));});
test('expiresAt provenance is retained and must remain a valid timestamp',()=>{
 const bad=clone(b);bad.expiresAt='not-a-date';assert.throws(()=>validateObservedBaseline(bad,scope));
 const impossible=clone(b);impossible.expiresAt=b.source.observedAt;assert.throws(()=>validateObservedBaseline(impossible,scope));
});
test('expected assertions and protected changes cannot be rewritten by age policy',()=>{
 const s=baseline();s.spec.assertions[0].expectedStatusCodes=[404];assert.throws(()=>validateObservedBaselineScenario(s,scope));
 assert.throws(()=>assertNoProtectedBaselineChanges(fixture.specification,[original.scenarioId]),{code:'OBSERVED_BASELINE_REBASELINE_REQUIRED'});
});
test('historical expiry-only label projects READY without rewriting the artifact',()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[AGE]};const before=JSON.stringify(s);
 assert.equal(baselineExecutionReadiness(s),'READY');assert.equal(JSON.stringify(s),before);
});
for(const code of ['OBSERVED_BASELINE_SOURCE_UNAVAILABLE','OBSERVED_BASELINE_REQUEST_INCOMPLETE','unknown blocker'])
 test(`expiry plus ${code} does not bypass the remaining blocker`,()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[AGE,code]};assert.equal(baselineExecutionReadiness(s),'NEEDS_DATA');
 });
test('non-baseline and incomplete baseline labels are not promoted',()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[AGE]};s.baseline.requestCoverage.status='PARTIAL';assert.equal(baselineExecutionReadiness(s),'NEEDS_DATA');
 delete s.baseline;s.generationClass='AI_EXPLORATORY';assert.equal(baselineExecutionReadiness(s),'NEEDS_DATA');
});

import {readScenarioReadinessV2} from '../src/readiness/legacyReadinessAdapter.js';
import {evaluateScenarioReadinessV2} from '../src/readiness/scenarioReadinessV2.js';
import {buildReadinessIssue} from '../src/readiness/readinessIssues.js';
import {collectScenarioReadinessIssues} from '../src/readiness/scenarioReadinessFacts.js';
import {reconcileReadinessFacts} from '../src/readiness/readinessReconciliation.js';
function snapshot(s,codes,expectation={status:'EVIDENCED',basis:'OBSERVED_BASELINE'}) {
 s.readinessV2=evaluateScenarioReadinessV2({basis:'NATIVE_V2',issues:codes.map(c=>buildReadinessIssue(c,'READINESS_EVALUATOR')),expectation,learningPolicyAllows:false});
 return s;
}
test('clock no longer introduces an expiry issue to facts',()=>{
 assert.deepEqual(collectScenarioReadinessIssues(original,{nowMs:after}),collectScenarioReadinessIssues(original,{nowMs:expiredAt-1}));
 assert.equal(collectScenarioReadinessIssues(original,{nowMs:after}).some(i=>i.code===AGE),false);
});
test('native expiry-only issue is removed in read projection, snapshot is immutable',()=>{
 const s=snapshot(baseline(),[AGE]),before=JSON.stringify(s),out=readScenarioReadinessV2(s,{nowMs:after});
 assert.equal(out.execution.status,'READY');assert.equal(out.regression.status,'READY');assert.equal(out.basis,'NATIVE_V2');assert.equal(out.expectation.status,'EVIDENCED');assert.deepEqual(out.issues,[]);assert.equal(JSON.stringify(s),before);
});
test('native expired plus genuinely unavailable data remains blocked',()=>{
 const s=snapshot(baseline(),[AGE,'OBSERVED_BASELINE_SOURCE_UNAVAILABLE']),out=readScenarioReadinessV2(s);
 assert.equal(out.execution.status,'BLOCKED');assert.deepEqual(out.issues.map(i=>i.code),['OBSERVED_BASELINE_SOURCE_UNAVAILABLE']);
});
test('expiry removal cannot verify an immature derivation',()=>{
 const s=snapshot(baseline(),[AGE,'EXPECTATION_REVALIDATION_REQUIRED'],{status:'HYPOTHESIS',basis:'DERIVATION_PENDING_VERIFICATION'});
 const out=readScenarioReadinessV2(s);assert.equal(out.execution.status,'READY');assert.equal(out.regression.status,'BLOCKED');assert.equal(out.expectation.status,'HYPOTHESIS');
});
test('legacy expiry-only issue does not create a replacement synthetic data blocker',()=>{
 const s=baseline();delete s.readinessV2;s.automation={readiness:'NEEDS_DATA',blockers:[AGE]};
 const out=readScenarioReadinessV2(s,{nowMs:after});assert.equal(out.basis,'LEGACY_PROJECTION');assert.equal(out.execution.status,'READY');assert.equal(out.regression.status,'READY');assert.deepEqual(out.issues,[]);
});
test('legacy unknown cause still fails closed after ignoring age',()=>{
 const s=baseline();delete s.readinessV2;s.automation={readiness:'NEEDS_DATA',blockers:[AGE,'UNKNOWN_CUSTOM_BLOCKER']};
 assert.equal(readScenarioReadinessV2(s,{nowMs:after}).execution.status,'BLOCKED');
});
test('invalid present v2 is rejected, not silently adapted',()=>{
 const s=baseline();s.readinessV2={contractVersion:'bad',issues:[]};assert.throws(()=>readScenarioReadinessV2(s));
});
test('reconciliation removes old expiry from explicitly supplied base but never evolves a baseline',()=>{
 const s=snapshot(baseline(),[AGE]),before=JSON.stringify(s),out=reconcileReadinessFacts({scenario:s,base:s.readinessV2,nowMs:after,proposalAvailable:true,verificationMatched:true,evidence:{kind:'PASSED',coverageComplete:true}});
 assert.equal(out.state,'BASELINE_PROTECTED');assert.equal(out.readinessV2.regression.status,'READY');assert.equal(out.readinessV2.expectation.status,'EVIDENCED');assert.ok(out.resolvedIssueCodes.includes(AGE));assert.equal(JSON.stringify(s),before);
});
test('non-baseline expiry issue is not discarded by native reader',()=>{
 const s=snapshot(baseline(),[AGE]);delete s.baseline;s.generationClass='AI_EXPLORATORY';assert.equal(readScenarioReadinessV2(s).execution.status,'BLOCKED');
});

import {captureHash} from '../src/baselineCapture.js';
import {materializeObservedBaselineRequests,verifyObservedBaselineSchemas} from '../src/services/observedBaselineRuntime.js';
import {buildUnits} from '../src/services/suiteRunService.js';
import {buildObservedBaselineScenario} from '../src/intelligence/observedBaselineGeneration.js';
import {readinessNextAction} from '../src/readiness/readinessNextAction.js';
async function requests(s=baseline(),extra={}) {return materializeObservedBaselineRequests({env:{},...scope,scenarios:[s],now:after,loadSource:async()=>clone(fixture.source),...extra});}
async function pinnedRequest(request={headers:{},pathParams:{},query:{}}) {
 const s=baseline();s.spec.request=clone(request);s.baseline.requestFingerprint='brq_'+await captureHash({request,encoding:s.baseline.requestBodyEncoding});return s;
}
test('runtime replays old but physically retained Catalog request and keeps hashes/assertions',async()=>{
 const s=baseline(),before=JSON.stringify(s),out=await requests(s);assert.deepEqual(out.get(s.scenarioId),fixture.source.request);assert.equal(JSON.stringify(s),before);
});
for(const [name,request] of [['empty',{headers:{},query:{},pathParams:{}}],['self-contained',{headers:{},query:{limit:'5'},pathParams:{}}]])
 test(`${name} persisted request with exact fingerprint does not require Catalog source`,async()=>{
 const s=await pinnedRequest(request),before=JSON.stringify(s);const out=await requests(s,{loadSource:async()=>{throw new Error('must not fetch source');}});
 assert.deepEqual(out.get(s.scenarioId),request);assert.equal(JSON.stringify(s),before);
 });
test('purged request with unknown missing values is not invented or replaced',async()=>{
 await assert.rejects(requests(baseline(),{loadSource:async()=>({...fixture.source,availability:'EXPIRED',request:undefined})}),{code:'RUN_OBSERVED_BASELINE_SOURCE_UNAVAILABLE'});
});
test('fallback rejects unsafe secret-bearing stored request',async()=>{
 const s=await pinnedRequest({headers:{cookie:'secret-value'},pathParams:{},query:{}});
 await assert.rejects(requests(s,{loadSource:async()=>null}),{code:'RUN_OBSERVED_BASELINE_SOURCE_UNAVAILABLE'});
});
test('Catalog cannot substitute a different request under the old fingerprint',async()=>{
 const source=clone(fixture.source);source.request.query.limit='500';await assert.rejects(requests(baseline(),{loadSource:async()=>source}),{code:'RUN_OBSERVED_BASELINE_REQUEST_HASH_MISMATCH'});
});
test('Catalog cannot substitute provenance from another source',async()=>{
 const source=clone(fixture.source);source.source.eventId='cat_evt_other';await assert.rejects(requests(baseline(),{loadSource:async()=>source}),{code:'RUN_OBSERVED_BASELINE_PROVENANCE_MISMATCH'});
});
test('configured user data conflict remains an error',async()=>{
 await assert.rejects(requests(baseline(),{configuredBindings:[{target:'QUERY',selector:'limit',origin:'USER_DEFINED',sourceType:'FIXED',fixedValue:25}]}),{code:'RUN_OBSERVED_BASELINE_USER_DATA_CONFLICT'});
});
test('matching user data is allowed without changing source',async()=>{
 assert.ok((await requests(baseline(),{configuredBindings:[{target:'QUERY',selector:'limit',origin:'USER_DEFINED',sourceType:'FIXED',fixedValue:50}]})).has(original.scenarioId));
});
test('pinned schema validation still rejects a mismatching reference and hash',async()=>{
 const sc={schemaRef:b.responseSchemaVersionId,schemaVersionId:b.responseSchemaVersionId,schemaHash:b.responseSchemaHash,direction:'RESPONSE',statusCode:200,schema:clone(fixture.schema)};
 await verifyObservedBaselineSchemas([baseline()],[sc]);
 await assert.rejects(verifyObservedBaselineSchemas([baseline()],[{...sc,schemaVersionId:'csv_other'}]));
 await assert.rejects(verifyObservedBaselineSchemas([baseline()],[{...sc,schema:{type:'string'}}]),{code:'RUN_OBSERVED_BASELINE_SCHEMA_HASH_MISMATCH'});
});
function unitInput(method='GET',environmentId=scope.environmentId) {
 return {items:[{ordinal:0,endpointId:scope.endpointId,testDesignVersionId:'tdv_pinned',testDesignVersion:7,method,scenarioIds:[original.scenarioId],scenarioOrigins:[{scenarioId:original.scenarioId,generationClass:'OBSERVED_BASELINE',environmentId,expiresAt:b.expiresAt}]}]};
}
test('suite selects expired saved baseline instead of heldUnits',()=>{
 const slice=unitInput(),before=JSON.stringify(slice),out=buildUnits(slice,{decisions:[]},{environmentId:scope.environmentId,createdAt:new Date(after).toISOString()});
 assert.equal(out[0].decision,'EXECUTE');assert.equal(out[0].holdReason,null);assert.deepEqual(out[0].scenarioIds,[original.scenarioId]);assert.equal(JSON.stringify(slice),before);
});
test('suite retains environment isolation after removing age',()=>{
 const out=buildUnits(unitInput('GET','env_other'),{}, {environmentId:scope.environmentId});assert.equal(out[0].decision,'POLICY_HOLD');assert.equal(out[0].holdReason,'OBSERVED_BASELINE_ENVIRONMENT_MISMATCH');
});
test('suite mutation policy is not bypassed by old baseline',()=>{
 const out=buildUnits(unitInput('POST'),{decisions:[]},{environmentId:scope.environmentId});assert.equal(out[0].holdReason,'MUTATION_EXECUTION_DISABLED');
});
test('suite production mutation still needs explicit confirmation',()=>{
 const decision={endpointId:scope.endpointId,method:'POST',executionDecision:'ALLOW'};
 const out=buildUnits(unitInput('POST'),{environment:{environmentType:'PROD'},decisions:[decision]},{environmentId:scope.environmentId,confirmProductionMutation:false});assert.equal(out[0].holdReason,'MUTATION_PRODUCTION_CONFIRMATION_REQUIRED');
});
test('generation from retained old source remains ready and keeps original deadline',()=>{
 const out=buildObservedBaselineScenario(fixture.source,fixture.context,{now:new Date(after)});assert.equal(out.automation.readiness,'READY');assert.equal(out.baseline.expiresAt,b.expiresAt);assert.deepEqual(out.spec.assertions,original.spec.assertions);
});
test('physically unavailable source remains NEEDS_DATA during generation',()=>{
 const out=buildObservedBaselineScenario({...fixture.source,availability:'EXPIRED'},fixture.context,{now:new Date(after)});assert.equal(out.automation.readiness,'NEEDS_DATA');assert.ok(out.automation.blockers.includes('OBSERVED_BASELINE_SOURCE_UNAVAILABLE'));
});
test('workspace command offers regression but not baseline mutation after expiry',()=>{
 const s=baseline(),out=reconcileReadinessFacts({scenario:s,nowMs:after});
 const actions=readinessNextAction(s,{readinessV2:out.readinessV2,readinessReconciliation:{complete:true}},{canWrite:true,now:after});
 assert.equal(actions.commands.regression,true);assert.equal(actions.commands.analyze,false);assert.equal(actions.workflow,'PROTECTED');assert.equal(actions.policyBlocked,false);
});

test('malformed native issue list cannot release a historical expiry-only label',()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[]};s.readinessV2={issues:{}};assert.equal(baselineExecutionReadiness(s),'NEEDS_DATA');
});
