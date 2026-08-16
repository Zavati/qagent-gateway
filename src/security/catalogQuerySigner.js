export const CATALOG_QUERY_AUTH_VERSION = 'qagent.catalog-query.v1';

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalizeCatalogQuery(searchParams) {
  return Array.from(searchParams.entries())
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function buildCatalogQuerySigningPayload({ method = 'GET', url, organizationId, projectId, timestamp }) {
  const parsed = url instanceof URL ? url : new URL(url);
  return [
    CATALOG_QUERY_AUTH_VERSION,
    String(method || 'GET').toUpperCase(),
    parsed.pathname,
    canonicalizeCatalogQuery(parsed.searchParams),
    String(organizationId || '').trim(),
    String(projectId || '').trim(),
    String(timestamp || '').trim(),
  ].join('\n');
}

export async function createCatalogQuerySignature({ secret, method = 'GET', url, organizationId, projectId, timestamp }) {
  const normalizedSecret = String(secret || '');
  if (normalizedSecret.length < 32) {
    const err = new Error('Catalog Query HMAC secret is not configured.');
    err.status = 503;
    err.code = 'CATALOG_QUERY_NOT_CONFIGURED';
    throw err;
  }

  const payload = buildCatalogQuerySigningPayload({ method, url, organizationId, projectId, timestamp });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

export async function buildCatalogQueryHeaders({ env, url, organizationId, projectId, timestamp = null }) {
  const resolvedTimestamp = timestamp == null ? String(Math.floor(Date.now() / 1000)) : String(timestamp);
  const signature = await createCatalogQuerySignature({
    secret: env?.CATALOG_QUERY_HMAC_SECRET,
    method: 'GET',
    url,
    organizationId,
    projectId,
    timestamp: resolvedTimestamp,
  });

  return {
    'X-QAgent-Organization-Id': organizationId,
    'X-QAgent-Project-Id': projectId,
    'X-QAgent-Query-Timestamp': resolvedTimestamp,
    'X-QAgent-Query-Signature': signature,
  };
}
