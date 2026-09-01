import {
  proxyCatalogQuery,
  CatalogProxyError,
} from '../services/catalogQueryProxyService.js';

function buildIncomingUrl(query = {}) {
  const url = new URL(
    'https://qagent.internal/catalog-context',
  );

  for (
    const [key, value]
    of Object.entries(query || {})
  ) {
    if (
      value == null
      || value === ''
    ) {
      continue;
    }

    url.searchParams.set(
      key,
      String(value),
    );
  }

  return url;
}

function parseBody(bodyText) {
  try {
    return bodyText
      ? JSON.parse(bodyText)
      : null;
  } catch {
    return null;
  }
}

async function queryCatalogData({
  env,
  organizationId,
  projectId,
  upstreamPath,
  query = {},
  fetchImpl = null,
}) {
  const result =
    await proxyCatalogQuery({
      env,
      organizationId,
      projectId,
      upstreamPath,
      incomingUrl:
        buildIncomingUrl(query),
      fetchImpl,
    });

  const parsed =
    parseBody(
      result.bodyText,
    );

  if (
    result.status < 200
    || result.status >= 300
  ) {
    throw new CatalogProxyError(
      result.status,

      parsed?.code
      || (
        result.status === 404
          ? 'CATALOG_ENDPOINT_NOT_FOUND'
          : 'CATALOG_CONTEXT_QUERY_FAILED'
      ),

      parsed?.message
      || (
        result.status === 404
          ? 'Catalog endpoint não encontrado neste Project.'
          : 'Falha ao consultar o Catalog.'
      ),
    );
  }

  if (
    !parsed
    || parsed.status !== 'ok'
    || !Object.prototype
      .hasOwnProperty
      .call(parsed, 'data')
  ) {
    throw new CatalogProxyError(
      502,
      'CATALOG_CONTEXT_RESPONSE_INVALID',
      'Catalog retornou uma resposta inválida para Test Design.',
    );
  }

  return parsed.data;
}

export function getCatalogEndpointForTestDesign(
  input,
) {
  return queryCatalogData({
    ...input,

    upstreamPath:
      `/v1/catalog/endpoints/${encodeURIComponent(input.endpointId)}`,
  });
}

export function getCatalogSchemasForTestDesign(
  input,
) {
  return queryCatalogData({
    ...input,

    upstreamPath:
      `/v1/catalog/endpoints/${encodeURIComponent(input.endpointId)}/schemas`,

    query: {
      versionsPerTrack:
        input.versionsPerTrack,
    },
  });
}

export async function getCatalogEvidenceForTestDesign(
  input,
) {
  const data =
    await queryCatalogData({
      ...input,

      upstreamPath:
        `/v1/catalog/endpoints/${encodeURIComponent(input.endpointId)}/evidence`,

      query: {
        limit:
          input.limit,
      },
    });

  return Array.isArray(data)
    ? data
    : [];
}

/**
 * 07.7.8-C2-E — Observed QUERY Runtime
 *
 * target passa a ser propagado para a consulta escalar
 * do Reservoir.
 *
 * Isso diferencia corretamente, por exemplo:
 *
 *   BODY:status
 *   QUERY:status
 *
 * usando a mesma rota existente do Catalog.
 */
export async function getCatalogObservedTestDataForTestDesign(
  input,
) {
  const data =
    await queryCatalogData({
      ...input,

      upstreamPath:
        `/v1/catalog/endpoints/${encodeURIComponent(input.endpointId)}/observed-test-data`,

      query: {
        limit:
          input.limit,

        environmentId:
          input.environmentId,

        target:
          input.target,

        selector:
          input.selector,

        outcomeClass:
          input.outcomeClass,

        cursor:
          input.cursor,
      },
    });

  return Array.isArray(data)
    ? data
    : [];
}

/**
 * Não filtramos samples por target.
 *
 * Um request sample pode conter simultaneamente:
 *
 *   BODY:$.leaveTypeId
 *   QUERY:fromDate
 *   QUERY:toDate
 *
 * e o Runtime Resolver precisa enxergar o sample completo
 * para preservar a correlação entre esses valores.
 */
export async function getCatalogObservedRequestSamplesForTestDesign(
  input,
) {
  const data =
    await queryCatalogData({
      ...input,

      upstreamPath:
        `/v1/catalog/endpoints/${encodeURIComponent(input.endpointId)}/observed-test-data/samples`,

      query: {
        limit:
          input.limit,

        environmentId:
          input.environmentId,

        outcomeClass:
          input.outcomeClass,

        cursor:
          input.cursor,
      },
    });

  return Array.isArray(data)
    ? data
    : [];
}