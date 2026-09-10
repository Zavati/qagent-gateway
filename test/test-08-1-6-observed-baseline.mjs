// 08.1.6: public metadata guards, safe failure and source immutability. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateObservedBaseline,validateObservedBaselineScenario,observedBaselineReady,assertNoProtectedBaselineChanges,isApprovedBaselineRevision} from '../src/baselineContract.js';
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/baseline-fixture.json',import.meta.url),'utf8'));
const s=f.specification.scenarios[0],b=s.baseline;
const scope={organizationId:b.source.organizationId,projectId:b.source.projectId,endpointId:b.source.endpointId};
const now=Date.parse(b.source.observedAt)+60000;
test('public provenance validates exact scope and contains no request data',()=>{
 assert.equal(validateObservedBaseline(b,scope),b);assert.equal(validateObservedBaselineScenario(s,scope),s);
 assert.throws(()=>validateObservedBaseline({...b,request:{limit:50}},scope));
 assert.throws(()=>validateObservedBaseline(b,{...scope,projectId:'other'}));
 assert.throws(()=>validateObservedBaselineScenario({...s,spec:{...s.spec,assertions:[{type:'STATUS',expectedStatusCodes:[422]}]}},scope));
});
test('source expiry / incomplete evidence never becomes ready',()=>{
 assert.equal(observedBaselineReady(b,now),true);assert.equal(observedBaselineReady(b,Date.parse(b.expiresAt)+1),false);
 assert.equal(observedBaselineReady({...b,requestCoverage:{...b.requestCoverage,status:'PARTIAL'}},now),false);
});
test('ordinary repair cannot weaken baseline and explicit approval needs exact parent',()=>{
 assert.throws(()=>assertNoProtectedBaselineChanges(f.specification,[s.scenarioId]),{code:'OBSERVED_BASELINE_REBASELINE_REQUIRED'});
 const next=structuredClone(s);next.baseline.revision={previousBaselineId:b.baselineId,sourceTestDesignVersionId:'tdv_parent',approvedByUserId:'usr_test',approvedAt:new Date(now).toISOString(),reasonCode:'RECAPTURE_SOURCE'};
 assert.equal(isApprovedBaselineRevision(s,next,'tdv_parent'),true);assert.equal(isApprovedBaselineRevision(s,next,'tdv_other'),false);
});

import {buildObservedBaselineScenario} from '../src/intelligence/observedBaselineGeneration.js';
import {reviseObservedBaseline} from '../src/intelligence/observedBaselineRevision.js';
test('generation pins source and no unapproved controlled context',()=>{
 const built=buildObservedBaselineScenario(f.source,f.context,{now:new Date(now)});
 assert.deepEqual(built.spec.request,{pathParams:{},query:{},headers:{}});assert.equal(built.spec.assertions.find(a=>a.type==='SCHEMA').schemaRef,b.responseSchemaVersionId);
 assert.throws(()=>buildObservedBaselineScenario(f.source,f.context,{mode:'CONTROLLED_STATE',now:new Date(now)}),{code:'OBSERVED_BASELINE_CONTEXT_CONFIRMATION_REQUIRED'});
});
test('explicit policy review makes a new artifact with stable scenario and no IA/execution',()=>{
 const previous={testDesign:{versionId:'tdv_parent',specification:f.specification}};
 const out=reviseObservedBaseline({previous,sources:{items:[f.source]},context:f.context,contextFingerprint:'a'.repeat(64),options:{mode:'CONTROLLED_STATE',confirmControlledContext:true,replace:{scenarioId:s.scenarioId,newBaselineId:b.baselineId,sourceTestDesignVersionId:'tdv_parent',confirm:true,reasonCode:'COMPARISON_POLICY_REVIEW'}},actor:'usr_test',now:new Date(now)});
 assert.equal(out.specification.scenarios[0].scenarioId,s.scenarioId);assert.equal(out.specification.scenarios[0].baseline.comparisonPolicy.mode,'CONTROLLED_STATE');assert.equal(s.baseline.comparisonPolicy.mode,'STRUCTURE');assert.equal(out.diagnostics.observedBaselineRevision.executionRequested,false);
});
