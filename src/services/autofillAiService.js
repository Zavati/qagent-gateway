import { buildAutofillPrompt, normalizeAutofillResponse } from '../lib/autofill.js';
import { normalizeIncomingElement, prefillHeuristics, applyCpfCnpjReplacement } from '../lib/heuristics.js';
import { getAutofillModel } from '../lib/config.js';
import { resolveAiRuntimeConfig } from './aiRuntimeConfigService.js';

function defaultLog() {}

export async function generateAutofillActions(body, env, { aiEngine, log = defaultLog, accountId = null, resolveAiConfig = resolveAiRuntimeConfig } = {}) {
  if (!aiEngine || typeof aiEngine.generateJson !== 'function') {
    throw new Error('aiEngine is required.');
  }

  const normalizedElements = (body.elements || []).map(normalizeIncomingElement).filter(Boolean);
  const fallbackModel = getAutofillModel(body, env);
  const { actions: prefilled, remaining } = prefillHeuristics(
    body.elements || [],
    Number(env.AUTOFILL_HEUR_MAX_ELEMENTS || 200)
  );

  if (!remaining || remaining.length === 0) {
    return {
      actions: applyCpfCnpjReplacement(prefilled, normalizedElements),
      meta: { mode: 'heuristic', model: fallbackModel },
    };
  }

  const aiConfig = await resolveAiConfig(env, {
    accountId,
    capability: 'autofill',
    fallbackModel,
  });
  const model = aiConfig.model;

  const promptBody = { url: body.url, elements: remaining };
  const prompt = buildAutofillPrompt(promptBody, Number(env.AUTOFILL_MAX_ELEMS || 50));
  const systemPrompt = 'Você é um assistente que gera valores para preenchimento de formulários.';
  let parsed = null;
  let repairAttempts = 0;
  let rawText = '';

  try {
    const out = await aiEngine.generateJson({
      capability: 'autofill',
      provider: aiConfig.provider,
      credentials: aiConfig.credentials,
      model,
      systemPrompt,
      userPrompt: prompt,
      temperature: Number(env.AUTOFILL_TEMPERATURE || 0.0),
      maxOutputTokens: Number(env.AUTOFILL_MAX_TOKENS || 600),
      timeoutMs: Number(env.AI_TIMEOUT_MS || env.OPENAI_TIMEOUT_MS || 30000),
      retries: 2,
    }, env);

    parsed = out?.json || null;
    rawText = out?.contentText || out?.rawText || '';
  } catch (e) {
    rawText = e?.contentText || e?.rawText || '';
    log('autofill_ai_error', {
      provider: aiConfig.provider,
      model,
      errorName: e?.name,
      errorCode: e?.code || null,
      errorMessage: e?.message,
      upstreamStatus: e?.upstreamStatus || null,
      upstreamCode: e?.upstreamCode || null,
      retryable: Boolean(e?.retryable),
      retryAfterMs: e?.retryAfterMs || null,
      hasRawText: Boolean(rawText),
    });

    // Falhas HTTP/rede continuam sendo erro de upstream; não mascarar com heurística.
    if (e?.upstreamFailed || !rawText) {
      const upstreamStatus = e?.upstreamStatus || 0;
      const detail = upstreamStatus ? `HTTP ${upstreamStatus}` : (e?.message || 'unknown');
      const err = new Error(`Falha ao chamar LLM (${detail}).`);
      err.status = upstreamStatus === 429 ? 429 : 502;
      err.code = 'AI_UPSTREAM_ERROR';
      err.upstreamStatus = upstreamStatus;
      err.upstreamCode = e?.upstreamCode || null;
      err.retryable = Boolean(e?.retryable);
      if (e?.retryAfterMs) err.retryAfterMs = e.retryAfterMs;
      throw err;
    }
  }

  let aiActions = parsed ? normalizeAutofillResponse(parsed) : null;

  if (!aiActions && rawText) {
    repairAttempts += 1;
    log('autofill_repair_attempt', { hasRawText: true });
    const repaired = await aiEngine.repairJson({
      capability: 'autofill',
      provider: aiConfig.provider,
      credentials: aiConfig.credentials,
      model,
      systemPrompt,
      originalPrompt: prompt,
      rawText,
      repairInstruction: 'Extraia e retorne SOMENTE o JSON no formato {"actions":[{"selector":"...","value":"...","simulate":false}]}.',
      temperature: 0,
      maxOutputTokens: Number(env.AUTOFILL_MAX_TOKENS || 600),
      timeoutMs: Math.min(5000, Number(env.AI_TIMEOUT_MS || env.OPENAI_TIMEOUT_MS || 30000)),
      retries: 0,
    }, env);
    aiActions = repaired ? normalizeAutofillResponse(repaired) : null;
  }

  if (!aiActions) {
    log('autofill_fallback', { prefilled: prefilled.length, repairAttempts });
    return {
      actions: applyCpfCnpjReplacement(prefilled, normalizedElements),
      meta: { mode: 'heuristic', provider: aiConfig.provider, aiConfigSource: aiConfig.source, model, prefilled: prefilled.length, repairAttempts },
    };
  }

  const combined = [...prefilled, ...aiActions];
  return {
    actions: applyCpfCnpjReplacement(combined, normalizedElements),
    meta: { mode: 'ai', provider: aiConfig.provider, aiConfigSource: aiConfig.source, model, prefilled: prefilled.length, repairAttempts },
  };
}
