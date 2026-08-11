import assert from 'node:assert';
import { handleGenerateTests } from '../src/handlers/generateTests.js';

const env = {
  OPENAI_API_KEY: 'test',
  QAGENT_ADMIN_TOKENS: 'admin_token',
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX: 20,
  MAX_BODY_BYTES: 25000,
};
const rateLimiter = () => {};

async function testInvalidPayload() {
  const aiEngine = {
    async generateJson() { throw new Error('should not be called'); },
    async repairJson() { return null; },
  };
  const req = { headers: new Map([['Authorization', 'Bearer admin_token_12345678901234567890']]), json: async () => ({}) };
  try {
    await handleGenerateTests(req, env, { aiEngine, rateLimiter });
    assert.fail('Expected validation error');
  } catch (e) {
    assert.strictEqual(e.status, 400);
  }
}

async function testValidPayloadUsesAiEngine() {
  let received = null;
  const mockAiEngine = {
    async generateJson(input) {
      received = input;
      return { json: { cases: [{ id: 'TC-001', title: 'Test', steps: [] }], score: { value: 3, reason: 'ok' } } };
    },
    async repairJson() { return null; },
  };
  const req = {
    headers: new Map([['Authorization', 'Bearer admin_token_12345678901234567890']]),
    json: async () => ({ jira: { key: 'JIRA-1', title: 'Title', description: 'Desc' }, format: 'step', context: {} })
  };
  const resp = await handleGenerateTests(req, env, { aiEngine: mockAiEngine, rateLimiter });
  assert.strictEqual(received.capability, 'test-generation');
  assert.ok(Array.isArray(resp.cases));
  assert.strictEqual(resp.meta.model, 'gpt-4o-mini');
  assert.strictEqual(resp.meta.mode, 'ai');
}

async function testDedicatedGenerationModel() {
  let model = null;
  const aiEngine = {
    async generateJson(input) {
      model = input.model;
      return { json: { cases: [], score: { value: 1, reason: 'ok' } } };
    },
    async repairJson() { return null; },
  };
  const req = {
    headers: new Map([['Authorization', 'Bearer admin_token_12345678901234567890']]),
    json: async () => ({ jira: { key: 'JIRA-2', title: 'Title', description: 'Desc' }, format: 'step', context: {} })
  };
  await handleGenerateTests(req, { ...env, GENERATE_TESTS_MODEL: 'model-tests', AUTOFILL_MODEL: 'model-autofill' }, { aiEngine, rateLimiter });
  assert.strictEqual(model, 'model-tests');
}



async function testAccountAiConfigOverridesEnvAndBrowserModel() {
  let received = null;
  const mockAiEngine = {
    async generateJson(input) {
      received = input;
      return { json: { cases: [], score: { value: 2, reason: 'ok' } } };
    },
    async repairJson() { return null; },
  };
  const resolveAiConfig = async (_env, input) => {
    assert.strictEqual(input.accountId, 'cus_company');
    return {
      source: 'account',
      provider: 'openai',
      credentials: { apiKey: 'company-key' },
      model: 'company-controlled-model',
    };
  };
  const req = {
    headers: new Map([['Authorization', 'Bearer admin_token_12345678901234567890']]),
    json: async () => ({
      jira: { key: 'JIRA-3', title: 'Title', description: 'Desc' },
      format: 'step',
      context: {},
      meta: { model: 'browser-model-must-not-win' },
    }),
  };
  const resp = await handleGenerateTests(req, env, {
    aiEngine: mockAiEngine,
    rateLimiter,
    accountId: 'cus_company',
    resolveAiConfig,
  });
  assert.strictEqual(received.provider, 'openai');
  assert.strictEqual(received.credentials.apiKey, 'company-key');
  assert.strictEqual(received.model, 'company-controlled-model');
  assert.strictEqual(resp.meta.aiConfigSource, 'account');
  assert.strictEqual(resp.meta.model, 'company-controlled-model');
}


async function testUpstreamFailureDoesNotTriggerRepair() {
  let repairCalls = 0;
  const logs = [];
  const upstreamError = new Error('gemini upstream failed');
  upstreamError.code = 'AI_UPSTREAM_ERROR';
  upstreamError.upstreamFailed = true;
  upstreamError.upstreamStatus = 429;
  upstreamError.upstreamCode = 'too_many_requests';
  upstreamError.retryable = true;
  upstreamError.retryAfterMs = 55722;
  upstreamError.rawText = '{"error":{"code":"too_many_requests"}}';

  const aiEngine = {
    async generateJson() { throw upstreamError; },
    async repairJson() { repairCalls += 1; return null; },
  };
  const resolveAiConfig = async () => ({
    source: 'account',
    provider: 'gemini',
    credentials: { apiKey: 'company-key' },
    model: 'gemini-2.5-flash',
  });
  const req = {
    headers: new Map([['Authorization', 'Bearer admin_token_12345678901234567890']]),
    json: async () => ({ jira: { key: 'JIRA-429', title: 'Title', description: 'Desc' }, format: 'step', context: {} }),
  };

  const resp = await handleGenerateTests(req, { ...env, log: (...args) => logs.push(args) }, {
    aiEngine,
    rateLimiter,
    accountId: 'cus_company',
    resolveAiConfig,
  });

  assert.strictEqual(repairCalls, 0, 'erro HTTP upstream não pode chamar repairJson');
  assert.strictEqual(resp.meta.mode, 'stub');
  assert.strictEqual(resp.meta.repairAttempts, 0);
  assert.strictEqual(resp.meta.provider, 'gemini');
  assert.strictEqual(resp.meta.upstreamStatus, 429);
  assert.strictEqual(resp.meta.upstreamCode, 'too_many_requests');
  assert.strictEqual(resp.meta.retryAfterMs, 55722);
  assert.strictEqual(resp.meta.retryable, true);
  assert.ok(logs.some(([event]) => event === 'generateTests_ai_error'));
}

async function testInvalidJsonResponseTriggersSingleRepair() {
  let repairCalls = 0;
  const formatError = new Error('invalid json');
  formatError.code = 'AI_INVALID_JSON';
  formatError.upstreamFailed = false;
  formatError.upstreamStatus = 200;
  formatError.contentText = 'quase json';

  const aiEngine = {
    async generateJson() { throw formatError; },
    async repairJson() {
      repairCalls += 1;
      return {
        cases: [{ id: 'TC-001', title: 'Repaired', objective: '', preconditions: [], steps: [], tags: [], priority: 'Medium' }],
        score: { value: 2, reason: 'repaired' },
      };
    },
  };
  const req = {
    headers: new Map([['Authorization', 'Bearer admin_token_12345678901234567890']]),
    json: async () => ({ jira: { key: 'JIRA-R', title: 'Title', description: 'Desc' }, format: 'step', context: {} }),
  };

  const resp = await handleGenerateTests(req, env, { aiEngine, rateLimiter });
  assert.strictEqual(repairCalls, 1);
  assert.strictEqual(resp.meta.mode, 'ai');
  assert.strictEqual(resp.meta.repairAttempts, 1);
  assert.strictEqual(resp.cases[0].title, 'Repaired');
}

await testInvalidPayload();
await testValidPayloadUsesAiEngine();
await testDedicatedGenerationModel();
await testAccountAiConfigOverridesEnvAndBrowserModel();
await testUpstreamFailureDoesNotTriggerRepair();
await testInvalidJsonResponseTriggersSingleRepair();
console.log('generateTests handler tests passed ✅');
