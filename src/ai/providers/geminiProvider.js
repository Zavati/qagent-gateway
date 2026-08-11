import { geminiClient } from '../../lib/geminiClient.js';

function assertApiKey(env, credentials) {
  const apiKey = String(credentials?.apiKey || env?.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('Credencial Gemini não configurada para a organização nem no ambiente.');
    err.status = 500;
    err.code = 'AI_PROVIDER_NOT_CONFIGURED';
    throw err;
  }
  return apiKey;
}

export const geminiProvider = {
  name: 'gemini',

  async generateJson({
    env,
    credentials,
    model,
    userPrompt,
    systemPrompt = '',
    temperature = 0,
    maxOutputTokens = 1200,
    timeoutMs = 90_000,
    retries = 2,
    maxRetryWaitMs,
    retryBaseDelayMs,
    retryMaxDelayMs,
  }) {
    const apiKey = assertApiKey(env, credentials);
    const out = await geminiClient.callJsonResponse(model, userPrompt, {
      apiKey,
      apiVersion: env?.GEMINI_API_VERSION || 'v1',
      systemPrompt,
      temperature,
      maxOutputTokens,
      timeoutMs,
      retries,
      maxRetryWaitMs: Number.isFinite(maxRetryWaitMs) ? maxRetryWaitMs : Number(env?.AI_MAX_RETRY_WAIT_MS || 2500),
      retryBaseDelayMs: Number.isFinite(retryBaseDelayMs) ? retryBaseDelayMs : Number(env?.AI_RETRY_BASE_DELAY_MS || 500),
      retryMaxDelayMs: Number.isFinite(retryMaxDelayMs) ? retryMaxDelayMs : Number(env?.AI_RETRY_MAX_DELAY_MS || 2000),
    });

    return {
      ...out,
      provider: 'gemini',
      model,
    };
  },

  async repairJson({
    env,
    credentials,
    model,
    originalPrompt,
    rawText,
    systemPrompt = '',
    repairInstruction = '',
    temperature = 0,
    maxOutputTokens = 2000,
    timeoutMs = 25_000,
    retries = 0,
    maxRetryWaitMs,
    retryBaseDelayMs,
    retryMaxDelayMs,
  }) {
    const apiKey = assertApiKey(env, credentials);
    const instruction = repairInstruction
      || 'A resposta anterior não estava em JSON puro ou estava no formato errado. Retorne somente um JSON válido, sem markdown ou texto adicional.';

    const repairPrompt = `${originalPrompt}\n\n${instruction}\n\nResposta anterior:\n${rawText || ''}`;

    try {
      const out = await geminiClient.callJsonResponse(model, repairPrompt, {
        apiKey,
        systemPrompt,
        temperature,
        maxOutputTokens,
        timeoutMs,
        retries,
        maxRetryWaitMs: Number.isFinite(maxRetryWaitMs) ? maxRetryWaitMs : Number(env?.AI_MAX_RETRY_WAIT_MS || 2500),
        retryBaseDelayMs: Number.isFinite(retryBaseDelayMs) ? retryBaseDelayMs : Number(env?.AI_RETRY_BASE_DELAY_MS || 500),
        retryMaxDelayMs: Number.isFinite(retryMaxDelayMs) ? retryMaxDelayMs : Number(env?.AI_RETRY_MAX_DELAY_MS || 2000),
      });
      return out?.json || null;
    } catch (error) {
      if (error?.upstreamFailed) throw error;
      return null;
    }
  },
};
