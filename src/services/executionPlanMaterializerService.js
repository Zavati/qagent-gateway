import { getCatalogEndpointForTestDesign, getCatalogEvidenceForTestDesign, getCatalogSchemasForTestDesign } from '../intelligence/catalogKnowledgeClient.js';
import { deriveDiscoveredRuntimeCandidate, isDiscoveredRuntimeServiceKey } from '../intelligence/discoveredRuntime.js';
import { resolveEnvironmentRuntimeConfig } from './environmentRuntimeConfigService.js';
import {
  EXECUTION_PLAN_CONTRACT_VERSION,
  RUNTIME_SNAPSHOT_CONTRACT_VERSION,
  sha256Hex,
} from '../lib/runContracts.js';

const EXECUTABLE_READINESS = 'READY';
const DSL_VERSION = 'qagent.api-test-dsl.v1';
const MAX_SCHEMA_BYTES = 256 * 1024;

function runError(message, code, status = 409, publicDetails = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (publicDetails) error.publicDetails = publicDetails;
  throw error;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function validateArtifactScope(artifact, { organizationId, projectId }) {
  const specification = artifact?.specification;
  if (
    !artifact
    || artifact.organizationId !== organizationId
    || artifact.projectId !== projectId
    || artifact.specificationVersion !== 'qagent.test-spec.v1'
    || specification?.contractVersion !== 'qagent.test-design.v1'
    || specification?.specificationVersion !== 'qagent.test-spec.v1'
    || specification?.source?.organizationId !== organizationId
    || specification?.source?.projectId !== projectId
    || specification?.source?.endpointId !== artifact.endpointId
  ) {
    runError('Test Design version inválida para criação do Run.', 'RUN_TEST_DESIGN_INVALID', 502);
  }
}

function selectScenarios(specification, requestedScenarioIds) {
  const scenarios = Array.isArray(specification?.scenarios) ? specification.scenarios : [];
  const byId = new Map(scenarios.map((scenario) => [scenario?.scenarioId, scenario]));

  let selected;
  if (Array.isArray(requestedScenarioIds) && requestedScenarioIds.length > 0) {
    selected = requestedScenarioIds.map((scenarioId) => {
      const scenario = byId.get(scenarioId);
      if (!scenario) {
        runError('Cenário solicitado não existe nesta Test Design Version.', 'RUN_SCENARIO_NOT_FOUND', 404, { scenarioId });
      }
      return scenario;
    });
  } else {
    selected = scenarios.filter((scenario) => scenario?.automation?.readiness === EXECUTABLE_READINESS);
  }

  if (!selected.length) {
    runError('Esta Test Design Version não possui cenários READY para execução.', 'RUN_NO_EXECUTABLE_SCENARIOS', 409);
  }

  for (const scenario of selected) {
    const readiness = scenario?.automation?.readiness || 'UNKNOWN';
    if (readiness !== EXECUTABLE_READINESS) {
      runError(
        `O cenário '${scenario?.scenarioId || 'unknown'}' não está elegível para execução.`,
        'RUN_SCENARIO_NOT_EXECUTABLE',
        409,
        {
          scenarioId: scenario?.scenarioId || null,
          readiness,
          blockers: Array.isArray(scenario?.automation?.blockers) ? scenario.automation.blockers.slice(0, 10) : [],
        },
      );
    }
    if (scenario?.spec?.dslVersion !== DSL_VERSION || scenario?.spec?.type !== 'api') {
      runError('O cenário usa um DSL ainda não suportado pelo Runner.', 'RUN_SCENARIO_DSL_UNSUPPORTED', 409, {
        scenarioId: scenario?.scenarioId || null,
        dslVersion: scenario?.spec?.dslVersion || null,
        type: scenario?.spec?.type || null,
      });
    }
  }

  return selected;
}

async function resolveRuntimeReferences(runtimeConfig, selectedScenarios, {
  env,
  organizationId,
  projectId,
  artifact,
  environmentId,
  confirmDiscoveredRuntime = false,
  loadEndpoint = getCatalogEndpointForTestDesign,
  loadEvidence = getCatalogEvidenceForTestDesign,
} = {}) {
  const referencedServiceKeys = uniqueStrings(selectedScenarios.map((scenario) => scenario?.spec?.target?.apiServiceKey));
  const apiServices = {};
  let resolutionSource = 'EXPLICIT_CONFIG';
  let resolutionConfidence = 'CONFIRMED';
  let discoveredCandidate = null;

  for (const serviceKey of referencedServiceKeys) {
    const runtimeService = runtimeConfig?.apiServices?.[serviceKey];
    if (runtimeService?.baseUrl) {
      apiServices[serviceKey] = {
        apiServiceId: runtimeService.apiServiceId,
        name: runtimeService.name,
        serviceKey,
        baseUrl: runtimeService.baseUrl,
      };
      continue;
    }

    if (!isDiscoveredRuntimeServiceKey(serviceKey)) {
      runError(
        `API Service '${serviceKey}' não possui Base URL no Environment selecionado.`,
        'RUN_API_SERVICE_ENVIRONMENT_BINDING_MISSING',
        409,
        { serviceKey },
      );
    }

    if (resolutionSource === 'DISCOVERED_OBSERVATION' && discoveredCandidate?.serviceKey !== serviceKey) {
      runError('Run contém múltiplos runtime targets descobertos, ainda não suportados no bootstrap v1.', 'RUN_DISCOVERED_RUNTIME_MULTIPLE_TARGETS_UNSUPPORTED', 409);
    }

    if (!discoveredCandidate) {
      const [endpointDetail, evidenceResponse] = await Promise.all([
        loadEndpoint({ env, organizationId, projectId, endpointId: artifact.endpointId }),
        loadEvidence({ env, organizationId, projectId, endpointId: artifact.endpointId, limit: 50 }),
      ]);
      const evidence = Array.isArray(evidenceResponse?.data)
        ? evidenceResponse.data
        : Array.isArray(evidenceResponse)
          ? evidenceResponse
          : [];
      discoveredCandidate = deriveDiscoveredRuntimeCandidate(endpointDetail, evidence);
    }

    if (discoveredCandidate.status !== 'DISCOVERED' || discoveredCandidate.serviceKey !== serviceKey || !discoveredCandidate.origin) {
      runError('Runtime descoberto mudou ou não pode mais ser resolvido de forma inequívoca.', 'RUN_DISCOVERED_RUNTIME_STALE', 409, {
        serviceKey,
        observedOrigins: discoveredCandidate.observedOrigins || [],
      });
    }

    if (discoveredCandidate.environmentIds.length > 0 && !discoveredCandidate.environmentIds.includes(environmentId)) {
      runError('Runtime descoberto não foi observado no Environment selecionado.', 'RUN_DISCOVERED_RUNTIME_ENVIRONMENT_MISMATCH', 409, {
        serviceKey,
        environmentId,
        observedEnvironmentIds: discoveredCandidate.environmentIds,
      });
    }

    if (confirmDiscoveredRuntime !== true) {
      runError('Runtime descoberto exige confirmação explícita antes da criação do Run.', 'RUN_DISCOVERED_RUNTIME_CONFIRMATION_REQUIRED', 409, {
        serviceKey,
        baseUrl: discoveredCandidate.origin,
        confidence: discoveredCandidate.confidence,
        environmentId,
      });
    }

    const host = new URL(discoveredCandidate.origin).hostname;
    apiServices[serviceKey] = {
      apiServiceId: null,
      name: `Discovered ${host}`,
      serviceKey,
      baseUrl: discoveredCandidate.origin,
    };
    resolutionSource = 'DISCOVERED_OBSERVATION';
    resolutionConfidence = discoveredCandidate.confidence || 'HIGH';
  }

  const authProfiles = {};
  const publicProfiles = Object.entries(runtimeConfig?.authProfiles || {}).map(([profileKey, profile]) => ({
    profileKey,
    ...profile,
  }));

  for (const scenario of selectedScenarios) {
    const auth = scenario?.spec?.auth || {};
    if (auth.requirement !== 'REQUIRED') continue;
    const authProfileRef = String(auth.authProfileRef || '').trim();
    if (!authProfileRef) {
      runError('Cenário READY requer Auth Profile, mas a referência está ausente.', 'RUN_AUTH_PROFILE_REQUIRED', 409, {
        scenarioId: scenario?.scenarioId || null,
      });
    }
    const profile = publicProfiles.find((item) => item.authProfileId === authProfileRef || item.profileKey === authProfileRef);
    if (!profile || profile.credentialsConfigured !== true) {
      runError('Auth Profile não está configurado para o Environment selecionado.', 'RUN_AUTH_PROFILE_ENVIRONMENT_NOT_CONFIGURED', 409, {
        scenarioId: scenario?.scenarioId || null,
        authProfileRef,
      });
    }
    authProfiles[authProfileRef] = {
      authProfileId: profile.authProfileId,
      profileKey: profile.profileKey,
      name: profile.name,
      type: profile.type,
      config: clone(profile.config || {}),
      credentialsConfigured: true,
    };
  }

  return {
    apiServices,
    authProfiles,
    resolution: {
      source: resolutionSource,
      confidence: resolutionConfidence,
      requiresExecutionConfirmation: false,
    },
  };
}

function schemaVersionForTrack(track) {
  const versions = Array.isArray(track?.versions) ? track.versions : [];
  return versions.find((version) => version?.schemaVersionId === track?.currentSchemaVersionId)
    || versions.find((version) => version?.schemaHash === track?.currentSchemaHash)
    || versions[0]
    || null;
}

function schemaCandidate(track, version, requestedRef, refType) {
  if (!track || !version || !version.schema || typeof version.schema !== 'object') return null;
  const serialized = JSON.stringify(version.schema);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SCHEMA_BYTES) {
    runError('Schema estrutural excede o limite permitido para o Execution Plan.', 'RUN_SCHEMA_SNAPSHOT_TOO_LARGE', 409, {
      schemaRef: requestedRef,
    });
  }
  return {
    schemaRef: requestedRef,
    refType,
    schemaTrackId: track.schemaTrackId || null,
    direction: track.direction || null,
    statusCode: Number.isInteger(track.statusCode) ? track.statusCode : null,
    schemaVersionId: version.schemaVersionId || null,
    schemaHash: version.schemaHash || null,
    contentTypes: uniqueStrings((version.contentTypes || []).map((item) => item?.contentType)),
    schema: clone(version.schema),
  };
}

export function materializeSchemaSnapshotsV1(catalogSchemas, requestedRefs) {
  const refs = uniqueStrings(requestedRefs).sort();
  if (!refs.length) return [];
  const tracks = Array.isArray(catalogSchemas?.tracks) ? catalogSchemas.tracks : [];
  const snapshots = [];

  for (const ref of refs) {
    const candidates = [];
    for (const track of tracks) {
      const versions = Array.isArray(track?.versions) ? track.versions : [];
      const current = schemaVersionForTrack(track);

      if (track?.schemaTrackId === ref && current) {
        const candidate = schemaCandidate(track, current, ref, 'TRACK');
        if (candidate) candidates.push(candidate);
      }
      if (track?.currentSchemaVersionId === ref && current) {
        const candidate = schemaCandidate(track, current, ref, 'VERSION');
        if (candidate) candidates.push(candidate);
      }
      if (track?.currentSchemaHash === ref && current) {
        const candidate = schemaCandidate(track, current, ref, 'HASH');
        if (candidate) candidates.push(candidate);
      }

      for (const version of versions) {
        if (version?.schemaVersionId === ref) {
          const candidate = schemaCandidate(track, version, ref, 'VERSION');
          if (candidate) candidates.push(candidate);
        }
        if (version?.schemaHash === ref) {
          const candidate = schemaCandidate(track, version, ref, 'HASH');
          if (candidate) candidates.push(candidate);
        }
      }
    }

    const deduped = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const key = `${candidate.schemaTrackId}|${candidate.schemaVersionId}|${candidate.schemaHash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(candidate);
    }

    if (!deduped.length) {
      runError('Schema reference não pôde ser materializada de forma exata para o Run.', 'RUN_SCHEMA_REFERENCE_NOT_RESOLVABLE', 409, {
        schemaRef: ref,
      });
    }

    const distinctSchemas = new Set(deduped.map((item) => item.schemaHash || JSON.stringify(item.schema)));
    if (distinctSchemas.size > 1) {
      runError('Schema reference é ambígua no Catalog atual.', 'RUN_SCHEMA_REFERENCE_AMBIGUOUS', 409, {
        schemaRef: ref,
      });
    }

    snapshots.push(deduped[0]);
  }

  return snapshots;
}

function collectSchemaRefs(selectedScenarios) {
  const refs = [];
  for (const scenario of selectedScenarios) {
    for (const assertion of scenario?.spec?.assertions || []) {
      if (assertion?.type === 'SCHEMA' && assertion?.schemaRef) refs.push(assertion.schemaRef);
    }
  }
  return uniqueStrings(refs);
}

export async function materializeExecutionPlanV1({
  env,
  organizationId,
  projectId,
  artifact,
  environmentId,
  requestedScenarioIds = null,
  confirmDiscoveredRuntime = false,
  runId,
  executionPlanId,
  runtimeSnapshotId,
  createdAt,
  resolveRuntime = resolveEnvironmentRuntimeConfig,
  loadSchemas = getCatalogSchemasForTestDesign,
  loadEndpoint = getCatalogEndpointForTestDesign,
  loadEvidence = getCatalogEvidenceForTestDesign,
} = {}) {
  validateArtifactScope(artifact, { organizationId, projectId });
  const selectedScenarios = selectScenarios(artifact.specification, requestedScenarioIds);

  const runtimeConfig = await resolveRuntime(env, organizationId, projectId, environmentId);
  if (runtimeConfig?.environment?.environmentId !== environmentId) {
    runError('Runtime Config retornou um Environment divergente.', 'RUN_RUNTIME_SCOPE_MISMATCH', 502);
  }

  const runtimeRefs = await resolveRuntimeReferences(runtimeConfig, selectedScenarios, {
    env,
    organizationId,
    projectId,
    artifact,
    environmentId,
    confirmDiscoveredRuntime,
    loadEndpoint,
    loadEvidence,
  });
  const schemaRefs = collectSchemaRefs(selectedScenarios);
  let schemaSnapshots = [];
  if (schemaRefs.length) {
    const catalogSchemas = await loadSchemas({
      env,
      organizationId,
      projectId,
      endpointId: artifact.endpointId,
      versionsPerTrack: 50,
    });
    schemaSnapshots = materializeSchemaSnapshotsV1(catalogSchemas, schemaRefs);
  }

  const runtimeSnapshotBase = {
    contractVersion: RUNTIME_SNAPSHOT_CONTRACT_VERSION,
    runtimeSnapshotId,
    runId,
    organizationId,
    projectId,
    environment: clone(runtimeConfig.environment),
    resolution: clone(runtimeRefs.resolution),
    apiServices: runtimeRefs.apiServices,
    // qagent.api-test-dsl.v1 has no variable-reference contract yet.
    // Persist no unreferenced values; only expose safe keys for future planning.
    variables: {},
    availableVariableKeys: Object.keys(runtimeConfig.variables || {}).sort(),
    authProfiles: runtimeRefs.authProfiles,
    createdAt,
  };
  const runtimeSnapshot = {
    ...runtimeSnapshotBase,
    snapshotHash: await sha256Hex(runtimeSnapshotBase),
  };

  const scenarioPlans = selectedScenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    category: scenario.category,
    priority: scenario.priority,
    confidence: scenario.confidence,
    groundingLevel: scenario?.grounding?.level || null,
    readiness: scenario.automation.readiness,
    spec: clone(scenario.spec),
  }));

  const executionPlanBase = {
    contractVersion: EXECUTION_PLAN_CONTRACT_VERSION,
    executionPlanId,
    runId,
    organizationId,
    projectId,
    testDesign: {
      testDesignId: artifact.testDesignId,
      testDesignVersionId: artifact.testDesignVersionId,
      version: artifact.version,
      endpointId: artifact.endpointId,
      contextFingerprint: artifact.contextFingerprint,
      specificationVersion: artifact.specificationVersion,
    },
    environmentId,
    runtimeSnapshotId,
    scenarios: scenarioPlans,
    schemaSnapshots,
    createdAt,
  };
  const executionPlan = {
    ...executionPlanBase,
    planHash: await sha256Hex(executionPlanBase),
  };

  return {
    selectedScenarioIds: scenarioPlans.map((scenario) => scenario.scenarioId),
    runtimeSnapshot,
    executionPlan,
  };
}
