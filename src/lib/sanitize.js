// sanitize helpers
export function sanitizeString(input, maxLen = 2000) {
  if (input == null) return input;
  let s = String(input);
  s = s.replace(/[\x00-\x1F\x7F]+/g, " ").trim();
  if (/^javascript:/i.test(s)) throw Object.assign(new Error("Valor inválido (javascript: proibido)."), { status: 400 });
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

export function isValidSelector(sel) {
  if (!sel || typeof sel !== 'string') return false;
  if (/^javascript:/i.test(sel)) return false;
  if (sel.length > 1000) return false;
  return true;
}
