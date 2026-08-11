import {
  fetchTextWithTimeout,
  extractJsonFromText,
  getAiRetryDecision,
  waitForAiRetry,
  createAiUpstreamError,
  createAiResponseFormatError,
} from './aiHttp.js';

function extractGeminiInteractionText(bodyText) {
  if (!bodyText) return '';

  try {
    const payload = JSON.parse(bodyText);

    if (typeof payload?.output_text === 'string' && payload.output_text) {
      return payload.output_text;
    }

    const steps = Array.isArray(payload?.steps) ? payload.steps : [];
    const modelOutputs = steps.filter((step) => step?.type === 'model_output');
    const lastModelOutput = modelOutputs[modelOutputs.length - 1];
    const content = Array.isArray(lastModelOutput?.content) ? lastModelOutput.content : [];

    return content
      .map((item) => (item?.type === 'text' && typeof item?.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('');
  } catch {
    return '';
  }
}

function parseGeminiError(bodyText) {
  try {
    const payload = JSON.parse(bodyText || '{}');
    const error = payload?.error || {};
    const rawCode = error?.code;
    return {
      code: typeof rawCode === 'string'
        ? rawCode
        : (typeof error?.status === 'string' ? error.status : (rawCode ? String(rawCode) : null)),
      message: typeof error?.message === 'string' ? error.message : null,
    };
  } catch {
    return { code: null, message: null };
  }
}

function normalizeModel(model) {
  const normalized = String(model || '').trim().replace(/^models\//, '');
  if (!normalized) {
    const err = new Error('Modelo Gemini ausente.');
    err.status = 500;
    err.code = 'AI_MODEL_REQUIRED';
    throw err;
  }
  return normalized;
}

export const geminiClient = {
  async callJsonResponse(model, userPrompt, opts = {}) {
    const apiVersion = String(opts.apiVersion || 'v1').trim() || 'v1';
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/interactions`;
    const timeoutMs = opts.timeoutMs || 90_000;
    const retries = Number.isInteger(opts.retries) ? opts.retries : 2;
    const maxRetryWaitMs = Number.isFinite(opts.maxRetryWaitMs) ? opts.maxRetryWaitMs : 2_500;
    const retryBaseDelayMs = Number.isFinite(opts.retryBaseDelayMs) ? opts.retryBaseDelayMs : 500;
    const retryMaxDelayMs = Number.isFinite(opts.retryMaxDelayMs) ? opts.retryMaxDelayMs : 2_000;
    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': opts.apiKey || '',
    };

    const requestBody = {
      model: normalizeModel(model),
      input: String(userPrompt || ''),
      response_format: {
        type: 'text',
        mime_type: 'application/json',
      },
      generation_config: {
        max_output_tokens: typeof opts.maxOutputTokens === 'number' ? opts.maxOutputTokens : 1200,
      },
      store: false,
    };

    if (opts.systemPrompt) {
      requestBody.system_instruction = String(opts.systemPrompt);
    }

    const body = JSON.stringify(requestBody);

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const response = await fetchTextWithTimeout(url, {
        method: 'POST',
        headers,
        body,
      }, timeoutMs);

      if (response.ok) {
        const contentText = extractGeminiInteractionText(response.text || '');
        const json = extractJsonFromText(contentText);
        if (json) {
          return {
            json,
            rawText: response.text || '',
            contentText,
            status: response.status,
            ok: true,
          };
        }

        // HTTP 2xx com formato inválido é problema de saída, não de transporte.
        // O chamador pode fazer um único repair sem repetir a geração completa.
        throw createAiResponseFormatError('Gemini', {
          rawText: response.text || '',
          contentText,
          status: response.status,
        });
      }

      const upstream = parseGeminiError(response.text);
      const decision = getAiRetryDecision({
        status: response.status,
        attempt,
        retries,
        retryAfterMs: response.retryAfterMs,
        maxRetryWaitMs,
        baseDelayMs: retryBaseDelayMs,
        maxDelayMs: retryMaxDelayMs,
      });

      if (decision.retry) {
        await waitForAiRetry(decision.delayMs);
        continue;
      }

      throw createAiUpstreamError('gemini', response, {
        upstreamCode: upstream.code,
        upstreamMessage: upstream.message,
        retryable: decision.delayMs > maxRetryWaitMs || Boolean(
          response.status === 0 || response.status === 408 || response.status === 429 || response.status >= 500
        ),
      });
    }

    throw new Error('Gemini retry loop ended unexpectedly.');
  },
};
