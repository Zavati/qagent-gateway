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
      });
      return out?.json || null;
    } catch {
      return null;
    }
  },
};
