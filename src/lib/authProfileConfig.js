import { cleanConfigText, looksSensitiveVariableKey, normalizeServiceKey } from './environmentConfig.js';

export const AUTH_PROFILE_TYPES = new Set([
  'none',
  'basic',
  'api_key',
  'oauth2_client_credentials',
  'login_http_json',
]);

const SECRET_FIELDS_BY_TYPE = {
  basic: ['username', 'password'],
  api_key: ['apiKey'],
  oauth2_client_credentials: ['clientId', 'clientSecret'],
  login_http_json: ['username', 'password'],
};

export function normalizeAuthProfileType(value) {
  const type = cleanConfigText(value, 64).toLowerCase();
  if (!AUTH_PROFILE_TYPES.has(type)) {
    const err = new Error('Auth Profile type inválido.');
    err.status = 400;
    err.code = 'INVALID_AUTH_PROFILE_TYPE';
    throw err;
  }
  return type;
}

export function normalizeProfileKey(value) {
  const key = cleanConfigText(value, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!key || key.length < 2) {
    const err = new Error('profileKey inválida. Use um identificador como default-customer.');
    err.status = 400;
    err.code = 'INVALID_AUTH_PROFILE_KEY';
    throw err;
  }
  return key;
}

export function normalizeRelativeApiPath(value, label = 'path') {
  const path = cleanConfigText(value, 800);
  if (!path || !path.startsWith('/') || path.startsWith('//')) {
    const err = new Error(`${label} deve ser um path relativo iniciado por /.`);
    err.status = 400;
    err.code = 'INVALID_AUTH_ENDPOINT_PATH';
    throw err;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.includes('\\') || path.split('/').includes('..') || path.includes('#')) {
    const err = new Error(`${label} inválido para Auth Profile.`);
    err.status = 400;
    err.code = 'INVALID_AUTH_ENDPOINT_PATH';
    throw err;
  }
  return path;
}

function normalizeJsonPath(value, fallback) {
  const path = cleanConfigText(value || fallback, 240);
  if (!/^[A-Za-z0-9_$.-]+$/.test(path)) {
    const err = new Error('JSON path de autenticação inválido.');
    err.status = 400;
    err.code = 'INVALID_AUTH_JSON_PATH';
    throw err;
  }
  return path;
}

function normalizeHeaderName(value, fallback) {
  const name = cleanConfigText(value || fallback, 120);
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
    const err = new Error('Nome de header inválido no Auth Profile.');
    err.status = 400;
    err.code = 'INVALID_AUTH_HEADER_NAME';
    throw err;
  }
  return name;
}

function assertStaticBodySafe(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error('staticBody deve ser um objeto JSON.');
    err.status = 400;
    err.code = 'INVALID_AUTH_STATIC_BODY';
    throw err;
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > 8_192) {
    const err = new Error('staticBody excede 8 KB.');
    err.status = 413;
    err.code = 'AUTH_STATIC_BODY_TOO_LARGE';
    throw err;
  }
  const walk = (obj) => {
    if (Array.isArray(obj)) {
      for (const child of obj) if (child && typeof child === 'object') walk(child);
      return;
    }
    for (const [key, child] of Object.entries(obj)) {
      if (looksSensitiveVariableKey(key) || /(password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key)/i.test(key)) {
        const err = new Error('staticBody não pode conter secrets. Use Secret Vault.');
        err.status = 400;
        err.code = 'AUTH_STATIC_BODY_SECRET_FORBIDDEN';
        throw err;
      }
      if (child && typeof child === 'object') walk(child);
    }
  };
  walk(value);
  return JSON.parse(serialized);
}
const COOKIE_SESSION_DEFAULT_SUCCESS_STATUS_CODES = Object.freeze([
  200,
  201,
  204,
  302,
  303,
]);

const AUTH_COOKIE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const AUTH_FORM_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_.:[\]-]{0,127}$/;

function authConfigError(message, code) {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

function normalizeCookieName(value) {
  const cookieName = cleanConfigText(value, 120);

  if (!cookieName) {
    return null;
  }

  if (!AUTH_COOKIE_NAME_RE.test(cookieName)) {
    throw authConfigError(
      'Nome de cookie inválido no Auth Profile.',
      'INVALID_AUTH_COOKIE_NAME',
    );
  }

  return cookieName;
}

function normalizeAuthFormField(value, label) {
  const field = cleanConfigText(value, 128);

  if (!field || !AUTH_FORM_FIELD_RE.test(field)) {
    throw authConfigError(
      `${label} inválido no Auth Profile.`,
      'INVALID_AUTH_FORM_FIELD',
    );
  }

  return field;
}

function normalizeCookieSessionSuccessStatusCodes(value) {
  if (value == null) {
    return [...COOKIE_SESSION_DEFAULT_SUCCESS_STATUS_CODES];
  }

  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw authConfigError(
      'successStatusCodes deve ser uma lista de status HTTP.',
      'INVALID_AUTH_SUCCESS_STATUS_CODES',
    );
  }

  const normalized = [];

  for (const raw of value) {
    const code = Number(raw);

    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw authConfigError(
        'successStatusCodes contém status HTTP inválido.',
        'INVALID_AUTH_SUCCESS_STATUS_CODES',
      );
    }

    if (!normalized.includes(code)) {
      normalized.push(code);
    }
  }

  return normalized;
}

function normalizeCookieSessionPreflight(value) {
  if (value == null) {
    return {
      enabled: false,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw authConfigError(
      'preflight deve ser um objeto.',
      'INVALID_AUTH_PREFLIGHT',
    );
  }

  const enabled = value.enabled === true;

  if (!enabled) {
    return {
      enabled: false,
    };
  }

  const method = cleanConfigText(value.method || 'GET', 16).toUpperCase();

  // FIX-1 v1 é intencionalmente conservadora.
  // Preflight não deve possuir side effect.
  if (method !== 'GET') {
    throw authConfigError(
      'Preflight de autenticação suporta somente GET nesta versão.',
      'INVALID_AUTH_PREFLIGHT_METHOD',
    );
  }

  const path = normalizeRelativeApiPath(
    value.path,
    'preflight.path',
  );

  const preserveCookies = value.preserveCookies !== false;

  if (
    !value.extract ||
    typeof value.extract !== 'object' ||
    Array.isArray(value.extract)
  ) {
    throw authConfigError(
      'preflight.extract é obrigatório quando preflight está habilitado.',
      'AUTH_PREFLIGHT_EXTRACT_REQUIRED',
    );
  }

  const kind = cleanConfigText(
    value.extract.kind || '',
    64,
  ).toUpperCase();

  if (kind !== 'HTML_INPUT_BY_NAME') {
    throw authConfigError(
      'Extractor de preflight não suportado.',
      'INVALID_AUTH_PREFLIGHT_EXTRACT_KIND',
    );
  }

  const name = normalizeAuthFormField(
    value.extract.name,
    'preflight.extract.name',
  );

  const injectField = normalizeAuthFormField(
    value.extract.injectField,
    'preflight.extract.injectField',
  );

  return {
    enabled: true,
    method: 'GET',
    path,
    preserveCookies,
    extract: {
      kind: 'HTML_INPUT_BY_NAME',
      name,
      injectField,
    },
  };
}

function normalizeCookieSessionDescriptor(value) {
  if (value == null) {
    return {
      cookieName: null,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw authConfigError(
      'session deve ser um objeto.',
      'INVALID_AUTH_COOKIE_SESSION',
    );
  }

  return {
    cookieName: normalizeCookieName(value.cookieName),
  };
}

/**
 * Mantém login_http_json antigo exatamente como está.
 *
 * Somente quando resultMode=cookie_session removemos as opções de
 * token extraction e acrescentamos a configuração stateful.
 */
function normalizeLoginHttpResultConfig(baseConfig, rawConfig) {
  const resultMode = cleanConfigText(
    rawConfig?.resultMode || '',
    32,
  ).toLowerCase();

  // Backward compatibility:
  // ausência de resultMode = comportamento atual token JSON/header.
  if (!resultMode) {
    return baseConfig;
  }

  if (resultMode !== 'cookie_session') {
    throw authConfigError(
      'resultMode inválido para login_http_json.',
      'INVALID_AUTH_LOGIN_RESULT_MODE',
    );
  }

  const effectiveTargetMode =
    baseConfig.targetMode ||
    (baseConfig.apiServiceKey ? 'api_service' : 'runtime_origin');

  /**
   * Cookie de sessão nunca pode ser adquirido em Origin A
   * e injetado silenciosamente em Origin B.
   *
   * Para a primeira versão, cookie_session é portanto
   * estritamente runtime_origin.
   */
  if (effectiveTargetMode !== 'runtime_origin') {
    throw authConfigError(
      'Cookie Session exige targetMode=runtime_origin.',
      'AUTH_COOKIE_SESSION_REQUIRES_RUNTIME_ORIGIN',
    );
  }

  const {
    tokenSource,
    tokenJsonPath,
    tokenHeader,
    targetHeader,
    scheme,
    ...shared
  } = baseConfig;

  return {
    ...shared,
    targetMode: 'runtime_origin',
    resultMode: 'cookie_session',

    preflight: normalizeCookieSessionPreflight(
      rawConfig.preflight,
    ),

    session: normalizeCookieSessionDescriptor(
      rawConfig.session,
    ),

    successStatusCodes:
      normalizeCookieSessionSuccessStatusCodes(
        rawConfig.successStatusCodes,
      ),
  };
}

export function normalizeAuthProfileConfig(typeValue, input = {}) {
  const type = normalizeAuthProfileType(typeValue);
  const config = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  if (type === 'none' || type === 'basic') return {};

  if (type === 'api_key') {
    const placement = cleanConfigText(config.placement || 'header', 16).toLowerCase();
    if (!['header', 'query'].includes(placement)) {
      const err = new Error('API key placement inválido. Use header ou query.');
      err.status = 400;
      err.code = 'INVALID_API_KEY_PLACEMENT';
      throw err;
    }
    const name = placement === 'header'
      ? normalizeHeaderName(config.name, 'X-API-Key')
      : cleanConfigText(config.name || 'api_key', 120);
    if (placement === 'query' && !/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(name)) {
      const err = new Error('Nome do parâmetro de API key inválido.');
      err.status = 400;
      err.code = 'INVALID_API_KEY_PARAM_NAME';
      throw err;
    }
    const prefix = String(config.prefix ?? '').replace(/[\r\n\0]/g, '').slice(0, 80);
    return { placement, name, prefix };
  }

  const targetMode = cleanConfigText(config.targetMode || (config.apiServiceKey ? 'api_service' : 'runtime_origin'), 32).toLowerCase();
  if (!['api_service', 'runtime_origin'].includes(targetMode)) {
    const err = new Error('targetMode inválido. Use api_service ou runtime_origin.');
    err.status = 400;
    err.code = 'INVALID_AUTH_TARGET_MODE';
    throw err;
  }
  const apiServiceKey = targetMode === 'api_service' ? normalizeServiceKey(config.apiServiceKey) : null;
  const path = normalizeRelativeApiPath(config.path);
  const targetHeader = normalizeHeaderName(config.targetHeader, 'Authorization');

  if (type === 'oauth2_client_credentials') {
    const clientAuthentication = cleanConfigText(config.clientAuthentication || 'body', 16).toLowerCase();
    if (!['body', 'basic'].includes(clientAuthentication)) {
      const err = new Error('clientAuthentication inválido. Use body ou basic.');
      err.status = 400;
      err.code = 'INVALID_OAUTH_CLIENT_AUTHENTICATION';
      throw err;
    }
    return {
      targetMode,
      apiServiceKey,
      path,
      method: 'POST',
      clientAuthentication,
      scope: cleanConfigText(config.scope, 1000) || null,
      audience: cleanConfigText(config.audience, 1000) || null,
      tokenJsonPath: normalizeJsonPath(config.tokenJsonPath, 'access_token'),
      expiresInJsonPath: normalizeJsonPath(config.expiresInJsonPath, 'expires_in'),
      tokenTypeJsonPath: normalizeJsonPath(config.tokenTypeJsonPath, 'token_type'),
      targetHeader,
    };
  }

  const tokenSource = cleanConfigText(config.tokenSource || 'json', 16).toLowerCase();
  if (!['json', 'header'].includes(tokenSource)) {
    const err = new Error('tokenSource inválido. Use json ou header.');
    err.status = 400;
    err.code = 'INVALID_LOGIN_TOKEN_SOURCE';
    throw err;
  }
  const bodyEncoding = cleanConfigText(config.bodyEncoding || 'json', 16).toLowerCase();
  if (!['json', 'form'].includes(bodyEncoding)) {
    const err = new Error('bodyEncoding inválido. Use json ou form.');
    err.status = 400;
    err.code = 'INVALID_LOGIN_BODY_ENCODING';
    throw err;
  }
  const staticBody = assertStaticBodySafe(config.staticBody);
  if (bodyEncoding === 'form') {
    for (const [key, value] of Object.entries(staticBody)) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(key) || (value !== null && typeof value === 'object')) {
        const err = new Error('Login form aceita apenas campos estáticos escalares com nomes seguros.');
        err.status = 400;
        err.code = 'INVALID_AUTH_STATIC_FORM_FIELDS';
        throw err;
      }
    }
  }

  return normalizeLoginHttpResultConfig(
    {
      targetMode,
      apiServiceKey,
      path,
      method: 'POST',
      bodyEncoding,
      usernameField: cleanConfigText(
        config.usernameField || (bodyEncoding === 'form' ? 'username' : 'email'),
        120,
      ),
      passwordField: cleanConfigText(
        config.passwordField || 'password',
        120,
      ),
      staticBody,
      tokenSource,
      tokenJsonPath:
        tokenSource === 'json'
          ? normalizeJsonPath(
            config.tokenJsonPath,
            bodyEncoding === 'form' ? 'access_token' : 'accessToken',
          )
          : null,
      tokenHeader:
        tokenSource === 'header'
          ? normalizeHeaderName(
            config.tokenHeader,
            'Authorization',
          )
          : null,
      targetHeader,
      scheme: cleanConfigText(
        config.scheme ?? 'Bearer',
        40,
      ),
    },
    config,
  );
}

export function expectedSecretKindForAuthType(typeValue) {
  const type = normalizeAuthProfileType(typeValue);
  return type === 'none' ? null : type;
}

export function normalizeAuthSecretPayload(kindValue, payload) {
  const kind = cleanConfigText(kindValue, 64).toLowerCase();
  if (kind === 'generic') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      const err = new Error('Secret genérico deve ser um objeto JSON.');
      err.status = 400;
      err.code = 'INVALID_SECRET_PAYLOAD';
      throw err;
    }
    const text = JSON.stringify(payload);
    if (new TextEncoder().encode(text).byteLength > 32_768) {
      const err = new Error('Secret excede 32 KB.');
      err.status = 413;
      err.code = 'SECRET_PAYLOAD_TOO_LARGE';
      throw err;
    }
    return JSON.parse(text);
  }

  const fields = SECRET_FIELDS_BY_TYPE[kind];
  if (!fields) {
    const err = new Error('Secret kind inválido.');
    err.status = 400;
    err.code = 'INVALID_SECRET_KIND';
    throw err;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const err = new Error('Credenciais inválidas.');
    err.status = 400;
    err.code = 'INVALID_AUTH_CREDENTIALS';
    throw err;
  }

  const out = {};
  for (const field of fields) {
    const value = String(payload[field] ?? '');
    if (!value || value.length > 10_000) {
      const err = new Error(`Credencial ${field} é obrigatória e deve ter tamanho válido.`);
      err.status = 400;
      err.code = 'INVALID_AUTH_CREDENTIALS';
      throw err;
    }
    out[field] = value;
  }
  return out;
}

export function publicAuthProfileConfig(configJson) {
  try {
    const value = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
