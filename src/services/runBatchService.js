import { MUTATION_METHODS, SAFE_METHODS } from '../lib/mutationContracts.js';
import { RUN_BATCH_CONTRACT_VERSION } from '../lib/runBatchContracts.js';
import { sha256Hex } from '../lib/runContracts.js';
import { getRunnerTestArtifact } from './testRegistryClient.js';
import { createRunV1 } from './runService.js';

function batchError(message, code, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = false;
  if (details) error.publicDetails = details;
  throw error;
}

function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

export function resolveDirectMutationConcurrency(env) {
  return parseBoundedInt(env?.DIRECT_MUTATION_RUN_CONCURRENCY, 3, 1, 5);
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function lane() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

function resolveSelection(artifact, requestedScenarioIds) {
  const scenarios = Array.isArray(artifact?.specification?.scenarios) ? artifact.specification.scenarios : [];
  const requested = Array.isArray(requestedScenarioIds) && requestedScenarioIds.length
    ? requestedScenarioIds
    : scenarios.filter((scenario) => scenario?.automation?.readiness === 'READY').map((scenario) => scenario.scenarioId);
  if (!requested.length) batchError('Nenhum cenário READY selecionado para execução.', 'RUN_BATCH_EMPTY_SELECTION', 409);

  const byId = new Map(scenarios.map((scenario) => [scenario?.scenarioId, scenario]));
  const selected = requested.map((scenarioId) => {
    const scenario = byId.get(scenarioId);
    if (!scenario) batchError('Run Batch contém cenário inexistente no Test Design.', 'RUN_BATCH_SCENARIO_NOT_FOUND', 409, { scenarioId });
    return scenario;
  });
  const methods = [...new Set(selected.map((scenario) => String(scenario?.spec?.target?.method || '').toUpperCase()))];
  if (methods.length !== 1 || !methods[0]) {
    batchError('Run Batch exige cenários do mesmo método HTTP.', 'RUN_BATCH_METHOD_INCONSISTENT', 409, { methods });
  }
  return { scenarioIds: requested, method: methods[0] };
}

async function childIdempotencyKey(batchKey, scenarioKey) {
  const digest = await sha256Hex(`${batchKey}|${scenarioKey}`);
  return `runbatch:${digest.slice(0, 56)}`;
}

export async function createRunBatchV1({
  env,
  organizationId,
  projectId,
  userId = null,
  input,
  idempotencyKey,
  deps = {},
} = {}) {
  const loadArtifact = deps.getRunnerTestArtifact || getRunnerTestArtifact;
  const createRun = deps.createRun || createRunV1;
  const artifact = await loadArtifact({ env, organizationId, projectId, testDesignVersionId: input.testDesignVersionId });
  const selection = resolveSelection(artifact, input.scenarioIds);
  const commonInput = {
    contractVersion: 'qagent.run-create.v1',
    testDesignVersionId: input.testDesignVersionId,
    environmentId: input.environmentId,
    confirmDiscoveredRuntime: input.confirmDiscoveredRuntime === true,
  };

  let executionKind;
  let runInputs;
  if (MUTATION_METHODS.includes(selection.method)) {
    executionKind = 'MUTATION_FANOUT';
    runInputs = selection.scenarioIds.map((scenarioId) => ({ ...commonInput, scenarioIds: [scenarioId] }));
  } else if (SAFE_METHODS.includes(selection.method)) {
    executionKind = 'READ_ONLY_BATCH';
    runInputs = [{ ...commonInput, scenarioIds: selection.scenarioIds }];
  } else {
    batchError('Método HTTP não suportado para Run Batch.', 'RUN_BATCH_METHOD_UNSUPPORTED', 409, { method: selection.method });
  }

  const concurrency = executionKind === 'MUTATION_FANOUT' ? resolveDirectMutationConcurrency(env) : 1;
  const runs = await mapLimit(runInputs, concurrency, async (childInput, index) => createRun({
    env,
    organizationId,
    projectId,
    userId,
    input: childInput,
    idempotencyKey: await childIdempotencyKey(idempotencyKey, childInput.scenarioIds[0] || `batch-${index}`),
  }));

  return {
    contractVersion: RUN_BATCH_CONTRACT_VERSION,
    executionKind,
    method: selection.method,
    requestedScenarioCount: selection.scenarioIds.length,
    runCount: runs.length,
    concurrency,
    runs,
    idempotentReplay: runs.length > 0 && runs.every((run) => run?.idempotentReplay === true),
  };
}
