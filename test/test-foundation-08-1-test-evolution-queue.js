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

// 08.1.2: a bounded auto-rerun must not start a second evolution chain.
// Instead, its Result Set is verified and attributed to the proposal that created the rerun.
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
let verificationRequest=null;
const evolutionService={
  async fetch(req){
    verificationRequest={url:req.url,body:JSON.parse(await req.text()),organizationId:req.headers.get('X-QAgent-Organization-Id'),projectId:req.headers.get('X-QAgent-Project-Id')};
    return Response.json({status:'ok',data:{contractVersion:'qagent.test-evolution-outcome-verification.v1',proposalId:'tep_1',outcome:'RECOVERED_BY_EVOLUTION',recoveryConfirmed:true,reasonCode:'EVOLVED_RERUN_PASSED'}});
  },
};
await handleTestEvolutionQueue({ queue: 'qagent-test-evolution', messages: [rerunMessage] }, { QAGENT_DB: db, TEST_EVOLUTION_SERVICE:evolutionService });
assert.equal(rerunMessage.acked, true);
assert.equal(rerunMessage.retried, false);
assert.match(verificationRequest.url,/\/test-evolution-proposals\/tep_1\/verify-outcome$/);
assert.deepEqual(verificationRequest.body,{rerunRunId:'run_123',rerunResultSetId:`rset_${'a'.repeat(64)}`});
assert.equal(verificationRequest.organizationId,'org_123');
assert.equal(verificationRequest.projectId,'prj_123');

// Invalid trigger is fail-closed and acknowledged instead of poisoning the queue.
const invalid = fakeMessage({ contractVersion: 'wrong' });
await handleTestEvolutionQueue({ queue: 'qagent-test-evolution', messages: [invalid] }, {});
assert.equal(invalid.acked, true);
assert.equal(invalid.retried, false);

console.log('Foundation 08.1/08.1.2 Test Evolution queue bounded recovery attribution: PASS');
