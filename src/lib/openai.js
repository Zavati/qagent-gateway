// OpenAI utilities: fetch with timeout and parse Responses API output
export async function fetchTextWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: {
        name: e?.name || "Error",
        message: e?.message || String(e),
      },
    };
  } finally {
    clearTimeout(t);
  }
}

// Parse Responses API body (string) and try to extract either structured JSON output or text output.
// Returns { text: string, json: object|null }
export function parseResponsesOutput(bodyText) {
  if (!bodyText) return { text: "", json: null };
  try {
    const obj = JSON.parse(bodyText);

    // Some SDKs also expose convenience fields like output_text. Keep it as fallback.
    const fallbackText = typeof obj?.output_text === "string" ? obj.output_text : "";

    const out = Array.isArray(obj?.output) ? obj.output : [];
    const msg = out.find((x) => x.type === "message") || out[0];
    const c = Array.isArray(msg?.content) ? msg.content : [];

    // Prefer structured JSON content when present
    const jsonItem =
      c.find((x) => x.type === "output_json" && x.json)
      || c.find((x) => x.type === "output_json" && x.value)
      || c.find((x) => x.type === "json" && x.json)
      || c.find((x) => x.type === "json" && x.value);

    if (jsonItem) {
      const j = jsonItem.json ?? jsonItem.value;
      if (j && typeof j === "object") return { text: "", json: j };
      // If json is a string, keep it as text (we'll parse later)
      if (typeof j === "string") return { text: j, json: null };
    }

    // Otherwise, fall back to text
    const text =
      c.find((x) => x.type === "output_text")?.text
      || c.find((x) => x.type === "text")?.text
      || fallbackText
      || "";

    return { text: typeof text === "string" ? text : "", json: null };
  } catch {
    return { text: "", json: null };
  }
}

// Attempts to find and parse a JSON object inside arbitrary text, returns parsed object or null
export function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // Fast path: whole string is JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { return JSON.parse(trimmed); } catch {}
  }

  const s = text;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inString) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === stringChar) { inString = false; stringChar = ''; }
      } else {
        if (c === '"' || c === "'") { inString = true; stringChar = c; }
        else if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            const sub = s.slice(i, j + 1);
            try {
              return JSON.parse(sub);
            } catch {
              break; // try next opening brace
            }
          }
        }
      }
    }
  }
  return null;
}
