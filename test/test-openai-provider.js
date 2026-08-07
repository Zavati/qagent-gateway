import assert from 'node:assert';
import { openaiProvider } from '../src/ai/providers/openaiProvider.js';

const originalFetch = globalThis.fetch;

try {
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '{"actions":[{"selector":"#name","value":"Igor"}]}' }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await openaiProvider.generateJson({
    env: { OPENAI_API_KEY: 'test-key' },
    model: 'gpt-test',
    systemPrompt: 'system instructions',
    userPrompt: 'user instructions',
    temperature: 0,
    maxOutputTokens: 500,
    timeoutMs: 1000,
    retries: 0,
  });

  assert.strictEqual(captured.url, 'https://api.openai.com/v1/responses');
  assert.strictEqual(captured.init.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(captured.init.body);
  assert.strictEqual(body.model, 'gpt-test');
  assert.strictEqual(body.input[0].role, 'system');
  assert.strictEqual(body.input[0].content[0].text, 'system instructions');
  assert.strictEqual(body.input[1].role, 'user');
  assert.strictEqual(body.input[1].content[0].text, 'user instructions');
  assert.deepStrictEqual(result.json, { actions: [{ selector: '#name', value: 'Igor' }] });
  assert.strictEqual(result.provider, 'openai');
  assert.strictEqual(result.status, 200);

  captured = null;
  await openaiProvider.generateJson({
    env: { OPENAI_API_KEY: 'env-key-should-not-win' },
    credentials: { apiKey: 'account-key' },
    model: 'gpt-test',
    userPrompt: 'account credential test',
    timeoutMs: 1000,
    retries: 0,
  });
  assert.strictEqual(captured.init.headers.Authorization, 'Bearer account-key');

  await assert.rejects(
    () => openaiProvider.generateJson({ env: {}, model: 'x', userPrompt: 'x' }),
    (err) => err?.code === 'AI_PROVIDER_NOT_CONFIGURED'
  );

  console.log('OpenAI provider tests passed ✅');
} finally {
  globalThis.fetch = originalFetch;
}
