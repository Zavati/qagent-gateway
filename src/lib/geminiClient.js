import { fetchTextWithTimeout, extractJsonFromText } from './aiHttp.js';

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

    let lastText = '';
    let lastContentText = '';
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const response = await fetchTextWithTimeout(url, {
        method: 'POST',
        headers,
        body,
      }, timeoutMs);

      lastText = response.text || '';
      lastStatus = response.status || 0;

      if (!response.ok) continue;

      lastContentText = extractGeminiInteractionText(lastText);
      const json = extractJsonFromText(lastContentText);
      if (json) {
        return {
          json,
          rawText: lastText,
          contentText: lastContentText,
          status: response.status,
          ok: true,
        };
      }
    }

    const err = new Error('Failed to get valid JSON from Gemini');
    err.rawText = lastText;
    err.contentText = lastContentText;
    err.upstreamStatus = lastStatus;
    err.upstreamFailed = lastStatus === 0 || lastStatus < 200 || lastStatus >= 300;
    throw err;
  },
};
