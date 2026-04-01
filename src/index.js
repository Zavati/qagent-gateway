// QAgent Gateway (Cloudflare Worker)
// Endpoints:
//  - POST /v1/generate-tests
//  - GET/POST /health
//  - GET /debug/openai-models (diagnóstico)
// Auth:
//  - Authorization: Bearer <clientKey> (novo padrão; tokens legados ainda podem ser aceitos conforme janela de migração)
// Proteções:
//  - rate limit por token
//  - limite de payload
//  - logs com PII minimizado


const PROD_HOST = "api.apiqagent.com";

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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-QAgent-Signature, X-QAgent-Tenant, X-QAgent-Cohort",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    ...extra,
  };
} 

import { getEnvNum } from './lib/config.js';
import { safeId, isAdminToken, generateClientKey, hashClientKey, validateClientKeyFormat, generateAccessToken, hashAccessToken } from './lib/keyService.js';
import { getOrCreateLicense, assertPremiumAllowed, daysLeft, createTrialLicenseForKeyHash, getLicenseByKeyHash, applyPaymentToLicense } from './lib/licenseService.js';
import { createCustomer, getCustomerByEmail, getCustomerById, customerEmailIndexKey } from './lib/customerService.js';
import { buildSignupEmailEvent, savePendingEmailEvent, markEmailEventStatus, saveEmailDispatchAck } from './lib/emailEventService.js';
import { sendEmailEvent } from './lib/emailDispatcher.js';
import { verifyWebhookSignatureOrThrow } from './lib/webhookSecurity.js';
import { savePaymentEvent } from './lib/paymentEventService.js';
import { trackMigrationMetric } from './lib/migrationMetricsService.js';
import { createCheckoutSession, verifyStripeWebhook, normalizeStripeEvent } from './lib/stripeService.js';
import { hashPassword, verifyPassword } from './lib/passwords.js';
import { createUser, getUserByEmail, getUserById, updateUserLoginStats, updateUserPassword } from './lib/userService.js';
import { createSessionToken, verifySessionToken } from './lib/sessionTokens.js';

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

// Estado de falhas de login (lockout breve após N tentativas)
const loginFailureState = new Map(); // key -> { failures, lockUntil }

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

function getClientIp(req) {
  const cfIp = req.headers.get('CF-Connecting-IP') || req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const xff = req.headers.get('X-Forwarded-For') || req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return null;
}

function isLoginLocked(key) {
  if (!key) return false;
  const st = loginFailureState.get(key);
  if (!st) return false;
  const now = Date.now();
  if (st.lockUntil && now < st.lockUntil) return true;
  if (st.lockUntil && now >= st.lockUntil) {
    loginFailureState.delete(key);
  }
  return false;
}

function registerLoginFailure(key, maxFailures, lockMs) {
  if (!key) return;
  const now = Date.now();
  let st = loginFailureState.get(key);
  if (!st || (st.lockUntil && now >= st.lockUntil)) {
    st = { failures: 0, lockUntil: null };
  }
  st.failures += 1;
  if (st.failures >= maxFailures) {
    st.lockUntil = now + lockMs;
    st.failures = 0;
  }
  loginFailureState.set(key, st);
}

function clearLoginFailures(key) {
  if (!key) return;
  loginFailureState.delete(key);
}

function generateRandomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, '0');
  }
  return out;
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

function isLegacyLicenseMigrationWindowOpen(env) {
  const rawFlag = String(env?.ALLOW_LEGACY_LICENSE_TOKEN ?? 'true').trim().toLowerCase();
  if (rawFlag === 'false' || rawFlag === '0' || rawFlag === 'off' || rawFlag === 'no') {
    return { allowed: false, legacySunsetAt: String(env?.LEGACY_TOKEN_MIGRATION_UNTIL || '').trim() || null };
  }

  const untilRaw = String(env?.LEGACY_TOKEN_MIGRATION_UNTIL || '').trim();
  if (!untilRaw) {
    return { allowed: true, legacySunsetAt: null };
  }

  const untilMs = Date.parse(untilRaw);
  if (!Number.isFinite(untilMs)) {
    return { allowed: true, legacySunsetAt: null };
  }

  return {
    allowed: Date.now() <= untilMs,
    legacySunsetAt: new Date(untilMs).toISOString(),
  };
}

function parseCsvSet(raw) {
  const source = String(raw || '').trim();
  if (!source) return new Set();
  return new Set(
    source
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function resolveLegacyPolicyForRequest(req, env) {
  const migrationWindow = isLegacyLicenseMigrationWindowOpen(env);
  const tenantId = String(req.headers.get('X-QAgent-Tenant') || '').trim().toLowerCase();
  const cohortId = String(req.headers.get('X-QAgent-Cohort') || '').trim().toLowerCase();

  const forcedTenantSet = parseCsvSet(env?.MIGRATION_REQUIRE_CLIENTKEY_TENANTS);
  const forcedCohortSet = parseCsvSet(env?.MIGRATION_REQUIRE_CLIENTKEY_COHORTS);

  const tenantForced = Boolean(tenantId && forcedTenantSet.has(tenantId));
  const cohortForced = Boolean(cohortId && forcedCohortSet.has(cohortId));

  if (tenantForced) {
    return {
      legacyAllowed: false,
      reason: 'tenant_enforced',
      legacySunsetAt: migrationWindow.legacySunsetAt,
      tenantId,
      cohortId,
    };
  }

  if (cohortForced) {
    return {
      legacyAllowed: false,
      reason: 'cohort_enforced',
      legacySunsetAt: migrationWindow.legacySunsetAt,
      tenantId,
      cohortId,
    };
  }

  return {
    legacyAllowed: migrationWindow.allowed,
    reason: migrationWindow.allowed ? 'global_allowed' : 'global_denied',
    legacySunsetAt: migrationWindow.legacySunsetAt,
    tenantId,
    cohortId,
  };
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

import { validateGenerateTestsBody, validateAutofillBody, normalizeCases, validateSignupTrialBody, validateEmailDispatchedBody, validatePaymentWebhookBody } from './lib/validators.js';
import { API_CONTRACT_VERSION } from './lib/contracts.js';

// (validators are imported from ./lib/validators.js) 

// heuristics implementation moved to ./lib/heuristics.js


function buildAutofillPrompt(body, maxElems = 150) {
  // compact prompt: one line per element as selector|type|name|placeholder|semantic|tableContext
  const list = (body.elements || []).slice(0, maxElems).map((e) => {
    const selector = (e.selector || '').replace(/\s+/g, ' ').trim();
    const type = (e.type || '').replace(/\s+/g, ' ').trim();
    const name = (e.name || '').replace(/\s+/g, ' ').trim();
    const placeholder = (e.placeholder || '').replace(/\s+/g, ' ').trim();
    const semantic = (e.semantic || '').replace(/\s+/g, ' ').trim();
    const tableContext = e.tableContext && typeof e.tableContext === 'object'
      ? sanitizeString(
        `${e.tableContext.cellText || ''} ${e.tableContext.rowText || ''} ${e.tableContext.innerTableText || ''} ${e.tableContext.outerTableText || ''}`,
        800
      ).replace(/\s+/g, ' ').trim()
      : '';
    return `${selector}|${type}|${name}|${placeholder}|${semantic}|${tableContext}`;
  }).join('\n');

  return `Você é um assistente de preenchimento de formulários. Responda SOMENTE JSON com formato: {"actions":[{"selector":"...","value":"...","simulate":false}]}. Gere valores curtos e seguros (max 200 chars), sem HTML ou javascript:, use emails para campos de email, telefones para phone, nomes para name. Página: ${body.url}\nElementos (cada linha: selector|type|name|placeholder|semantic|tableContext):\n${list}`;
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
  const credentialType = validateClientKeyFormat(token) ? 'client_key' : 'legacy_token';
  const migrationPolicy = resolveLegacyPolicyForRequest(req, env);

  if (credentialType === 'legacy_token' && !migrationPolicy.legacyAllowed) {
    await trackMigrationMetric(env, {
      tenant: migrationPolicy.tenantId,
      cohort: migrationPolicy.cohortId,
      credentialType,
      statusCode: 403,
      legacyAccepted: false,
      legacyBlocked: true,
    });
    const err = new Error('Token legado desabilitado. Atualize para clientKey.');
    err.status = 403;
    throw err;
  }

  const license = await getOrCreateLicense(env, token);
  assertPremiumAllowed(license);

  await trackMigrationMetric(env, {
    tenant: migrationPolicy.tenantId,
    cohort: migrationPolicy.cohortId,
    credentialType,
    statusCode: 200,
    legacyAccepted: credentialType === 'legacy_token',
    legacyBlocked: false,
  });

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
      max_output_tokens: Number(env.AUTOFILL_MAX_TOKENS || 600),
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

async function handleDebugPaymentEvent(req, env, provider, eventId) {
  if (!env?.QAGENT_KV) {
    return json({ ok: false, message: 'KV não configurado (env.QAGENT_KV ausente).' }, { status: 500, headers: corsHeaders(req, env) });
  }

  try {
    const paymentKey = `payment_event:${provider}:${eventId}`;
    const paymentRaw = await env.QAGENT_KV.get(paymentKey);
    const payment = paymentRaw ? JSON.parse(paymentRaw) : null;

    const emailRaw = await env.QAGENT_KV.get(`email_event:${eventId}`);
    const email = emailRaw ? JSON.parse(emailRaw) : null;

    let clientKeyRecord = null;
    try {
      const keyHash = payment?.keyHash || null;
      if (keyHash) {
        const ckRaw = await env.QAGENT_KV.get(`clientkey:${keyHash}`);
        clientKeyRecord = ckRaw ? JSON.parse(ckRaw) : null;
      }
    } catch (e) {
      // ignore
    }

    return json({ ok: true, payment, email, clientKeyRecord }, { status: 200, headers: corsHeaders(req, env) });
  } catch (e) {
    return json({ ok: false, message: e?.message || String(e) }, { status: 500, headers: corsHeaders(req, env) });
  }
}



async function handleGetLicense(req, env) {
  const token = getBearerToken(req);
  validateToken(env, token); // mantém seu modelo atual de tokens permitidos

  const credentialType = validateClientKeyFormat(token) ? 'client_key' : 'legacy_token';
  const migrationPolicy = resolveLegacyPolicyForRequest(req, env);

  if (credentialType === 'legacy_token' && !migrationPolicy.legacyAllowed) {
    await trackMigrationMetric(env, {
      tenant: migrationPolicy.tenantId,
      cohort: migrationPolicy.cohortId,
      credentialType,
      statusCode: 403,
      legacyAccepted: false,
      legacyBlocked: true,
    });
    const err = new Error('Token legado desabilitado. Atualize para clientKey.');
    err.status = 403;
    throw err;
  }

  const lic = await getOrCreateLicense(env, token);

  await trackMigrationMetric(env, {
    tenant: migrationPolicy.tenantId,
    cohort: migrationPolicy.cohortId,
    credentialType,
    statusCode: 200,
    legacyAccepted: credentialType === 'legacy_token',
    legacyBlocked: false,
  });

  return json(
    {
      status: "ok",
      credential: {
        type: credentialType,
      },
      migration: {
        legacyAccepted: credentialType === 'legacy_token',
        legacySunsetAt: migrationPolicy.legacySunsetAt,
        policy: migrationPolicy.reason,
        tenant: migrationPolicy.tenantId || null,
        cohort: migrationPolicy.cohortId || null,
      },
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

async function handleAuthLogin(req, env) {
  const ip = getClientIp(req);
  const ipKey = ip ? `login-ip:${ip}` : null;
  const windowMs = getEnvNum(env, 'LOGIN_RATE_LIMIT_WINDOW_MS', 60_000);
  const maxReq = getEnvNum(env, 'LOGIN_RATE_LIMIT_MAX', 20);
  if (ipKey) {
    try {
      rateLimitOrThrow({ key: ipKey, windowMs, max: maxReq });
    } catch (e) {
      // Mantém mensagem genérica de credenciais inválidas para não vazar motivo
      const err = new Error('Credenciais inválidas.');
      err.status = 401;
      throw err;
    }
  }

  const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 10_000);
  const body = await readJsonWithLimit(req, maxBytes);

  const email = String(body?.email || '').trim().toLowerCase();
  const password = body?.password;
  const emailKey = email ? `login-email:${email}` : null;

  const maxFailures = getEnvNum(env, 'LOGIN_MAX_FAILURES', 5);
  const lockMs = getEnvNum(env, 'LOGIN_LOCKOUT_MS', 10 * 60_000);

  if (isLoginLocked(ipKey) || isLoginLocked(emailKey)) {
    const err = new Error('Credenciais inválidas.');
    err.status = 401;
    throw err;
  }

  if (!email || typeof password !== 'string' || !password) {
    registerLoginFailure(ipKey, maxFailures, lockMs);
    registerLoginFailure(emailKey, maxFailures, lockMs);
    const err = new Error('Credenciais inválidas.');
    err.status = 401;
    throw err;
  }

  const user = await getUserByEmail(env, email);
  if (!user) {
    registerLoginFailure(ipKey, maxFailures, lockMs);
    registerLoginFailure(emailKey, maxFailures, lockMs);
    const err = new Error('Credenciais inválidas.');
    err.status = 401;
    throw err;
  }

  const ok = await verifyPassword(password, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
    iterations: user.passwordIterations,
    algo: user.passwordAlgo,
  });

  if (!ok) {
    registerLoginFailure(ipKey, maxFailures, lockMs);
    registerLoginFailure(emailKey, maxFailures, lockMs);
    const err = new Error('Credenciais inválidas.');
    err.status = 401;
    throw err;
  }

  // Login bem-sucedido limpa falhas anteriores
  clearLoginFailures(ipKey);
  clearLoginFailures(emailKey);

  const nowIso = new Date().toISOString();
  await updateUserLoginStats(env, user.userId, { lastLoginAt: nowIso });

  const tokenInfo = await createSessionToken(env, {
    sub: user.userId,
    email: user.email,
    ver: typeof user.tokenVersion === 'number' ? user.tokenVersion : 1,
    iss: 'qagent-gateway',
    aud: 'qagent-console',
  });

  const expiresAtIso = new Date(tokenInfo.exp * 1000).toISOString();

  return json(
    {
      status: 'ok',
      session: {
        token: tokenInfo.token,
        expiresAt: expiresAtIso,
      },
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleAuthMe(req, env) {
  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    const err = new Error('Sessão ausente.');
    err.status = 401;
    throw err;
  }

  const verified = await verifySessionToken(env, sessionToken);
  if (!verified.ok) {
    const err = new Error('Sessão inválida ou expirada.');
    err.status = 401;
    throw err;
  }

  const payload = verified.payload;
  const userId = payload?.sub;
  const user = await getUserById(env, userId);
  if (!user) {
    const err = new Error('Sessão inválida.');
    err.status = 401;
    throw err;
  }

  if (typeof user.tokenVersion === 'number' && payload?.ver !== user.tokenVersion) {
    const err = new Error('Sessão revogada. Faça login novamente.');
    err.status = 401;
    throw err;
  }

  let licenseSummary = null;
  if (user.customerId) {
    try {
      const customer = await getCustomerById(env, user.customerId);
      const custEmail = customer?.email || null;
      if (custEmail) {
        const existing = await getCustomerByEmail(env, custEmail);
        const keyHash = existing?.keyHash || null;
        if (keyHash) {
          const lic = await getLicenseByKeyHash(env, keyHash);
          if (lic) {
            const expiresAt = lic.expiresAt || lic.trialEndsAt || null;
            let clientKeyPrefix = null;
            try {
              const ckRaw = await env.QAGENT_KV.get(`clientkey:${keyHash}`);
              if (ckRaw) {
                const ck = JSON.parse(ckRaw);
                clientKeyPrefix = ck?.clientKeyPrefix || null;
              }
            } catch (e) {
              log('auth_me_clientkey_lookup_error', { message: e?.message || String(e), userId: user.userId, keyHash });
            }
            licenseSummary = {
              status: lic.status,
              plan: lic.plan,
              expiresAt,
              daysLeft: daysLeft(expiresAt),
              keyHash,
              clientKeyPrefix,
            };
          }
        }
      }
    } catch (e) {
      log('auth_me_license_lookup_error', { message: e?.message || String(e), userId: user.userId });
    }
  }

  const expiresAtIso = typeof payload?.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null;

  return json(
    {
      status: 'ok',
      user: {
        userId: user.userId,
        email: user.email,
        customerId: user.customerId || null,
      },
      session: {
        expiresAt: expiresAtIso,
      },
      license: licenseSummary,
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleForgotPassword(req, env) {
  const ip = getClientIp(req);
  const ipKey = ip ? `forgot-ip:${ip}` : null;
  const windowMs = getEnvNum(env, 'FORGOT_RATE_LIMIT_WINDOW_MS', 60_000);
  const maxReq = getEnvNum(env, 'FORGOT_RATE_LIMIT_MAX', 10);

  if (ipKey) {
    try {
      rateLimitOrThrow({ key: ipKey, windowMs, max: maxReq });
    } catch (e) {
      // Mesmo em caso de rate limit, responder genericamente
      return json(
        {
          status: 'ok',
          message: 'Se encontrarmos uma conta com este email, enviaremos instruções de recuperação.',
        },
        { status: 200, headers: corsHeaders(req, env) }
      );
    }
  }

  let email = null;
  try {
    const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 10_000);
    const body = await readJsonWithLimit(req, maxBytes);
    email = String(body?.email || '').trim().toLowerCase();
  } catch (e) {
    log('forgot_password_invalid_body', { message: e?.message || String(e) });
  }

  if (!email || !env?.QAGENT_KV) {
    return json(
      {
        status: 'ok',
        message: 'Se encontrarmos uma conta com este email, enviaremos instruções de recuperação.',
      },
      { status: 200, headers: corsHeaders(req, env) }
    );
  }

  try {
    const user = await getUserByEmail(env, email);
    if (user) {
      const now = new Date();
      const createdAt = now.toISOString();
      const ttlMs = getEnvNum(env, 'FORGOT_TOKEN_TTL_MS', 30 * 60_000);
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

      const tokenId = `fpw_${generateRandomHex(16)}`;
      const record = {
        tokenId,
        userId: user.userId,
        email: user.email,
        createdAt,
        expiresAt,
        usedAt: null,
      };

      try {
        await env.QAGENT_KV.put(`forgotpw:${tokenId}`, JSON.stringify(record));
      } catch (e) {
        log('forgot_password_kv_put_error', { message: e?.message || String(e), email });
      }

      try {
        const baseUrl = (env.PASSWORD_RESET_BASE_URL || 'https://app.apiqagent.com/reset-password').trim();
        const resetUrl = `${baseUrl}?token=${encodeURIComponent(tokenId)}`;
        const emailEvent = buildSignupEmailEvent({
          customerId: user.customerId || null,
          email: user.email,
          keyHash: null,
          template: 'forgot_password',
        });
        emailEvent.metadata = {
          ...(emailEvent.metadata || {}),
          resetToken: tokenId,
          resetUrl,
        };
        await savePendingEmailEvent(env, emailEvent);
        try {
          await sendEmailEvent(env, emailEvent);
        } catch (e) {
          log('forgot_password_email_send_error', { message: e?.message || String(e), email });
        }
      } catch (e) {
        log('forgot_password_email_build_error', { message: e?.message || String(e), email });
      }
    }
  } catch (e) {
    log('forgot_password_lookup_error', { message: e?.message || String(e), email });
  }

  return json(
    {
      status: 'ok',
      message: 'Se encontrarmos uma conta com este email, enviaremos instruções de recuperação.',
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleResetPassword(req, env) {
  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 10_000);
  const body = await readJsonWithLimit(req, maxBytes);

  const token = String(body?.token || '').trim();
  const password = body?.password;
  const passwordConfirmation = body?.passwordConfirmation;

  if (!token) {
    const err = new Error('Token inválido ou expirado.');
    err.status = 400;
    throw err;
  }

  if (password == null || typeof password !== 'string' || passwordConfirmation == null || typeof passwordConfirmation !== 'string') {
    const err = new Error("'password' e 'passwordConfirmation' devem ser informados.");
    err.status = 400;
    throw err;
  }

  if (password !== passwordConfirmation) {
    const err = new Error('As senhas não conferem.');
    err.status = 400;
    throw err;
  }

  const pwd = String(password);
  if (pwd.length < 8) {
    const err = new Error('Senha muito curta (mínimo 8 caracteres).');
    err.status = 400;
    throw err;
  }
  if (!/[A-Z]/.test(pwd) || !/[a-z]/.test(pwd) || !/[0-9]/.test(pwd)) {
    const err = new Error('Senha fraca. Use letras maiúsculas, minúsculas e números.');
    err.status = 400;
    throw err;
  }

  const key = `forgotpw:${token}`;
  const raw = await env.QAGENT_KV.get(key);
  if (!raw) {
    const err = new Error('Token inválido ou expirado.');
    err.status = 400;
    throw err;
  }

  let record = null;
  try {
    record = JSON.parse(raw);
  } catch {
    const err = new Error('Token inválido ou expirado.');
    err.status = 400;
    throw err;
  }

  if (record.usedAt) {
    const err = new Error('Token inválido ou expirado.');
    err.status = 400;
    throw err;
  }

  if (record.expiresAt) {
    const exp = Date.parse(record.expiresAt);
    if (Number.isFinite(exp) && Date.now() > exp) {
      const err = new Error('Token inválido ou expirado.');
      err.status = 400;
      throw err;
    }
  }

  const userId = record.userId;
  const user = await getUserById(env, userId);
  if (!user) {
    const err = new Error('Token inválido ou expirado.');
    err.status = 400;
    throw err;
  }

  const passwordBundle = await hashPassword(pwd);
  const updatedUser = await updateUserPassword(env, user.userId, passwordBundle);

  // Marca token como usado (uso único)
  try {
    record.usedAt = new Date().toISOString();
    await env.QAGENT_KV.put(key, JSON.stringify(record));
  } catch (e) {
    log('reset_password_mark_used_error', { message: e?.message || String(e), tokenPrefix: token.slice(0, 8) });
  }

  // Opcional: emitir nova sessão já autenticada
  let session = null;
  try {
    const tokenInfo = await createSessionToken(env, {
      sub: user.userId,
      email: user.email,
      ver: typeof updatedUser?.tokenVersion === 'number' ? updatedUser.tokenVersion : ((typeof user.tokenVersion === 'number' ? user.tokenVersion : 1) + 1),
      iss: 'qagent-gateway',
      aud: 'qagent-console',
    });
    const expiresAtIso = new Date(tokenInfo.exp * 1000).toISOString();
    session = {
      token: tokenInfo.token,
      expiresAt: expiresAtIso,
    };
  } catch (e) {
    log('reset_password_session_error', { message: e?.message || String(e), userId: user.userId });
  }

  return json(
    {
      status: 'ok',
      session,
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleConsoleLicense(req, env) {
  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    const err = new Error('Sessão ausente.');
    err.status = 401;
    throw err;
  }

  const verified = await verifySessionToken(env, sessionToken);
  if (!verified.ok) {
    const err = new Error('Sessão inválida ou expirada.');
    err.status = 401;
    throw err;
  }

  const payload = verified.payload;
  const userId = payload?.sub;
  const user = await getUserById(env, userId);
  if (!user) {
    const err = new Error('Sessão inválida.');
    err.status = 401;
    throw err;
  }

  if (typeof user.tokenVersion === 'number' && payload?.ver !== user.tokenVersion) {
    const err = new Error('Sessão revogada. Faça login novamente.');
    err.status = 401;
    throw err;
  }

  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  if (!user.customerId) {
    const err = new Error('Conta sem vínculo de cliente.');
    err.status = 409;
    throw err;
  }

  let licenseSummary = null;
  try {
    const customer = await getCustomerById(env, user.customerId);
    const custEmail = customer?.email || user.email || null;
    if (custEmail) {
      const existing = await getCustomerByEmail(env, custEmail);
      const keyHash = existing?.keyHash || null;
      if (keyHash) {
        const lic = await getLicenseByKeyHash(env, keyHash);
        if (lic) {
          const expiresAt = lic.expiresAt || lic.trialEndsAt || null;
          licenseSummary = {
            status: lic.status,
            plan: lic.plan,
            expiresAt,
            daysLeft: daysLeft(expiresAt),
          };
        }
      }
    }
  } catch (e) {
    log('console_license_main_lookup_error', { message: e?.message || String(e), userId: user.userId });
  }

  const clientKeys = [];
  try {
    let cursor = undefined;
    const maxClientKeys = 500;

    while (true) {
      const page = await env.QAGENT_KV.list({ prefix: 'clientkey:', cursor });
      const keys = page?.keys || [];

      if (keys.length) {
        const results = await Promise.all(
          keys.map(async (k) => {
            const raw = await env.QAGENT_KV.get(k.name);
            return raw ? { name: k.name, raw } : null;
          })
        );

        for (const item of results) {
          if (!item) continue;
          let rec = null;
          try {
            rec = JSON.parse(item.raw);
          } catch {
            continue;
          }
          if (rec && rec.customerId === user.customerId) {
            clientKeys.push({
              label: rec.label || null,
              prefix: rec.clientKeyPrefix || null,
              createdAt: rec.createdAt || null,
              revokedAt: rec.revokedAt || null,
            });
          }
        }
      }

      if (page.list_complete || !page.cursor || clientKeys.length >= maxClientKeys) break;
      cursor = page.cursor;
    }
  } catch (e) {
    log('console_license_clientkeys_error', { message: e?.message || String(e), userId: user.userId });
  }

  return json(
    {
      status: 'ok',
      license: licenseSummary,
      clientKeys,
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleConsolePayments(req, env) {
  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    const err = new Error('Sessão ausente.');
    err.status = 401;
    throw err;
  }

  const verified = await verifySessionToken(env, sessionToken);
  if (!verified.ok) {
    const err = new Error('Sessão inválida ou expirada.');
    err.status = 401;
    throw err;
  }

  const payload = verified.payload;
  const userId = payload?.sub;
  const user = await getUserById(env, userId);
  if (!user) {
    const err = new Error('Sessão inválida.');
    err.status = 401;
    throw err;
  }

  if (typeof user.tokenVersion === 'number' && payload?.ver !== user.tokenVersion) {
    const err = new Error('Sessão revogada. Faça login novamente.');
    err.status = 401;
    throw err;
  }

  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  if (!user.customerId) {
    const err = new Error('Conta sem vínculo de cliente.');
    err.status = 409;
    throw err;
  }

  // Descobre todos os keyHash associados a este customerId (incluindo chaves revogadas)
  const keyHashes = new Set();
  try {
    let cursor = undefined;
    const maxClientKeys = 500;

    while (true) {
      const page = await env.QAGENT_KV.list({ prefix: 'clientkey:', cursor });
      const keys = page?.keys || [];

      if (keys.length) {
        const results = await Promise.all(
          keys.map(async (k) => {
            const raw = await env.QAGENT_KV.get(k.name);
            return raw ? { name: k.name, raw } : null;
          })
        );

        for (const item of results) {
          if (!item) continue;
          let rec = null;
          try {
            rec = JSON.parse(item.raw);
          } catch {
            continue;
          }
          if (rec && rec.customerId === user.customerId) {
            if (rec.keyHash) {
              keyHashes.add(rec.keyHash);
            } else if (item.name.startsWith('clientkey:')) {
              keyHashes.add(item.name.slice('clientkey:'.length));
            }
          }
        }
      }

      if (page.list_complete || !page.cursor || keyHashes.size >= maxClientKeys) break;
      cursor = page.cursor;
    }
  } catch (e) {
    log('console_payments_clientkeys_error', { message: e?.message || String(e), userId: user.userId });
  }

  const payments = [];
  try {
    let cursor = undefined;
    const maxEvents = 100;
    const maxScanKeys = 2000;
    let scanned = 0;

    while (true) {
      const page = await env.QAGENT_KV.list({ prefix: 'payment_event:', cursor });
      const keys = page?.keys || [];
      scanned += keys.length;

      if (keys.length) {
        const results = await Promise.all(
          keys.map(async (k) => {
            const raw = await env.QAGENT_KV.get(k.name);
            return raw ? raw : null;
          })
        );

        for (const raw of results) {
          if (!raw) continue;
          let evt = null;
          try {
            evt = JSON.parse(raw);
          } catch {
            continue;
          }
          if (!evt || !evt.keyHash || !keyHashes.has(evt.keyHash)) continue;

          const occurredAt = evt.occurredAt || evt.receivedAt || null;
          const billing = evt.billing || {};
          const provider = evt.provider || null;
          const eventId = evt.eventId || null;
          let link = null;
          if (provider === 'stripe' && eventId) {
            link = `https://dashboard.stripe.com/events/${eventId}`;
          }

          payments.push({
            provider,
            eventId,
            type: evt.type || null,
            occurredAt,
            status: (evt.transition && evt.transition.finalStatus) || evt.status || null,
            amount: billing.amount || null,
            currency: billing.currency || null,
            link,
          });
        }
      }

      if (page.list_complete || !page.cursor || scanned >= maxScanKeys || payments.length >= maxEvents) break;
      cursor = page.cursor;
    }
  } catch (e) {
    log('console_payments_list_error', { message: e?.message || String(e), userId: user.userId });
  }

  // Ordena do mais recente para o mais antigo
  payments.sort((a, b) => {
    const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return tb - ta;
  });

  return json(
    {
      status: 'ok',
      payments,
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleRotateClientKey(req, env) {
  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    const err = new Error('Sessão ausente.');
    err.status = 401;
    throw err;
  }

  const verified = await verifySessionToken(env, sessionToken);
  if (!verified.ok) {
    const err = new Error('Sessão inválida ou expirada.');
    err.status = 401;
    throw err;
  }

  const payload = verified.payload;
  const userId = payload?.sub;
  const user = await getUserById(env, userId);
  if (!user) {
    const err = new Error('Sessão inválida.');
    err.status = 401;
    throw err;
  }

  if (typeof user.tokenVersion === 'number' && payload?.ver !== user.tokenVersion) {
    const err = new Error('Sessão revogada. Faça login novamente.');
    err.status = 401;
    throw err;
  }

  if (!user.customerId) {
    const err = new Error('Conta sem vínculo de cliente para rotação de chave.');
    err.status = 409;
    throw err;
  }

  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  const customer = await getCustomerById(env, user.customerId);
  const email = customer?.email || user.email || null;
  if (!email) {
    const err = new Error('Não foi possível localizar cliente para rotação de chave.');
    err.status = 409;
    throw err;
  }

  const existing = await getCustomerByEmail(env, email);
  const currentKeyHash = existing?.keyHash || null;
  if (!currentKeyHash) {
    const err = new Error('Nenhuma clientKey ativa encontrada para esta conta.');
    err.status = 409;
    throw err;
  }

  const currentLicense = await getLicenseByKeyHash(env, currentKeyHash);
  if (!currentLicense) {
    const err = new Error('Licença não encontrada para a clientKey atual.');
    err.status = 409;
    throw err;
  }

  const keyMode = String(env?.CLIENT_KEY_MODE || '').toLowerCase() || ((env.ENVIRONMENT || 'production') === 'production' ? 'live' : 'test');
  const newClientKey = generateClientKey(keyMode === 'test' ? 'test' : 'live');
  const newKeyHash = await hashClientKey(newClientKey);

  const nowIsoStr = new Date().toISOString();

  // Criar novo registro de clientkey
  try {
    await env.QAGENT_KV.put(`clientkey:${newKeyHash}`, JSON.stringify({
      keyHash: newKeyHash,
      customerId: user.customerId,
      label: 'rotated',
      clientKeyPrefix: String(newClientKey).slice(0, 12),
      createdAt: nowIsoStr,
      lastUsedAt: null,
      revokedAt: null,
    }));
  } catch (e) {
    log('rotate_clientkey_new_put_error', { message: e?.message || String(e), userId: user.userId });
    const err = new Error('Falha ao salvar nova clientKey.');
    err.status = 500;
    throw err;
  }

  // Marcar clientKey antiga como revogada, se existir
  try {
    const oldRaw = await env.QAGENT_KV.get(`clientkey:${currentKeyHash}`);
    if (oldRaw) {
      const old = JSON.parse(oldRaw);
      old.revokedAt = nowIsoStr;
      await env.QAGENT_KV.put(`clientkey:${currentKeyHash}`, JSON.stringify(old));
    }
  } catch (e) {
    log('rotate_clientkey_old_mark_error', { message: e?.message || String(e), userId: user.userId });
  }

  // Regravar licença para o novo keyHash, preservando status/plano/expiração
  try {
    const newLicense = {
      ...currentLicense,
      // mantém licenseId, status, plan, datas; apenas atualiza timestamps
      updatedAt: nowIsoStr,
    };

    await env.QAGENT_KV.put(`license:${newKeyHash}`, JSON.stringify(newLicense));

    // marcar antiga como revogada para evitar uso da chave anterior
    const oldLicense = {
      ...currentLicense,
      status: 'revoked',
      updatedAt: nowIsoStr,
    };
    await env.QAGENT_KV.put(`license:${currentKeyHash}`, JSON.stringify(oldLicense));
  } catch (e) {
    log('rotate_clientkey_license_error', { message: e?.message || String(e), userId: user.userId });
    const err = new Error('Falha ao atualizar licença durante rotação de chave.');
    err.status = 500;
    throw err;
  }

  // Atualizar índice de email -> keyHash
  try {
    const idxKey = customerEmailIndexKey(email);
    await env.QAGENT_KV.put(idxKey, JSON.stringify({
      customerId: user.customerId,
      keyHash: newKeyHash,
      updatedAt: nowIsoStr,
    }));
  } catch (e) {
    log('rotate_clientkey_email_index_error', { message: e?.message || String(e), userId: user.userId });
  }

  const expiresAt = currentLicense.expiresAt || currentLicense.trialEndsAt || null;

  return json(
    {
      status: 'ok',
      clientKey: newClientKey,
      license: {
        status: currentLicense.status,
        plan: currentLicense.plan,
        expiresAt,
        daysLeft: daysLeft(expiresAt),
      },
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleSignupTrial(req, env) {
  const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 25_000);
  const body = await readJsonWithLimit(req, maxBytes);
  validateSignupTrialBody(body);

  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  const email = String(body.email || '').trim().toLowerCase();

  // Verifica se já existe usuário/cliente com este email e trial/active válido
  const existing = await getCustomerByEmail(env, email);
  if (existing?.keyHash) {
    const existingLicense = await getLicenseByKeyHash(env, existing.keyHash);
    if (existingLicense) {
      const existingExpiry = existingLicense.trialEndsAt || existingLicense.expiresAt;
      const activeTrial = existingLicense.status === 'trial' && daysLeft(existingExpiry) > 0;
      if (activeTrial || existingLicense.status === 'active') {
        return json(
          { status: 'error', message: 'Email já cadastrado com trial ativo.' },
          { status: 409, headers: corsHeaders(req, env) }
        );
      }
    }
  }

  const existingUser = await getUserByEmail(env, email);
  if (existingUser) {
    return json(
      { status: 'error', message: 'Conta já existente para este email.' },
      { status: 409, headers: corsHeaders(req, env) }
    );
  }

  const keyMode = String(env?.CLIENT_KEY_MODE || '').toLowerCase() || ((env.ENVIRONMENT || 'production') === 'production' ? 'live' : 'test');
  const clientKey = generateClientKey(keyMode === 'test' ? 'test' : 'live');
  const keyHash = await hashClientKey(clientKey);

  const customer = await createCustomer(env, {
    email,
    name: body.name,
    company: body.company,
    source: body.source || 'landing-page',
    keyHash,
  });

  const createdAt = new Date().toISOString();
  await env.QAGENT_KV.put(`clientkey:${keyHash}`, JSON.stringify({
    keyHash,
    customerId: customer.customerId,
    label: 'signup-trial',
    clientKeyPrefix: String(clientKey).slice(0, 12),
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
  }));

  const license = await createTrialLicenseForKeyHash(env, {
    keyHash,
    customerId: customer.customerId,
    plan: 'pro',
  });

   // Se senha foi enviada, cria conta de usuário vinculada ao customerId
  let user = null;
  if (body.password && body.passwordConfirmation) {
    const passwordBundle = await hashPassword(body.password);
    try {
      user = await createUser(env, {
        email,
        passwordBundle,
        customerId: customer.customerId,
      });
    } catch (e) {
      // Se falhar na criação do usuário (por exemplo, corrida de email duplicado),
      // loga e segue apenas com trial, sem bloquear signup.
      log('signup_user_create_error', { message: e?.message || String(e), email });
    }
  }

  const emailEvent = buildSignupEmailEvent({
    customerId: customer.customerId,
    email: customer.email,
    keyHash,
    template: 'trial_welcome',
  });
  await savePendingEmailEvent(env, emailEvent);

  const dispatchPromise = sendEmailEvent(env, emailEvent);

  return {
    response: json(
      {
        status: 'ok',
        version: API_CONTRACT_VERSION,
        customer: {
          customerId: customer.customerId,
          email: customer.email,
        },
        license: {
          status: license.status,
          plan: license.plan,
          trialEndsAt: license.trialEndsAt || license.expiresAt,
          daysLeft: daysLeft(license.trialEndsAt || license.expiresAt),
        },
        credentials: {
          clientKey,
          delivery: 'webhook:email',
        },
        user: user
          ? {
              userId: user.userId,
              email: user.email,
            }
          : null,
      },
      { status: 201, headers: corsHeaders(req, env) }
    ),
    dispatchPromise,
  };
}

async function handleEmailDispatchedWebhook(req, env) {
  const rawBody = await req.clone().text();
  await verifyWebhookSignatureOrThrow({
    env,
    route: '/v1/webhooks/email-dispatched',
    signatureHeader: req.headers.get('X-QAgent-Signature') || '',
    rawBody,
  });

  const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 25_000);
  const body = await readJsonWithLimit(req, maxBytes);
  validateEmailDispatchedBody(body);

  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  const saved = await saveEmailDispatchAck(env, body);
  if (!saved.created) {
    return json({ status: 'ok', processed: false, idempotent: true }, { status: 200, headers: corsHeaders(req, env) });
  }

  await markEmailEventStatus(env, body.eventId, 'confirmed', {
    confirmedAt: new Date().toISOString(),
    template: body.template,
  });

  return json({ status: 'ok', processed: true }, { status: 200, headers: corsHeaders(req, env) });
}

async function handleBillingPlans(req, env) {
  // Catálogo estático inicial de planos. Pode ser evoluído futuramente
  // para vir de configuração/Stripe, mas o formato de resposta se mantém.
  const plans = [
    {
      // espelha a estrutura principal de um produto Stripe real
      id: 'prod_UG0Cu5h8WgxhZq',
      object: 'product',
      active: true,
      attributes: [],
      created: 1771730829,
      default_price: 'price_1THUBcBjKnMOesshCRjxaX0L',
      description: 'Acesso ao QAgent, plataforma de inteligência para testes de software, geração de casos de teste e automação de evidências.',
      images: [
        'https://files.stripe.com/links/MDB8YWNjdF8xVDJiSElCaktuTU9lc3NofGZsX2xpdmVfVDQ5dWpSOHVZSElRdjJsOWR0UjBkakhU0017ebV9Pt',
      ],
      livemode: true,
      marketing_features: [],
      metadata: {},
      name: 'QAgent',
      package_dimensions: null,
      shippable: null,
      statement_descriptor: null,
      tax_code: null,
      type: 'service',
      unit_label: null,
      updated: 1771730830,
      url: null,

      // campos adicionais específicos do nosso catálogo
      priceId: 'price_1THUBcBjKnMOesshCRjxaX0L',
      price: '49,99',
      currency: 'BRL',
      mensagem: 'Produto destinado a pessoa física.',
    }
  ];

  return json(
    {
      status: 'ok',
      plans,
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleBillingCheckout(req, env) {
  const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 12_000);
  const body = await readJsonWithLimit(req, maxBytes);

  const clientKey = body.clientKey || getBearerToken(req) || null;
  if (!clientKey) {
    const err = new Error('clientKey ausente para criar Checkout Session.');
    err.status = 400;
    throw err;
  }

  const priceId = body.priceId || env.STRIPE_PRICE_ID;
  if (!priceId) {
    const err = new Error('priceId ausente (body.priceId ou env.STRIPE_PRICE_ID).');
    err.status = 500;
    throw err;
  }

  const successUrl = body.successUrl || env.STRIPE_SUCCESS_URL || `${new URL(req.url).origin}/billing/success`;
  const cancelUrl = body.cancelUrl || env.STRIPE_CANCEL_URL || `${new URL(req.url).origin}/billing/cancel`;

  const quantity = Number(body.quantity || 1);

  const session = await createCheckoutSession(env, { clientKey, priceId, successUrl, cancelUrl, quantity, metadata: body.metadata || {} });

  return json({ status: 'ok', sessionId: session.id, url: session.url || null }, { headers: corsHeaders(req, env) });
}

async function handlePaymentWebhook(req, env) {
  // Support Stripe webhooks when STRIPE_WEBHOOK_SECRET is configured and header present
  const stripeSig = req.headers.get('Stripe-Signature') || req.headers.get('stripe-signature');
  let body = null;
  if (stripeSig && env.STRIPE_WEBHOOK_SECRET) {
    const verify = await verifyStripeWebhook(req, env);
    if (!verify.ok) {
      const err = new Error('Stripe webhook signature inválida: ' + (verify.reason || 'unknown'));
      err.status = 403;
      throw err;
    }
    try {
      const parsed = JSON.parse(verify.payloadText);
      body = normalizeStripeEvent(parsed);
    } catch (e) {
      const err = new Error('Falha ao parsear payload Stripe.');
      err.status = 400;
      throw err;
    }
  } else {
    const rawBody = await req.clone().text();
    await verifyWebhookSignatureOrThrow({
      env,
      route: '/v1/webhooks/payment',
      signatureHeader: req.headers.get('X-QAgent-Signature') || '',
      rawBody,
    });

    const maxBytes = getEnvNum(env, 'MAX_BODY_BYTES', 25_000);
    body = await readJsonWithLimit(req, maxBytes);

    // If occurredAt missing/empty, default to now so validation passes for test clients
    if (!body.occurredAt) body.occurredAt = new Date().toISOString();

    // Allow supplying clientKey via HTTP header for testing convenience
    try {
      const headerClientKey = req.headers.get('clientKey') || req.headers.get('ClientKey') || req.headers.get('x-client-key');
      if (headerClientKey && (!body.reference || !body.reference.clientKey)) {
        body.reference = body.reference || {};
        body.reference.clientKey = headerClientKey;
      }
    } catch (e) {
      // ignore header parse errors
    }

    validatePaymentWebhookBody(body);
  }

  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  let keyHash = null;
  if (body?.reference?.clientKey) {
    try {
      keyHash = await hashClientKey(body.reference.clientKey);
    } catch {
      keyHash = null;
    }
  }

  // If the webhook didn't include clientKey, attempt KV reconciliation
  // by looking up stripe:cust:<providerCustomerId> or stripe:sub:<providerSubscriptionId>
  // which may have been written previously when a checkout/session included metadata.clientKey.
  if (!keyHash && env?.QAGENT_KV) {
    try {
      const provCust = body?.reference?.providerCustomerId || null;
      const provSub = body?.reference?.providerSubscriptionId || null;
      if (provCust) {
        const found = await env.QAGENT_KV.get(`stripe:cust:${provCust}`);
        if (found) keyHash = found;
      }
      if (!keyHash && provSub) {
        const foundSub = await env.QAGENT_KV.get(`stripe:sub:${provSub}`);
        if (foundSub) keyHash = foundSub;
      }
    } catch (e) {
      log('stripe_mapping_lookup_error', { message: e?.message || String(e) });
    }
  }

  // Persist mapping from Stripe customer/subscription -> keyHash when available
  try {
    if (env?.QAGENT_KV && keyHash) {
      const provCust = body?.reference?.providerCustomerId || null;
      const provSub = body?.reference?.providerSubscriptionId || null;
      if (provCust) await env.QAGENT_KV.put(`stripe:cust:${provCust}`, keyHash);
      if (provSub) await env.QAGENT_KV.put(`stripe:sub:${provSub}`, keyHash);
    }
  } catch (e) {
    log('stripe_mapping_save_error', { message: e?.message || String(e) });
  }

  const toSave = {
    provider: body.provider,
    eventId: body.eventId,
    type: body.eventType,
    customerId: body?.customer?.customerId || null,
    keyHash,
    rawRef: {
      clientKeyPrefix: body?.reference?.clientKey ? String(body.reference.clientKey).slice(0, 12) : null,
      providerCustomerId: body?.reference?.providerCustomerId || null,
      providerSubscriptionId: body?.reference?.providerSubscriptionId || null,
    },
    billing: body.billing,
    occurredAt: body.occurredAt,
    status: 'processed',
  };

  const transition = await applyPaymentToLicense(env, {
    keyHash,
    paymentPayload: body,
  });

  toSave.transition = {
    updated: transition.updated,
    blocked: transition.blocked,
    reason: transition.reason,
    finalStatus: transition.license?.status || null,
  };

  const saved = await savePaymentEvent(env, toSave);
  if (!saved.created) {
    return json({ status: 'ok', processed: false, idempotent: true }, { status: 200, headers: corsHeaders(req, env) });
  }

  // If payment caused a license activation, generate a 30-day access token
  // and enqueue an email event to deliver it. Respect idempotency by relying
  // on savePaymentEvent(created=true) which guarantees this block runs once.
  let dispatchPromise = null;
  try {
    const finalStatus = transition.license?.status || null;
    if (transition.updated && !transition.blocked && finalStatus === 'active') {
      try {
        const token = generateAccessToken('access', 48);
        const tokenHash = await hashAccessToken(token);
        const issuedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        // Persist token hash in KV
        try {
          await env.QAGENT_KV.put(`access_token:${tokenHash}`, JSON.stringify({ keyHash, issuedAt, expiresAt, eventId: body.eventId }));
        } catch (e) {
          log('access_token_kv_put_error', { message: e?.message || String(e) });
        }

        // Build email event to send token to customer email. If email is missing
        // in the payload, attempt to lookup via customerId or clientkey mapping.
        let email = body?.customer?.email || null;
        let customerId = body?.customer?.customerId || null;

        if (!email) {
          // try direct lookup by customerId
          if (customerId) {
            try {
              const cust = await getCustomerById(env, customerId);
              if (cust?.email) email = cust.email;
            } catch (e) {
              log('customer_lookup_error', { message: e?.message || String(e), customerId });
            }
          }
        }

        if (!email && keyHash) {
          try {
            const ckRaw = await env.QAGENT_KV.get(`clientkey:${keyHash}`);
            if (ckRaw) {
              try {
                const ck = JSON.parse(ckRaw);
                if (!customerId && ck?.customerId) customerId = ck.customerId;
              } catch {}
            }
            if (customerId) {
              const cust = await getCustomerById(env, customerId);
              if (cust?.email) email = cust.email;
            }
          } catch (e) {
            log('clientkey_lookup_error', { message: e?.message || String(e), keyHash });
          }
        }

        if (email) {
          const evt = buildSignupEmailEvent({ customerId, email, keyHash, template: 'paid_access_token' });
          // include raw token only in metadata for dispatcher (avoid storing elsewhere)
          evt.metadata = { ...(evt.metadata || {}), token };
          await savePendingEmailEvent(env, evt);

          // dispatch via adapter (webhook or MailerSend)
          dispatchPromise = sendEmailEvent(env, evt);
        } else {
          log('paid_access_token_no_email', { eventId: body.eventId, keyHash, customerId });
        }
      } catch (e) {
        log('generate_access_token_error', { message: e?.message || String(e) });
      }
    }
  } catch (e) {
    log('access_token_flow_error', { message: e?.message || String(e) });
  }

  const response = json(
    {
      status: 'ok',
      processed: true,
      idempotent: false,
      transition: {
        updated: transition.updated,
        blocked: transition.blocked,
        reason: transition.reason,
        finalStatus: transition.license?.status || null,
      },
    },
    { status: 200, headers: corsHeaders(req, env) }
  );

  if (dispatchPromise) {
    return { response, dispatchPromise };
  }

  return response;
}


export default {
  async fetch(req, env, ctx) {
    // LOG TEMPORÁRIO: Verifica se a OPENAI_API_KEY está presente no ambiente
    log('env_openai_key_present', { present: !!env.OPENAI_API_KEY });
    try {
      const url = new URL(req.url);
      
      // Página de Política de Privacidade (público, sem token)
      if (url.pathname === "/privacy-policy" && req.method === "GET") {
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
      // Auth: login e info da sessão
      if (url.pathname === "/v1/auth/login" && req.method === "POST") {
        return await handleAuthLogin(req, env);
      }
      if (url.pathname === "/v1/auth/forgot-password" && req.method === "POST") {
        return await handleForgotPassword(req, env);
      }
      if (url.pathname === "/v1/auth/reset-password" && req.method === "POST") {
        return await handleResetPassword(req, env);
      }
      if (url.pathname === "/v1/auth/me" && req.method === "GET") {
        return await handleAuthMe(req, env);
      }
      if (url.pathname === "/v1/console/license" && req.method === "GET") {
        return await handleConsoleLicense(req, env);
      }
      if (url.pathname === "/v1/console/payments" && req.method === "GET") {
        return await handleConsolePayments(req, env);
      }
      if (url.pathname === "/v1/console/rotate-clientkey" && req.method === "POST") {
        return await handleRotateClientKey(req, env);
      }
      // Debug payment event: /debug/payment-event/:provider/:eventId
      if (url.pathname.startsWith('/debug/payment-event/') && req.method === 'GET') {
        const segs = url.pathname.split('/').slice(1); // ['debug','payment-event','provider','eventId']
        if (segs.length === 4 && segs[0] === 'debug' && segs[1] === 'payment-event') {
          const provider = segs[2];
          const eventId = segs[3];
          return await handleDebugPaymentEvent(req, env, provider, eventId);
        }
        return json({ ok: false, message: 'invalid debug path' }, { status: 400, headers: corsHeaders(req, env) });
      }
      // get pagamentos 
      if (url.pathname === "/v1/license" && req.method === "GET") {
        return await handleGetLicense(req, env);
      }
      if (url.pathname === "/v1/signup-trial" && req.method === "POST") {
        const result = await handleSignupTrial(req, env);
        if (result instanceof Response) {
          return result;
        }
        if (ctx?.waitUntil && result?.dispatchPromise) {
          ctx.waitUntil(result.dispatchPromise);
        } else if (result?.dispatchPromise) {
          result.dispatchPromise.catch((e) => log('email_dispatch_async_error', { message: e?.message || String(e) }));
        }
        return result.response;
      }
      if (url.pathname === "/v1/billing/plans" && req.method === "GET") {
        return await handleBillingPlans(req, env);
      }
      if (url.pathname === "/v1/billing/checkout" && req.method === "POST") {
        return await handleBillingCheckout(req, env);
      }
      if (url.pathname === "/v1/webhooks/email-dispatched" && req.method === "POST") {
        return await handleEmailDispatchedWebhook(req, env);
      }
      if (url.pathname === "/v1/webhooks/payment" && req.method === "POST") {
        const result = await handlePaymentWebhook(req, env);
        if (result instanceof Response) {
          return result;
        }
        if (ctx?.waitUntil && result?.dispatchPromise) {
          ctx.waitUntil(result.dispatchPromise);
        } else if (result?.dispatchPromise) {
          result.dispatchPromise.catch((e) => log('email_dispatch_async_error', { message: e?.message || String(e) }));
        }
        return result.response;
      }
      // generate-tests: só POST
      if (url.pathname === "/v1/generate-tests" && req.method === "POST") {
        // Autenticação: Authorization: Bearer <clientKey> (ou token legado, respeitando janela de migração)
        const token = getBearerToken(req) || (req.headers.get('X-QAgent-License') || '').trim();
        validateToken(env, token);

        const credentialType = validateClientKeyFormat(token) ? 'client_key' : 'legacy_token';
        const migrationPolicy = resolveLegacyPolicyForRequest(req, env);

        if (credentialType === 'legacy_token' && !migrationPolicy.legacyAllowed) {
          await trackMigrationMetric(env, {
            tenant: migrationPolicy.tenantId,
            cohort: migrationPolicy.cohortId,
            credentialType,
            statusCode: 403,
            legacyAccepted: false,
            legacyBlocked: true,
          });
          const err = new Error('Token legado desabilitado. Atualize para clientKey.');
          err.status = 403;
          throw err;
        }

        const license = await getOrCreateLicense(env, token);
        assertPremiumAllowed(license);

        await trackMigrationMetric(env, {
          tenant: migrationPolicy.tenantId,
          cohort: migrationPolicy.cohortId,
          credentialType,
          statusCode: 200,
          legacyAccepted: credentialType === 'legacy_token',
          legacyBlocked: false,
        });

        // Inject openaiClient and rateLimiter (rate-limit por clientKey/token já autenticado)
        const rateLimiter = (_token, windowMs, max) => rateLimitOrThrow({ key: `t:${safeId(token)}`, windowMs, max });
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
      // Log detalhado de erro para debug
      log('error_catch', {
        message: e?.message || String(e),
        status: e?.status || 500,
        stack: e?.stack || null,
        retryAfterMs: e?.retryAfterMs || null,
        detail: e?._detail || null,
      });
      const status = e?.status || 500;
      const headers = corsHeaders(req, env, status === 429 && e.retryAfterMs ? { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } : {});
      return json({ status: "error", message: e?.message || String(e), stack: e?.stack || null, detail: e?._detail || null }, { status, headers });
    }
  },
};

// Named exports for testing - COMMENTED OUT porque Wrangler requer apenas ExportedHandler
// Movido para test/test-utils.js se necessário
/*
export {
  corsHeaders,
  validateGenerateTestsBody,
  validateAutofillBody,
  validateSignupTrialBody,
  validateEmailDispatchedBody,
  validatePaymentWebhookBody,
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
  // contracts
  API_CONTRACT_VERSION,
};
*/
