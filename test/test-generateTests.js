import assert from 'node:assert';
import { handleGenerateTests } from '../src/handlers/generateTests.js';
import { openaiClient } from '../src/lib/openaiClient.js';

// Mock env and rateLimiter
const env = { OPENAI_API_KEY: 'test', QAGENT_ADMIN_TOKENS: 'admin_token', RATE_LIMIT_WINDOW_MS: 60000, RATE_LIMIT_MAX: 20, MAX_BODY_BYTES: 25000 };
const rateLimiter = () => {};

async function testStubResponse() {
  // Should return stub if no token or invalid
  const req = { headers: new Map([['Authorization', 'Bearer admin_token']]), json: async () => ({}) };
  try {
    await handleGenerateTests(req, env, { openaiClient, rateLimiter });
  } catch (e) {
    assert.strictEqual(e.status, 400);
  }
}

async function testValidPayload() {
  // Should call OpenAI client and return cases/meta
  let called = false;
  const mockOpenaiClient = {
    async callJsonResponse(model, prompt, opts) {
      called = true;
      return { cases: [{ id: 'TC-001', title: 'Test', steps: [] }] };
    },
    async repairJsonResponse() { return null; },
  };
  const req = {
    headers: new Map([['Authorization', 'Bearer admin_token']]),
    json: async () => ({ jira: { key: 'JIRA-1', title: 'Title', description: 'Desc' }, format: 'step', context: {} })
  };
  const resp = await handleGenerateTests(req, env, { openaiClient: mockOpenaiClient, rateLimiter });
  assert.ok(called);
  assert.ok(Array.isArray(resp.cases));
  assert.strictEqual(resp.meta.model, 'gpt-4o-mini');
  assert.strictEqual(resp.meta.mode, 'ai');
}

async function run() {
  await testStubResponse();
  await testValidPayload();
  console.log('generateTests handler tests passed ✅');
}

run();
