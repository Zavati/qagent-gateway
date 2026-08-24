import assert from 'node:assert/strict';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { getProjectTestInventory, materializeAutoReadySuite } from '../src/services/testRegistryClient.js';
import { getConsoleProjectTestInventory, postConsoleMaterializeAutoReadySuite } from '../src/handlers/consoleAutomation.js';

assert.equal(resolveGatewayRoute('GET','/v1/console/projects/prj_a/automation/test-inventory')?.name, 'consoleAutomationTestInventoryGet');
assert.equal(resolveGatewayRoute('POST','/v1/console/projects/prj_a/automation/suites/auto-ready/materialize')?.name, 'consoleAutomationAutoSuiteMaterializePost');
assert.equal(resolveGatewayRoute('GET','/v1/console/projects/prj_a/automation/suites/auto-ready/latest')?.name, 'consoleAutomationAutoSuiteLatestGet');

const inventory = {
  contractVersion:'qagent.project-test-inventory.v1', organizationId:'org_a', projectId:'prj_a', inventoryFingerprint:'a'.repeat(64),
  testDesignCount:2, endpointWithReadyCount:1, scenarioCount:5, readyScenarioCount:3, blockedScenarioCount:2,
  reviewRequiredScenarioCount:1, needsDataScenarioCount:1, needsAuthScenarioCount:0, executable:true, items:[],
  selection:[{endpointId:'cep_a',testDesignId:'td_a',testDesignVersionId:'tdv_a',testDesignVersion:4,scenarioIds:['test_001','test_003','test_004']}], computedAt:'2026-08-24T20:00:00.000Z'
};
let forwarded = null;
const got = await getProjectTestInventory({
  env:{}, organizationId:'org_a', projectId:'prj_a',
  fetchImpl: async (request) => { forwarded=request; return new Response(JSON.stringify({status:'ok',data:inventory}),{status:200}); },
});
assert.equal(got.readyScenarioCount,3);
assert.equal(forwarded.headers.get('X-QAgent-Organization-Id'),'org_a');
assert.equal(forwarded.headers.get('X-QAgent-Project-Id'),'prj_a');
assert.match(forwarded.url,/\/test-inventory$/);

const suiteData = {
  contractVersion:'qagent.test-suite.v1', created:true, unchanged:false,
  suite:{suiteId:'suite_'+ 'b'.repeat(64),organizationId:'org_a',projectId:'prj_a',suiteType:'AUTO_PROJECT_READY',name:'Regressão automática',status:'ACTIVE',latestVersion:1,latestVersionId:'suitev_123',createdAt:'x',updatedAt:'x'},
  version:{contractVersion:'qagent.test-suite-version.v1',suiteVersionId:'suitev_123',suiteId:'suite_'+ 'b'.repeat(64),organizationId:'org_a',projectId:'prj_a',version:1,sourceType:'ZERO_CONFIG_PROJECT_READY',selectionPolicy:'LATEST_TEST_DESIGNS_READY_SCENARIOS',selectionPolicyVersion:'qagent.suite-selection-policy.v1',inventoryFingerprint:'a'.repeat(64),testDesignCount:2,endpointCount:1,scenarioCount:3,selection:inventory.selection,createdAt:'x'},
  inventory,
};
const materialized = await materializeAutoReadySuite({
  env:{}, organizationId:'org_a', projectId:'prj_a',
  fetchImpl: async () => new Response(JSON.stringify({status:'ok',data:suiteData}),{status:201}),
});
assert.equal(materialized.version.scenarioCount,3);

let authorized = false;
const request = new Request('https://api.apiqagent.com/v1/console/projects/prj_a/automation/test-inventory');
const response = await getConsoleProjectTestInventory(request, {}, {projectId:'prj_a'}, {
  requireTenant: async () => ({organizationId:'org_a'}),
  getProject: async (_env,org,project) => { assert.equal(org,'org_a'); assert.equal(project,'prj_a'); authorized=true; },
  getInventory: async () => inventory,
});
assert.equal(authorized,true);
assert.equal(response.data.endpointWithReadyCount,1);

const postResult = await postConsoleMaterializeAutoReadySuite(new Request('https://api.apiqagent.com/v1/console/projects/prj_a/automation/suites/auto-ready/materialize',{method:'POST'}), {}, {projectId:'prj_a'}, {
  requireTenant: async () => ({organizationId:'org_a'}), getProject: async () => ({}), materializeSuite: async () => suiteData,
});
assert.equal(postResult.data.version.suiteVersionId,'suitev_123');

console.log('Foundation 07.7.10-A Gateway Suite/Inventory bridge: PASS');
