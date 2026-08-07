import { openaiClient } from '../../lib/openaiClient.js';

function assertApiKey(env, credentials) {
  const apiKey = String(credentials?.apiKey || env?.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ausente no ambiente.');
    err.status = 500;
    err.code = 'AI_PROVIDER_NOT_CONFIGURED';
    throw err;
  }
  return apiKey;
}

export const openaiProvider = {
  name: 'openai',

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
    const out = await openaiClient.callJsonResponse(model, userPrompt, {
      apiKey,
      systemPrompt,
      temperature,
      max_output_tokens: maxOutputTokens,
      timeoutMs,
      retries,
    });

    return {
      ...out,
      provider: 'openai',
      model,
    };
  },

  async repairJson({
    env,
    credentials,
    capability,
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

    // Mantém o comportamento legado da geração de casos durante a migração.
    if (capability === 'test-generation' && !repairInstruction) {
      return openaiClient.repairJsonResponse(model, originalPrompt, rawText, {
        apiKey,
        systemPrompt,
        temperature,
        max_output_tokens: maxOutputTokens,
        timeoutMs,
        retries,
      });
    }

    const instruction = repairInstruction
      || 'A resposta anterior não estava em JSON puro ou estava no formato errado. Retorne somente um JSON válido, sem markdown ou texto adicional.';

    const repairPrompt = `${originalPrompt}\n\n${instruction}\n\nResposta anterior:\n${rawText || ''}`;

    try {
      const out = await openaiClient.callJsonResponse(model, repairPrompt, {
        apiKey,
        systemPrompt,
        temperature,
        max_output_tokens: maxOutputTokens,
        timeoutMs,
        retries,
      });
      return out?.json || null;
    } catch {
      return null;
    }
  },
};
