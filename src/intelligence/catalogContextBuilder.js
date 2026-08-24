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
import { listProjectEndpointTestDataBindings } from '../services/testDataBindingService.js';
import { deriveDiscoveredRuntimeCandidate } from './discoveredRuntime.js';

export const CATALOG_CONTEXT_BUILDER_VERSION = 'qagent.catalog-context-builder.v1.6';
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

const AUTH_OBSERVED_SCHEMES = new Set(['BEARER', 'BASIC', 'API_KEY', 'COOKIE', 'UNKNOWN']);

function normalizeObservedAuthScheme(value) {
  const scheme = nullableString(value)?.toUpperCase().replace(/[- ]+/g, '_') || null;
  if (!scheme) return null;
  if (scheme === 'BEARER_TOKEN' || scheme === 'JWT') return 'BEARER';
  if (scheme === 'BASIC_AUTH') return 'BASIC';
  if (scheme === 'APIKEY' || scheme === 'X_API_KEY' || scheme === 'X_AUTH_TOKEN') return 'API_KEY';
  return AUTH_OBSERVED_SCHEMES.has(scheme) ? scheme : 'UNKNOWN';
}

function aggregateAuthObservation(items) {
  let observedTrue = 0;
  let observedFalse = 0;
  let authenticatedSuccessCount = 0;
  let unauthenticatedSuccessCount = 0;
  let unauthenticatedAuthErrorCount = 0;
  const schemes = new Set();
  const evidenceRefs = [];

  for (const item of items || []) {
    if (typeof item?.authObserved !== 'boolean') continue;
    const statusCode = nullableInteger(item?.statusCode);
    const isSuccess = statusCode != null && statusCode >= 200 && statusCode < 300;
    const isAuthError = statusCode === 401 || statusCode === 403;

    if (item.authObserved) {
      observedTrue += 1;
      if (isSuccess) authenticatedSuccessCount += 1;
      const scheme = normalizeObservedAuthScheme(item.authScheme) || 'UNKNOWN';
      schemes.add(scheme);
      const evidenceId = nullableString(item?.evidenceId);
      if (evidenceId && evidenceRefs.length < 20 && !evidenceRefs.includes(evidenceId)) evidenceRefs.push(evidenceId);
    } else {
      observedFalse += 1;
      if (isSuccess) unauthenticatedSuccessCount += 1;
      if (isAuthError) unauthenticatedAuthErrorCount += 1;
    }
  }

  let status = 'UNKNOWN';
  if (observedTrue > 0 && observedFalse > 0) {
    // Mixed header presence is not automatically ambiguity. A successful 2xx
    // without auth proves that the endpoint is public-capable, even if callers
    // sometimes send Authorization opportunistically.
    if (unauthenticatedSuccessCount > 0) status = 'OPTIONAL';
    // Conversely, observed 401/403 without auth plus authenticated success is
    // strong evidence that auth is actually required.
    else if (authenticatedSuccessCount > 0 && unauthenticatedAuthErrorCount > 0) status = 'REQUIRED';
    else status = 'MIXED';
  } else if (observedTrue > 0) {
    status = 'REQUIRED';
  } else if (observedFalse > 0) {
    status = unauthenticatedSuccessCount > 0 ? 'NONE'
      : unauthenticatedAuthErrorCount > 0 ? 'REQUIRED'
        : 'NONE';
  }

  const scheme = ['REQUIRED', 'OPTIONAL'].includes(status)
    ? (schemes.size === 1 ? [...schemes][0] : 'UNKNOWN')
    : null;
  return {
    status,
    scheme,
    evidenceRefs,
    observedWithAuthCount: observedTrue,
    observedWithoutAuthCount: observedFalse,
    authenticatedSuccessCount,
    unauthenticatedSuccessCount,
    unauthenticatedAuthErrorCount,
    knownSignalCount: observedTrue + observedFalse,
  };
}

function profileCompatibleWithObservedAuth(profile, scheme) {
  if (!profile || profile.enabled === false || profile.status === 'archived' || profile.type === 'none') return false;
  const normalizedScheme = normalizeObservedAuthScheme(scheme) || 'UNKNOWN';
  const config = profile.config && typeof profile.config === 'object' ? profile.config : {};

  if (normalizedScheme === 'UNKNOWN') return true;
  if (normalizedScheme === 'BASIC') return profile.type === 'basic';
  if (normalizedScheme === 'API_KEY') return profile.type === 'api_key';
  if (normalizedScheme === 'COOKIE') return false;
  if (normalizedScheme === 'BEARER') {
    if (profile.type === 'api_key') {
      return String(config.placement || '').toLowerCase() === 'header'
        && String(config.name || '').toLowerCase() === 'authorization';
    }
    if (profile.type === 'oauth2_client_credentials') {
      return String(config.targetHeader || 'Authorization').toLowerCase() === 'authorization';
    }
    if (profile.type === 'login_http_json') {
      const targetHeader = String(config.targetHeader || 'Authorization').toLowerCase();
      const configuredScheme = String(config.scheme ?? 'Bearer').trim().toUpperCase();
      return targetHeader === 'authorization' && (!configuredScheme || configuredScheme === 'BEARER');
    }
    return false;
  }
  return false;
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

function buildRuntimeServiceMapping(endpointDetail, controlPlane, evidence = []) {
  // 07.7.2-A: Test Design resolves logical service identity independently from
  // the Environment selected later by a Run. Environment coverage remains a
  // diagnostic/safety signal, but it no longer nulls a uniquely identified
  // API Service merely because every observed Environment is not configured.
  const environmentIds = observedEnvironmentIds(endpointDetail);
  const catalogBindings = (endpointDetail?.bindings || [])
    .map((binding) => ({ environmentId: nullableString(binding?.environmentId), origin: catalogBindingOrigin(binding) }))
    .filter((binding) => binding.origin);
  const evidenceOrigins = (evidence || []).map((item) => {
    const scheme = nullableString(item?.scheme)?.toLowerCase() || 'https';
    const host = nullableString(item?.host);
    return host ? safeHttpOrigin(`${scheme}://${host}`) : null;
  }).filter(Boolean);
  const observedOrigins = uniqueStrings([...catalogBindings.map((binding) => binding.origin), ...evidenceOrigins]);

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
    const discovered = deriveDiscoveredRuntimeCandidate(endpointDetail, evidence);
    if (discovered.status === 'DISCOVERED' && discovered.serviceKey) {
      return {
        apiServiceId: null,
        apiServiceKey: discovered.serviceKey,
        status: 'DISCOVERED',
        resolutionSource: 'DISCOVERED_OBSERVATION',
        runtimeSource: 'DISCOVERED_OBSERVATION',
        resolutionConfidence: discovered.confidence,
        requiresExecutionConfirmation: true,
        discoveredOrigin: discovered.origin,
        environmentIds: uniqueStrings([...environmentIds, ...discovered.environmentIds]),
        observedOrigins: discovered.observedOrigins,
        environmentCoverageStatus: discovered.environmentIds.length ? 'OBSERVED' : 'NOT_APPLICABLE',
        candidates: [],
      };
    }
    return {
      apiServiceId: null,
      apiServiceKey: null,
      status: discovered.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'UNMATCHED',
      resolutionSource: null,
      runtimeSource: null,
      resolutionConfidence: null,
      requiresExecutionConfirmation: false,
      discoveredOrigin: null,
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
      runtimeSource: null,
      resolutionConfidence: null,
      requiresExecutionConfirmation: false,
      discoveredOrigin: null,
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
    runtimeSource: 'EXPLICIT_CONFIG',
    resolutionConfidence: 'CONFIRMED',
    requiresExecutionConfirmation: false,
    discoveredOrigin: null,
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

function buildAuthRuntime(controlPlane, runtimeMapping, authObservation) {
  // 07.7.8-B — Zero-Config Auth Resolution.
  // Test Design remains Environment-independent for explicit API Services, but a
  // DISCOVERED_OBSERVATION runtime is tied to the Environment(s) that produced
  // the observation. Auth auto-selection must therefore never borrow credentials
  // from an unrelated Environment merely because it exists in the same Project.
  const serviceEnvironmentIds = runtimeMapping?.apiServiceId
    ? uniqueStrings((controlPlane.apiBindings || [])
      .filter((binding) => binding.apiServiceId === runtimeMapping.apiServiceId && binding?.status !== 'archived' && safeHttpOrigin(binding.baseUrl))
      .map((binding) => binding.environmentId))
    : [];
  const activeEnvironmentIds = uniqueStrings((controlPlane.environments || [])
    .filter((environment) => environment?.status !== 'archived')
    .map((environment) => environment.environmentId));
  const observedRuntimeEnvironmentIds = uniqueStrings(runtimeMapping?.environmentIds || [])
    .filter((environmentId) => activeEnvironmentIds.includes(environmentId));

  let eligibleEnvironmentIds = [];
  let environmentScopeSource = 'PROJECT_ENVIRONMENTS';
  if (runtimeMapping?.runtimeSource === 'DISCOVERED_OBSERVATION') {
    if ((runtimeMapping?.environmentIds || []).length) {
      eligibleEnvironmentIds = observedRuntimeEnvironmentIds;
      environmentScopeSource = 'OBSERVED_ENVIRONMENTS';
    } else {
      eligibleEnvironmentIds = activeEnvironmentIds;
      environmentScopeSource = 'PROJECT_ENVIRONMENTS_FALLBACK';
    }
  } else if (serviceEnvironmentIds.length) {
    eligibleEnvironmentIds = serviceEnvironmentIds;
    environmentScopeSource = 'API_SERVICE_ENVIRONMENTS';
  } else {
    eligibleEnvironmentIds = activeEnvironmentIds;
  }

  const usableProfiles = [];
  const compatibleProfiles = [];
  const profileCoverage = [];
  for (const profile of controlPlane.authProfiles || []) {
    if (profile.status === 'archived' || profile.enabled === false || profile.type === 'none') continue;
    const bindings = (controlPlane.authBindings || []).filter((binding) => binding.authProfileId === profile.authProfileId);
    const usableEnvironmentIds = eligibleEnvironmentIds.filter((environmentId) => {
      const binding = bindings.find((item) => item.environmentId === environmentId);
      return profileUsableForEnvironment(profile, binding);
    });
    if (!usableEnvironmentIds.length) continue;

    const compatible = !['REQUIRED', 'OPTIONAL'].includes(String(authObservation?.status || '').toUpperCase())
      || profileCompatibleWithObservedAuth(profile, authObservation?.scheme);
    const candidate = {
      authProfileId: profile.authProfileId,
      profileKey: profile.profileKey || null,
      name: profile.name || null,
      type: profile.type || null,
      usableEnvironmentIds: [...usableEnvironmentIds].sort(),
      observedAuthCompatible: compatible,
    };
    profileCoverage.push(candidate);
    usableProfiles.push(candidate);
    if (compatible) compatibleProfiles.push(candidate);
  }

  const observationStatus = String(authObservation?.status || 'UNKNOWN').toUpperCase();
  const availableProfiles = ['REQUIRED', 'OPTIONAL'].includes(observationStatus) ? compatibleProfiles : usableProfiles;
  availableProfiles.sort((a, b) => String(a.authProfileId).localeCompare(String(b.authProfileId)));
  compatibleProfiles.sort((a, b) => String(a.authProfileId).localeCompare(String(b.authProfileId)));

  let resolutionStatus = 'UNKNOWN';
  let resolutionSource = null;
  let selectedProfile = null;
  if (observationStatus === 'REQUIRED') {
    if (compatibleProfiles.length === 1) {
      resolutionStatus = 'AUTO_MATCHED';
      resolutionSource = runtimeMapping?.runtimeSource === 'DISCOVERED_OBSERVATION'
        ? 'OBSERVED_AUTH_AND_ENVIRONMENT'
        : 'OBSERVED_AUTH';
      selectedProfile = compatibleProfiles[0];
    } else if (compatibleProfiles.length > 1) {
      resolutionStatus = 'AMBIGUOUS';
      resolutionSource = 'OBSERVED_AUTH';
    } else {
      resolutionStatus = 'UNAVAILABLE';
      resolutionSource = 'OBSERVED_AUTH';
    }
  } else if (observationStatus === 'OPTIONAL') {
    if (compatibleProfiles.length === 1) {
      resolutionStatus = 'OPTIONAL_AUTO_MATCHED';
      resolutionSource = runtimeMapping?.runtimeSource === 'DISCOVERED_OBSERVATION'
        ? 'OBSERVED_OPTIONAL_AUTH_AND_ENVIRONMENT'
        : 'OBSERVED_OPTIONAL_AUTH';
      selectedProfile = compatibleProfiles[0];
    } else if (compatibleProfiles.length > 1) {
      resolutionStatus = 'OPTIONAL_AMBIGUOUS';
      resolutionSource = 'OBSERVED_OPTIONAL_AUTH';
    } else {
      resolutionStatus = 'OPTIONAL_NO_PROFILE';
      resolutionSource = 'OBSERVED_OPTIONAL_AUTH';
    }
  } else if (observationStatus === 'MIXED') {
    resolutionStatus = 'REVIEW_REQUIRED';
    resolutionSource = 'OBSERVED_AUTH';
  } else if (observationStatus === 'NONE') {
    resolutionStatus = 'NOT_REQUIRED';
    resolutionSource = 'OBSERVED_AUTH';
    // Backward-compatible convenience: keep a unique usable profile available
    // as the project default, although NONE scenarios will never consume it.
    if (usableProfiles.length === 1) selectedProfile = usableProfiles[0];
  } else if (usableProfiles.length === 1) {
    // Historical behavior for endpoints without a known auth signal. This does
    // not force REQUIRED; it only preserves the unique project profile as the
    // default should a grounded scenario require it for another reason.
    resolutionStatus = 'SINGLE_PROFILE_AVAILABLE';
    resolutionSource = 'PROJECT_AUTH_CONFIG';
    selectedProfile = usableProfiles[0];
  }

  return {
    availableAuthProfileRefs: availableProfiles.map((profile) => profile.authProfileId),
    defaultAuthProfileRef: selectedProfile?.authProfileId || null,
    completeProfileCount: usableProfiles.length,
    compatibleProfileCount: compatibleProfiles.length,
    eligibleEnvironmentCount: eligibleEnvironmentIds.length,
    eligibleEnvironmentIds: [...eligibleEnvironmentIds].sort(),
    environmentScopeSource,
    resolutionStatus,
    resolutionSource,
    selectedProfile,
    candidateProfileCount: compatibleProfiles.length,
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
      typeof item?.authObserved === 'boolean' ? String(item.authObserved) : '-',
      normalizeObservedAuthScheme(item?.authScheme) || '-',
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
    authObserved: typeof item?.authObserved === 'boolean' ? item.authObserved : null,
    authScheme: item?.authObserved === true ? (normalizeObservedAuthScheme(item?.authScheme) || 'UNKNOWN') : null,
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

async function defaultControlPlaneLoader({ env, organizationId, projectId, endpointId }) {
  const [environments, apiServices, authProfiles, testDataBindings] = await Promise.all([
    listProjectEnvironments(env, organizationId, projectId),
    listProjectApiServices(env, organizationId, projectId),
    listProjectAuthProfiles(env, organizationId, projectId),
    listProjectEndpointTestDataBindings(env, organizationId, projectId, endpointId),
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
    testDataBindings,
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
    controlPlaneLoader({ env, organizationId: scope.organizationId, projectId: scope.projectId, endpointId: scope.endpointId }),
  ]);

  const endpointDetail = catalog?.endpointDetail || {};
  if (nullableString(endpointDetail.endpointId) !== scope.endpointId) {
    const error = new Error('Endpoint retornado pelo Catalog diverge do endpoint solicitado.');
    error.status = 502;
    error.code = 'TEST_DESIGN_CONTEXT_ENDPOINT_MISMATCH';
    throw error;
  }

  const fetchedEvidence = Array.isArray(catalog?.evidence) ? catalog.evidence : [];
  const runtimeMapping = buildRuntimeServiceMapping(endpointDetail, controlPlane || {}, fetchedEvidence);
  const authObservation = aggregateAuthObservation(fetchedEvidence);
  const authRuntime = buildAuthRuntime(controlPlane || {}, runtimeMapping, authObservation);
  const schemaTracks = Array.isArray(catalog?.schemas?.tracks) ? catalog.schemas.tracks : [];
  let structuralSchemasIncluded = 0;
  const schemas = schemaTracks.slice(0, resolvedLimits.schemaTrackLimit).map((track) => {
    const result = mapSchemaTrack(track, resolvedLimits.schemaVersionMetadataLimit);
    if (result.structuralIncluded) structuralSchemasIncluded += 1;
    return result.mapped;
  }).filter((track) => track.trackId && ['REQUEST', 'RESPONSE'].includes(track.direction));

  const selectedEvidence = selectDiverseEvidence(fetchedEvidence, resolvedLimits.evidenceSelectedLimit)
    .map(mapEvidence)
    .filter((item) => item.evidenceId && item.observedAt);
  const selectedEvidenceIds = new Set(selectedEvidence.map((item) => item.evidenceId));
  const selectedAuthEvidenceRefs = authObservation.evidenceRefs.filter((ref) => selectedEvidenceIds.has(ref));

  const context = {
    contractVersion: TEST_DESIGN_CONTRACT_VERSION,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    endpoint: mapEndpoint(endpointDetail),
    schemas,
    evidence: selectedEvidence,
    environments: mapEnvironments(endpointDetail, controlPlane?.environments || []),
    testData: {
      configuredBindings: (controlPlane?.testDataBindings || []).map((binding) => ({
        bindingId: nullableString(binding?.bindingId),
        environmentId: nullableString(binding?.environmentId),
        target: nullableString(binding?.target),
        selector: nullableString(binding?.selector),
        sourceType: nullableString(binding?.sourceType),
        valueType: nullableString(binding?.valueType),
        generatorKind: nullableString(binding?.generatorKind),
        generatorConfig: binding?.sourceType === 'GENERATED' && isContextSafeJson(binding?.generatorConfig || {}) ? binding.generatorConfig : {},
        secretConfigured: binding?.sourceType === 'SECRET' ? binding?.secretConfigured === true : false,
      })).filter((binding) => binding.bindingId && binding.environmentId && binding.target && binding.selector && binding.sourceType),
    },
    runtime: {
      apiServiceKey: runtimeMapping.apiServiceKey,
      resolutionSource: runtimeMapping.runtimeSource,
      resolutionConfidence: runtimeMapping.resolutionConfidence,
      requiresExecutionConfirmation: runtimeMapping.requiresExecutionConfirmation === true,
      discoveredOrigin: runtimeMapping.discoveredOrigin,
      defaultAuthProfileRef: authRuntime.defaultAuthProfileRef,
      availableAuthProfileRefs: authRuntime.availableAuthProfileRefs,
      authObservation: {
        status: authObservation.status,
        scheme: authObservation.scheme,
        evidenceRefs: selectedAuthEvidenceRefs,
      },
    },
  };

  validateCatalogTestDesignContextV1(context);
  const contextFingerprint = await sha256Hex(canonicalize(context));
  const diagnostics = {
    builderVersion: CATALOG_CONTEXT_BUILDER_VERSION,
    runtimeMapping: {
      status: runtimeMapping.status,
      resolutionSource: runtimeMapping.resolutionSource,
      runtimeSource: runtimeMapping.runtimeSource,
      observedEnvironmentCount: runtimeMapping.environmentIds.length,
      observedOriginCount: runtimeMapping.observedOrigins.length,
      configuredApiServiceCount: (controlPlane?.apiServices || []).length,
      candidateCount: runtimeMapping.candidates.length,
      selectedApiServiceKey: runtimeMapping.apiServiceKey,
      resolutionConfidence: runtimeMapping.resolutionConfidence,
      requiresExecutionConfirmation: runtimeMapping.requiresExecutionConfirmation === true,
      discoveredOrigin: runtimeMapping.discoveredOrigin,
      environmentCoverageStatus: runtimeMapping.environmentCoverageStatus,
    },
    auth: {
      configuredProfileCount: (controlPlane?.authProfiles || []).filter((profile) => profile.enabled !== false && profile.status !== 'archived').length,
      completeProfileCount: authRuntime.completeProfileCount,
      compatibleProfileCount: authRuntime.compatibleProfileCount,
      candidateProfileCount: authRuntime.candidateProfileCount,
      eligibleEnvironmentCount: authRuntime.eligibleEnvironmentCount,
      environmentScopeSource: authRuntime.environmentScopeSource,
      resolutionStatus: authRuntime.resolutionStatus,
      resolutionSource: authRuntime.resolutionSource,
      defaultSelected: Boolean(authRuntime.defaultAuthProfileRef),
      selectedAuthProfileRef: authRuntime.selectedProfile?.authProfileId || null,
      selectedProfileKey: authRuntime.selectedProfile?.profileKey || null,
      selectedProfileName: authRuntime.selectedProfile?.name || null,
      selectedProfileType: authRuntime.selectedProfile?.type || null,
      observationStatus: authObservation.status,
      observedScheme: authObservation.scheme,
      observedWithAuthCount: authObservation.observedWithAuthCount,
      observedWithoutAuthCount: authObservation.observedWithoutAuthCount,
      authenticatedSuccessCount: authObservation.authenticatedSuccessCount,
      unauthenticatedSuccessCount: authObservation.unauthenticatedSuccessCount,
      unauthenticatedAuthErrorCount: authObservation.unauthenticatedAuthErrorCount,
      knownSignalCount: authObservation.knownSignalCount,
    },
    testData: {
      configuredBindingCount: (controlPlane?.testDataBindings || []).length,
      generatedBindingCount: (controlPlane?.testDataBindings || []).filter((item) => item?.sourceType === 'GENERATED').length,
      fixedBindingCount: (controlPlane?.testDataBindings || []).filter((item) => item?.sourceType === 'FIXED').length,
      secretBindingCount: (controlPlane?.testDataBindings || []).filter((item) => item?.sourceType === 'SECRET').length,
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
