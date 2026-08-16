import { buildCatalogQueryHeaders } from '../security/catalogQuerySigner.js';

const DEFAULT_BASE_URL = 'https://api.apiqagent.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

export class CatalogProxyError extends Error {
  constructor(status, code, message, detail = null) {
    super(message);
    this.status = status;
    this.code = code;
    if (detail) this._detail = detail;
  }
}

function resolveTimeoutMs(env) {
  const raw = Number(env?.CATALOG_QUERY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(raw), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function resolveBaseUrl(env) {
  const raw = String(env?.CATALOG_QUERY_BASE_URL || DEFAULT_BASE_URL).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new CatalogProxyError(503, 'CATALOG_QUERY_NOT_CONFIGURED', 'Catalog Query upstream is not configured.');
  }

  const isDevelopment = String(env?.ENVIRONMENT || '').toLowerCase() !== 'production';
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(isDevelopment && localHttp)) {
    throw new CatalogProxyError(503, 'CATALOG_QUERY_NOT_CONFIGURED', 'Catalog Query upstream must use HTTPS.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function safeParseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function mapUpstreamFailure(status, upstreamCode) {
  if (status === 401 || status === 403) {
    return new CatalogProxyError(
      502,
      'CATALOG_UPSTREAM_AUTH_FAILED',
      'Catalog service authentication failed.',
      { upstreamStatus: status, upstreamCode: upstreamCode || null }
    );
  }
  if (status >= 500) {
    return new CatalogProxyError(
      502,
      'CATALOG_UPSTREAM_FAILED',
      'Catalog service is temporarily unavailable.',
      { upstreamStatus: status, upstreamCode: upstreamCode || null }
    );
  }
  return null;
}

export function buildCatalogUpstreamUrl(env, upstreamPath, incomingUrl) {
  if (!String(upstreamPath || '').startsWith('/v1/catalog/')) {
    throw new CatalogProxyError(500, 'CATALOG_PROXY_PATH_INVALID', 'Catalog proxy path is invalid.');
  }
  const base = resolveBaseUrl(env);
  const sourceUrl = incomingUrl instanceof URL ? incomingUrl : new URL(incomingUrl);
  const target = new URL(base.toString());
  target.pathname = upstreamPath;
  target.search = sourceUrl.search;
  return target;
}

export async function proxyCatalogQuery({ env, organizationId, projectId, upstreamPath, incomingUrl, fetchImpl = fetch }) {
  const upstreamUrl = buildCatalogUpstreamUrl(env, upstreamPath, incomingUrl);
  const signedHeaders = await buildCatalogQueryHeaders({ env, url: upstreamUrl, organizationId, projectId });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveTimeoutMs(env));

  let response;
  try {
    response = await fetchImpl(upstreamUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', ...signedHeaders },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new CatalogProxyError(504, 'CATALOG_UPSTREAM_TIMEOUT', 'Catalog service request timed out.');
    }
    throw new CatalogProxyError(502, 'CATALOG_UPSTREAM_UNAVAILABLE', 'Catalog service is unavailable.', {
      message: error?.message || String(error),
    });
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await response.text();
  const parsedBody = safeParseJson(bodyText);
  const upstreamFailure = mapUpstreamFailure(response.status, parsedBody?.code);
  if (upstreamFailure) throw upstreamFailure;

  return {
    status: response.status,
    bodyText,
    contentType: response.headers.get('content-type') || 'application/json; charset=utf-8',
    queryApiVersion: response.headers.get('x-qagent-query-api-version') || null,
  };
}
