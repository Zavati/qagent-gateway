// QAgent Gateway (Cloudflare Worker)
// Endpoints:
//  - POST /v1/generate-tests
//  - GET/POST /health
//  - GET /debug/openai-models (diagnóstico)
// Auth:
//  - Authorization: Bearer <licenseToken>
// Proteções:
//  - rate limit por token
//  - limite de payload
//  - logs com PII minimizado


const PROD_HOST = "api.apiqagent.com";

const TRIAL_DAYS = 6;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

function isAdminToken(env, token) {
  const raw = (env?.QAGENT_ADMIN_TOKENS || "").trim();
  if (!raw) return false;
  return raw.split(",").map(s => s.trim()).filter(Boolean).includes(token);
}

function isProdAllowedHost(request, env) {
  const host = (request.headers.get("host") || "").toLowerCase();

  // Se quiser manter dev/local liberado, controle por env:
  // env.ENVIRONMENT = "production" | "development"
  const isProd = (env.ENVIRONMENT || "production") === "production";

  if (!isProd) return true;
  return host === PROD_HOST;
}

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function corsHeaders(req = null, env = {}, extra = {}) {
  // env.QAGENT_ALLOWED_ORIGINS can be "*" (default) or a comma-separated list of allowed origins
  const allowed = (env?.QAGENT_ALLOWED_ORIGINS || "*").trim();
  let origin = "*";
  if (allowed !== "*") {
    const reqOrigin = req?.headers?.get?.("origin") || "";
    const allowedList = allowed.split(",").map(s => s.trim()).filter(Boolean);
    if (reqOrigin && allowedList.includes(reqOrigin)) origin = reqOrigin;
    else origin = "null"; // deliberately block when origin not allowed
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    ...extra,
  };
} 

import { getEnvNum } from './lib/config.js';

function getBearerToken(req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

// Structured logging helper (JSON) - helps observability
function log(type, payload = {}) {
  try {
    console.log(JSON.stringify({ t: type, time: new Date().toISOString(), ...payload }));
  } catch (e) {
    console.log(type, payload);
  }
}

// --- Rate limit (memória do Worker) ---
// MVP: em memória. Em produção: Durable Object / KV.
const rateState = new Map(); // key -> { count, resetAt }

function rateLimitOrThrow({ key, windowMs, max }) {
  const now = Date.now();
  const st = rateState.get(key);
  if (!st || now >= st.resetAt) {
    rateState.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (st.count >= max) {
    const err = new Error("Rate limit excedido. Tente novamente em instantes.");
    err.status = 429;
    err.retryAfterMs = Math.max(0, st.resetAt - now);
    throw err;
  }
  st.count += 1;
}

function safeId(value) {
  const s = String(value || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

async function readJsonWithLimit(req, maxBytes) {
  const buf = await req.arrayBuffer();

  if (buf.byteLength === 0) {
    const err = new Error("Body vazio. A extensão não enviou JSON.");
    err.status = 400;
    throw err;
  }

  if (buf.byteLength > maxBytes) {
    const err = new Error(`Payload grande demais (${buf.byteLength} bytes). Limite: ${maxBytes}.`);
    err.status = 413;
    throw err;
  }

  const text = new TextDecoder().decode(buf);

  try {
    return JSON.parse(text);
  } catch {
    log("invalid_json_body_head", { head: text.slice(0, 300) });
    const err = new Error("JSON inválido.");
    err.status = 400;
    throw err;
  }
}

function validateToken(env, token) {
  if (!token) {
    const err = new Error("Token ausente. Vá em IA e cole seu license token.");
    err.status = 401;
    throw err;
  }

  // mínimo anti-abuso
  if (token.length < 24) {
    const err = new Error("Token inválido.");
    err.status = 403;
    throw err;
  }

  // charset seguro
  if (!/^[A-Za-z0-9_\-\.]+$/.test(token)) {
    const err = new Error("Token inválido (formato).");
    err.status = 403;
    throw err;
  }
}


// normalizeCases and validateGenerateTestsBody moved to ./lib/validators.js


// Sanitiza strings simples: trim, corta, recusa javascript: schemes e caracteres de controle
import { sanitizeString, isValidSelector } from './lib/sanitize.js';

import { normalizeIncomingElement, prefillHeuristics, generateAutofillStub, generateCpf, generateCnpj, detectCpfCnpjField, applyCpfCnpjReplacement } from './lib/heuristics.js';

// Attempts to find and parse a JSON object inside arbitrary text, returns parsed object or null
import { fetchTextWithTimeout, parseResponsesContent, extractJsonFromText } from './lib/openai.js';
import { openaiClient } from './lib/openaiClient.js';
import { handleGenerateTests as generateTestsHandler } from './handlers/generateTests.js';

import { getAutofillModel } from './lib/config.js';

import { validateGenerateTestsBody, validateAutofillBody, normalizeCases } from './lib/validators.js';

// (validators are imported from ./lib/validators.js) 

// heuristics implementation moved to ./lib/heuristics.js


function buildAutofillPrompt(body, maxElems = 50) {
  // compact prompt: one line per element as selector|type|name|placeholder|semantic
  const list = (body.elements || []).slice(0, maxElems).map((e) => {
    const selector = (e.selector || '').replace(/\s+/g, ' ').trim();
    const type = (e.type || '').replace(/\s+/g, ' ').trim();
    const name = (e.name || '').replace(/\s+/g, ' ').trim();
    const placeholder = (e.placeholder || '').replace(/\s+/g, ' ').trim();
    const semantic = (e.semantic || '').replace(/\s+/g, ' ').trim();
    return `${selector}|${type}|${name}|${placeholder}|${semantic}`;
  }).join('\n');

  return `Você é um assistente de preenchimento de formulários. Responda SOMENTE JSON com formato: {"actions":[{"selector":"...","value":"...","simulate":false}]}. Gere valores curtos e seguros (max 200 chars), sem HTML ou javascript:, use emails para campos de email, telefones para phone, nomes para name. Página: ${body.url}\nElementos (cada linha: selector|type|name|placeholder|semantic):\n${list}`;
}

function normalizeAutofillResponse(parsed) {
  if (!parsed || !Array.isArray(parsed.actions)) return null;
  const out = [];
  for (const a of parsed.actions.slice(0, 200)) {
    if (!a || typeof a.selector !== 'string') continue;
    if (!isValidSelector(a.selector)) continue;
    let selector;
    try {
      selector = sanitizeString(a.selector, 500);
    } catch {
      continue;
    }
    let value;
    if (a.value != null) {
      try {
        value = sanitizeString(a.value, 2000);
      } catch {
        continue;
      }
      if (/^javascript:/i.test(value)) continue;
    }
    const action = { selector };
    if (value !== undefined) action.value = value;
    if (a.simulate) action.simulate = !!a.simulate;
    if (a.delayMs != null) action.delayMs = Number(a.delayMs);
    if (a.check) action.check = !!a.check;
    if (a.radio) action.radio = !!a.radio;
    if (a.hint) action.hint = a.hint;
    out.push(action);
  }
  return out.length ? out : null;
}

// CPF/CNPJ gens moved to ./lib/heuristics.js


// detectCpfCnpjField & applyCpfCnpjReplacement moved to ./lib/heuristics.js


async function handleAutofill(req, env) {
  const token = getBearerToken(req) || (req.headers.get('X-QAgent-License') || '').trim();
  validateToken(env, token);
  const license = await getOrCreateLicense(env, token);
  assertPremiumAllowed(license);

  const windowMs = getEnvNum(env, 'RATE_LIMIT_WINDOW_MS', 60_000);
  const max = getEnvNum(env, 'RATE_LIMIT_MAX', 20);
  const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 25_000);
  rateLimitOrThrow({ key: `a:${safeId(token)}`, windowMs, max });

  const body = await readJsonWithLimit(req, maxBytes);
  validateAutofillBody(body);

  log('autofill', { token: safeId(token), url: sanitizeString(body.url, 2000), elements: Math.min(200, (body.elements || []).length) });

  // Normalize input elements once (map used later for CPF/CNPJ replacement)
  const normalizedElements = (body.elements || []).map(normalizeIncomingElement).filter(Boolean);

  // Escolhe o modelo a ser usado (pode vir de body.meta.model)
  const model = getAutofillModel(body, env);

  // First apply fast heuristics
  const { actions: prefilled, remaining } = prefillHeuristics(body.elements || [], Number(env.AUTOFILL_HEUR_MAX_ELEMENTS || 200));
  if (!remaining || remaining.length === 0) {
    const final = applyCpfCnpjReplacement(prefilled, normalizedElements);
    return json({ actions: final, meta: { mode: 'heuristic', model } }, { headers: corsHeaders(req, env) });
  }

  // Build prompt only for remaining elements (compact)
  const promptBody = { url: body.url, elements: remaining };
  const prompt = buildAutofillPrompt(promptBody, Number(env.AUTOFILL_MAX_ELEMS || 50));
  /* model is selected earlier (getAutofillModel) */
  const openaiUrl = "https://api.openai.com/v1/responses";
  const openaiInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: "Você é um assistente que gera valores para preenchimento de formulários." }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      text: { format: { type: "json_object" } },
      temperature: Number(env.AUTOFILL_TEMPERATURE || 0.0),
      max_output_tokens: Number(env.AUTOFILL_MAX_TOKENS || 300),
    }),
  };

  const timeoutMs = Number(env.OPENAI_TIMEOUT_MS || 30000);

  // retry até 3x com backoff simples
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await fetchTextWithTimeout(openaiUrl, openaiInit, timeoutMs);

    if (!last.ok && (last.status === 429 || last.status >= 500 || last.status === 0)) {
      await new Promise((r) => setTimeout(r, 300 + attempt * 700));
      continue;
    }
    break;
  }

  if (!last?.ok) {
    const errInfo = last?.error ? `${last.error.name}: ${last.error.message}` : (last?.status ? `HTTP ${last.status}` : 'unknown');
    log("autofill_openai_error", {
      status: last?.status,
      error: last?.error || null,
      bodyHead: (last?.text || "").slice(0, 400),
      detail: errInfo,
    });
    const err = new Error(`Falha ao chamar LLM (${errInfo}).`);
    err.status = 502;
    err._detail = last?.error?.message || null;
    throw err;
  }

  let contentText = "";
  try {
    const obj = JSON.parse(last.text);
    const out = obj?.output || [];
    const msg = out.find((x) => x.type === "message") || out[0];
    const c = msg?.content || [];
    contentText = c.find((x) => x.type === "output_text")?.text
      || c.find((x) => x.type === "text")?.text
      || "";
  } catch {
    const err = new Error("OpenAI retornou resposta não-JSON (Responses API).");
    err.status = 502;
    throw err;
  }

  let parsed = null;
  let repairAttempts = 0;
  // 1) try direct parse
  try {
    parsed = JSON.parse(contentText);
  } catch (e) {
    // 2) try extract JSON blob from text
    parsed = extractJsonFromText(contentText);
    if (!parsed) {
      // 3) attempt a short repair call to OpenAI (extract JSON only)
      if (env?.OPENAI_API_KEY) {
        try {
          repairAttempts += 1;
          log('autofill_repair_attempt', { head: (contentText || '').slice(0, 200) });
          const repairPrompt = `The previous model response contained extra text. Extract and RETURN ONLY the JSON object that represents the response. Input:\n${contentText}`;
          const repairInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
            body: JSON.stringify({
              model,
              input: [ { role: 'user', content: [{ type: 'input_text', text: repairPrompt }] } ],
              text: { format: { type: 'json_object' } },
              temperature: 0.0,
            }),
          };
          const repairTimeout = Math.min(5000, Number(env.OPENAI_TIMEOUT_MS || 30000));
          const rep = await fetchTextWithTimeout(openaiUrl, repairInit, repairTimeout);
          if (rep && rep.ok) {
            let repairText = '';
            try {
              const o = JSON.parse(rep.text);
              const out = o?.output || [];
              const msg = out.find((x) => x.type === 'message') || out[0];
              const c = msg?.content || [];
              repairText = c.find((x) => x.type === 'output_text')?.text || c.find((x) => x.type === 'text')?.text || '';
            } catch (e) {
              repairText = rep.text || '';
            }
            parsed = extractJsonFromText(repairText) || (() => { try { return JSON.parse(repairText); } catch { return null; } })();
          } else {
            log('autofill_repair_failed', { status: rep?.status, error: rep?.error || null });
          }
        } catch (e) {
          log('autofill_repair_exception', { message: e?.message || String(e) });
        }
      }
    }
  }

  const aiActions = parsed ? normalizeAutofillResponse(parsed) : null;
  if (!aiActions) {
    // fallback: return prefilled heuristics only and report repairAttempts
    log('autofill_fallback', { prefilled: prefilled.length, repairAttempts });

    return json({ actions: prefilled, meta: { mode: 'heuristic', model, prefilled: prefilled.length, repairAttempts } }, { headers: corsHeaders(req, env) });
  }

  // combine prefilled + aiActions, aiActions may be subset
  const combined = [...prefilled, ...aiActions];
  const finalActions = applyCpfCnpjReplacement(combined, normalizedElements);

  return json({ actions: finalActions, meta: { mode: 'ai', model, prefilled: prefilled.length, repairAttempts } }, { headers: corsHeaders(req, env) });
}


// fetchTextWithTimeout moved to ./lib/openai.js (common helper)

// ✅ Diagnóstico: dá pra chamar e ver se o Worker consegue falar com OpenAI e qual status vem.
async function handleDebugOpenAIModels(env) {
  if (!env?.OPENAI_API_KEY) {
    return json({ ok: false, message: "OPENAI_API_KEY ausente no env." }, { status: 500, headers: corsHeaders(null, env) });
  }

  const r = await fetchTextWithTimeout(
    "https://api.openai.com/v1/models",
    { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } },
    15000
  );

  return json(
    {
      ok: r.ok,
      status: r.status,
      error: r.error || null,
      bodyHead: (r.text || "").slice(0, 400),
    },
    { status: r.ok ? 200 : 502, headers: corsHeaders(null, env) }
  );
}



function nowIso() {
  return new Date().toISOString();
}

function addMsToIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function daysLeft(expiresAt) {
  const exp = Date.parse(expiresAt || "");
  if (!Number.isFinite(exp)) return 0;
  const diff = exp - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function licenseKeyForToken(token) {
  // usa safeId(token) que você já tem (hash)
  return `license:t:${safeId(token)}`;
}

async function kvGetJson(env, key) {
  const raw = await env.QAGENT_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function kvPutJson(env, key, value) {
  await env.QAGENT_KV.put(key, JSON.stringify(value));
}

function normalizeLicenseStatus(lic) {
  // expira automaticamente se passou do expiresAt
  if (!lic?.expiresAt) return lic;

  const exp = Date.parse(lic.expiresAt);
  if (Number.isFinite(exp) && Date.now() > exp && lic.status !== "expired") {
    return { ...lic, status: "expired", updatedAt: nowIso() };
  }
  return lic;
}

async function getOrCreateLicense(env, token) {
  if (isAdminToken(env, token)) {
    return {
      licenseId: "admin",
      status: "active",
      plan: "pro",
      expiresAt: "2999-01-01T00:00:00.000Z",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  if (!env?.QAGENT_KV) {
    const err = new Error("KV não configurado (env.QAGENT_KV ausente).");
    err.status = 500;
    throw err;
  }

  const key = licenseKeyForToken(token);
  let lic = await kvGetJson(env, key);

  if (!lic) {
    const createdAt = nowIso();
    lic = {
      licenseId: `lic_${crypto.randomUUID()}`,
      status: "trial",
      plan: "pro", // trial normalmente libera tudo
      expiresAt: addMsToIso(TRIAL_MS),
      createdAt,
      updatedAt: createdAt,
    };
    await kvPutJson(env, key, lic);
    return lic;
  }

  const updated = normalizeLicenseStatus(lic);
  if (updated.status !== lic.status) {
    await kvPutJson(env, key, updated);
    return updated;
  }

  return lic;
}

function assertPremiumAllowed(license) {
  if (!license) {
    const err = new Error("Licença não encontrada.");
    err.status = 403;
    throw err;
  }

  if (license.status !== "trial" && license.status !== "active") {
    const err = new Error("Seu trial expirou. Ative o plano para continuar usando recursos premium.");
    err.status = 403;
    throw err;
  }
}

async function handleGetLicense(req, env) {
  const token = getBearerToken(req);
  validateToken(env, token); // mantém seu modelo atual de tokens permitidos

  const lic = await getOrCreateLicense(env, token);

  return json(
    {
      status: "ok",
      license: {
        status: lic.status,
        plan: lic.plan,
        expiresAt: lic.expiresAt,
        daysLeft: daysLeft(lic.expiresAt),
      },
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}


export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      // Página de Política de Privacidade
      if (url.pathname === "/privacy-policy") {
        return new Response(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Política de Privacidade — QAgent</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      line-height: 1.6;
      padding: 0 20px;
      color: #111;
    }
    h1, h2 {
      margin-top: 32px;
    }
  </style>
</head>
<body>

<h1>Política de Privacidade — QAgent</h1>

<p>Última atualização: Janeiro de 2026</p>

<h2>1. Informações coletadas</h2>
<p>
A extensão QAgent não coleta, armazena ou compartilha informações pessoais identificáveis.
</p>

<h2>2. Dados processados</h2>
<p>
A extensão processa apenas informações fornecidas diretamente pelo usuário,
como texto de tarefas do Jira, descrições técnicas e contexto informado manualmente,
exclusivamente com o objetivo de gerar casos de teste.
</p>

<h2>3. Processamento externo</h2>
<p>
Para gerar os resultados, os dados enviados pelo usuário podem ser processados
por serviços de inteligência artificial através da API do QAgent.
Nenhum dado é utilizado para treinamento de modelos.
</p>

<h2>4. Armazenamento</h2>
<p>
Os dados são armazenados apenas localmente no navegador do usuário.
O QAgent não mantém banco de dados de conteúdo de tarefas, testes ou documentos.
</p>

<h2>5. Compartilhamento</h2>
<p>
Nenhuma informação pessoal é vendida, compartilhada ou utilizada para fins publicitários.
</p>

<h2>6. Segurança</h2>
<p>
Toda comunicação ocorre via HTTPS e utiliza mecanismos de autenticação por token.
</p>

<h2>7. Alterações</h2>
<p>
Esta política pode ser atualizada futuramente. Alterações relevantes serão refletidas nesta página.
</p>

<h2>8. Contato</h2>
<p>
Em caso de dúvidas, entre em contato pelo e-mail:
<strong>contato@apiqagent.com</strong>
</p>

</body>
</html>
`, {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      // 🔒 Bloqueia hosts não autorizados em produção (inclui *.workers.dev)
      if (!isProdAllowedHost(req, env)) {
        return json({ ok: false, message: "Forbidden" }, { status: 403, headers: corsHeaders(req, env) });
      }

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(req, env) });
      }

      // health: aceita GET ou POST
      if (url.pathname === "/health") {
        return json({ ok: true }, { status: 200, headers: corsHeaders(req, env) });
      }

      // debug: só GET
      if (url.pathname === "/debug/openai-models" && req.method === "GET") {
        return await handleDebugOpenAIModels(env);
      }
      // get pagamentos 
      if (url.pathname === "/v1/license" && req.method === "GET") {
        return await handleGetLicense(req, env);
      }
      // generate-tests: só POST
      if (url.pathname === "/v1/generate-tests" && req.method === "POST") {
        // Inject openaiClient and rateLimiter
        const rateLimiter = (token, windowMs, max) => rateLimitOrThrow({ key: `t:${safeId(token)}`, windowMs, max });
        const resp = await generateTestsHandler(req, env, { openaiClient, rateLimiter });
        // Garante que meta.model está presente no response
        if (!resp.meta) resp.meta = {};
        resp.meta.model = resp.meta.model || resp.model || (resp.meta.engine || null);
        return json(resp, { headers: corsHeaders(req, env) });
      }

      // autofill: POST /v1/autofill
      if (url.pathname === "/v1/autofill" && req.method === "POST") {
        return await handleAutofill(req, env);
      }



      return json({ status: "not_found", message: "Endpoint inexistente." }, { status: 404, headers: corsHeaders(req, env) });
    } catch (e) {
      const status = e?.status || 500;
      const headers = corsHeaders(req, env, status === 429 && e.retryAfterMs ? { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } : {});
      return json({ status: "error", message: e?.message || String(e) }, { status, headers });
    }
  },
};

// Named exports for testing
export {
  corsHeaders,
  validateGenerateTestsBody,
  validateAutofillBody,
  generateAutofillStub,
  prefillHeuristics,
  normalizeIncomingElement,
  extractJsonFromText,
  buildAutofillPrompt,
  normalizeAutofillResponse,
  sanitizeString,
  isValidSelector,
  safeId,
  normalizeCases,
  daysLeft,
  isAdminToken,
  // CPF/CNPJ helpers
  generateCpf,
  generateCnpj,
  detectCpfCnpjField,
  applyCpfCnpjReplacement,
  // openai helpers
  fetchTextWithTimeout,
  parseResponsesContent,
  // model helper
  getAutofillModel,
};
