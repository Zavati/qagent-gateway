import { fetchTextWithTimeout, extractJsonFromText } from './aiHttp.js';

export { fetchTextWithTimeout, extractJsonFromText };

// Parse Responses API body (string) and try to extract either structured JSON output or text output.
// Returns { text: string, json: object|null }
export function parseResponsesOutput(bodyText) {
  if (!bodyText) return { text: '', json: null };
  try {
    const obj = JSON.parse(bodyText);

    // Some SDKs also expose convenience fields like output_text. Keep it as fallback.
    const fallbackText = typeof obj?.output_text === 'string' ? obj.output_text : '';

    const out = Array.isArray(obj?.output) ? obj.output : [];
    const msg = out.find((x) => x.type === 'message') || out[0];
    const content = Array.isArray(msg?.content) ? msg.content : [];

    // Prefer structured JSON content when present.
    const jsonItem =
      content.find((x) => x.type === 'output_json' && x.json)
      || content.find((x) => x.type === 'output_json' && x.value)
      || content.find((x) => x.type === 'json' && x.json)
      || content.find((x) => x.type === 'json' && x.value);

    if (jsonItem) {
      const value = jsonItem.json ?? jsonItem.value;
      if (value && typeof value === 'object') return { text: '', json: value };
      if (typeof value === 'string') return { text: value, json: null };
    }

    const text =
      content.find((x) => x.type === 'output_text')?.text
      || content.find((x) => x.type === 'text')?.text
      || fallbackText
      || '';

    return { text: typeof text === 'string' ? text : '', json: null };
  } catch {
    return { text: '', json: null };
  }
}

// Backward-compat: versões antigas importam parseResponsesContent.
export function parseResponsesContent(bodyText) {
  return parseResponsesOutput(bodyText);
}
