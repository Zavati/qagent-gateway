import test from 'node:test';
import assert from 'node:assert/strict';
import {getConsoleProjectTestReadiness,getConsoleEndpointTestReadinessScenarios} from '../src/handlers/consoleTestReadiness.js';
import {getProjectTestReadiness} from '../src/services/testReadinessClient.js';
import {parseTestReadinessQuery,BASELINE_BUCKETS,BASELINE_GAPS} from '../src/contracts/testReadiness.js';
import {resolveGatewayRoute} from '../src/routing/gatewayRouter.js';
const query=parseTestReadinessQuery(new URLSearchParams('view=summary'));
const scope={organizationId:'org_test',projectId:'prj_test'};
function response(){return {status:'ok',data:{contractVersion:'qagent.project-test-readiness.v1',...scope,view:'summary',readinessRevision:'rrev_'+'a'.repeat(64),computedAt:'2026-09-10T20:00:00Z',readinessBasis:'LATEST_PERSISTED_TEST_DESIGN',filters:query.filters,
 projectSummary:{testDesignCount:0,scenarioCount:0,observedBaselineScenarioCount:0,aiExploratoryScenarioCount:0,legacyScenarioCount:0,readyScenarioCount:0,needsDataScenarioCount:0,reviewRequiredScenarioCount:0,needsAuthScenarioCount:0,needsEnvironmentScenarioCount:0,unknownReadinessScenarioCount:0,unknownOriginScenarioCount:0,pendingScenarioCount:0,executionEligibleScenarioCount:0,policyBlockedReadyScenarioCount:0,eligibilityPolicyVersion:'qagent.suite-execution-eligibility.v1',eligibilityBasis:'INVENTORY_POLICY_NOT_RUNTIME_AUTHORIZATION',baselineBuckets:BASELINE_BUCKETS.map(key=>({key,readiness:BASELINE_GAPS.includes(key)?'NEEDS_DATA':key,baselineGap:BASELINE_GAPS.includes(key)?key:null,scenarioCount:0,endpointCount:0,requestCoverageCounts:{COMPLETE:0,PARTIAL:0,UNKNOWN:0},responseCoverageCounts:{COMPLETE:0,PARTIAL:0,NO_BODY:0,UNKNOWN:0},selfCheckCounts:{PASSED:0,PARTIAL:0,FAILED:0,NO_BODY:0,UNKNOWN:0}}))},
 filteredSummary:{matchingEndpointCount:0,matchingScenarioCount:0,readinessCounts:{READY:0,NEEDS_DATA:0,REVIEW_REQUIRED:0,NEEDS_AUTH:0,NEEDS_ENVIRONMENT:0,UNKNOWN:0}},integrity:{fallbackVersionCount:0,unknownReadinessScenarioCount:0,unknownOriginScenarioCount:0,incompleteBaselineMetadataCount:0},page:{limit:25,hasMore:false,nextCursor:null},items:[]}};}
const deps={requireTenant:async()=>scope,getProject:async()=>({projectId:scope.projectId})};
const req=(suffix='?view=summary')=>new Request('https://gateway.test/v1/console/projects/prj_test/intelligence/test-readiness'+suffix,{headers:{'x-qagent-organization-id':'org_attacker'}});

test('routing read-only resources does not replace existing inventory/generation',()=>{
 const p='/v1/console/projects/prj_test';
 assert.equal(resolveGatewayRoute('GET',p+'/intelligence/test-readiness').name,'consoleProjectTestReadinessGet');
 assert.equal(resolveGatewayRoute('GET',p+'/intelligence/test-readiness/endpoints/cep_a/scenarios').name,'consoleEndpointTestReadinessScenariosGet');
 assert.notEqual(resolveGatewayRoute('POST',p+'/intelligence/test-readiness')?.name,'consoleProjectTestReadinessGet');
 assert.equal(resolveGatewayRoute('GET',p+'/automation/test-inventory').name,'consoleAutomationTestInventoryGet');
});
test('handler authorizes tenant and project before a read; ignores incoming tenant headers',async()=>{
 const order=[];
 const data=await getConsoleProjectTestReadiness(req(),{},scope,{requireTenant:async()=>{order.push('tenant');return scope;},getProject:async(_env,org,project)=>{order.push('project');assert.equal(org,'org_test');assert.equal(project,'prj_test');},getReadiness:async x=>{order.push('read');assert.equal(x.organizationId,'org_test');return response().data;}});
 assert.deepEqual(order,['tenant','project','read']);assert.equal(data.status,'ok');
 let reads=0;await assert.rejects(()=>getConsoleProjectTestReadiness(req(),{},scope,{...deps,getProject:async()=>{throw Error('forbidden');},getReadiness:async()=>reads++}));assert.equal(reads,0);
});
test('query rejects unsupported filters and detail requires immutable version',async()=>{
 await assert.rejects(()=>getConsoleProjectTestReadiness(req('?organizationId=org_bad'),{},scope,deps),{code:'TEST_READINESS_QUERY_INVALID'});
 await assert.rejects(()=>getConsoleEndpointTestReadinessScenarios(req(),{}, {...scope,endpointId:'cep_a'},deps),{code:'TEST_READINESS_QUERY_INVALID'});
 let seen;await getConsoleEndpointTestReadinessScenarios(req('/endpoints/cep_a/scenarios?testDesignVersionId=tdv_a&readiness=NEEDS_DATA'),{},{...scope,endpointId:'cep_a'},{...deps,getScenarios:async x=>{seen=x;return {};}});assert.equal(seen.query.testDesignVersionId,'tdv_a');
});
test('private service binding forwards scope and canonical query; no credentials or public URL',async()=>{
 let request;const env={TEST_REGISTRY_SERVICE:{fetch:async r=>{request=r;return Response.json(response());}}};
 const data=await getProjectTestReadiness({env,...scope,query});assert.equal(data.projectId,'prj_test');assert.equal(request.headers.get('x-qagent-organization-id'),'org_test');assert.equal(request.headers.get('authorization'),null);assert.equal(request.method,'GET');assert.ok(request.url.endsWith('view=summary&limit=25'));
 await assert.rejects(()=>getProjectTestReadiness({env:{TEST_REGISTRY_URL:'https://example.test'},...scope,query}),{code:'TEST_REGISTRY_NOT_CONFIGURED'});
});
test('upstream scope, extra payload and inconsistent totals fail closed',async()=>{
 for(const change of [b=>b.data.projectId='prj_other',b=>b.data.specification={request:{password:'NEVER'}},b=>b.data.projectSummary.scenarioCount=5]){
 const body=response();change(body);await assert.rejects(()=>getProjectTestReadiness({env:{TEST_REGISTRY_SERVICE:{fetch:async()=>Response.json(body)}},...scope,query}),{code:'TEST_READINESS_RESPONSE_INVALID'});
 }
});
test('known stale cursor is preserved; unknown upstream messages are not exposed',async()=>{
 for(const [status,body,code] of [[409,{code:'TEST_READINESS_CURSOR_STALE',message:'secret=NEVER'},'TEST_READINESS_CURSOR_STALE'],[404,{code:'TEST_REGISTRY_ROUTE_NOT_FOUND'},'TEST_READINESS_UPSTREAM_INCOMPATIBLE'],[500,{message:'password=NEVER'},'TEST_READINESS_UPSTREAM_UNAVAILABLE']]){
 await assert.rejects(()=>getProjectTestReadiness({env:{TEST_REGISTRY_SERVICE:{fetch:async()=>Response.json(body,{status})}},...scope,query}),e=>e.code===code&&!e.message.includes('NEVER'));
 }
});
test('malformed, oversized responses and network failures do not become empty success',async()=>{
 for(const [fn,code] of [[async()=>new Response('not json'),'TEST_READINESS_RESPONSE_INVALID'],[async()=>new Response('x'.repeat(1_048_577)),'TEST_READINESS_RESPONSE_INVALID'],[async()=>{throw Error('network secret');},'TEST_READINESS_UPSTREAM_UNAVAILABLE']])await assert.rejects(()=>getProjectTestReadiness({env:{TEST_REGISTRY_SERVICE:{fetch:fn}},...scope,query}),{code});
});
test('client timeout cancels private request and returns safe timeout code',async()=>{
 const env={TEST_REGISTRY_TIMEOUT_MS:1000,TEST_REGISTRY_SERVICE:{fetch:r=>new Promise((_,reject)=>r.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))))}};
 await assert.rejects(()=>getProjectTestReadiness({env,...scope,query}),{code:'TEST_READINESS_UPSTREAM_TIMEOUT',status:504});
});

test('timeout also bounds a body stream after service-binding headers have arrived',async()=>{
 let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
 const env={TEST_REGISTRY_TIMEOUT_MS:1000,TEST_REGISTRY_SERVICE:{fetch:async()=>new Response(body)}};
 await assert.rejects(()=>getProjectTestReadiness({env,...scope,query}),{code:'TEST_READINESS_UPSTREAM_TIMEOUT',status:504});
 assert.equal(cancelled,true);
});
