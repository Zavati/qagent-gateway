import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { missingStatusCoverageGap, assertStatusCoverageSource, STATUS_COVERAGE_CONTRACT } from '../src/statusCoverage.js';
import { assessLearningAdmission, buildLearningAdmissionForRunner } from '../src/readiness/learningAdmissionV2.js';
import { postConsoleLearningResolutionAnalyze } from '../src/handlers/consoleLearningResolution.js';
import { validExploratoryLearningAdmission } from '../src/learningScenarioEligibility.js';
import { evaluateScenarioReadinessV2 } from '../src/readiness/scenarioReadinessV2.js';
import { collectScenarioReadinessIssues } from '../src/readiness/scenarioReadinessFacts.js';
const raw=JSON.parse(readFileSync(new URL('./fixtures/status-coverage-source-08.1.7-c-fix2.json',import.meta.url),'utf8'));
const scope={...raw.specification.source,environmentId:'env_d3cf2d99-cea7-4c65-9d87-38c3291e05d2'};
const source=()=>structuredClone(raw.specification.scenarios.find(s=>s.scenarioId==='validar_estrutura_meta'));
const flags={SCENARIO_READINESS_V2_ENABLED:'true',SCENARIO_READINESS_RECONCILIATION_ENABLED:'true'};
globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const request=body=>new Request('https://console.invalid',{method:'POST',body:JSON.stringify(body)});
async function analyze({s=source(),proposal=null,editDeps={},body={}}={}){
 const deps={requireTenant:async()=>({organizationId:scope.organizationId,organizationRole:'owner',user:{userId:'usr_status_fixture'}}),getProject:async()=>({}),
  getLatest:async()=>({exists:true,testDesign:{versionId:raw.versionId,specification:{scenarios:[s]}}}),
  listResults:async()=>({items:proposal?[{endpointId:scope.endpointId,testDesignVersionId:raw.versionId,environmentId:scope.environmentId,resultSetId:'rset_status'}]:[],page:{hasMore:false}}),
  getResult:async()=>({resultSet:{...scope,testDesignVersionId:raw.versionId,resultSetId:'rset_status'},scenarios:[{scenarioId:s.scenarioId,scenarioResultId:'sres_status'}]}),
  inspect:async()=>({scenarios:[{scenarioResultId:'sres_status',eligible:true,changes:proposal?.changes||[]}]}),createProposal:async()=>proposal,
  getPolicy:async()=>({mode:'SUGGEST'}),getContext:async()=>({contextFingerprint:'same'}),
  reconcileReadiness:async()=>({items:[{scenarioId:s.scenarioId,readinessV2:s.readinessV2,readinessReconciliation:{state:'UNCHANGED'}}]}),
  resolveTestDataBindings:async()=>[],aiAssess:async()=>{throw Error('AI_FORBIDDEN');},createRerun:async()=>{throw Error('RUN_FORBIDDEN');},...editDeps};
 return postConsoleLearningResolutionAnalyze(request({environmentId:scope.environmentId,selections:[{endpointId:scope.endpointId,testDesignVersionId:raw.versionId,scenarioId:s.scenarioId}],...body}),flags,{projectId:scope.projectId},deps);
}
test('native STATUS-only admission now exposes the actionable gap without authorizing regression',()=>{
 const s=source(),before=structuredClone(s),a=assessLearningAdmission(s,{enabled:true});
 assert.equal(a.allowed,true);assert.equal(a.coverageStatus,'PARTIAL');assert.equal(a.confirmationRequiresCoverage,true);
 assert.deepEqual(a.coverageGaps,[{kind:'STATUS',code:'ASSERTION_STATUS_REQUIRED'}]);assert.equal(s.readinessV2.regression.status,'BLOCKED');assert.deepEqual(s,before);
});
test('real source is eligible for bounded STATUS extension, not for guessing a type in meta',()=>{
 const s=source();assert.deepEqual(assertStatusCoverageSource(s),[1]);assert.equal(s.objective,raw.specification.scenarios.find(s=>s.scenarioId==='validar_estrutura_meta').objective);
 assert.deepEqual(s.spec.assertions.map(a=>a.type),['JSON_PATH_EXISTS','SCHEMA']);
});
test('unchanged Runner admission wire still accepts the selected partial scenario',()=>{
 const s=source(),admission=buildLearningAdmissionForRunner(s,s,{enabled:true});
 assert.equal(admission.contractVersion,'qagent.exploratory-learning-admission.v1');
 assert.deepEqual(Object.keys(admission).sort(),['contractVersion','deferredBlockers','sourceReadiness']);
 assert.equal(validExploratoryLearningAdmission({spec:s.spec,learningAdmission:admission,readiness:s.automation.readiness}),true);
});
test('Analyze reports STATUS gap without writing, executing, or calling the model',async()=>{
 const r=await analyze(),i=r.data.items[0];assert.equal(i.status,'LEARNING_AVAILABLE');assert.equal(i.learning.allowed,true);
 assert.deepEqual(i.learning.coverageGaps,[{kind:'STATUS',code:'ASSERTION_STATUS_REQUIRED'}]);
 assert.equal(r.data.executionStarted,false);assert.equal(r.data.appliedByThisOperation,false);
});
test('Analyze safely projects the new observation and omits private proof internals',async()=>{
 const proposal={proposalId:'tep_status_fixture',status:'PENDING_REVIEW',assessment:{contextFingerprint:'same'},changes:[{
  changeId:'tec_status_fixture',changeType:'ASSERTION_COVERAGE_EXTENSION',assertionIndex:0,current:{readiness:'REVIEW_REQUIRED'},
  proposed:{learningMode:'COVERAGE_EXTENSION',requiresHumanApproval:true,coverageProof:{statusCoverageContractVersion:STATUS_COVERAGE_CONTRACT,
   execution:{assertionCount:2,secret:'DO_NOT_COPY'},additions:[{type:'STATUS',expectedStatusCodes:[200]}],observations:[{kind:'STATUS',actualStatusCode:200,schemaAssertionIndexes:[1],untrusted:'DO_NOT_COPY'}]}}
 }]};
 const r=await analyze({proposal}),extension=r.data.items[0].proposal.changes[0].extension;
 assert.equal(r.data.items[0].status,'PROPOSAL_AVAILABLE');assert.equal(extension.statusCoverageContractVersion,STATUS_COVERAGE_CONTRACT);
 assert.deepEqual(extension.observations,[{kind:'STATUS',actualStatusCode:200,schemaAssertionIndexes:[1]}]);
 assert.deepEqual(extension.addedAssertions,[{type:'STATUS',expectedStatusCodes:[200]}]);assert.equal(extension.requiresVerification,true);
 assert.ok(!JSON.stringify(r).includes('DO_NOT_COPY'));
});
test('legacy mode retains its old decision and does not reinterpret STATUS as an auto-fix',()=>{
 const s=source(),a=assessLearningAdmission(s,{enabled:false});assert.equal(a.allowed,false);assert.deepEqual(a.coverageGaps||[],[]);
});
test('already present STATUS is not another gap',()=>{
 const s=source();s.spec.assertions.push({type:'STATUS',expectedStatusCodes:[200]});assert.equal(missingStatusCoverageGap(s),null);
});
test('numeric detection remains the existing specialized gap, no duplicate STATUS-only branch',()=>{
 const s=source();s.title='Total numérico';s.objective='$.meta.total deve ser number';s.spec.assertions=[{type:'JSON_PATH_EXISTS',path:'$.meta.total'}];
 s.readinessV2=evaluateScenarioReadinessV2({issues:collectScenarioReadinessIssues(s),expectation:{status:'UNKNOWN',basis:'UNDETERMINED'},learningPolicyAllows:true});
 const a=assessLearningAdmission(s,{enabled:true});assert.deepEqual(a.coverageGaps,[{kind:'JSON_TYPE',path:'$.meta.total',expectedType:'number'}]);
});
for (const [name,edit] of [['mutation',s=>s.spec.target.method='POST'],['baseline',s=>s.generationClass='OBSERVED_BASELINE'],['invalid snapshot',s=>s.readinessV2={}]])test('STATUS diagnostics never bypass '+name,()=>{
 const s=source();edit(s);assert.equal(assessLearningAdmission(s,{enabled:true}).allowed,false);
});
test('read-only member cannot request analysis writes and browser proof is not accepted',async()=>{
 await assert.rejects(analyze({editDeps:{requireTenant:async()=>({organizationId:scope.organizationId,organizationRole:'viewer'})}}),{code:'LEARNING_RESOLUTION_FORBIDDEN'});
 await assert.rejects(analyze({body:{statusCoverageContractVersion:STATUS_COVERAGE_CONTRACT}}),{code:'LEARNING_RESOLUTION_INPUT_INVALID'});
});
test('stale source version is refused without automatic regeneration',async()=>{
 const r=await analyze({editDeps:{getLatest:async()=>({exists:true,testDesign:{versionId:'tdv_other'}})}});assert.equal(r.data.items[0].errorCode,'LEARNING_SOURCE_VERSION_STALE');
});
