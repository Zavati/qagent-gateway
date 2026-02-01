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

// Extract the 'content' text from Responses API body (string)
export function parseResponsesContent(bodyText) {
  if (!bodyText) return "";
  try {
    const obj = JSON.parse(bodyText);
    const out = obj?.output || [];
    const msg = out.find((x) => x.type === "message") || out[0];
    const c = msg?.content || [];
    return c.find((x) => x.type === "output_text")?.text
      || c.find((x) => x.type === "text")?.text
      || "";
  } catch {
    return "";
  }
}

// Attempts to find and parse a JSON object inside arbitrary text, returns parsed object or null
export function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;
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
            } catch (e) {
              break; // try next opening brace
            }
          }
        }
      }
    }
  }
  return null;
}
