import {
  fetchTextWithTimeout,
  getAiRetryDecision,
  waitForAiRetry,
  createAiUpstreamError,
  createAiResponseFormatError,
} from './aiHttp.js';
import { parseResponsesOutput, extractJsonFromText } from './openai.js';

const NON_RETRYABLE_429_CODES = new Set([
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'insufficient_quota',
]);

function parseOpenAiError(bodyText) {
  try {
    const payload = JSON.parse(bodyText || '{}');
    const error = payload?.error || {};
    return {
      code: typeof error?.code === 'string' ? error.code : (typeof error?.type === 'string' ? error.type : null),
      message: typeof error?.message === 'string' ? error.message : null,
    };
  } catch {
    return { code: null, message: null };
  }
}

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
    const retries = Number.isInteger(opts.retries) ? opts.retries : 2;
    const maxRetryWaitMs = Number.isFinite(opts.maxRetryWaitMs) ? opts.maxRetryWaitMs : 2_500;
    const retryBaseDelayMs = Number.isFinite(opts.retryBaseDelayMs) ? opts.retryBaseDelayMs : 500;
    const retryMaxDelayMs = Number.isFinite(opts.retryMaxDelayMs) ? opts.retryMaxDelayMs : 2_000;
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

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetchTextWithTimeout(url, { method: 'POST', headers, body }, timeoutMs);

      if (response.ok) {
        const parsed = parseResponsesOutput(response.text || '');
        if (parsed.json && typeof parsed.json === 'object') {
          return { json: parsed.json, rawText: response.text || '', contentText: '', status: response.status, ok: true };
        }

        const contentText = parsed.text || '';
        const json = extractJsonFromText(contentText);
        if (json) {
          return { json, rawText: response.text || '', contentText, status: response.status, ok: true };
        }

        throw createAiResponseFormatError('OpenAI', {
          rawText: response.text || '',
          contentText,
          status: response.status,
        });
      }

      const upstream = parseOpenAiError(response.text);
      const nonRetryable = response.status === 429 && NON_RETRYABLE_429_CODES.has(String(upstream.code || '').toLowerCase());
      const decision = getAiRetryDecision({
        status: response.status,
        attempt,
        retries,
        retryAfterMs: response.retryAfterMs,
        nonRetryable,
        maxRetryWaitMs,
        baseDelayMs: retryBaseDelayMs,
        maxDelayMs: retryMaxDelayMs,
      });

      if (decision.retry) {
        await waitForAiRetry(decision.delayMs);
        continue;
      }

      throw createAiUpstreamError('openai', response, {
        upstreamCode: upstream.code,
        upstreamMessage: upstream.message,
        retryable: !nonRetryable && Boolean(
          response.status === 0 || response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
        ),
      });
    }

    throw new Error('OpenAI retry loop ended unexpectedly.');
  },

  // Attempts to repair a non-JSON or invalid-structure response by re-prompting with explicit instructions
  async repairJsonResponse(model, originalPrompt, rawText, opts = {}) {
    const repairPrompt =
      `${originalPrompt}\n\n` +
      `ATENÇÃO: A resposta anterior não estava em JSON puro OU estava no formato errado. ` +
      `Gere APENAS um único JSON no formato exigido (com "cases" e "score"), sem texto extra. ` +
      `Se não souber, gere um stub: {"cases":[],"score":{"value":1,"reason":"stub"}}.\n\n` +
      `Resposta anterior (para referência):\n${rawText || ''}`;

    try {
      const out = await this.callJsonResponse(model, repairPrompt, opts);
      return out?.json || null;
    } catch (error) {
      if (error?.upstreamFailed) throw error;
      return null;
    }
  },
};
