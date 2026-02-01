import { fetchTextWithTimeout, parseResponsesContent, extractJsonFromText } from './openai.js';

// Robust OpenAI Responses API client for JSON output
export const openaiClient = {
  async callJsonResponse(model, prompt, opts = {}) {
    const url = 'https://api.openai.com/v1/responses';
    const timeoutMs = opts.timeoutMs || 60000;
    const retries = opts.retries || 2;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey || ''}`,
    };
    const body = JSON.stringify({ model, prompt });
    let lastText = '', lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetchTextWithTimeout(url, { method: 'POST', headers, body }, timeoutMs);
      lastText = res.text;
      if (!res.ok) {
        lastErr = new Error(`OpenAI error: ${res.status}`);
        continue;
      }
      const content = parseResponsesContent(lastText);
      const json = extractJsonFromText(content);
      if (json) return json;
      lastErr = new Error('No valid JSON in response');
    }
    const err = new Error('Failed to get valid JSON from OpenAI');
    err.rawText = lastText;
    throw err;
  },

  // Attempts to repair a non-JSON response by re-prompting with explicit instructions
  async repairJsonResponse(model, originalPrompt, rawText, opts = {}) {
    const repairPrompt = `${originalPrompt}\n\nATENÇÃO: A resposta anterior não estava em JSON puro. Gere APENAS o JSON, sem texto extra. Se não souber, gere um stub: {\"cases\":[]}`;
    try {
      const json = await this.callJsonResponse(model, repairPrompt, opts);
      return json;
    } catch {
      return null;
    }
  },
};
