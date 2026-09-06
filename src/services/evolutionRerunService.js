import { getRunBundle } from '../repositories/runRepository.js';
import { createRunV1 } from './runService.js';

function rerunError(message, code, status = 409, publicDetails = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (publicDetails) error.publicDetails = publicDetails;
  throw error;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function sourceSnapshot(bundle) {
  return bundle?.runtimeSnapshot?.snapshot || null;
}

/**
 * Builds an internal-only reuse token from a Run that already reached the
 * Runner with a confirmed runtime and completed HTTP execution.
 *
 * Important: this token contains only runtime target metadata. It deliberately
 * does NOT carry cookies, resolved auth material, generated Test Data, or
 * secret values. The new Run rematerializes those normally.
 */
export function buildEvolutionConfirmedRuntimeReuse(sourceBundle, {
  organizationId,
  projectId,
  environmentId,
  scenarioId,
} = {}) {
  const run = sourceBundle?.run;
  const snapshotRow = sourceBundle?.runtimeSnapshot;
  const snapshot = sourceSnapshot(sourceBundle);
  const attempt = sourceBundle?.latestAttempt;

  if (!run || !snapshotRow || !snapshot) {
    rerunError(
      'Source Run não possui Runtime Snapshot reutilizável.',
      'EVOLUTION_RERUN_SOURCE_RUNTIME_UNAVAILABLE',
      409,
    );
  }
  if (run.organizationId !== organizationId || run.projectId !== projectId) {
    rerunError(
      'Source Run pertence a outro tenant.',
      'EVOLUTION_RERUN_SOURCE_SCOPE_MISMATCH',
      403,
    );
  }
  if (run.environmentId !== environmentId || snapshot?.environment?.environmentId !== environmentId) {
    rerunError(
      'Source Run usa Environment diferente do rerun.',
      'EVOLUTION_RERUN_SOURCE_ENVIRONMENT_MISMATCH',
      409,
      { sourceEnvironmentId: run.environmentId || null, environmentId },
    );
  }
  if (!Array.isArray(run.scenarioIds) || !run.scenarioIds.includes(scenarioId)) {
    rerunError(
      'Source Run não executou o cenário solicitado para evolução.',
      'EVOLUTION_RERUN_SOURCE_SCENARIO_MISMATCH',
      409,
      { scenarioId },
    );
  }
  if (snapshot?.resolution?.requiresExecutionConfirmation === true || snapshotRow.requiresExecutionConfirmation === true) {
    rerunError(
      'Source Run ainda exige confirmação de runtime.',
      'EVOLUTION_RERUN_SOURCE_RUNTIME_NOT_CONFIRMED',
      409,
    );
  }
  if (attempt?.runtimeReadinessStatus !== 'READY' || attempt?.httpExecutionStatus !== 'COMPLETED') {
    rerunError(
      'Source Run não possui execução HTTP confirmada para reutilização de runtime.',
      'EVOLUTION_RERUN_SOURCE_NOT_EXECUTED',
      409,
      {
        runtimeReadinessStatus: attempt?.runtimeReadinessStatus || null,
        httpExecutionStatus: attempt?.httpExecutionStatus || null,
      },
    );
  }
  if (Number(attempt?.httpResponseCount || 0) < 1) {
    rerunError(
      'Source Run não produziu resposta HTTP reutilizável como confirmação de target.',
      'EVOLUTION_RERUN_SOURCE_HTTP_RESPONSE_REQUIRED',
      409,
    );
  }

  // Explicit runtime config should be resolved fresh from the Environment.
  // Snapshot reuse is only required to bypass a new confirmation prompt for
  // an already-confirmed DISCOVERED_OBSERVATION target.
  if (snapshot?.resolution?.source !== 'DISCOVERED_OBSERVATION') {
    return null;
  }

  const apiServices = snapshot?.apiServices || {};
  const reusableEntries = Object.entries(apiServices).filter(([, service]) => {
    try {
      const url = new URL(String(service?.baseUrl || ''));
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  });
  if (!reusableEntries.length) {
    rerunError(
      'Source Runtime Snapshot não possui target descoberto reutilizável.',
      'EVOLUTION_RERUN_SOURCE_TARGET_UNAVAILABLE',
      409,
    );
  }

  return {
    contractVersion: 'qagent.evolution-runtime-reuse.v1',
    kind: 'EVOLUTION_CONFIRMED_RUNTIME_REUSE',
    sourceRunId: run.runId,
    sourceRuntimeSnapshotId: snapshotRow.runtimeSnapshotId,
    sourceEndpointId: run.endpointId,
    organizationId,
    projectId,
    environmentId,
    resolutionSource: 'DISCOVERED_OBSERVATION',
    resolutionConfidence: snapshot?.resolution?.confidence || snapshotRow.resolutionConfidence || 'HIGH',
    apiServices: Object.fromEntries(reusableEntries.map(([key, service]) => [key, {
      apiServiceId: service?.apiServiceId || null,
      name: service?.name || `Reused ${key}`,
      serviceKey: service?.serviceKey || key,
      baseUrl: String(service.baseUrl),
    }])),
  };
}

export async function createEvolutionRerunV1({
  env,
  organizationId,
  projectId,
  userId = null,
  sourceRunId,
  testDesignVersionId,
  environmentId,
  scenarioId,
  idempotencyKey,
  deps = {},
} = {}) {
  if (!sourceRunId) {
    rerunError('sourceRunId é obrigatório para rerun de evolução.', 'EVOLUTION_RERUN_SOURCE_RUN_REQUIRED', 409);
  }
  const loadBundle = deps.getRunBundle || getRunBundle;
  const createRun = deps.createRun || createRunV1;
  const sourceBundle = await loadBundle(env, organizationId, projectId, sourceRunId);
  if (!sourceBundle?.run) {
    rerunError('Source Run não encontrado.', 'EVOLUTION_RERUN_SOURCE_RUN_NOT_FOUND', 404, { sourceRunId });
  }

  const runtimeReuse = buildEvolutionConfirmedRuntimeReuse(sourceBundle, {
    organizationId,
    projectId,
    environmentId,
    scenarioId,
  });

  const created = await createRun({
    env,
    organizationId,
    projectId,
    userId,
    input: {
      contractVersion: 'qagent.run-create.v1',
      testDesignVersionId,
      environmentId,
      scenarioIds: [scenarioId],
      // User confirmation is intentionally not forged. The internal reuse
      // token is what authorizes the previously confirmed discovered target.
      confirmDiscoveredRuntime: false,
    },
    idempotencyKey,
    runtimeReuse,
  });

  return {
    ...created,
    evolutionRuntimeReuse: {
      contractVersion: 'qagent.evolution-runtime-reuse-result.v1',
      sourceRunId,
      sourceRuntimeSnapshotId: runtimeReuse?.sourceRuntimeSnapshotId || null,
      reusedDiscoveredRuntime: Boolean(runtimeReuse),
      strategy: runtimeReuse ? 'CONFIRMED_SOURCE_RUNTIME_TARGET' : 'FRESH_EXPLICIT_ENVIRONMENT_CONFIG',
    },
  };
}
