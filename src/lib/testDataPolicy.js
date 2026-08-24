export const TEST_DATA_SCOPE_PRECEDENCE = Object.freeze({
  PROJECT: 1,
  ENVIRONMENT: 2,
  ENDPOINT: 3,
});

export const TEST_DATA_SCOPES = Object.freeze(['PROJECT', 'ENVIRONMENT', 'ENDPOINT']);

const SENSITIVE_SELECTOR_KEYS = new Set([
  'password', 'passwd', 'newpassword', 'currentpassword', 'passwordconfirmation', 'newpasswordconfirmation',
  'secret', 'clientsecret', 'apikey', 'authorization', 'cookie', 'credential', 'privatekey',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'bearertoken', 'sessiontoken',
]);

const SAFE_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
const SAFE_SCHEMA_FORMATS = new Set(['email', 'uuid', 'date', 'date-time']);

function selectorTokens(target, selector) {
  const normalizedTarget = String(target || '').trim().toUpperCase();
  const value = String(selector || '').trim();
  if (!value) return [];
  if (normalizedTarget === 'BODY') return value.match(/[A-Za-z_][A-Za-z0-9_-]*/g) || [];
  return [value];
}

function canonicalToken(token) {
  return String(token || '').replace(/[_-]/g, '').toLowerCase();
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boundedInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function safeEnum(values, sensitive) {
  if (sensitive || !Array.isArray(values) || values.length === 0 || values.length > 20) return undefined;
  const out = [];
  for (const value of values) {
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) return undefined;
    if (typeof value === 'string' && new TextEncoder().encode(value).byteLength > 256) return undefined;
    out.push(value);
  }
  return out;
}

export function isSensitiveTestDataSelector(target, selector) {
  return selectorTokens(target, selector).some((token) => SENSITIVE_SELECTOR_KEYS.has(canonicalToken(token)));
}

// Keep generator config structural. This prevents generatorConfig from becoming
// a persistence/prompt side-channel for examples, defaults, secrets or arbitrary payloads.
export function sanitizeTestDataGeneratorSchema(node, selectorPath = '$', depth = 0) {
  if (!plain(node) || depth > 8) return {};
  const out = {};
  const sensitive = isSensitiveTestDataSelector('BODY', selectorPath);
  const type = String(node.type || '').toLowerCase();
  if (SAFE_SCHEMA_TYPES.has(type)) out.type = type;
  const format = String(node.format || '').toLowerCase();
  if (!sensitive && SAFE_SCHEMA_FORMATS.has(format)) out.format = format;

  const minimum = finiteNumber(node.minimum);
  const maximum = finiteNumber(node.maximum);
  if (minimum != null) out.minimum = minimum;
  if (maximum != null) out.maximum = maximum;

  const minLength = boundedInteger(node.minLength, 0, 4096);
  const maxLength = boundedInteger(node.maxLength, 0, 4096);
  const minItems = boundedInteger(node.minItems, 0, 50);
  const maxItems = boundedInteger(node.maxItems, 0, 50);
  if (minLength != null) out.minLength = minLength;
  if (maxLength != null) out.maxLength = maxLength;
  if (minItems != null) out.minItems = minItems;
  if (maxItems != null) out.maxItems = maxItems;

  const enumValues = safeEnum(node.enum, sensitive);
  if (enumValues) out.enum = enumValues;

  if (Array.isArray(node.required)) {
    const required = [...new Set(node.required.filter((key) => typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,119}$/.test(key)))].slice(0, 50);
    if (required.length) out.required = required;
  }

  if (plain(node.properties)) {
    const properties = {};
    for (const key of Object.keys(node.properties).slice(0, 50)) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]{0,119}$/.test(key)) continue;
      properties[key] = sanitizeTestDataGeneratorSchema(node.properties[key], `${selectorPath}.${key}`, depth + 1);
    }
    if (Object.keys(properties).length) out.properties = properties;
  }

  if (plain(node.items)) out.items = sanitizeTestDataGeneratorSchema(node.items, `${selectorPath}[]`, depth + 1);
  if (Array.isArray(node.oneOf) && node.oneOf.length) out.oneOf = node.oneOf.slice(0, 4).map((item) => sanitizeTestDataGeneratorSchema(item, selectorPath, depth + 1));
  if (Array.isArray(node.anyOf) && node.anyOf.length) out.anyOf = node.anyOf.slice(0, 4).map((item) => sanitizeTestDataGeneratorSchema(item, selectorPath, depth + 1));
  return out;
}

export function sanitizeTestDataGeneratorConfig(kind, config, { valueType = 'STRING', selectorPath = '$' } = {}) {
  const normalizedKind = String(kind || 'AUTO').trim().toUpperCase();
  const normalizedValueType = String(valueType || 'STRING').trim().toUpperCase();
  if (normalizedKind !== 'JSON_SCHEMA' && !(normalizedKind === 'AUTO' && normalizedValueType === 'JSON')) return {};
  const schema = sanitizeTestDataGeneratorSchema(plain(config) ? config.schema : null, selectorPath);
  return Object.keys(schema).length ? { schema } : {};
}

export function assertTestDataSourceSecurity(target, selector, sourceType, fail) {
  if (!isSensitiveTestDataSelector(target, selector)) return;
  if (String(sourceType || '').trim().toUpperCase() === 'SECRET') return;
  fail(
    'Campo sensível de Test Data deve usar sourceType SECRET e Secret Vault.',
    'TEST_DATA_SECRET_SOURCE_REQUIRED',
    409,
  );
}

export function scopeRank(scopeType) {
  return TEST_DATA_SCOPE_PRECEDENCE[String(scopeType || '').toUpperCase()] || 0;
}
