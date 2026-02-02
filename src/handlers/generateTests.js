import { sanitizeString } from '../lib/sanitize.js';
import { validateGenerateTestsBody } from '../lib/validators.js';
import { getEnvNum, getAutofillModel } from '../lib/config.js';

// Função log deve ser passada pelo env ou contexto, ou fallback para console.log
function getLogger(env) {
  if (typeof env?.log === 'function') return env.log;
  if (typeof globalThis.log === 'function') return globalThis.log;
  return (...args) => { try { console.log(...args); } catch {} };
}

// openaiClient: { callJsonResponse(model, prompt, opts), repairJsonResponse(model, prompt, rawText, opts) }
export async function handleGenerateTests(req, env, { openaiClient, rateLimiter }) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';

  // Token validation
  if (!token || token.length < 24 || !/^[A-Za-z0-9_\-.]+$/.test(token)) {
    const err = new Error('Token inválido ou ausente.');
    err.status = 401;
    throw err;
  }

  // Rate limit
  const windowMs = getEnvNum(env, 'RATE_LIMIT_WINDOW_MS', 60_000);
  const max = getEnvNum(env, 'RATE_LIMIT_MAX', 20);
  rateLimiter?.(token, windowMs, max);

  // Read and validate body
  const body = await req.json();
  validateGenerateTestsBody(body);

  // Sanitize prompt fields
  const issueKey = sanitizeString(body?.jira?.key || body?.source?.issueKey || '', 40);
  const format = (body?.format || 'step').toLowerCase();
  const jiraTitle = sanitizeString(body?.jira?.title || '', 300);
  const jiraDesc = sanitizeString(body?.jira?.description || '', 4000);

  const ctx = body?.context || {};
  const curl = sanitizeString(ctx.curl || '', 2000);
  const docLink = sanitizeString(ctx.docLink || '', 300);
  const expected = sanitizeString(ctx.expected || '', 1000);

  // Model selection
  const model = getAutofillModel(body, env);

  // Prompt mais resiliente: sem placeholders tipo <1-8> e sem texto fora do JSON
  const userPrompt = `Você é um especialista em QA. Analise a tarefa do Jira abaixo e:

- Gere de 5 a 10 casos de teste (cobrindo happy path, validações, negativos, bordas, autorização).
- Avalie a complexidade da tarefa de 1 a 8 (padrão Scrum) e justifique a nota.

IMPORTANTE:
- Responda SOMENTE com JSON válido (sem markdown, sem texto antes/depois).
- Não use comentários no JSON.
- "score.value" deve ser um número inteiro entre 1 e 8.

Formato de resposta (JSON):
{
  "cases": [
    {
      "id": "TC-001",
      "title": "Título do caso de teste",
      "objective": "Objetivo do teste",
      "preconditions": ["Pré-condição 1", "Pré-condição 2"],
      "steps": [
        {
          "action": "Ação a ser executada",
          "data": "Payload ou dados relevantes (string JSON)",
          "expected": "Resultado esperado"
        }
      ],
      "tags": ["tag1", "tag2"],
      "priority": "High | Medium | Low"
    }
  ],
  "score": { "value": 5, "reason": "Justificativa objetiva." }
}

Regras:
- Cada caso deve conter TODOS os campos acima (use valores padrão se necessário).
- steps, preconditions e tags devem ser arrays.
- steps deve ser array de objetos com action, data e expected.
- priority deve ser High, Medium ou Low.
- id deve ser único por caso, no formato TC-00X.

Tarefa:
- Key: ${issueKey}
- Title: ${jiraTitle}
- Description: ${jiraDesc}

Formato preferido: ${format === 'bdd' ? 'BDD (Given/When/Then)' : 'Step-by-step'}.

CONTEXTO ADICIONAL (QA):
- cURL:
${curl}

- Link de documentação:
${docLink}

- Resultado esperado:
${expected}`;

  // OpenAI call + repair
  const t0 = Date.now();
  let result = null;
  let repairAttempts = 0;
  let mode = 'ai';
  let rawText = '';
  const log = getLogger(env);

  try {
    const out = await openaiClient.callJsonResponse(
      model,
      userPrompt,
      { apiKey: env.OPENAI_API_KEY, retries: 3, timeoutMs: 90_000, max_output_tokens: 1200 }
    );

    // Logs que realmente ajudam a diagnosticar
    log('generateTests_openai_http', {
      status: out?.status,
      ok: out?.ok,
      hasRawText: Boolean(out?.rawText),
      hasContentText: Boolean(out?.contentText),
      hasJson: Boolean(out?.json),
    });

    log('generateTests_openai_rawtext', {
      rawTextPreview: (out?.rawText || '').slice(0, 2000),
      contentTextPreview: (out?.contentText || '').slice(0, 2000),
    });

    // Pega o melhor "raw" possível para repair
    rawText =
      (out?.rawText && String(out.rawText)) ||
      (out?.contentText && String(out.contentText)) ||
      (out?.json ? JSON.stringify(out.json) : '');

    result = out?.json;

    // Log do JSON parseado (quando existe)
    log('generateTests_openai_json', {
      jsonKeys: result && typeof result === 'object' ? Object.keys(result).slice(0, 30) : [],
      jsonPreview: result ? JSON.stringify(result).slice(0, 2000) : '',
      rawFallbackUsed: !out?.rawText && !out?.contentText && Boolean(out?.json),
    });

    // Se a IA retornou JSON mas no formato errado, tenta reparo também (não apenas em exceptions)
    const missingCases = !Array.isArray(result?.cases);
    const missingScore = !(result?.score && typeof result.score === 'object' && typeof result.score.value === 'number');

    if (missingCases || missingScore) {
      repairAttempts++;
      log('generateTests_openai_invalid_shape', { missingCases, missingScore });

      // Se rawText estiver vazio, loga isso claramente (é o bug mais comum)
      if (!rawText) {
        log('generateTests_openai_missing_raw_for_repair', {
          note: 'rawText/contentText vieram vazios do openaiClient; repair terá baixa eficácia.',
        });
      }

      const repaired = await openaiClient.repairJsonResponse(
        model,
        userPrompt,
        rawText,
        { apiKey: env.OPENAI_API_KEY, timeoutMs: 20_000, max_output_tokens: 1200 }
      );

      log('generateTests_openai_repair_result', {
        repairedPreview: repaired ? JSON.stringify(repaired).slice(0, 2000) : '',
        repairedHasCases: Array.isArray(repaired?.cases),
        repairedHasScoreValue: typeof repaired?.score?.value === 'number',
      });

      if (repaired) result = repaired;
    }
  } catch (e) {
    repairAttempts++;
    rawText = e?.contentText || e?.rawText || '';

    log('generateTests_openai_error', {
      errorName: e?.name,
      errorMessage: e?.message,
      rawTextPreview: String(rawText || '').slice(0, 2000),
    });

    result = await openaiClient.repairJsonResponse(
      model,
      userPrompt,
      rawText,
      { apiKey: env.OPENAI_API_KEY, timeoutMs: 20_000, max_output_tokens: 1200 }
    );

    log('generateTests_openai_repair', {
      repairedPreview: result ? JSON.stringify(result).slice(0, 2000) : '',
    });

    if (!result) {
      mode = 'stub';
      result = {
        cases: [{ id: 'TC-001', title: 'Stub', objective: '', preconditions: [], steps: [], tags: [], priority: 'Medium' }],
        score: { value: 1, reason: 'Stub: IA não respondeu.' },
      };
    }
  }

  const durationMs = Date.now() - t0;

  // Garante que sempre retorna cases e score, e normaliza cada case para o padrão esperado
  const cases = Array.isArray(result?.cases) ? result.cases : [];
  let score = result?.score && typeof result.score === 'object' ? result.score : null;
  if (!score) score = { value: 1, reason: 'IA não retornou score.' };

  function normalizeTestCase(tc, idx = 0) {
    return {
      id: typeof tc?.id === 'string' && tc.id ? tc.id : `TC-${(idx + 1).toString().padStart(3, '0')}`,
      title: typeof tc?.title === 'string' && tc.title ? tc.title : 'Caso de teste',
      objective: typeof tc?.objective === 'string' && tc.objective ? tc.objective : '',
      preconditions: Array.isArray(tc?.preconditions) ? tc.preconditions.map(String) : [],
      steps: Array.isArray(tc?.steps)
        ? tc.steps.map(s => ({
            action: typeof s?.action === 'string' ? s.action : '',
            data: typeof s?.data === 'string' ? s.data : '',
            expected: typeof s?.expected === 'string' ? s.expected : '',
          }))
        : [],
      tags: Array.isArray(tc?.tags) ? tc.tags.map(String) : [],
      priority: ['High', 'Medium', 'Low'].includes(tc?.priority) ? tc.priority : 'Medium',
    };
  }

  const normalizedCases = cases.map((tc, idx) => normalizeTestCase(tc, idx));
  const caseCount = normalizedCases.length;

  const meta = {
    mode,
    model,
    caseCount,
    repairAttempts,
    durationMs,
    promptSize: userPrompt.length,
  };

  // Só expõe rawText em stub (pra não vazar em produção)
  if (mode === 'stub' && rawText) meta.rawText = String(rawText).slice(0, 2000);

  return {
    cases: normalizedCases,
    score,
    meta,
  };
}
