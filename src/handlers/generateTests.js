import { sanitizeString } from '../lib/sanitize.js';
import { validateGenerateTestsBody } from '../lib/validators.js';
import { getEnvNum, getAutofillModel } from '../lib/config.js';

function getLogger(env) {
  if (typeof env?.log === 'function') return env.log;
  if (typeof globalThis.log === 'function') return globalThis.log;
  return (...args) => { try { console.log(...args); } catch {} };
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// openaiClient: { callJsonResponse(model, prompt, opts), repairJsonResponse(model, prompt, rawText, opts) }
export async function handleGenerateTests(req, env, { openaiClient, rateLimiter }) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';

  if (!token || token.length < 24 || !/^[A-Za-z0-9_\-.]+$/.test(token)) {
    const err = new Error('Token inválido ou ausente.');
    err.status = 401;
    throw err;
  }

  const windowMs = getEnvNum(env, 'RATE_LIMIT_WINDOW_MS', 60_000);
  const max = getEnvNum(env, 'RATE_LIMIT_MAX', 20);
  rateLimiter?.(token, windowMs, max);

  const body = await req.json();
  validateGenerateTestsBody(body);

  // ↓↓↓ Pequena redução de risco de prompt gigante (ajuda a caber mais output)
  const issueKey = sanitizeString(body?.jira?.key || body?.source?.issueKey || '', 40);
  const format = (body?.format || 'step').toLowerCase();
  const jiraTitle = sanitizeString(body?.jira?.title || '', 260);
  const jiraDesc = sanitizeString(body?.jira?.description || '', 2500); // antes 4000

  const ctx = body?.context || {};
  const curl = sanitizeString(ctx.curl || '', 1400);       // antes 2000
  const docLink = sanitizeString(ctx.docLink || '', 300);
  const expected = sanitizeString(ctx.expected || '', 800); // antes 1000

  const model = getAutofillModel(body, env);

  const basePrompt = `Você é um especialista em QA. Analise a tarefa do Jira abaixo e:

- Gere EXATAMENTE 5 a 20 casos de teste (happy path, validações, negativos, bordas, autorização, cenários possíveis).
- Avalie a complexidade da tarefa de 1 a 8 (padrão Scrum) e justifique.

IMPORTANTE:
- Responda SOMENTE com JSON válido (sem markdown, sem texto antes/depois).
- Não use comentários no JSON.
- Seja conciso nos textos (títulos/objetivos curtos).
- "score.value" deve ser um número inteiro entre 1 e 8.
- Garanta que TODOS os campos existam em TODOS os casos.

Formato (JSON):
{
  "cases": [
    {
      "id": "TC-001",
      "title": "Título",
      "objective": "Objetivo",
      "preconditions": ["..."],
      "steps": [
        { "action": "...", "data": "...", "expected": "..." }
      ],
      "tags": ["..."],
      "priority": "High | Medium | Low"
    }
  ],
  "score": { "value": "...", "reason": "..." }
}

Regras:
- steps, preconditions e tags são arrays.
- steps é array de objetos com action, data e expected.
- priority ∈ {High, Medium, Low}
- id único por caso: TC-00X

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

  const t0 = Date.now();
  let result = null;
  let repairAttempts = 0;
  let mode = 'ai';
  let rawText = '';
  const log = getLogger(env);

  async function callOnce(prompt, maxOutputTokens) {
    const out = await openaiClient.callJsonResponse(
      model,
      prompt,
      { apiKey: env.OPENAI_API_KEY, retries: 2, timeoutMs: 90_000, max_output_tokens: maxOutputTokens }
    );

    const raw = out?.rawText || '';
    const parsedRaw = raw ? safeJsonParse(raw) : null;
    const status = parsedRaw?.status;
    const incompleteReason = parsedRaw?.incomplete_details?.reason;

    log('generateTests_openai_http', {
      statusCode: out?.status,
      ok: out?.ok,
      respStatus: status,
      incompleteReason,
      hasRawText: Boolean(out?.rawText),
      hasContentText: Boolean(out?.contentText),
      hasJson: Boolean(out?.json),
    });

    log('generateTests_openai_rawtext', {
      contentTextPreview: (out?.contentText || '').slice(0, 1600),
      rawTextPreview: (out?.rawText || '').slice(0, 1600),
    });

    return { out, status, incompleteReason };
  }

  try {
    // 1) Primeira tentativa: mais tokens pra evitar truncar
    let { out, status, incompleteReason } = await callOnce(basePrompt, 2600);

    result = out?.json;

    // rawText pra repair: prefira o "contentText" (trecho do JSON) antes do raw inteiro
    rawText =
      (out?.contentText && String(out.contentText)) ||
      (out?.rawText && String(out.rawText)) ||
      (out?.json ? JSON.stringify(out.json) : '');

    // 2) Se truncou por max_output_tokens, faz fallback pedindo menos (e mais conciso)
    if (status === 'incomplete' && incompleteReason === 'max_output_tokens') {
      log('generateTests_openai_truncated', { note: 'Resposta truncada por max_output_tokens. Repetindo com resposta mais compacta.' });

      const compactPrompt = basePrompt + `

ATENÇÃO (modo compacto):
- Se estiver longo, reduza cada caso para 1 step apenas.
- Mantenha EXATAMENTE 6 casos.
- Seja ainda mais conciso (frases curtas).`;

      ({ out, status, incompleteReason } = await callOnce(compactPrompt, 3200));
      result = out?.json;
      rawText =
        (out?.contentText && String(out.contentText)) ||
        (out?.rawText && String(out.rawText)) ||
        (out?.json ? JSON.stringify(out.json) : '');
    }

    // 3) Se veio JSON mas no formato errado (ou null), tenta repair
    const missingCases = !Array.isArray(result?.cases);
    const missingScore = !(result?.score && typeof result.score === 'object' && typeof result.score.value === 'number');

    if (missingCases || missingScore) {
      repairAttempts++;
      log('generateTests_openai_invalid_shape', { missingCases, missingScore, rawHasData: Boolean(rawText) });

      const repaired = await openaiClient.repairJsonResponse(
        model,
        basePrompt,
        rawText,
        { apiKey: env.OPENAI_API_KEY, timeoutMs: 25_000, max_output_tokens: 2000 }
      );

      log('generateTests_openai_repair_result', {
        repairedPreview: repaired ? JSON.stringify(repaired).slice(0, 1400) : '',
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
      rawTextPreview: String(rawText || '').slice(0, 1600),
    });

    result = await openaiClient.repairJsonResponse(
      model,
      basePrompt,
      rawText,
      { apiKey: env.OPENAI_API_KEY, timeoutMs: 25_000, max_output_tokens: 2000 }
    );

    if (!result) {
      mode = 'stub';
      result = {
        cases: [{ id: 'TC-001', title: 'Stub', objective: '', preconditions: [], steps: [], tags: [], priority: 'Medium' }],
        score: { value: 1, reason: 'Stub: IA não respondeu.' },
      };
    }
  }

  const durationMs = Date.now() - t0;

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

  const meta = { mode, model, caseCount, repairAttempts, durationMs, promptSize: basePrompt.length };
  if (mode === 'stub' && rawText) meta.rawText = String(rawText).slice(0, 1600);

  return {
    cases: normalizedCases,
    score,
    meta,
  };
}
