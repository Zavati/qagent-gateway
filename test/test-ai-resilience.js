import assert from 'node:assert';
import {
  parseRetryAfterMs,
  extractRetryDelayMsFromBody,
  getAiRetryDecision,
} from '../src/lib/aiHttp.js';
import { geminiProvider } from '../src/ai/providers/geminiProvider.js';
import { openaiProvider } from '../src/ai/providers/openaiProvider.js';

const originalFetch = globalThis.fetch;

async function testRetryParsingAndPolicy() {
  assert.strictEqual(parseRetryAfterMs('2'), 2000);
  assert.strictEqual(
    extractRetryDelayMsFromBody(JSON.stringify({ error: { message: 'Please retry in 55.721784785s.' } })),
    55722
  );

  assert.deepStrictEqual(
    getAiRetryDecision({ status: 400, attempt: 0, retries: 2 }),
    { retry: false, delayMs: 0 }
  );

  const long429 = getAiRetryDecision({
    status: 429,
    attempt: 0,
    retries: 2,
    retryAfterMs: 55_000,
    maxRetryWaitMs: 2_500,
  });
  assert.strictEqual(long429.retry, false);
  assert.strictEqual(long429.delayMs, 55_000);

  const short503 = getAiRetryDecision({
    status: 503,
    attempt: 0,
    retries: 2,
    baseDelayMs: 0,
    maxDelayMs: 0,
  });
  assert.strictEqual(short503.retry, true);
  assert.strictEqual(short503.delayMs, 0);
}

async function testGeminiDoesNotRetryClientErrors() {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      error: { message: 'bad request', code: 'invalid_request' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    () => geminiProvider.generateJson({
      env: { GEMINI_API_KEY: 'test' },
      model: 'gemini-test',
      userPrompt: 'x',
      retries: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    }),
    (err) => err?.upstreamStatus === 400
      && err?.upstreamCode === 'invalid_request'
      && err?.upstreamFailed === true
      && err?.retryable === false
  );
  assert.strictEqual(calls, 1);
}

async function testGeminiLong429IsSurfacedWithoutRetry() {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      error: {
        message: 'Quota exceeded. Please retry in 55.721784785s.',
        code: 'too_many_requests',
      },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    () => geminiProvider.generateJson({
      env: { GEMINI_API_KEY: 'test' },
      model: 'gemini-2.5-flash',
      userPrompt: 'x',
      retries: 2,
      maxRetryWaitMs: 2500,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    }),
    (err) => err?.upstreamStatus === 429
      && err?.upstreamCode === 'too_many_requests'
      && err?.retryable === true
      && err?.retryAfterMs === 55722
  );
  assert.strictEqual(calls, 1, '429 longo não deve multiplicar chamadas ao Gemini');
}

async function testGeminiRetriesTransient5xxThenSucceeds() {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: 'temporary', status: 'UNAVAILABLE' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"ok":true}' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await geminiProvider.generateJson({
    env: { GEMINI_API_KEY: 'test' },
    model: 'gemini-test',
    userPrompt: 'x',
    retries: 2,
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
  });

  assert.deepStrictEqual(result.json, { ok: true });
  assert.strictEqual(calls, 2);
}

async function testGeminiInvalidJsonDoesNotRepeatGeneration() {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'not-json' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    () => geminiProvider.generateJson({
      env: { GEMINI_API_KEY: 'test' },
      model: 'gemini-test',
      userPrompt: 'x',
      retries: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    }),
    (err) => err?.code === 'AI_INVALID_JSON' && err?.upstreamFailed === false
  );
  assert.strictEqual(calls, 1, 'JSON inválido deve ir para repair, não repetir geração completa');
}

async function testOpenAiDoesNotRetryQuota429() {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      error: {
        message: 'You exceeded your current quota.',
        type: 'insufficient_quota',
        code: 'credit_balance_exhausted',
      },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    () => openaiProvider.generateJson({
      env: { OPENAI_API_KEY: 'test' },
      model: 'gpt-test',
      userPrompt: 'x',
      retries: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    }),
    (err) => err?.upstreamStatus === 429
      && err?.upstreamCode === 'credit_balance_exhausted'
      && err?.retryable === false
  );
  assert.strictEqual(calls, 1, 'quota/billing OpenAI não deve ser retentada');
}

async function testOpenAiRetriesTransient5xxThenSucceeds() {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: 'server error', type: 'server_error' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await openaiProvider.generateJson({
    env: { OPENAI_API_KEY: 'test' },
    model: 'gpt-test',
    userPrompt: 'x',
    retries: 2,
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
  });

  assert.deepStrictEqual(result.json, { ok: true });
  assert.strictEqual(calls, 2);
}

try {
  await testRetryParsingAndPolicy();
  await testGeminiDoesNotRetryClientErrors();
  await testGeminiLong429IsSurfacedWithoutRetry();
  await testGeminiRetriesTransient5xxThenSucceeds();
  await testGeminiInvalidJsonDoesNotRepeatGeneration();
  await testOpenAiDoesNotRetryQuota429();
  await testOpenAiRetriesTransient5xxThenSucceeds();
  console.log('AI resilience tests passed ✅');
} finally {
  globalThis.fetch = originalFetch;
}
