import assert from 'node:assert';
import { geminiProvider } from '../src/ai/providers/geminiProvider.js';

const originalFetch = globalThis.fetch;

try {
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({
      id: 'int_test',
      model: 'gemini-test',
      object: 'interaction',
      status: 'completed',
      steps: [{
        type: 'model_output',
        content: [{
          type: 'text',
          text: '{"actions":[{"selector":"#name","value":"Igor"}]}',
        }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await geminiProvider.generateJson({
    env: { GEMINI_API_KEY: 'test-key' },
    model: 'gemini-test',
    systemPrompt: 'system instructions',
    userPrompt: 'user instructions',
    temperature: 0,
    maxOutputTokens: 500,
    timeoutMs: 1000,
    retries: 0,
  });

  assert.strictEqual(
    captured.url,
    'https://generativelanguage.googleapis.com/v1/interactions'
  );
  assert.strictEqual(captured.init.headers['x-goog-api-key'], 'test-key');

  const body = JSON.parse(captured.init.body);
  assert.strictEqual(body.model, 'gemini-test');
  assert.strictEqual(body.input, 'user instructions');
  assert.strictEqual(body.system_instruction, 'system instructions');
  assert.strictEqual(body.response_format.type, 'text');
  assert.strictEqual(body.response_format.mime_type, 'application/json');
  assert.strictEqual(body.generation_config.max_output_tokens, 500);
  assert.strictEqual(body.store, false);

  assert.deepStrictEqual(result.json, { actions: [{ selector: '#name', value: 'Igor' }] });
  assert.strictEqual(result.provider, 'gemini');
  assert.strictEqual(result.model, 'gemini-test');
  assert.strictEqual(result.status, 200);

  captured = null;
  await geminiProvider.generateJson({
    env: { GEMINI_API_KEY: 'env-key-should-not-win' },
    credentials: { apiKey: 'account-key' },
    model: 'models/gemini-account-test',
    userPrompt: 'account credential test',
    timeoutMs: 1000,
    retries: 0,
  });

  assert.strictEqual(captured.init.headers['x-goog-api-key'], 'account-key');
  assert.strictEqual(JSON.parse(captured.init.body).model, 'gemini-account-test');

  await assert.rejects(
    () => geminiProvider.generateJson({ env: {}, model: 'x', userPrompt: 'x' }),
    (err) => err?.code === 'AI_PROVIDER_NOT_CONFIGURED'
  );

  console.log('Gemini provider tests passed ✅');
} finally {
  globalThis.fetch = originalFetch;
}
