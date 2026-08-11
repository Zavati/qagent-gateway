import assert from 'node:assert';
import { generateAutofillActions } from '../src/services/autofillAiService.js';

async function testHeuristicOnlySkipsAi() {
  let aiCalled = false;
  const engine = {
    async generateJson() { aiCalled = true; return { json: {} }; },
  };
  const result = await generateAutofillActions({
    url: 'https://example.com',
    elements: [{ selector: '#email', type: 'email', visible: true }],
  }, {}, { aiEngine: engine });

  assert.strictEqual(aiCalled, false);
  assert.strictEqual(result.meta.mode, 'heuristic');
  assert.strictEqual(result.actions[0].value, 'user@example.com');
}

async function testAiActionsAreMerged() {
  let received = null;
  const engine = {
    resolveProviderName() { return 'openai'; },
    async generateJson(input) {
      received = input;
      return { json: { actions: [{ selector: '#name', value: 'Igor', simulate: false }] } };
    },
    async repairJson() { return null; },
  };
  const result = await generateAutofillActions({
    url: 'https://example.com/form',
    elements: [
      { selector: '#email', type: 'email', visible: true },
      { selector: '#name', type: 'text', name: 'fullName', visible: true },
    ],
  }, { AUTOFILL_MODEL: 'model-a' }, { aiEngine: engine });

  assert.strictEqual(result.meta.mode, 'ai');
  assert.strictEqual(result.meta.model, 'model-a');
  assert.strictEqual(received.capability, 'autofill');
  assert.ok(received.systemPrompt);
  assert.strictEqual(result.actions.length, 2);
  assert.ok(result.actions.some((a) => a.selector === '#name' && a.value === 'Igor'));
}

async function testRepairWhenFirstResponseHasInvalidShape() {
  let repairCalled = false;
  const engine = {
    async generateJson() {
      return { json: { unexpected: true }, rawText: '{"unexpected":true}' };
    },
    async repairJson() {
      repairCalled = true;
      return { actions: [{ selector: '#name', value: 'Maria' }] };
    },
  };
  const result = await generateAutofillActions({
    url: 'https://example.com/form',
    elements: [{ selector: '#name', type: 'text', name: 'fullName', visible: true }],
  }, {}, { aiEngine: engine });

  assert.strictEqual(repairCalled, true);
  assert.strictEqual(result.meta.repairAttempts, 1);
  assert.strictEqual(result.actions[0].value, 'Maria');
}


async function testUpstreamFailureIsNotMaskedByHeuristics() {
  const engine = {
    async generateJson() {
      const err = new Error('Failed to get valid JSON from OpenAI');
      err.upstreamFailed = true;
      err.upstreamStatus = 401;
      err.rawText = '{"error":"unauthorized"}';
      throw err;
    },
    async repairJson() { return null; },
  };

  await assert.rejects(
    () => generateAutofillActions({
      url: 'https://example.com/form',
      elements: [{ selector: '#name', type: 'text', name: 'fullName', visible: true }],
    }, {}, { aiEngine: engine }),
    (err) => err?.status === 502 && /HTTP 401/.test(err?.message || '')
  );
}




async function testRateLimitPreserves429AndRetryAfter() {
  const engine = {
    async generateJson() {
      const err = new Error('rate limited');
      err.upstreamFailed = true;
      err.upstreamStatus = 429;
      err.upstreamCode = 'too_many_requests';
      err.retryable = true;
      err.retryAfterMs = 55000;
      err.rawText = '{"error":"rate"}';
      throw err;
    },
    async repairJson() { throw new Error('repair must not be called'); },
  };

  await assert.rejects(
    () => generateAutofillActions({
      url: 'https://example.com/form',
      elements: [{ selector: '#name', type: 'text', name: 'fullName', visible: true }],
    }, {}, { aiEngine: engine }),
    (err) => err?.status === 429
      && err?.code === 'AI_UPSTREAM_ERROR'
      && err?.upstreamCode === 'too_many_requests'
      && err?.retryAfterMs === 55000
  );
}

async function testAccountAiConfigControlsProviderCredentialsAndModel() {
  let received = null;
  const engine = {
    async generateJson(input) {
      received = input;
      return { json: { actions: [{ selector: '#name', value: 'Empresa' }] } };
    },
    async repairJson() { return null; },
  };
  const resolveAiConfig = async (_env, input) => {
    assert.strictEqual(input.accountId, 'cus_company');
    return {
      source: 'account',
      provider: 'openai',
      credentials: { apiKey: 'company-key' },
      model: 'company-autofill-model',
    };
  };

  const result = await generateAutofillActions({
    url: 'https://example.com/form',
    settings: { model: 'browser-model-must-not-win' },
    elements: [{ selector: '#name', type: 'text', name: 'fullName', visible: true }],
  }, {}, { aiEngine: engine, accountId: 'cus_company', resolveAiConfig });

  assert.strictEqual(received.provider, 'openai');
  assert.strictEqual(received.credentials.apiKey, 'company-key');
  assert.strictEqual(received.model, 'company-autofill-model');
  assert.strictEqual(result.meta.aiConfigSource, 'account');
}

await testHeuristicOnlySkipsAi();
await testAiActionsAreMerged();
await testRepairWhenFirstResponseHasInvalidShape();
await testUpstreamFailureIsNotMaskedByHeuristics();
await testRateLimitPreserves429AndRetryAfter();
await testAccountAiConfigControlsProviderCredentialsAndModel();
console.log('autofill AI service tests passed ✅');
