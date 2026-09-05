import assert from 'node:assert/strict';
import { handleTestEvolutionQueue } from '../src/handlers/testEvolutionQueue.js';

function fakeMessage(body) {
  return {
    id: 'msg_1', body,
    acked: false, retried: false,
    ack() { this.acked = true; },
    retry() { this.retried = true; },
  };
}

// A result emitted by the bounded auto-rerun must never start another automatic evolution chain.
const rerunMessage = fakeMessage({
  contractVersion: 'qagent.test-evolution-result-trigger.v1',
  organizationId: 'org_123',
  projectId: 'prj_123',
  resultSetId: `rset_${'a'.repeat(64)}`,
  runId: 'run_123',
  scenarioIds: ['scn_1'],
});
const db = {
  prepare() {
    return {
      bind() { return this; },
      async first() {
        return {
          runId: 'run_123', organizationId: 'org_123', projectId: 'prj_123',
          idempotencyKey: 'test-evolution-rerun:tep_1:tdv_2',
          scenarioIdsJson: '["scn_1"]', scenarioCount: 1, testDesignVersion: 2,
        };
      },
    };
  },
};
await handleTestEvolutionQueue({ queue: 'qagent-test-evolution', messages: [rerunMessage] }, { QAGENT_DB: db });
assert.equal(rerunMessage.acked, true);
assert.equal(rerunMessage.retried, false);

// Invalid trigger is fail-closed and acknowledged instead of poisoning the queue.
const invalid = fakeMessage({ contractVersion: 'wrong' });
await handleTestEvolutionQueue({ queue: 'qagent-test-evolution', messages: [invalid] }, {});
assert.equal(invalid.acked, true);
assert.equal(invalid.retried, false);

console.log('Foundation 08.1 Test Evolution queue bounded rerun: PASS');
