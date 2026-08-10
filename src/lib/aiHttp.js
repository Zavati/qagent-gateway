export async function fetchTextWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: '',
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;

    let depth = 0;
    let inString = false;
    let stringChar = '';
    let escaped = false;

    for (let j = i; j < text.length; j += 1) {
      const char = text[j];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === stringChar) {
          inString = false;
          stringChar = '';
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, j + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}
