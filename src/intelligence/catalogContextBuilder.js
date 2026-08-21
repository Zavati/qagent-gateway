import {
  TEST_DESIGN_CONTRACT_VERSION,
  validateCatalogTestDesignContextV1,
} from './testDesignContract.js';
import {
  getCatalogEndpointForTestDesign,
  getCatalogSchemasForTestDesign,
  getCatalogEvidenceForTestDesign,
} from './catalogKnowledgeClient.js';
import { listProjectEnvironments } from '../services/environmentService.js';
import { listProjectApiServices } from '../services/apiServiceService.js';
import { listProjectEnvironmentApiBindings } from '../services/environmentApiBindingService.js';
import { listProjectAuthProfiles } from '../services/authProfileService.js';
import { listProjectEnvironmentAuthProfileBindings } from '../services/authProfileBindingService.js';

export const CATALOG_CONTEXT_BUILDER_VERSION = 'qagent.catalog-context-builder.v1.1';
export const DEFAULT_CONTEXT_LIMITS = Object.freeze({
  evidenceFetchLimit: 50,
  evidenceSelectedLimit: 24,
  schemaVersionsPerTrack: 8,
  schemaTrackLimit: 24,
  schemaVersionMetadataLimit: 8,
});

function nullableString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableInteger(value) {
  const number = nullableNumber(value);
  return number != null && Number.isInteger(number) ? number : null;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => nullableString(value)).filter(Boolean))];
}

function safeHttpOrigin(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function catalogBindingOrigin(binding) {
  const scheme = nullableString(binding?.scheme)?.toLowerCase();
  if (!['http', 'https'].includes(scheme)) return null;
  const authority = nullableString(binding?.host) || nullableString(binding?.hostname);
  if (!authority) return null;
  const withPort = binding?.port && !String(authority).includes(':')
    ? `${authority}:${binding.port}`
    : authority;
  return safeHttpOrigin(`${scheme}://${withPort}`);
}

function observedEnvironmentIds(endpointDetail) {
  const fromSummaries = (endpointDetail?.environments || []).map((item) => item?.environmentId);
  const fromBindings = (endpointDetail?.bindings || []).map((item) => item?.environmentId);
  return uniqueStrings([...fromSummaries, ...fromBindings]);
}

function buildRuntimeServiceMapping(endpointDetail, controlPlane) {
  // 07.7.2-A: Test Design resolves logical service identity independently from
  // the Environment selected later by a Run. Environment coverage remains a
  // diagnostic/safety signal, but it no longer nulls a uniquely identified
  // API Service merely because every observed Environment is not configured.
  const environmentIds = observedEnvironmentIds(endpointDetail);
  const catalogBindings = (endpointDetail?.bindings || [])
    .map((binding) => ({ environmentId: nullableString(binding?.environmentId), origin: catalogBindingOrigin(binding) }))
    .filter((binding) => binding.origin);
  const observedOrigins = uniqueStrings(catalogBindings.map((binding) => binding.origin));

  const candidates = [];
  for (const service of controlPlane.apiServices || []) {
    if (service?.status === 'archived') continue;
    const serviceBindings = (controlPlane.apiBindings || []).filter((binding) => (
      binding.apiServiceId === service.apiServiceId && binding?.status !== 'archived'
    ));
    const configuredOrigins = uniqueStrings(serviceBindings.map((binding) => safeHttpOrigin(binding.baseUrl)));
    const matchedOrigins = configuredOrigins.filter((origin) => observedOrigins.includes(origin));
    if (!matchedOrigins.length) continue;

    const matchedEnvironments = new Set();
    for (const catalogBinding of catalogBindings) {
      if (!catalogBinding.environmentId) continue;
      const exactEnvironmentBinding = serviceBindings.some((runtimeBinding) => (
        nullableString(runtimeBinding.environmentId) === catalogBinding.environmentId
        && safeHttpOrigin(runtimeBinding.baseUrl) === catalogBinding.origin
      ));
      if (exactEnvironmentBinding) matchedEnvironments.add(catalogBinding.environmentId);
    }

    const configuredEnvironmentIds = uniqueStrings(serviceBindings.map((binding) => binding.environmentId));
    candidates.push({
      apiServiceId: service.apiServiceId,
      serviceKey: service.serviceKey,
      matchedOrigins: [...matchedOrigins].sort(),
      originMatchCount: matchedOrigins.length,
      matchedEnvironmentIds: [...matchedEnvironments].sort(),
      configuredEnvironmentIds,
      environmentMatchCount: matchedEnvironments.size,
    });
  }

  candidates.sort((a, b) => (
    b.originMatchCount - a.originMatchCount
    || b.environmentMatchCount - a.environmentMatchCount
    || String(a.serviceKey).localeCompare(String(b.serviceKey))
  ));

  if (!candidates.length) {
    return {
      apiServiceId: null,
      apiServiceKey: null,
      status: 'UNMATCHED',
      resolutionSource: null,
      environmentIds,
      observedOrigins,
      environmentCoverageStatus: environmentIds.length ? 'NONE' : 'NOT_APPLICABLE',
      candidates: [],
    };
  }

  const bestOriginCount = candidates[0].originMatchCount;
  const bestEnvironmentCount = candidates[0].environmentMatchCount;
  const best = candidates.filter((candidate) => (
    candidate.originMatchCount === bestOriginCount
    && candidate.environmentMatchCount === bestEnvironmentCount
  ));
  if (best.length > 1) {
    return {
      apiServiceId: null,
      apiServiceKey: null,
      status: 'AMBIGUOUS',
      resolutionSource: 'ORIGIN',
      environmentIds,
      observedOrigins,
      environmentCoverageStatus: environmentIds.length ? 'AMBIGUOUS' : 'NOT_APPLICABLE',
      candidates,
    };
  }

  const selected = best[0];
  const environmentCoverageStatus = !environmentIds.length
    ? 'NOT_APPLICABLE'
    : environmentIds.every((environmentId) => selected.matchedEnvironmentIds.includes(environmentId))
      ? 'COMPLETE'
      : selected.matchedEnvironmentIds.length > 0
        ? 'PARTIAL'
        : 'NONE';

  return {
    apiServiceId: selected.apiServiceId,
    apiServiceKey: selected.serviceKey,
    status: 'MATCHED',
    resolutionSource: 'ORIGIN',
    environmentIds,
    observedOrigins,
    environmentCoverageStatus,
    candidates,
  };
}

function profileUsableForEnvironment(profile, binding) {
  if (!binding || binding.status === 'archived' || binding.authProfileEnabled === false) return false;
  if (profile.type === 'none') return false;
  return binding.credentialsConfigured === true;
}

function buildAuthRuntime(controlPlane, runtimeMapping) {
  // Test Design is Environment-independent. A profile is therefore considered
  // available when it is executable in at least one Environment where the
  // resolved API Service is configured. The selected Run Environment performs
  // the strict per-Environment validation later in Execution Plan materialization.
  const serviceEnvironmentIds = runtimeMapping?.apiServiceId
    ? uniqueStrings((controlPlane.apiBindings || [])
      .filter((binding) => binding.apiServiceId === runtimeMapping.apiServiceId && binding?.status !== 'archived' && safeHttpOrigin(binding.baseUrl))
      .map((binding) => binding.environmentId))
    : [];
  const activeEnvironmentIds = uniqueStrings((controlPlane.environments || [])
    .filter((environment) => environment?.status !== 'archived')
    .map((environment) => environment.environmentId));
  const eligibleEnvironmentIds = serviceEnvironmentIds.length ? serviceEnvironmentIds : activeEnvironmentIds;

  const available = [];
  const profileCoverage = [];
  for (const profile of controlPlane.authProfiles || []) {
    if (profile.status === 'archived' || profile.enabled === false || profile.type === 'none') continue;
    const bindings = (controlPlane.authBindings || []).filter((binding) => binding.authProfileId === profile.authProfileId);
    const usableEnvironmentIds = eligibleEnvironmentIds.filter((environmentId) => {
      const binding = bindings.find((item) => item.environmentId === environmentId);
      return profileUsableForEnvironment(profile, binding);
    });
    if (usableEnvironmentIds.length) {
      available.push(profile.authProfileId);
      profileCoverage.push({
        authProfileId: profile.authProfileId,
        usableEnvironmentIds: [...usableEnvironmentIds].sort(),
      });
    }
  }
  available.sort();
  return {
    availableAuthProfileRefs: available,
    defaultAuthProfileRef: available.length === 1 ? available[0] : null,
    completeProfileCount: available.length,
    eligibleEnvironmentCount: eligibleEnvironmentIds.length,
    profileCoverage,
  };
}

function isContextSafeJson(value, depth = 0) {
  if (depth > 10) return false;
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 80 && value.every((item) => isContextSafeJson(item, depth + 1));
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length <= 80 && keys.every((key) => key.length <= 160 && isContextSafeJson(value[key], depth + 1));
  }
  return false;
}

function mapSchemaTrack(track, versionLimit) {
  const versions = Array.isArray(track?.versions) ? track.versions : [];
  const currentVersion = versions.find((version) => version?.schemaVersionId === track?.currentSchemaVersionId)
    || versions.find((version) => version?.schemaHash === track?.currentSchemaHash)
    || versions[0]
    || null;
  const contentTypes = uniqueStrings((currentVersion?.contentTypes || []).map((item) => item?.contentType));
  const structuralSchema = currentVersion && isContextSafeJson(currentVersion.schema) ? currentVersion.schema : undefined;
  const mapped = {
    trackId: nullableString(track?.schemaTrackId),
    direction: track?.direction,
    statusCode: nullableInteger(track?.statusCode),
    currentVersionId: nullableString(track?.currentSchemaVersionId),
    currentSchemaHash: nullableString(track?.currentSchemaHash),
    contentTypes,
    versions: versions.slice(0, versionLimit).map((version) => ({
      versionId: nullableString(version?.schemaVersionId),
      schemaHash: nullableString(version?.schemaHash),
      observationCount: nullableInteger(version?.observationCount),
      introducedAt: nullableString(version?.firstSeenAt),
    })).filter((version) => version.versionId && version.schemaHash),
  };
  if (structuralSchema !== undefined) mapped.schema = structuralSchema;
  return { mapped, structuralIncluded: structuralSchema !== undefined };
}

function selectDiverseEvidence(items, limit) {
  const selected = [];
  const selectedIds = new Set();
  const signatures = new Set();

  for (const item of items || []) {
    if (selected.length >= limit) break;
    const evidenceId = nullableString(item?.evidenceId);
    if (!evidenceId || selectedIds.has(evidenceId)) continue;
    const signature = [
      nullableString(item?.environmentId) || '-',
      nullableString(item?.evidenceOutcomeClass) || '-',
      nullableInteger(item?.statusCode) ?? '-',
      nullableString(item?.requestSchemaVersionId) || '-',
      nullableString(item?.responseSchemaVersionId) || '-',
    ].join('|');
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    selectedIds.add(evidenceId);
    selected.push(item);
  }

  for (const item of items || []) {
    if (selected.length >= limit) break;
    const evidenceId = nullableString(item?.evidenceId);
    if (!evidenceId || selectedIds.has(evidenceId)) continue;
    selectedIds.add(evidenceId);
    selected.push(item);
  }
  return selected;
}

function mapEvidence(item) {
  return {
    evidenceId: nullableString(item?.evidenceId),
    observedAt: nullableString(item?.observedAt),
    environmentId: nullableString(item?.environmentId),
    outcome: nullableString(item?.evidenceOutcomeClass),
    statusCode: nullableInteger(item?.statusCode),
    latencyMs: nullableNumber(item?.latencyMs),
    sourceHost: nullableString(item?.host),
    sessionId: nullableString(item?.observationSessionId),
    requestSchemaVersionId: nullableString(item?.requestSchemaVersionId),
    responseSchemaVersionId: nullableString(item?.responseSchemaVersionId),
  };
}

function mapEndpoint(endpointDetail) {
  return {
    endpointId: nullableString(endpointDetail?.endpointId),
    serviceId: nullableString(endpointDetail?.serviceId),
    serviceName: nullableString(endpointDetail?.serviceName || endpointDetail?.serviceDisplayName),
    classification: nullableString(endpointDetail?.classification),
    classificationConfidence: nullableNumber(endpointDetail?.classificationConfidence),
    method: nullableString(endpointDetail?.method)?.toUpperCase(),
    normalizedPath: nullableString(endpointDetail?.normalizedPath),
    discoveryConfidenceScore: nullableNumber(endpointDetail?.discoveryConfidenceScore),
    discoveryConfidenceLevel: nullableString(endpointDetail?.discoveryConfidenceLevel),
    lifecycleState: nullableString(endpointDetail?.lifecycleState),
    observationCount: nullableInteger(endpointDetail?.observationCount),
    sessionCount: nullableInteger(endpointDetail?.sessionCount),
    environmentCount: nullableInteger(endpointDetail?.environmentCount),
    successRatePct: nullableNumber(endpointDetail?.successRatePct),
    latencyAvgMs: nullableNumber(endpointDetail?.latencyAvgMs),
    firstSeenAt: nullableString(endpointDetail?.firstSeenAt),
    lastSeenAt: nullableString(endpointDetail?.lastSeenAt),
  };
}

function mapEnvironments(endpointDetail, projectEnvironments) {
  const names = new Map((projectEnvironments || []).map((environment) => [environment.environmentId, environment.name]));
  return (endpointDetail?.environments || []).map((item) => ({
    environmentId: nullableString(item?.environmentId),
    name: nullableString(names.get(item?.environmentId)),
    observationCount: nullableInteger(item?.observationCount),
    successRatePct: nullableNumber(item?.successRatePct),
    lastSeenAt: nullableString(item?.lastSeenAt),
  })).filter((item) => item.environmentId);
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function defaultCatalogLoader({ env, organizationId, projectId, endpointId, limits }) {
  const base = { env, organizationId, projectId, endpointId };
  const [endpointDetail, schemas, evidence] = await Promise.all([
    getCatalogEndpointForTestDesign(base),
    getCatalogSchemasForTestDesign({ ...base, versionsPerTrack: limits.schemaVersionsPerTrack }),
    getCatalogEvidenceForTestDesign({ ...base, limit: limits.evidenceFetchLimit }),
  ]);
  return { endpointDetail, schemas, evidence };
}

async function defaultControlPlaneLoader({ env, organizationId, projectId }) {
  const [environments, apiServices, authProfiles] = await Promise.all([
    listProjectEnvironments(env, organizationId, projectId),
    listProjectApiServices(env, organizationId, projectId),
    listProjectAuthProfiles(env, organizationId, projectId),
  ]);
  const [apiBindingGroups, authBindingGroups] = await Promise.all([
    Promise.all(environments.map((environment) => listProjectEnvironmentApiBindings(env, organizationId, projectId, environment.environmentId))),
    Promise.all(environments.map((environment) => listProjectEnvironmentAuthProfileBindings(env, organizationId, projectId, environment.environmentId))),
  ]);
  return {
    environments,
    apiServices,
    apiBindings: apiBindingGroups.flat(),
    authProfiles,
    authBindings: authBindingGroups.flat(),
  };
}

export async function buildCatalogTestDesignContextV1({
  env,
  organizationId,
  projectId,
  endpointId,
  limits = {},
  catalogLoader = defaultCatalogLoader,
  controlPlaneLoader = defaultControlPlaneLoader,
} = {}) {
  const resolvedLimits = { ...DEFAULT_CONTEXT_LIMITS, ...(limits || {}) };
  const scope = {
    organizationId: nullableString(organizationId),
    projectId: nullableString(projectId),
    endpointId: nullableString(endpointId),
  };
  if (!scope.organizationId || !scope.projectId || !scope.endpointId) {
    const error = new Error('organizationId, projectId e endpointId são obrigatórios para montar o Test Design Context.');
    error.status = 400;
    error.code = 'TEST_DESIGN_CONTEXT_SCOPE_REQUIRED';
    throw error;
  }

  const [catalog, controlPlane] = await Promise.all([
    catalogLoader({ env, ...scope, limits: resolvedLimits }),
    controlPlaneLoader({ env, organizationId: scope.organizationId, projectId: scope.projectId }),
  ]);

  const endpointDetail = catalog?.endpointDetail || {};
  if (nullableString(endpointDetail.endpointId) !== scope.endpointId) {
    const error = new Error('Endpoint retornado pelo Catalog diverge do endpoint solicitado.');
    error.status = 502;
    error.code = 'TEST_DESIGN_CONTEXT_ENDPOINT_MISMATCH';
    throw error;
  }

  const runtimeMapping = buildRuntimeServiceMapping(endpointDetail, controlPlane || {});
  const authRuntime = buildAuthRuntime(controlPlane || {}, runtimeMapping);
  const schemaTracks = Array.isArray(catalog?.schemas?.tracks) ? catalog.schemas.tracks : [];
  let structuralSchemasIncluded = 0;
  const schemas = schemaTracks.slice(0, resolvedLimits.schemaTrackLimit).map((track) => {
    const result = mapSchemaTrack(track, resolvedLimits.schemaVersionMetadataLimit);
    if (result.structuralIncluded) structuralSchemasIncluded += 1;
    return result.mapped;
  }).filter((track) => track.trackId && ['REQUEST', 'RESPONSE'].includes(track.direction));

  const fetchedEvidence = Array.isArray(catalog?.evidence) ? catalog.evidence : [];
  const selectedEvidence = selectDiverseEvidence(fetchedEvidence, resolvedLimits.evidenceSelectedLimit)
    .map(mapEvidence)
    .filter((item) => item.evidenceId && item.observedAt);

  const context = {
    contractVersion: TEST_DESIGN_CONTRACT_VERSION,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    endpoint: mapEndpoint(endpointDetail),
    schemas,
    evidence: selectedEvidence,
    environments: mapEnvironments(endpointDetail, controlPlane?.environments || []),
    runtime: {
      apiServiceKey: runtimeMapping.apiServiceKey,
      defaultAuthProfileRef: authRuntime.defaultAuthProfileRef,
      availableAuthProfileRefs: authRuntime.availableAuthProfileRefs,
    },
  };

  validateCatalogTestDesignContextV1(context);
  const contextFingerprint = await sha256Hex(canonicalize(context));
  const diagnostics = {
    builderVersion: CATALOG_CONTEXT_BUILDER_VERSION,
    runtimeMapping: {
      status: runtimeMapping.status,
      resolutionSource: runtimeMapping.resolutionSource,
      observedEnvironmentCount: runtimeMapping.environmentIds.length,
      observedOriginCount: runtimeMapping.observedOrigins.length,
      configuredApiServiceCount: (controlPlane?.apiServices || []).length,
      candidateCount: runtimeMapping.candidates.length,
      selectedApiServiceKey: runtimeMapping.apiServiceKey,
      environmentCoverageStatus: runtimeMapping.environmentCoverageStatus,
    },
    auth: {
      configuredProfileCount: (controlPlane?.authProfiles || []).filter((profile) => profile.enabled !== false && profile.status !== 'archived').length,
      completeProfileCount: authRuntime.completeProfileCount,
      eligibleEnvironmentCount: authRuntime.eligibleEnvironmentCount,
      defaultSelected: Boolean(authRuntime.defaultAuthProfileRef),
    },
    schemas: {
      tracksFetched: schemaTracks.length,
      tracksSelected: schemas.length,
      structuralSchemasIncluded,
      structuralSchemasOmitted: Math.max(0, schemas.length - structuralSchemasIncluded),
    },
    evidence: {
      fetched: fetchedEvidence.length,
      selected: selectedEvidence.length,
    },
    limits: resolvedLimits,
  };

  return { context, contextFingerprint, diagnostics };
}
