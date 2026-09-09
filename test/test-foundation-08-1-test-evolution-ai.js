import assert from 'node:assert/strict';
import { assessTestEvolutionWithAi, normalizeTestEvolutionAiOutput } from '../src/services/testEvolutionAiService.js';

const normalized = normalizeTestEvolutionAiOutput({
  classification: 'expected_behavior_learned',
  decision: 'evolve_test',
  confidence: 0.97,
  reasonCodes: ['expected_status_confirmed', 'expected_status_confirmed'],
  rationale: 'Stable validation behavior.',
});
assert.deepEqual(normalized, {
  classification: 'EXPECTED_BEHAVIOR_LEARNED',
  decision: 'EVOLVE_TEST',
  confidence: 97,
  reasonCodes: ['EXPECTED_STATUS_CONFIRMED'],
  rationale: 'Stable validation behavior.',
});

assert.throws(() => normalizeTestEvolutionAiOutput({
  classification: 'MAKE_TEST_PASS',
  decision: 'EVOLVE_TEST',
  confidence: 99,
}), /unsupported classification/i);

let capturedResolve = null;
let capturedRequest = null;
const result = await assessTestEvolutionWithAi({
  env: { TEST_EVOLUTION_MODEL: 'gpt-test-evolution', TEST_EVOLUTION_AI_TIMEOUT_MS: '22000' },
  accountId: 'cus_company_1',
  context: {
    contractVersion: 'qagent.test-evolution-evidence-context.v1',
    currentTest: { candidateChanges: [{ changeType: 'ADD_JSON_PATH_EQUALS_ASSERTION' }] },
    currentExecution: { http: { statusCode: 400 } },
  },
  resolveAiConfig: async (_env, input) => {
    capturedResolve = input;
    return { source: 'account', provider: 'openai', credentials: { apiKey: 'unit-secret' }, model: 'gpt-company', configId: 'aicfg_1' };
  },
  aiEngine: {
    async generateJson(request) {
      capturedRequest = request;
      return {
        json: {
          classification: 'EXPECTED_BEHAVIOR_LEARNED',
          decision: 'EVOLVE_TEST',
          confidence: 98,
          reasonCodes: ['REPEATED_EVIDENCE'],
          rationale: 'Observed behavior matches the validation intent.',
        },
        provider: 'openai',
        model: 'gpt-company',
      };
    },
  },
});

assert.equal(capturedResolve.accountId, 'cus_company_1');
assert.equal(capturedResolve.capability, 'test-evolution');
assert.equal(capturedResolve.fallbackModel, 'gpt-test-evolution');
assert.equal(capturedRequest.capability, 'test-evolution');
assert.equal(capturedRequest.provider, 'openai');
assert.equal(capturedRequest.model, 'gpt-company');
assert.equal(capturedRequest.temperature, 0);
assert.equal(capturedRequest.timeoutMs, 22000);
assert.match(capturedRequest.systemPrompt, /NOT blind self-healing/);
assert.match(capturedRequest.systemPrompt, /APPLICATION_BUG_SUSPECTED/);
assert.match(capturedRequest.systemPrompt, /REQUEST_BODY_FIELD_ADD/);
assert.match(capturedRequest.systemPrompt, /Structural BODY add\/remove changes are human-review gated/);
assert.equal(result.assessment.confidence, 98);
assert.equal(result.ai.configSource, 'account');

console.log('Foundation 08.1 Test Evolution AI / BYOAI boundary: PASS');
