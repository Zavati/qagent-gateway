import { fetchTextWithTimeout, parseResponsesOutput, extractJsonFromText } from './openai.js';

// Robust OpenAI Responses API client for JSON output
export const openaiClient = {
  /**
   * Calls Responses API enforcing json_object output.
   * Returns { json, rawText, contentText } where:
   *  - json: parsed object (or null if not found)
   *  - rawText: full HTTP body returned by OpenAI
   *  - contentText: extracted message text (if any)
   */
  async callJsonResponse(model, userPrompt, opts = {}) {
    const url = 'https://api.openai.com/v1/responses';
    const timeoutMs = opts.timeoutMs || 90000;
    const retries = opts.retries || 2;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey || ''}`,
    };

    const input = [];
    if (opts.systemPrompt) {
      input.push({ role: 'system', content: [{ type: 'input_text', text: String(opts.systemPrompt) }] });
    }
    input.push({ role: 'user', content: [{ type: 'input_text', text: userPrompt }] });

    const body = JSON.stringify({
      model,
      input,
      // Ask for strict JSON output. Some responses may come as structured output_json.
      text: { format: { type: 'json_object' } },
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.0,
      max_output_tokens: typeof opts.max_output_tokens === 'number' ? opts.max_output_tokens : 1200,
    });

    let lastText = '', lastContentText = '', lastErr, lastStatus = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetchTextWithTimeout(url, { method: 'POST', headers, body }, timeoutMs);
      lastText = res.text || '';
      lastStatus = res.status || 0;
      if (!res.ok) {
        lastErr = new Error(`OpenAI error: ${res.status}`);
        continue;
      }

      const parsed = parseResponsesOutput(lastText);
      if (parsed.json && typeof parsed.json === 'object') {
        return { json: parsed.json, rawText: lastText, contentText: '', status: res.status, ok: true };
      }

      lastContentText = parsed.text || '';
      const json = extractJsonFromText(lastContentText);
      if (json) return { json, rawText: lastText, contentText: lastContentText, status: res.status, ok: true };

      lastErr = new Error('No valid JSON in response');
    }

    const err = new Error('Failed to get valid JSON from OpenAI');
    err.rawText = lastText;
    err.contentText = lastContentText;
    err.upstreamStatus = lastStatus;
    err.upstreamFailed = lastStatus === 0 || lastStatus < 200 || lastStatus >= 300;
    throw err;
  },

  // Attempts to repair a non-JSON or invalid-structure response by re-prompting with explicit instructions
  async repairJsonResponse(model, originalPrompt, rawText, opts = {}) {
    const repairPrompt =
      `${originalPrompt}

` +
      `ATENÇÃO: A resposta anterior não estava em JSON puro OU estava no formato errado. ` +
      `Gere APENAS um único JSON no formato exigido (com "cases" e "score"), sem texto extra. ` +
      `Se não souber, gere um stub: {"cases":[],"score":{"value":1,"reason":"stub"}}.

` +
      `Resposta anterior (para referência):
${rawText || ''}`;

    try {
      const out = await this.callJsonResponse(model, repairPrompt, opts);
      return out?.json || null;
    } catch {
      return null;
    }
  },
};
