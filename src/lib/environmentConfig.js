const VARIABLE_TYPES = new Set(['STRING', 'NUMBER', 'BOOLEAN', 'JSON']);
const SENSITIVE_KEY_PATTERNS = [
  /(^|[._-])password($|[._-])/i,
  /(^|[._-])passwd($|[._-])/i,
  /(^|[._-])secret($|[._-])/i,
  /(^|[._-])token($|[._-])/i,
  /(^|[._-])api[_-]?key($|[._-])/i,
  /(^|[._-])client[_-]?secret($|[._-])/i,
  /(^|[._-])private[_-]?key($|[._-])/i,
  /(^|[._-])authorization($|[._-])/i,
  /(^|[._-])credential(s)?($|[._-])/i,
];

export function cleanConfigText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizeApiBaseUrl(value, label = 'API Base URL') {
  const raw = cleanConfigText(value, 2000);
  if (!raw) {
    const err = new Error(`${label} é obrigatória.`);
    err.status = 400;
    err.code = 'API_BASE_URL_REQUIRED';
    throw err;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    const err = new Error(`${label} inválida.`);
    err.status = 400;
    err.code = 'INVALID_API_BASE_URL';
    throw err;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    const err = new Error(`${label} deve usar http ou https.`);
    err.status = 400;
    err.code = 'INVALID_API_BASE_URL_SCHEME';
    throw err;
  }

  if (url.username || url.password) {
    const err = new Error(`${label} não pode conter usuário ou senha embutidos.`);
    err.status = 400;
    err.code = 'API_BASE_URL_CREDENTIALS_FORBIDDEN';
    throw err;
  }

  if (url.search || url.hash) {
    const err = new Error(`${label} não pode conter query string ou fragment.`);
    err.status = 400;
    err.code = 'API_BASE_URL_QUERY_OR_FRAGMENT_FORBIDDEN';
    throw err;
  }

  return raw.replace(/\/+$/, '');
}

export function normalizeServiceKey(value) {
  const raw = cleanConfigText(value, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!raw || raw.length < 2) {
    const err = new Error('serviceKey inválida. Use um identificador como identity, payments ou catalog.');
    err.status = 400;
    err.code = 'INVALID_API_SERVICE_KEY';
    throw err;
  }
  return raw;
}

export function normalizeVariableKey(value) {
  const key = cleanConfigText(value, 128);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key)) {
    const err = new Error('Chave de variável inválida. Use letras, números, _, . ou -, iniciando por letra ou _.');
    err.status = 400;
    err.code = 'INVALID_ENVIRONMENT_VARIABLE_KEY';
    throw err;
  }
  return key;
}

export function looksSensitiveVariableKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(String(key || '')));
}

export function assertNonSecretVariable(input) {
  const key = normalizeVariableKey(input?.variableKey ?? input?.key);
  if (input?.secret === true || input?.sensitive === true || looksSensitiveVariableKey(key)) {
    const err = new Error('Secrets não podem ser armazenados como Environment Variables. Use Secret Vault/Auth Profiles.');
    err.status = 400;
    err.code = 'SECRET_ENVIRONMENT_VARIABLE_FORBIDDEN';
    throw err;
  }
  return key;
}

export function normalizeVariableValue(value, requestedType = 'STRING') {
  const valueType = cleanConfigText(requestedType || 'STRING', 16).toUpperCase();
  if (!VARIABLE_TYPES.has(valueType)) {
    const err = new Error('valueType inválido. Use STRING, NUMBER, BOOLEAN ou JSON.');
    err.status = 400;
    err.code = 'INVALID_ENVIRONMENT_VARIABLE_TYPE';
    throw err;
  }

  let normalized;
  if (valueType === 'STRING') {
    normalized = value == null ? '' : String(value);
  } else if (valueType === 'NUMBER') {
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(number)) {
      const err = new Error('Valor NUMBER inválido.');
      err.status = 400;
      err.code = 'INVALID_ENVIRONMENT_VARIABLE_VALUE';
      throw err;
    }
    normalized = String(number);
  } else if (valueType === 'BOOLEAN') {
    if (value === true || String(value).toLowerCase() === 'true' || String(value) === '1') normalized = 'true';
    else if (value === false || String(value).toLowerCase() === 'false' || String(value) === '0') normalized = 'false';
    else {
      const err = new Error('Valor BOOLEAN inválido.');
      err.status = 400;
      err.code = 'INVALID_ENVIRONMENT_VARIABLE_VALUE';
      throw err;
    }
  } else {
    try {
      normalized = typeof value === 'string' ? JSON.stringify(JSON.parse(value)) : JSON.stringify(value);
    } catch {
      const err = new Error('Valor JSON inválido.');
      err.status = 400;
      err.code = 'INVALID_ENVIRONMENT_VARIABLE_VALUE';
      throw err;
    }
    if (normalized === undefined) normalized = 'null';
  }

  if (new TextEncoder().encode(normalized).byteLength > 8_192) {
    const err = new Error('Valor de Environment Variable excede 8 KB.');
    err.status = 413;
    err.code = 'ENVIRONMENT_VARIABLE_VALUE_TOO_LARGE';
    throw err;
  }

  return { valueType, variableValue: normalized };
}

export function deserializeVariableValue(variableValue, valueType) {
  const type = String(valueType || 'STRING').toUpperCase();
  if (type === 'NUMBER') return Number(variableValue);
  if (type === 'BOOLEAN') return variableValue === 'true';
  if (type === 'JSON') {
    try { return JSON.parse(variableValue); } catch { return null; }
  }
  return variableValue;
}
