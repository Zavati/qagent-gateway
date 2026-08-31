import { aiEngine as defaultAiEngine } from '../ai/aiEngine.js';
import { getEnvNum, getTestDesignModel } from '../lib/config.js';
import { resolveAiRuntimeConfig } from '../services/aiRuntimeConfigService.js';
import { buildCatalogTestDesignContextV1 } from './catalogContextBuilder.js';
import {
  buildTestSpecificationV1,
  normalizeTestDesignModelOutputV1,
  TestDesignContractError,
  validateTestDesignModelOutputV1,
  validateTestSpecificationV1,
} from './testDesignContract.js';
import {
  buildTestDesignPromptV1,
  buildTestDesignRepairPromptV1,
  TEST_DESIGN_PROMPT_VERSION,
  TEST_DESIGN_REPAIR_PROMPT_VERSION,
} from './testDesignPrompt.js';
import { applySemanticGroundingGuardV1 } from './semanticGroundingGuard.js';
import { applyObservedAuthSignalBridgeV1 } from './observedAuthSignalBridge.js';
import { applySecretSafeTestDesignSanitizerV1 } from './secretSafeTestDesignSanitizer.js';
import { applyTestDataPlannerV1 } from './testDataPlanner.js';

export const AI_TEST_DESIGN_ENGINE_VERSION = 'qagent.ai-test-design-engine.v1';

function logger(env) {
  if (typeof env?.log === 'function') return env.log;
  return (...args) => { try { console.log(...args); } catch {} };
}


function isAiAbortTimeout(error) {
  if (!error?.upstreamFailed || Number(error?.upstreamStatus || 0) !== 0) return false;
  const name = String(error?.transportError?.name || '').toLowerCase();
  const message = String(error?.transportError?.message || error?.upstreamMessage || error?.message || '').toLowerCase();
  return name === 'aborterror' || message.includes('aborted') || message.includes('aborterror');
}

function wrapAiTimeout(error, { stage, timeoutMs } = {}) {
  const wrapped = new Error('O provider de IA excedeu o tempo limite durante a geração do Test Design.');
  wrapped.status = 504;
  wrapped.code = 'AI_UPSTREAM_TIMEOUT';
  wrapped.details = {
    provider: error?.provider || null,
    stage: stage || 'unknown',
    timeoutMs: Number(timeoutMs || 0) || null,
    retryable: true,
  };
  wrapped.publicDetails = wrapped.details;
  return wrapped;
}


function wrapInvalidModelOutput(error, { repairAttempts = 0 } = {}) {
  const wrapped = new Error('A IA retornou um Test Design incompatível com o contrato qagent.test-design.v1.');
  wrapped.status = 502;
  wrapped.code = 'AI_TEST_DESIGN_OUTPUT_INVALID';
  wrapped.details = {
    repairAttempts,
    validationCode: error?.code || 'TEST_DESIGN_CONTRACT_INVALID',
    validationPath: error?.path || null,
  };
  if (Array.isArray(error?.details?.allowed)) wrapped.details.expectedValues = error.details.allowed.slice(0, 20);
  if (typeof error?.details?.receivedType === 'string') wrapped.details.receivedType = error.details.receivedType;
  if (['string', 'number', 'boolean'].includes(typeof error?.details?.receivedValue)) wrapped.details.receivedValue = error.details.receivedValue;
  wrapped.publicDetails = wrapped.details;
  return wrapped;
}

function contractRepairInstruction(error) {
  const code = error?.code || 'TEST_DESIGN_CONTRACT_INVALID';
  const path = error?.path || 'unknown';
  const rule = String(error?.message || 'Contrato inválido.').slice(0, 500);
  const secretRule = code === 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN'
    ? `\nEste é um erro de material sensível. Remova COMPLETAMENTE o campo/entry sensível indicado. NÃO substitua por valor fictício, placeholder, null, string vazia ou outro secret. Se o cenário depender desse dado para executar, use automationHints.needsData=true e adicione uma razão de que o valor deve ser resolvido por mecanismo seguro de runtime/test data. Não crie assertions/extracts sobre secrets.`
    : '';
  return `A resposta anterior viola o TestDesignModelOutputV1 (${code} em ${path}).
Regra violada: ${rule}${secretRule}
Reescreva o objeto COMPLETO, respeitando estritamente OUTPUT_JSON_SCHEMA, os formatos exatos de assertion e CATALOG_CONTEXT_JSON.
Para confidence use EXATAMENTE uma destas strings: HIGH, MEDIUM, LOW. Nunca use número, percentual, score ou VERY_HIGH/VERY_LOW.
Não adicione campos extras. Não invente refs. Use somente IDs existentes no contexto. Retorne somente JSON válido.`;
}

function modelOutputFrom(out) {
  return out?.json && typeof out.json === 'object' ? out.json : null;
}

function normalizeModelOutput(output, log, stage = 'generate') {
  const normalized = normalizeTestDesignModelOutputV1(output);
  if (normalized.changes.length) {
    log('testDesign_ai_output_normalized', {
      stage,
      normalizationCount: normalized.changes.length,
      normalizationPaths: normalized.changes.slice(0, 20),
    });
  }
  return normalized;
}

function emptySecretSafeDiagnostics() {
  return {
    sanitizerVersion: 'qagent.secret-safe-test-design-sanitizer.v1',
    sanitizedScenarioCount: 0,
    removedMaterialCount: 0,
    requestSecretRemovalCount: 0,
    authHeaderRemovalCount: 0,
    assertionRemovalCount: 0,
    extractRemovalCount: 0,
    needsDataScenarioCount: 0,
    reviewRequiredScenarioCount: 0,
    byKind: {},
    sanitizedPaths: [],
    sanitizedScenarioIds: [],
    needsDataScenarioIds: [],
    reviewRequiredScenarioIds: [],
  };
}

function mergeSecretSafeDiagnostics(target, current) {
  for (const key of ['removedMaterialCount', 'requestSecretRemovalCount', 'authHeaderRemovalCount', 'assertionRemovalCount', 'extractRemovalCount']) {
    target[key] += Number(current?.[key] || 0);
  }
  for (const [kind, count] of Object.entries(current?.byKind || {})) target.byKind[kind] = (target.byKind[kind] || 0) + count;
  for (const key of ['sanitizedPaths', 'sanitizedScenarioIds', 'needsDataScenarioIds', 'reviewRequiredScenarioIds']) {
    target[key] = [...new Set([...(target[key] || []), ...(current?.[key] || [])])].slice(0, key === 'sanitizedPaths' ? 40 : 20);
  }
  target.sanitizedScenarioCount = target.sanitizedScenarioIds.length;
  target.needsDataScenarioCount = target.needsDataScenarioIds.length;
  target.reviewRequiredScenarioCount = target.reviewRequiredScenarioIds.length;
  return target;
}

export async function generateCatalogTestDesignV1({
  env,
  organizationId,
  projectId,
  endpointId,
  accountId = null,
  aiEngine = defaultAiEngine,
  contextBuilder = buildCatalogTestDesignContextV1,
  resolveAiConfig = resolveAiRuntimeConfig,
  now = () => new Date(),
} = {}) {
  const startedAtMs = Date.now();
  const log = logger(env);
  const contextResult = await contextBuilder({ env, organizationId, projectId, endpointId });
  const { context, contextFingerprint, diagnostics: contextDiagnostics, observedTestData = null } = contextResult;

  const fallbackModel = getTestDesignModel(env);
  const aiConfig = await resolveAiConfig(env, {
    accountId,
    capability: 'test-design',
    fallbackModel,
  });

  const scenarioCount = Math.max(4, Math.min(12, getEnvNum(env, 'TEST_DESIGN_SCENARIO_COUNT', 8)));
  const prompt = buildTestDesignPromptV1(context, { scenarioCount });
  const maxOutputTokens = Math.max(1800, Math.min(8000, getEnvNum(env, 'TEST_DESIGN_MAX_OUTPUT_TOKENS', 5500)));
  const timeoutMs = Math.max(15_000, Math.min(120_000, getEnvNum(env, 'TEST_DESIGN_TIMEOUT_MS', 90_000)));
  const repairTimeoutMs = Math.max(20_000, Math.min(90_000, getEnvNum(env, 'TEST_DESIGN_REPAIR_TIMEOUT_MS', 60_000)));
  const repairPrompt = buildTestDesignRepairPromptV1(context, { scenarioCount });

  let out;
  let modelOutput;
  let repairAttempts = 0;
  let firstValidationError = null;
  const secretSafeSanitizer = emptySecretSafeDiagnostics();

  log('testDesign_ai_start', {
    engineVersion: AI_TEST_DESIGN_ENGINE_VERSION,
    promptVersion: TEST_DESIGN_PROMPT_VERSION,
    provider: aiConfig.provider,
    model: aiConfig.model,
    endpointId: context.endpoint.endpointId,
    contextFingerprint,
    scenarioCount,
  });

  try {
    out = await aiEngine.generateJson({
      capability: 'test-design',
      provider: aiConfig.provider,
      credentials: aiConfig.credentials,
      model: aiConfig.model,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      retries: 2,
      timeoutMs,
      maxOutputTokens,
      temperature: 0,
    }, env);
    modelOutput = modelOutputFrom(out);
  } catch (generationError) {
    const rawText = String(generationError?.contentText || generationError?.rawText || '');
    if (generationError?.upstreamFailed) {
      if (isAiAbortTimeout(generationError)) {
        log('testDesign_ai_timeout', {
          stage: 'generate',
          provider: aiConfig.provider,
          model: aiConfig.model,
          endpointId: context.endpoint.endpointId,
          contextFingerprint,
          timeoutMs,
        });
        throw wrapAiTimeout(generationError, { stage: 'generate', timeoutMs });
      }
      throw generationError;
    }
    if (!rawText) throw generationError;

    repairAttempts += 1;
    log('testDesign_ai_format_repair', {
      errorCode: generationError?.code || null,
      upstreamStatus: generationError?.upstreamStatus || null,
      provider: aiConfig.provider,
      model: aiConfig.model,
    });

    try {
      modelOutput = await aiEngine.repairJson({
        capability: 'test-design',
        provider: aiConfig.provider,
        credentials: aiConfig.credentials,
        model: aiConfig.model,
        systemPrompt: repairPrompt.systemPrompt,
        originalPrompt: repairPrompt.userPrompt,
        rawText,
        repairInstruction: 'A resposta anterior não pôde ser interpretada como JSON. Gere novamente o objeto COMPLETO TestDesignModelOutputV1, respeitando estritamente OUTPUT_JSON_SCHEMA e as refs permitidas. Retorne somente JSON válido.',
        retries: 0,
        timeoutMs: repairTimeoutMs,
        maxOutputTokens,
        temperature: 0,
      }, env);
    } catch (repairError) {
      if (isAiAbortTimeout(repairError)) {
        log('testDesign_ai_timeout', {
          stage: 'format-repair',
          provider: aiConfig.provider,
          model: aiConfig.model,
          endpointId: context.endpoint.endpointId,
          contextFingerprint,
          timeoutMs: repairTimeoutMs,
        });
        throw wrapAiTimeout(repairError, { stage: 'format-repair', timeoutMs: repairTimeoutMs });
      }
      throw repairError;
    }

    out = { provider: aiConfig.provider, model: aiConfig.model, json: modelOutput };
  }

  let normalizationPaths = [];
  {
    const normalized = normalizeModelOutput(modelOutput, log, 'generate');
    modelOutput = normalized.output;
    normalizationPaths = normalized.changes;
  }
  {
    const sanitized = applySecretSafeTestDesignSanitizerV1(modelOutput);
    modelOutput = sanitized.output;
    mergeSecretSafeDiagnostics(secretSafeSanitizer, sanitized.diagnostics);
    if (sanitized.diagnostics.removedMaterialCount > 0) {
      log('testDesign_secret_safe_sanitizer_applied', {
        stage: 'generate',
        sanitizerVersion: sanitized.diagnostics.sanitizerVersion,
        endpointId: context.endpoint.endpointId,
        sanitizedScenarioCount: sanitized.diagnostics.sanitizedScenarioCount,
        removedMaterialCount: sanitized.diagnostics.removedMaterialCount,
        byKind: sanitized.diagnostics.byKind,
      });
    }
  }

  try {
    validateTestDesignModelOutputV1(modelOutput, context);
  } catch (error) {
    if (!(error instanceof TestDesignContractError)) throw error;
    firstValidationError = error;
    if (repairAttempts >= 1) {
      throw wrapInvalidModelOutput(error, { repairAttempts });
    }
    repairAttempts += 1;

    log('testDesign_ai_contract_repair', {
      validationCode: error.code,
      validationPath: error.path || null,
      provider: out?.provider || aiConfig.provider,
      model: out?.model || aiConfig.model,
    });

    let repaired;
    try {
      repaired = await aiEngine.repairJson({
        capability: 'test-design',
        provider: aiConfig.provider,
        credentials: aiConfig.credentials,
        model: aiConfig.model,
        systemPrompt: repairPrompt.systemPrompt,
        originalPrompt: repairPrompt.userPrompt,
        rawText: JSON.stringify(modelOutput),
        repairInstruction: contractRepairInstruction(error),
        retries: 0,
        timeoutMs: repairTimeoutMs,
        maxOutputTokens,
        temperature: 0,
      }, env);
    } catch (repairError) {
      if (isAiAbortTimeout(repairError)) {
        log('testDesign_ai_timeout', {
          stage: 'contract-repair',
          provider: out?.provider || aiConfig.provider,
          model: out?.model || aiConfig.model,
          endpointId: context.endpoint.endpointId,
          contextFingerprint,
          timeoutMs: repairTimeoutMs,
        });
        throw wrapAiTimeout(repairError, { stage: 'contract-repair', timeoutMs: repairTimeoutMs });
      }
      throw repairError;
    }

    modelOutput = repaired;
    {
      const normalized = normalizeModelOutput(modelOutput, log, 'repair');
      modelOutput = normalized.output;
      normalizationPaths = [...new Set([...normalizationPaths, ...normalized.changes])];
    }
    {
      const sanitized = applySecretSafeTestDesignSanitizerV1(modelOutput);
      modelOutput = sanitized.output;
      mergeSecretSafeDiagnostics(secretSafeSanitizer, sanitized.diagnostics);
      if (sanitized.diagnostics.removedMaterialCount > 0) {
        log('testDesign_secret_safe_sanitizer_applied', {
          stage: 'repair',
          sanitizerVersion: sanitized.diagnostics.sanitizerVersion,
          endpointId: context.endpoint.endpointId,
          sanitizedScenarioCount: sanitized.diagnostics.sanitizedScenarioCount,
          removedMaterialCount: sanitized.diagnostics.removedMaterialCount,
          byKind: sanitized.diagnostics.byKind,
        });
      }
    }
    try {
      validateTestDesignModelOutputV1(modelOutput, context);
    } catch (repairError) {
      if (repairError instanceof TestDesignContractError) {
        log('testDesign_ai_contract_failed', {
          validationCode: repairError.code,
          validationPath: repairError.path || null,
          repairAttempts,
          provider: out?.provider || aiConfig.provider,
          model: out?.model || aiConfig.model,
          endpointId: context.endpoint.endpointId,
          contextFingerprint,
        });
        throw wrapInvalidModelOutput(repairError, { repairAttempts });
      }
      throw repairError;
    }
  }

  const semanticGuard = applySemanticGroundingGuardV1(modelOutput, context);
  modelOutput = semanticGuard.output;
  validateTestDesignModelOutputV1(modelOutput, context);
  if (semanticGuard.diagnostics.issueCount > 0) {
    log('testDesign_semantic_guard_applied', {
      guardVersion: semanticGuard.diagnostics.guardVersion,
      endpointId: context.endpoint.endpointId,
      contextFingerprint,
      changedScenarioCount: semanticGuard.diagnostics.changedScenarioCount,
      issueCount: semanticGuard.diagnostics.issueCount,
      issuesByCode: semanticGuard.diagnostics.issuesByCode,
    });
  }

  const observedAuthBridge = applyObservedAuthSignalBridgeV1(modelOutput, context);
  modelOutput = observedAuthBridge.output;
  validateTestDesignModelOutputV1(modelOutput, context);
  if (observedAuthBridge.diagnostics.changedScenarioCount > 0 || observedAuthBridge.diagnostics.observationStatus !== 'UNKNOWN') {
    log('testDesign_observed_auth_bridge_applied', {
      bridgeVersion: observedAuthBridge.diagnostics.bridgeVersion,
      endpointId: context.endpoint.endpointId,
      contextFingerprint,
      observationStatus: observedAuthBridge.diagnostics.observationStatus,
      observedScheme: observedAuthBridge.diagnostics.observedScheme,
      compatibleProfileCount: observedAuthBridge.diagnostics.compatibleProfileCount,
      defaultProfileSelected: observedAuthBridge.diagnostics.defaultProfileSelected,
      changedScenarioCount: observedAuthBridge.diagnostics.changedScenarioCount,
    });
  }

  const testDataPlanner = applyTestDataPlannerV1(modelOutput, context, {
    secretSafeDiagnostics: secretSafeSanitizer,
    semanticDiagnostics: semanticGuard.diagnostics,
    observedTestData,
    observedRuntimeEnabled: false,
  });
  modelOutput = testDataPlanner.output;
  validateTestDesignModelOutputV1(modelOutput, context);
  if (testDataPlanner.diagnostics.bindingCount > 0 || testDataPlanner.diagnostics.unresolvedCount > 0) {
    log('testDesign_test_data_planner_applied', {
      plannerVersion: testDataPlanner.diagnostics.plannerVersion,
      endpointId: context.endpoint.endpointId,
      contextFingerprint,
      plannedScenarioCount: testDataPlanner.diagnostics.plannedScenarioCount,
      generatedCount: testDataPlanner.diagnostics.generatedCount,
      fixedCount: testDataPlanner.diagnostics.fixedCount,
      secretCount: testDataPlanner.diagnostics.secretCount,
      observedCount: testDataPlanner.diagnostics.observedCount,
      observedRuntimePendingCount: testDataPlanner.diagnostics.observedRuntimePendingCount,
      unresolvedCount: testDataPlanner.diagnostics.unresolvedCount,
      byGeneratorKind: testDataPlanner.diagnostics.byGeneratorKind,
    });
  }

  const generatedAt = now().toISOString();
  const provider = String(out?.provider || aiConfig.provider || '').trim();
  const model = String(out?.model || aiConfig.model || '').trim();
  const specification = buildTestSpecificationV1({
    context,
    modelOutput,
    generation: { provider, model, generatedAt, contextFingerprint },
    testDataPlans: testDataPlanner.plansByScenarioId,
  });
  validateTestSpecificationV1(specification, context);

  const durationMs = Math.max(0, Date.now() - startedAtMs);
  log('testDesign_ai_success', {
    engineVersion: AI_TEST_DESIGN_ENGINE_VERSION,
    provider,
    model,
    endpointId: context.endpoint.endpointId,
    contextFingerprint,
    scenarioCount: specification.summary.scenarioCount,
    readyCount: specification.summary.readyCount,
    repairAttempts,
    durationMs,
    firstValidationCode: firstValidationError?.code || null,
  });

  return {
    specification,
    contextFingerprint,
    diagnostics: {
      engineVersion: AI_TEST_DESIGN_ENGINE_VERSION,
      promptVersion: TEST_DESIGN_PROMPT_VERSION,
      repairPromptVersion: TEST_DESIGN_REPAIR_PROMPT_VERSION,
      provider,
      model,
      aiConfigSource: aiConfig.source,
      scenarioCountRequested: scenarioCount,
      scenarioCountGenerated: specification.summary.scenarioCount,
      repairAttempts,
      normalizationCount: normalizationPaths.length,
      normalizationPaths: normalizationPaths.slice(0, 20),
      secretSafeSanitizer,
      testDataPlanner: testDataPlanner.diagnostics,
      semanticGuard: semanticGuard.diagnostics,
      observedAuthBridge: observedAuthBridge.diagnostics,
      timeoutMs,
      repairTimeoutMs,
      durationMs,
      context: contextDiagnostics,
    },
  };
}
