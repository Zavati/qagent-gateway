import { sanitizeString } from '../lib/sanitize.js';
import { validateGenerateTestsBody, normalizeCases } from '../lib/validators.js';
import { getEnvNum, getAutofillModel } from '../lib/config.js';

// openaiClient: { callJsonResponse(model, prompt, opts) }
export async function handleGenerateTests(req, env, { openaiClient, rateLimiter }) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  // Token validation
  if (!token || token.length < 24 || !/^[A-Za-z0-9_\-.]+$/.test(token)) {
    const err = new Error('Token inválido ou ausente.');
    err.status = 401;
    throw err;
  }
  // License check (stub)
  // ... (mantém lógica de licença do index.js)

  // Rate limit
  const windowMs = getEnvNum(env, 'RATE_LIMIT_WINDOW_MS', 60_000);
  const max = getEnvNum(env, 'RATE_LIMIT_MAX', 20);
  rateLimiter?.(token, windowMs, max);

  // Read and validate body
  const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 25_000);
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

  // Prompt atualizado: pede nota (score) e justificativa, exige JSON com cases e score
  const userPrompt = `Você é um especialista em QA. Analise a tarefa do Jira abaixo e:

- Gere de 5 a 10 casos de teste (cobrindo happy path, validações, negativos, bordas, autorização).
- Avalie a complexidade da tarefa de 1 a 8 (padrão Scrum) e justifique a nota.

Responda SOMENTE JSON, no seguinte formato:
{
  "cases": [ ... ],
  "score": { "value": <1-8>, "reason": "..." }
}

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
  let result, repairAttempts = 0, mode = 'ai', rawText = '';
  try {
    result = await openaiClient.callJsonResponse(
      model,
      userPrompt,
      { apiKey: env.OPENAI_API_KEY, retries: 3, timeoutMs: 90000, max_output_tokens: 1200 }
    );
  } catch (e) {
    // Try repair if not JSON
    repairAttempts++;
    rawText = e.rawText || '';
    result = await openaiClient.repairJsonResponse(
      model,
      userPrompt,
      rawText,
      { apiKey: env.OPENAI_API_KEY, timeoutMs: 10000, max_output_tokens: 1200 }
    );
    if (!result) {
      mode = 'stub';
      result = { cases: [{ id: 'TC-001', title: 'Stub', steps: [] }], score: { value: 1, reason: 'Stub: IA não respondeu.' } };
    }
  }
  const durationMs = Date.now() - t0;
  // Garante que sempre retorna cases e score
  let cases = Array.isArray(result?.cases) ? result.cases : [];
  let score = result?.score && typeof result.score === 'object' ? result.score : null;
  // fallback se IA não respondeu score
  if (!score) score = { value: 1, reason: 'IA não retornou score.' };
  const normalized = normalizeCases({ cases });
  const caseCount = normalized?.cases?.length || 0;

  const meta = { mode, model, caseCount, repairAttempts, durationMs, promptSize: userPrompt.length };
  if (mode === 'stub' && rawText) meta.rawText = rawText;
  return {
    cases: normalized?.cases || [],
    score,
    meta,
  };
}
