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

  // Prompt atualizado: pede nota (score) e justificativa, exige JSON com cases e score, e especifica o formato exato dos campos de cada case
  const userPrompt = `Você é um especialista em QA. Analise a tarefa do Jira abaixo e:

  - Gere de 5 a 10 casos de teste (cobrindo happy path, validações, negativos, bordas, autorização).
  - Avalie a complexidade da tarefa de 1 a 8 (padrão Scrum) e justifique a nota.

Responda SOMENTE JSON, no seguinte formato:
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
  "score": { "value": <1-8>, "reason": "..." }
}

Garanta que cada caso de teste contenha TODOS os campos acima, mesmo que precise preencher com valores padrão.
Os campos steps, preconditions e tags devem ser arrays.
O campo steps deve ser um array de objetos com action, data e expected.
O campo priority deve ser High, Medium ou Low.
O campo id deve ser único por caso, no formato TC-00X.

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
    // Log do retorno bruto e do parsing
    log('generateTests_openai_raw', { raw: JSON.stringify(result).slice(0, 2000) });
  } catch (e) {
    // Try repair if not JSON
    repairAttempts++;
    rawText = e.rawText || '';
    log('generateTests_openai_error', { error: e.message, rawText: rawText.slice(0, 2000) });
    result = await openaiClient.repairJsonResponse(
      model,
      userPrompt,
      rawText,
      { apiKey: env.OPENAI_API_KEY, timeoutMs: 10000, max_output_tokens: 1200 }
    );
    log('generateTests_openai_repair', { repaired: JSON.stringify(result).slice(0, 2000) });
    if (!result) {
      mode = 'stub';
      result = { cases: [{ id: 'TC-001', title: 'Stub', steps: [] }], score: { value: 1, reason: 'Stub: IA não respondeu.' } };
    }
  }
  const durationMs = Date.now() - t0;
  // Garante que sempre retorna cases e score, e normaliza cada case para o padrão esperado
  let cases = Array.isArray(result?.cases) ? result.cases : [];
  let score = result?.score && typeof result.score === 'object' ? result.score : null;
  if (!score) score = { value: 1, reason: 'IA não retornou score.' };

  // Função para garantir que cada case siga o padrão esperado
  function normalizeTestCase(tc, idx = 0) {
    return {
      id: typeof tc.id === 'string' && tc.id ? tc.id : `TC-${(idx+1).toString().padStart(3, '0')}`,
      title: typeof tc.title === 'string' && tc.title ? tc.title : 'Caso de teste',
      objective: typeof tc.objective === 'string' && tc.objective ? tc.objective : '',
      preconditions: Array.isArray(tc.preconditions) ? tc.preconditions.map(String) : [],
      steps: Array.isArray(tc.steps) ? tc.steps.map(s => ({
        action: typeof s.action === 'string' ? s.action : '',
        data: typeof s.data === 'string' ? s.data : '',
        expected: typeof s.expected === 'string' ? s.expected : ''
      })) : [],
      tags: Array.isArray(tc.tags) ? tc.tags.map(String) : [],
      priority: ['High','Medium','Low'].includes(tc.priority) ? tc.priority : 'Medium',
    };
  }
  const normalizedCases = cases.map((tc, idx) => normalizeTestCase(tc, idx));
  const caseCount = normalizedCases.length;

  const meta = { mode, model, caseCount, repairAttempts, durationMs, promptSize: userPrompt.length };
  if (mode === 'stub' && rawText) meta.rawText = rawText;
  return {
    cases: normalizedCases,
    score,
    meta,
  };
}
