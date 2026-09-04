import assert from 'node:assert/strict';
import { postConsoleRun } from '../src/handlers/consoleRuns.js';

const tenant = { organizationId: 'org_x', organizationRole: 'owner', user: { userId: 'usr_x' } };
const projectId = 'prj_x';

async function request(body) {
  return new Request('https://api.apiqagent.com/v1/console/projects/prj_x/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'idem_12345678' },
    body: JSON.stringify(body),
  });
}

{
  let singleCalled = 0;
  let batchCalled = 0;
  const result = await postConsoleRun(await request({
    contractVersion: 'qagent.run-create.v1',
    testDesignVersionId: 'tdv_12345678',
    environmentId: 'env_12345678',
    scenarioIds: ['test_a'],
  }), {}, { projectId }, {
    requireTenant: async () => tenant,
    getProject: async () => ({ projectId }),
    createRun: async ({ input }) => { singleCalled++; return { run: { runId: 'run_single1234', scenarioIds: input.scenarioIds } }; },
    createRunBatch: async () => { batchCalled++; return {}; },
  });
  assert.equal(singleCalled, 1);
  assert.equal(batchCalled, 0);
  assert.equal(result.data.run.runId, 'run_single1234');
}

{
  let singleCalled = 0;
  let batchCalled = 0;
  const result = await postConsoleRun(await request({
    contractVersion: 'qagent.run-batch-create.v1',
    testDesignVersionId: 'tdv_12345678',
    environmentId: 'env_12345678',
    scenarioIds: ['test_a', 'test_b'],
  }), {}, { projectId }, {
    requireTenant: async () => tenant,
    getProject: async () => ({ projectId }),
    createRun: async () => { singleCalled++; return {}; },
    createRunBatch: async ({ input }) => { batchCalled++; return { contractVersion: 'qagent.run-batch.v1', runs: [], requestedScenarioCount: input.scenarioIds.length }; },
  });
  assert.equal(singleCalled, 0);
  assert.equal(batchCalled, 1);
  assert.equal(result.data.contractVersion, 'qagent.run-batch.v1');
  assert.equal(result.data.requestedScenarioCount, 2);
}

console.log('07.7.8-D FIX-1.1 stable /runs boundary: ok');
