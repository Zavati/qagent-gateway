import assert from 'node:assert/strict';
import { getLatestAutoReadySuite } from '../src/services/testRegistryClient.js';
import { getConsoleLatestAutoReadySuite } from '../src/handlers/consoleAutomation.js';

const organizationId = 'org_a';
const projectId = 'prj_a';
const suiteId = `suite_${'b'.repeat(64)}`;
const latestData = {
  exists: true,
  suite: {
    suiteId, organizationId, projectId, suiteType: 'AUTO_PROJECT_READY', name: 'Regressão automática',
    description: null, status: 'ACTIVE', latestVersion: 3, latestVersionId: 'suitev_3', createdAt: 'x', updatedAt: 'x',
  },
  version: {
    contractVersion: 'qagent.test-suite-version.v1', suiteVersionId: 'suitev_3', suiteId, organizationId, projectId,
    version: 3, sourceType: 'ZERO_CONFIG_PROJECT_READY', selectionPolicy: 'LATEST_TEST_DESIGNS_READY_SCENARIOS',
    selectionPolicyVersion: 'qagent.suite-selection-policy.v2', inventoryFingerprint: 'a'.repeat(64), testDesignCount: 2,
    endpointCount: 2, scenarioCount: 4, selectionIncluded: false, selection: [], createdAt: 'x',
  },
  snapshot: {
    contractVersion: 'qagent.evolution-aware-regression-snapshot.v1', state: 'OUTDATED', outdatedReason: 'TEST_DESIGN_EVOLVED',
    suiteInventoryFingerprint: 'a'.repeat(64), currentInventoryFingerprint: 'c'.repeat(64), changedTestDesignCount: 1,
    evolvedTestDesignCount: 1, versionChangedTestDesignCount: 0, addedTestDesignCount: 0, removedTestDesignCount: 0,
    noLongerReadyTestDesignCount: 0, selectionPolicyChanged: false, suiteSelectionPolicyVersion: 'qagent.suite-selection-policy.v2',
    currentSelectionPolicyVersion: 'qagent.suite-selection-policy.v2', changesIncluded: true, changesTruncated: false,
    changes: [{
      changeType: 'TEST_DESIGN_EVOLVED', endpointId: 'cep_1', testDesignId: 'td_1',
      from: {testDesignVersionId: 'tdv_old', testDesignVersion: 4},
      to: {testDesignVersionId: 'tdv_new', testDesignVersion: 5, readyScenarioCount: 2},
      evolution: {proposalId: 'tep_1', sourceTestDesignVersionId: 'tdv_old'},
    }],
  },
};

let forwarded = null;
const data = await getLatestAutoReadySuite({
  env: {}, organizationId, projectId,
  fetchImpl: async (request) => {
    forwarded = request;
    return new Response(JSON.stringify({status: 'ok', data: latestData}), {status: 200});
  },
});
assert.equal(data.snapshot.state, 'OUTDATED');
assert.equal(data.snapshot.outdatedReason, 'TEST_DESIGN_EVOLVED');
assert.equal(data.snapshot.evolvedTestDesignCount, 1);
assert.match(forwarded.url, /\/suites\/auto-ready\/latest\?view=compact&snapshot=1$/);

const handled = await getConsoleLatestAutoReadySuite(
  new Request(`https://api.apiqagent.com/v1/console/projects/${projectId}/automation/suites/auto-ready/latest`),
  {}, {projectId}, {
    requireTenant: async () => ({organizationId}), getProject: async () => ({}), getLatestSuite: async () => latestData,
  },
);
assert.equal(handled.data.snapshot.changes[0].to.testDesignVersion, 5);

await assert.rejects(
  getLatestAutoReadySuite({
    env: {}, organizationId, projectId,
    fetchImpl: async () => new Response(JSON.stringify({status: 'ok', data: {...latestData, snapshot: {...latestData.snapshot, evolvedTestDesignCount: '1'}}}), {status: 200}),
  }),
  (error) => error?.code === 'TEST_REGISTRY_SUITE_RESPONSE_INVALID',
);

console.log('08.1.3-A Gateway evolution-aware regression snapshot bridge: PASS');
