function pathError(message, code = 'ASSERTION_JSON_PATH_UNSUPPORTED') {
  const error = new Error(message);
  error.code = code;
  error.assertionEngine = true;
  return error;
}

function parseQuoted(source, start) {
  const quote = source[start];
  let i = start + 1;
  let out = '';
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1];
      if (next == null) throw pathError('JSON Path quoted key incompleto.');
      if (next === quote || next === '\\' || next === '/' ) out += next;
      else if (next === 'b') out += '\b';
      else if (next === 'f') out += '\f';
      else if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else if (next === 't') out += '\t';
      else throw pathError('Escape não suportado em JSON Path.');
      i += 2;
      continue;
    }
    if (ch === quote) return { value: out, end: i + 1 };
    out += ch;
    i += 1;
  }
  throw pathError('JSON Path quoted key sem fechamento.');
}

export function parseJsonPath(path) {
  const source = String(path || '').trim();
  if (!source || source.length > 500 || source[0] !== '$') {
    throw pathError('JSON Path deve iniciar em $.');
  }
  if (source === '$') return [];

  const tokens = [];
  let i = 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '.') {
      i += 1;
      if (i >= source.length) throw pathError('JSON Path termina após ponto.');
      if (source[i] === '*') {
        tokens.push({ type: 'wildcard' });
        i += 1;
        continue;
      }
      const start = i;
      while (i < source.length && /[A-Za-z0-9_$-]/.test(source[i])) i += 1;
      if (start === i) throw pathError('Propriedade inválida em JSON Path.');
      tokens.push({ type: 'property', key: source.slice(start, i) });
      continue;
    }

    if (ch === '[') {
      i += 1;
      if (i >= source.length) throw pathError('JSON Path bracket incompleto.');
      if (source[i] === '*') {
        i += 1;
        if (source[i] !== ']') throw pathError('Wildcard inválido em JSON Path.');
        i += 1;
        tokens.push({ type: 'wildcard' });
        continue;
      }
      if (source[i] === '"' || source[i] === "'") {
        const quoted = parseQuoted(source, i);
        i = quoted.end;
        if (source[i] !== ']') throw pathError('Quoted property inválida em JSON Path.');
        i += 1;
        tokens.push({ type: 'property', key: quoted.value });
        continue;
      }
      const start = i;
      while (i < source.length && /[0-9]/.test(source[i])) i += 1;
      if (start === i || source[i] !== ']') throw pathError('Índice inválido em JSON Path.');
      const index = Number(source.slice(start, i));
      if (!Number.isSafeInteger(index) || index < 0 || index > 1_000_000) throw pathError('Índice fora do limite em JSON Path.');
      i += 1;
      tokens.push({ type: 'index', index });
      continue;
    }

    throw pathError('Sintaxe de JSON Path não suportada.');
  }
  return tokens;
}
