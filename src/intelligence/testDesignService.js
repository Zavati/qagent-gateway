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
import { buildTestDesignPromptV1, TEST_DESIGN_PROMPT_VERSION } from './testDesignPrompt.js';

export const AI_TEST_DESIGN_ENGINE_VERSION = 'qagent.ai-test-design-engine.v1';

function logger(env) {
  if (typeof env?.log === 'function') return env.log;
  return (...args) => { try { console.log(...args); } catch {} };
}

function rawTextFromAi(out) {
  if (out?.contentText) return String(out.contentText);
  if (out?.rawText) return String(out.rawText);
  if (out?.json) return JSON.stringify(out.json);
  return '';
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
  return `A resposta anterior viola o TestDesignModelOutputV1 (${code} em ${path}).
Regra violada: ${rule}
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
  const { context, contextFingerprint, diagnostics: contextDiagnostics } = contextResult;

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

  let out;
  let modelOutput;
  let repairAttempts = 0;
  let firstValidationError = null;

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
    if (generationError?.upstreamFailed || !rawText) throw generationError;

    repairAttempts += 1;
    log('testDesign_ai_format_repair', {
      errorCode: generationError?.code || null,
      upstreamStatus: generationError?.upstreamStatus || null,
      provider: aiConfig.provider,
      model: aiConfig.model,
    });

    modelOutput = await aiEngine.repairJson({
      capability: 'test-design',
      provider: aiConfig.provider,
      credentials: aiConfig.credentials,
      model: aiConfig.model,
      systemPrompt: prompt.systemPrompt,
      originalPrompt: prompt.userPrompt,
      rawText,
      repairInstruction: 'A resposta anterior não pôde ser interpretada como JSON. Gere novamente o objeto COMPLETO TestDesignModelOutputV1, respeitando estritamente OUTPUT_JSON_SCHEMA e as refs permitidas. Retorne somente JSON válido.',
      retries: 0,
      timeoutMs: Math.min(timeoutMs, 30_000),
      maxOutputTokens,
      temperature: 0,
    }, env);

    out = { provider: aiConfig.provider, model: aiConfig.model, json: modelOutput };
  }

  let normalizationPaths = [];
  {
    const normalized = normalizeModelOutput(modelOutput, log, 'generate');
    modelOutput = normalized.output;
    normalizationPaths = normalized.changes;
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

    const repaired = await aiEngine.repairJson({
      capability: 'test-design',
      provider: aiConfig.provider,
      credentials: aiConfig.credentials,
      model: aiConfig.model,
      systemPrompt: prompt.systemPrompt,
      originalPrompt: prompt.userPrompt,
      rawText: rawTextFromAi(out),
      repairInstruction: contractRepairInstruction(error),
      retries: 0,
      timeoutMs: Math.min(timeoutMs, 30_000),
      maxOutputTokens,
      temperature: 0,
    }, env);

    modelOutput = repaired;
    {
      const normalized = normalizeModelOutput(modelOutput, log, 'repair');
      modelOutput = normalized.output;
      normalizationPaths = [...new Set([...normalizationPaths, ...normalized.changes])];
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

  const generatedAt = now().toISOString();
  const provider = String(out?.provider || aiConfig.provider || '').trim();
  const model = String(out?.model || aiConfig.model || '').trim();
  const specification = buildTestSpecificationV1({
    context,
    modelOutput,
    generation: { provider, model, generatedAt, contextFingerprint },
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
      provider,
      model,
      aiConfigSource: aiConfig.source,
      scenarioCountRequested: scenarioCount,
      scenarioCountGenerated: specification.summary.scenarioCount,
      repairAttempts,
      normalizationCount: normalizationPaths.length,
      normalizationPaths: normalizationPaths.slice(0, 20),
      durationMs,
      context: contextDiagnostics,
    },
  };
}
