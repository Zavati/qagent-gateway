import assert from 'node:assert/strict';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { getResultsProjectSummary } from '../src/services/resultsReadClient.js';
import { getConsoleAutomationSummary } from '../src/handlers/consoleAutomation.js';

assert.equal(resolveGatewayRoute('GET','/v1/console/projects/prj_a/automation/summary')?.name, 'consoleAutomationSummaryGet');
assert.equal(resolveGatewayRoute('GET','/v1/console/projects/prj_a/automation/results')?.name, 'consoleAutomationResultsList');
assert.equal(resolveGatewayRoute('GET','/v1/console/projects/prj_a/automation/results/rset_abc')?.name, 'consoleAutomationResultGet');
assert.equal(resolveGatewayRoute('GET','/v1/console/projects/prj_a/catalog/endpoints/cep_a/automation/latest')?.name, 'consoleEndpointAutomationLatestGet');

let forwarded = null;
const responseData = { contractVersion: 'qagent.execution-results-read.v1', executionCount: 1, passRate: 100 };
const result = await getResultsProjectSummary({
  env: { RESULTS_READ_TIMEOUT_MS:'10000' }, organizationId:'org_a', projectId:'prj_a', days:30,
  fetchImpl: async (request) => {
    forwarded = request;
    return new Response(JSON.stringify({status:'ok',data:responseData}), {status:200,headers:{'content-type':'application/json'}});
  },
});
assert.equal(result.executionCount,1);
assert.equal(forwarded.headers.get('X-QAgent-Organization-Id'),'org_a');
assert.equal(forwarded.headers.get('X-QAgent-Project-Id'),'prj_a');
assert.match(forwarded.url,/days=30/);

let projectChecked = false;
const req = new Request('https://api.apiqagent.com/v1/console/projects/prj_a/automation/summary?days=14', { headers: { Authorization:'Bearer session' } });
const body = await getConsoleAutomationSummary(req, {}, {projectId:'prj_a'}, {
  requireTenant: async () => ({organizationId:'org_a'}),
  getProject: async (_env, org, project) => { assert.equal(org,'org_a'); assert.equal(project,'prj_a'); projectChecked=true; },
  getSummary: async (input) => { assert.equal(input.organizationId,'org_a'); assert.equal(input.days,'14'); return responseData; },
});
assert.equal(projectChecked,true);
assert.equal(body.data.passRate,100);
console.log('Foundation 07.7.9-C Gateway Results bridge: PASS');
