import assert from 'node:assert/strict';
import { enrichLegacyAssertionComparison } from '../src/services/assertionComparisonService.js';
const root={organizationId:'org_test',projectId:'prj_test',runId:'run_test',executionPlanId:'xplan_test',testDesignVersionId:'tdv_v3',runtimeSnapshotId:'rts_v3',environmentId:'env_stg'};
const original={resultSet:root,scenarios:[{scenarioId:'test_001',assertions:[{assertionIndex:0,type:'SCHEMA',outcome:'FAILED',schemaRef:'csv_old',path:'$.meta.total',primaryIssueCode:'SCHEMA_TYPE_MISMATCH',actualTypes:[],expectedType:null}],evidence:{response:{bodyPreview:'{"meta":{"total":"0"}}'}}}]};
const plan={...root,plan:{...root,testDesign:{testDesignVersionId:'tdv_v3'},scenarios:[{scenarioId:'test_001',spec:{assertions:[{type:'SCHEMA',schemaRef:'csv_old'}]}}],schemaSnapshots:[{schemaRef:'csv_old',schemaHash:'b'.repeat(64),schema:{type:'object',properties:{meta:{type:'object',properties:{total:{type:'integer'}}}}}}]}};
const input={env:{},organizationId:root.organizationId,projectId:root.projectId,data:original};
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
await test('Legacy uses exact run snapshot, keeps received type unknown and original immutable',async()=>{
 const before=JSON.stringify(original);let calls=0;
 const out=await enrichLegacyAssertionComparison(input,{getPlan:async(_env,org,project,run)=>{assert.deepEqual([org,project,run],['org_test','prj_test','run_test']);calls++;return plan;}});
 const a=out.scenarios[0].assertions[0];assert.equal(calls,1);assert.equal(a.outcome,'FAILED');assert.equal(a.expectedType,null);
 assert.equal(a.diagnostics.source,'LEGACY_EXECUTION_PLAN');assert.equal(a.diagnostics.issues[0].actualType,null);
 assert.deepEqual(a.diagnostics.issues[0].expectedTypes,['integer']);assert.equal(a.diagnostics.issues[0].schemaPointer,'/properties/meta/properties/total/type');
 assert.equal(JSON.stringify(original),before);
});
for(const key of ['organizationId','projectId','executionPlanId','testDesignVersionId','runId','runtimeSnapshotId','environmentId'])await test('Reject inconsistent '+key,async()=>{
 const bad=structuredClone(plan);bad[key]='different';assert.equal(await enrichLegacyAssertionComparison(input,{getPlan:async()=>bad}),original);
});
await test('No latest Catalog or arbitrary schema fallback',async()=>{
 const missing=structuredClone(plan);missing.plan.schemaSnapshots[0].schemaRef='csv_new';
 const out=await enrichLegacyAssertionComparison(input,{getPlan:async()=>missing});assert.equal(out.scenarios[0].assertions[0].diagnostics,undefined);
 const changed=structuredClone(plan);changed.plan.scenarios[0].spec.assertions[0].schemaRef='csv_new';
 assert.equal((await enrichLegacyAssertionComparison(input,{getPlan:async()=>changed})).scenarios[0].assertions[0].diagnostics,undefined);
});
await test('Unavailable plan never blocks result read',async()=>{assert.equal(await enrichLegacyAssertionComparison(input,{getPlan:async()=>{throw new Error('db down');}}),original);});
await test('Modern diagnostic already persisted does not query Gateway plan',async()=>{
 const modern=structuredClone(original);modern.scenarios[0].assertions[0].diagnostics={source:'RUNNER_EVALUATION'};
 const out=await enrichLegacyAssertionComparison({...input,data:modern},{getPlan:async()=>{throw new Error('must not call');}});assert.equal(out,modern);
});
console.log(`08.1.5 Gateway: ${checks} checks passed`);
