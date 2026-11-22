import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { consoleUiTestDesign, internalUiTestDesign } from '../src/handlers/uiTestDesign.js';
import { UI_COMPILER_VERSION, UI_DEFAULT_PROFILE, UI_LEGACY_COMPILER_VERSION, UI_LEGACY_DEFAULT_PROFILE,
  assertUiCompilation, canonicalUiJson, normalizeUiProfile, uiError } from '../src/services/uiTestDesignClient.js';
import { sha256TextHex } from '../src/security/testGenerationInternalAuth.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v2.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v1.json', import.meta.url), 'utf8'));
const scope = golden.source.scope, source = golden.source;
const path = `/v1/console/projects/${scope.projectId}/environments/${scope.environmentId}/ui-test-design`;
const versionId = 'uitdv_observed_plan';
const receipt = compilation => ({ domain:'UI',status:'persisted',testDesignId:'uitd_observed_plan',testDesignVersionId:versionId,version:1,contentHash:compilation.specificationHash,source:compilation.source,compilation });
function product(suffix, method='GET', body) { return new Request('https://gateway.invalid'+path+suffix,{method,...(body===undefined?{}:{body:JSON.stringify(body)})}); }
function deps(overrides={}) { return { tenant:async()=>({organizationId:scope.organizationId,organizationRole:'member',user:{userId:'usr_test'},accountId:'acc_test'}),
  environment:async()=>({status:'active'}),organization:async()=>({status:'active'}),source:async()=>({source}), ...overrides }; }
const params={...scope,resource:'designs',id:versionId,action:'evidence'};
async function rehash(compilation) { compilation.specificationHash=await sha256TextHex(canonicalUiJson(compilation.specification)); return compilation; }
function evidence(section='ACTIONS', artifactId=null) {
  const unit=golden.specification.plan.sections.find(row=>row.section===section), totalItems=unit?.count??1;
  return {contractVersion:'qagent.ui-test-design-plan-page.v1',source,specificationHash:golden.specificationHash,section,artifactId,
    items:totalItems?[{index:0,id:'unit_0',sourceRef:{manifestHash:source.manifestHash,pointer:unit?unit.pointer+'/0':'',artifactId,sha256:artifactId?'c'.repeat(64):null,byteLength:artifactId?1:null},
      validation:{rule:unit?.rule??'ARTIFACT_JSON_VALUE',status:'PLANNED',reasonCodes:[]},preview:{label:'Observed evidence'}}]:[],totalItems,nextCursor:null,executionPerformed:false};
}

test('new batches select v2 while explicit legacy jobs keep their compiler and complete profile',async()=>{
  const calls=[],dependencies=deps({request:async args=>{calls.push(args);return {jobId:'uitdj_test'};}});
  const body={operationId:'uitdop_test',bundleVersionIds:[source.bundleVersionId]};
  for(const extra of [{},{compilerVersion:UI_LEGACY_COMPILER_VERSION}]) await consoleUiTestDesign(product('/jobs','POST',{...body,...extra}),{}, {...scope,resource:'jobs'},dependencies);
  assert.equal(calls[0].body.compilerVersion,UI_COMPILER_VERSION);assert.deepEqual(calls[0].body.profile,UI_DEFAULT_PROFILE);
  assert.equal(calls[1].body.compilerVersion,UI_LEGACY_COMPILER_VERSION);assert.deepEqual(calls[1].body.profile,UI_LEGACY_DEFAULT_PROFILE);
  assert.throws(()=>normalizeUiProfile(UI_LEGACY_DEFAULT_PROFILE,UI_COMPILER_VERSION));
  assert.throws(()=>normalizeUiProfile(UI_DEFAULT_PROFILE,UI_LEGACY_COMPILER_VERSION));
  for(const profile of [{...UI_DEFAULT_PROFILE,coveragePolicy:'SAMPLE'}, {...UI_DEFAULT_PROFILE,maxChecks:100}]) {
    await assert.rejects(consoleUiTestDesign(product('/jobs','POST',{...body,profile}),{}, {...scope,resource:'jobs'},dependencies));
  }
  assert.equal(calls.length,2);
});

test('closed v2 plan validation preserves v1 and rejects omitted evidence, altered rules and fabricated execution',async()=>{
  await assertUiCompilation(golden,scope);await assertUiCompilation(legacy,legacy.source.scope);
  for(const mutate of [
    c=>{c.specification.plan.sections.pop();},
    c=>{c.specification.plan.selection='SAMPLE';},
    c=>{c.specification.plan.ruleSetVersion='unrecognized';},
    c=>{c.specification.plan.silentOmissionAllowed=true;},
    c=>{c.specification.coverage.validationUnitsExecuted=1;},
    c=>{c.summary.coverage={...c.summary.coverage,actionsPlanned:999};},
    c=>{c.specification.steps=[];},
    c=>{c.specification.source.manifestHash='f'.repeat(64);},
  ]) { const changed=structuredClone(golden);mutate(changed);await rehash(changed);await assert.rejects(assertUiCompilation(changed,scope)); }
  const mislabeled={...golden,contractVersion:'qagent.ui-test-design-compilation.v1'};
  await assert.rejects(assertUiCompilation(mislabeled,scope),{code:'UI_TEST_DESIGN_COMPILATION_INVALID'});
});

test('v2 callback pins requested compiler/profile and refuses a valid legacy downgrade',async()=>{
  const body={...scope,jobId:'uitdj_test',jobItemId:'uitdji_test',generationRequestId:'uitdg_uitdji_test',bundleVersionId:source.bundleVersionId,compilerVersion:UI_COMPILER_VERSION,profile:UI_DEFAULT_PROFILE};
  const request=()=>new Request('https://gateway.invalid/internal/v1/ui-test-design/compile',{method:'POST',body:JSON.stringify(body)});
  const injected=deps({verify:async()=>scope,request:async()=>golden});
  assert.deepEqual((await internalUiTestDesign(request(),{}, {action:'compile'},injected)).data,golden);
  await assert.rejects(internalUiTestDesign(request(),{}, {action:'compile'},{...injected,request:async()=>legacy}),{code:'UI_TEST_DESIGN_COMPILATION_INVALID'});
  const different=structuredClone(golden);different.specification.profile.layoutTolerancePx=3;await rehash(different);
  await assert.rejects(internalUiTestDesign(request(),{}, {action:'compile'},{...injected,request:async()=>different}),{code:'UI_TEST_DESIGN_COMPILATION_INVALID'});
});

test('evidence route only permits GET for a saved version',()=>{
  assert.deepEqual(resolveGatewayRoute('GET',path+'/designs/'+versionId+'/evidence'),{name:'consoleUiTestDesign',params:{projectId:scope.projectId,environmentId:scope.environmentId,resource:'designs',id:versionId,action:'evidence'}});
  for(const [method,suffix] of [['POST','/designs/'+versionId+'/evidence'],['GET','/jobs/job/evidence'],['GET','/sources/source/evidence']]) assert.equal(resolveGatewayRoute(method,path+suffix),null);
});

test('page request uses the immutable Registry plan, current source authorization and exact hash',async()=>{
  const calls=[],page=evidence(),dependencies=deps({source:async()=>{calls.push('access');return {source};},request:async args=>{
    calls.push(args);return args.service==='registry'?receipt(golden):page;
  }});
  const result=await consoleUiTestDesign(product('/designs/'+versionId+'/evidence?section=ACTIONS&limit=20&cursor=opaque'),{},params,dependencies);
  assert.deepEqual(result.data,page);assert.equal(calls[1],'access');assert.equal(calls[2].path,'/internal/ui/v1/test-design/plan-page');
  assert.deepEqual(calls[2].body,{scope,specification:golden.specification,specificationHash:golden.specificationHash,section:'ACTIONS',limit:20,cursor:'opaque'});
  assert.equal(calls[2].service,'ui');
});

test('page reads reject revoked sources, changed version hashes and mixed artifact/context responses',async()=>{
  let pageCalls=0;
  const request=async args=>{if(args.service==='registry')return receipt(golden);pageCalls++;return evidence();};
  await assert.rejects(consoleUiTestDesign(product('/designs/'+versionId+'/evidence?section=ACTIONS'),{},params,deps({request,source:async()=>{throw uiError('UI_BUNDLE_ACCESS_REVOKED',410);}})),{code:'UI_BUNDLE_ACCESS_REVOKED'});
  assert.equal(pageCalls,0);
  for(const mutate of [p=>{p.specificationHash='d'.repeat(64);},p=>{p.source={...source,scope:{...scope,environmentId:'env_other'}};},p=>{p.section='FIXTURES';},p=>{p.totalItems++;},p=>{p.executionPerformed=true;}]) {
    const page=structuredClone(evidence());mutate(page);
    await assert.rejects(consoleUiTestDesign(product('/designs/'+versionId+'/evidence?section=ACTIONS'),{},params,deps({request:async args=>args.service==='registry'?receipt(golden):page})));
  }
});

test('artifact content paging forwards a typed ID and rejects query-injected plans and selectors',async()=>{
  let forwarded;
  const dependencies=deps({request:async args=>{if(args.service==='registry')return receipt(golden);forwarded=args.body;return evidence('ARTIFACT_CONTENT','uia_observed');}});
  await consoleUiTestDesign(product('/designs/'+versionId+'/evidence?section=ARTIFACT_CONTENT&artifactId=uia_observed&limit=50'),{},params,dependencies);
  assert.equal(forwarded.artifactId,'uia_observed');assert.equal(forwarded.limit,50);
  for(const query of ['section=ARTIFACT_CONTENT','section=ACTIONS&artifactId=uia_x','section=ACTIONS&specification=forged','section=ACTIONS&section=FIXTURES','section=unknown','section=ACTIONS&limit=0']) {
    forwarded=null;await assert.rejects(consoleUiTestDesign(product('/designs/'+versionId+'/evidence?'+query),{},params,dependencies),{code:'UI_TEST_DESIGN_PAGINATION_INVALID'});assert.equal(forwarded,null);
  }
});

test('legacy saved versions remain readable but are not misrepresented as reference plans',async()=>{
  const dependencies=deps({source:async()=>({source:legacy.source}),request:async()=>receipt(legacy)});
  await assert.rejects(consoleUiTestDesign(product('/designs/'+versionId+'/evidence?section=ACTIONS'),{},params,dependencies),{code:'UI_TEST_DESIGN_PLAN_UNSUPPORTED'});
  assert.equal((await consoleUiTestDesign(product('/designs/'+versionId),{}, {...params,action:null},dependencies)).data.compilation.contractVersion,'qagent.ui-test-design-compilation.v1');
});
