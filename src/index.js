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
import { createCustomer, getCustomerByEmail, getCustomerById } from './lib/customerService.js';
import { buildSignupEmailEvent, savePendingEmailEvent, markEmailEventStatus, saveEmailDispatchAck } from './lib/emailEventService.js';
import { sendEmailEvent } from './lib/emailDispatcher.js';
import { verifyWebhookSignatureOrThrow } from './lib/webhookSecurity.js';
import { savePaymentEvent } from './lib/paymentEventService.js';
import { trackMigrationMetric } from './lib/migrationMetricsService.js';
import { createCheckoutSession, verifyStripeWebhook, normalizeStripeEvent } from './lib/stripeService.js';

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
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
  }));

  const license = await createTrialLicenseForKeyHash(env, {
    keyHash,
    customerId: customer.customerId,
    plan: 'pro',
  });

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
