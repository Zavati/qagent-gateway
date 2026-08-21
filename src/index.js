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

import { getEnvNum } from './lib/config.js';
import { corsHeaders } from './lib/http.js';
import { safeId, isAdminToken, generateClientKey, hashClientKey, validateClientKeyFormat, generateAccessToken, hashAccessToken } from './lib/keyService.js';
import { getOrCreateLicense, assertPremiumAllowed, daysLeft, createTrialLicenseForKeyHash, getLicenseByKeyHash, applyPaymentToLicense } from './lib/licenseService.js';
import { createCustomer, getCustomerByEmail, getCustomerById, customerEmailIndexKey } from './lib/customerService.js';
import { buildSignupEmailEvent, savePendingEmailEvent, markEmailEventStatus, saveEmailDispatchAck } from './lib/emailEventService.js';
import { sendEmailEvent } from './lib/emailDispatcher.js';
import { verifyWebhookSignatureOrThrow } from './lib/webhookSecurity.js';
import { getPaymentEvent, savePaymentEvent } from './lib/paymentEventService.js';
import { trackMigrationMetric } from './lib/migrationMetricsService.js';
import { createCheckoutSession, verifyStripeWebhook, normalizeStripeEvent } from './lib/stripeService.js';
import { hashPassword, verifyPassword } from './lib/passwords.js';
import { createUser, getUserByEmail, getUserById, updateUserLoginStats, updateUserPassword } from './lib/userService.js';
import { createSessionToken, verifySessionToken } from './lib/sessionTokens.js';
import { provisionSignupTenant } from './services/accountTenantProvisioningService.js';

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
import { sanitizeString } from './lib/sanitize.js';
import { fetchTextWithTimeout } from './lib/openai.js';
import { handleGenerateTests as generateTestsHandler } from './handlers/generateTests.js';
import { aiEngine } from './ai/aiEngine.js';
import { generateAutofillActions } from './services/autofillAiService.js';
import { getConsoleAiProviders, getConsoleAiConfig, putConsoleAiConfig, deleteConsoleAiConfig } from './handlers/consoleAiConfig.js';
import { postPluginSession } from './handlers/pluginSession.js';
import { postPluginObservationGrant } from './handlers/pluginObservationGrant.js';
import {
  getConsoleOrganization, patchConsoleOrganization,
  listConsoleProjects, createConsoleProject, getConsoleProject, patchConsoleProject, deleteConsoleProject,
  listConsoleEnvironments, createConsoleEnvironment, getConsoleEnvironment, patchConsoleEnvironment, deleteConsoleEnvironment,
} from './handlers/consoleDataArchitecture.js';
import {
  listConsoleApiServices, createConsoleApiService, getConsoleApiService, patchConsoleApiService, deleteConsoleApiService,
  listConsoleEnvironmentApiBindings, getConsoleEnvironmentApiBinding, putConsoleEnvironmentApiBinding, deleteConsoleEnvironmentApiBinding,
  listConsoleEnvironmentVariables, createConsoleEnvironmentVariable, getConsoleEnvironmentVariable, patchConsoleEnvironmentVariable, deleteConsoleEnvironmentVariable,
  getConsoleEnvironmentRuntimeConfig,
} from './handlers/consoleEnvironmentConfig.js';
import {
  listConsoleSecrets, createConsoleSecret, getConsoleSecret, patchConsoleSecret, putConsoleSecretValue, deleteConsoleSecret,
  listConsoleAuthProfiles, createConsoleAuthProfile, getConsoleAuthProfile, patchConsoleAuthProfile, deleteConsoleAuthProfile,
  listConsoleAuthProfileEnvironmentBindings, getConsoleAuthProfileEnvironmentBinding, putConsoleAuthProfileEnvironmentBinding, deleteConsoleAuthProfileEnvironmentBinding,
} from './handlers/consoleAuthProfiles.js';

import {
  getConsoleCatalogSummary,
  listConsoleCatalogServices,
  listConsoleCatalogEndpoints,
  getConsoleCatalogEndpoint,
  listConsoleCatalogEndpointEvidence,
  getConsoleCatalogEndpointSchemas,
  listConsoleCatalogEndpointLifecycleHistory,
} from './handlers/consoleCatalog.js';
import { getConsoleTestDesign, getConsoleTestDesignContext, postConsoleTestDesign } from './handlers/consoleIntelligence.js';
import { postConsoleRun, getConsoleRun } from './handlers/consoleRuns.js';
import {
  getInternalRunnerRunBundle,
  postInternalRunnerClaim,
  postInternalRunnerHeartbeat,
  postInternalRunnerReceived,
  postInternalRunnerRetry,
} from './handlers/internalRunnerControl.js';
import { validateAutofillBody, validateSignupTrialBody, validateEmailDispatchedBody, validatePaymentWebhookBody } from './lib/validators.js';
import { API_CONTRACT_VERSION } from './lib/contracts.js';
import { dispatchGatewayRoute } from './routing/gatewayRouter.js';

// (validators are imported from ./lib/validators.js) 

// heuristics implementation moved to ./lib/heuristics.js


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

  log('autofill', {
    token: safeId(token),
    url: sanitizeString(body.url, 2000),
    elements: Math.min(200, (body.elements || []).length),
    aiConfigScope: license?.customerId ? 'account' : 'environment',
  });

  const result = await generateAutofillActions(body, env, { aiEngine, log, accountId: license?.customerId || null });
  return json(result, { headers: corsHeaders(req, env) });
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
    // Prioriza leitura por customerId do usuário, varrendo todas as clientKeys
    // associadas ao cliente para evitar divergência quando há múltiplas chaves.
    const keyHashes = new Set();
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

    const rankStatus = (s) => {
      const status = String(s || '').toLowerCase();
      if (status === 'active') return 5;
      if (status === 'trial') return 4;
      if (status === 'grace_period') return 3;
      if (status === 'past_due') return 2;
      if (status === 'expired') return 1;
      return 0;
    };

    let best = null;
    for (const keyHash of keyHashes) {
      const lic = await getLicenseByKeyHash(env, keyHash);
      if (!lic) continue;
      const expiresAt = lic.expiresAt || lic.trialEndsAt || null;
      const candidate = {
        status: lic.status,
        plan: lic.plan,
        expiresAt,
        daysLeft: daysLeft(expiresAt),
      };

      if (!best) {
        best = candidate;
        continue;
      }

      const rankA = rankStatus(candidate.status);
      const rankB = rankStatus(best.status);
      if (rankA > rankB) {
        best = candidate;
        continue;
      }
      if (rankA === rankB) {
        const ta = Date.parse(candidate.expiresAt || '') || 0;
        const tb = Date.parse(best.expiresAt || '') || 0;
        if (ta > tb) best = candidate;
      }
    }

    if (best) {
      licenseSummary = best;
    } else {
      // fallback legado por email (mantém compatibilidade)
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

   // Se senha foi enviada, cria a conta de usuário vinculada ao customerId.
  // O fluxo legado sem senha continua suportado, mas uma conta real do Console
  // só é considerada provisionada quando também existir Organization + owner.
  let user = null;
  let tenant = null;
  if (body.password && body.passwordConfirmation) {
    const passwordBundle = await hashPassword(body.password);
    try {
      user = await createUser(env, {
        email,
        passwordBundle,
        customerId: customer.customerId,
      });
    } catch (e) {
      // Mantém compatibilidade com o comportamento anterior do trial, porém
      // sem tentar provisionar tenant quando o usuário não foi criado.
      log('signup_user_create_error', { message: e?.message || String(e), email });
    }

    if (user) {
      try {
        tenant = await provisionSignupTenant(env, { customer, user });
      } catch (e) {
        log('signup_tenant_provision_error', {
          message: e?.message || String(e),
          code: e?.code || null,
          customerId: customer.customerId,
          userId: user.userId,
        });
        const err = new Error('Conta criada, mas não foi possível provisionar a organização. Tente novamente após validar o Data DB.');
        err.status = e?.status || 500;
        err.code = e?.code || 'SIGNUP_TENANT_PROVISION_FAILED';
        throw err;
      }
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
        organization: tenant
          ? {
              organizationId: tenant.organization.organizationId,
              name: tenant.organization.name,
              role: tenant.membership.role,
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

  const bodyClientKey = typeof body.clientKey === 'string' ? body.clientKey.trim() : '';
  const bearerToken = (getBearerToken(req) || '').trim();
  const clientKey = bodyClientKey || bearerToken || null;
  if (!clientKey || !validateClientKeyFormat(clientKey)) {
    const err = new Error('clientKey inválida/ausente para criar Checkout Session. Envie body.clientKey no formato qag_...');
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

  // Stripe sends several events that are useful for observability but must not
  // alter entitlements (for example payment_intent.succeeded). Acknowledge them
  // explicitly so they never fall through as a failed license transition.
  if (body?.processing?.action === 'ignore') {
    return json({
      status: 'ok',
      processed: false,
      ignored: true,
      eventType: body?.providerEventType || body?.eventType || 'unknown',
    }, { status: 200, headers: corsHeaders(req, env) });
  }

  // Exact Stripe event replay protection must happen BEFORE any license mutation.
  // Stripe may deliver the same Event more than once.
  const existingPaymentEvent = await getPaymentEvent(env, body.provider, body.eventId);
  if (existingPaymentEvent) {
    return json({ status: 'ok', processed: false, idempotent: true }, { status: 200, headers: corsHeaders(req, env) });
  }

  let keyHash = body?.reference?.keyHash || null;
  if (!keyHash && body?.reference?.clientKey) {
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

  if (body?.processing?.action === 'mapping_only') {
    const mappingEvent = {
      provider: body.provider,
      eventId: body.eventId,
      type: body.eventType,
      keyHash,
      rawRef: {
        providerCustomerId: body?.reference?.providerCustomerId || null,
        providerSubscriptionId: body?.reference?.providerSubscriptionId || null,
        providerInvoiceId: body?.reference?.providerInvoiceId || null,
      },
      billing: body.billing,
      occurredAt: body.occurredAt,
      status: 'processed',
      transition: { updated: false, blocked: false, reason: 'mapping_only', finalStatus: null },
    };
    await savePaymentEvent(env, mappingEvent);
    return json({
      status: 'ok',
      processed: true,
      idempotent: false,
      mappingOnly: true,
      transition: mappingEvent.transition,
    }, { status: 200, headers: corsHeaders(req, env) });
  }

  // A state-changing Stripe event without a resolvable QAgent account must be retried.
  // Webhook event order is not guaranteed; a later Checkout/Subscription event may
  // establish the mapping before Stripe's retry.
  if (!keyHash && body?.provider === 'stripe') {
    const err = new Error('Evento Stripe ainda não reconciliado com uma licença QAgent.');
    err.status = 503;
    throw err;
  }

  const toSave = {
    provider: body.provider,
    eventId: body.eventId,
    type: body.eventType,
    customerId: body?.customer?.customerId || null,
    keyHash,
    rawRef: {
      legacyClientKeyPresent: Boolean(body?.reference?.clientKey),
      providerCustomerId: body?.reference?.providerCustomerId || null,
      providerSubscriptionId: body?.reference?.providerSubscriptionId || null,
      providerInvoiceId: body?.reference?.providerInvoiceId || null,
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

  await savePaymentEvent(env, toSave);

  // If payment caused a license activation, generate a 30-day access token
  // and enqueue an email event to deliver it. Respect idempotency by relying
  // on savePaymentEvent(created=true) which guarantees this block runs once.
  let dispatchPromise = null;
  try {
    const finalStatus = transition.license?.status || null;
    if (body?.processing?.sendAccessToken === true && transition.updated && !transition.blocked && finalStatus === 'active') {
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


async function settleAsyncHandlerResult(result, ctx) {
  if (result instanceof Response) {
    return result;
  }

  if (ctx?.waitUntil && result?.dispatchPromise) {
    ctx.waitUntil(result.dispatchPromise);
  } else if (result?.dispatchPromise) {
    result.dispatchPromise.catch((e) => log('email_dispatch_async_error', { message: e?.message || String(e) }));
  }

  return result?.response || result;
}

async function handleGenerateTestsRoute(req, env) {
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

  const rateLimiter = (_token, windowMs, max) => rateLimitOrThrow({ key: `t:${safeId(token)}`, windowMs, max });
  const resp = await generateTestsHandler(req, env, { aiEngine, rateLimiter, accountId: license?.customerId || null });

  if (!resp.meta) resp.meta = {};
  resp.meta.model = resp.meta.model || resp.model || (resp.meta.engine || null);

  return json(resp, { headers: corsHeaders(req, env) });
}

const gatewayRouteHandlers = {
  health: (req, env) => json({ ok: true }, { status: 200, headers: corsHeaders(req, env) }),
  debugOpenAIModels: (_req, env) => handleDebugOpenAIModels(env),
  authLogin: (req, env) => handleAuthLogin(req, env),
  forgotPassword: (req, env) => handleForgotPassword(req, env),
  resetPassword: (req, env) => handleResetPassword(req, env),
  authMe: (req, env) => handleAuthMe(req, env),
  pluginSessionCreate: async (req, env) => json(await postPluginSession(req, env), { status: 201, headers: corsHeaders(req, env) }),
  pluginObservationGrantCreate: async (req, env) => json(await postPluginObservationGrant(req, env), { status: 201, headers: corsHeaders(req, env) }),
  consoleLicense: (req, env) => handleConsoleLicense(req, env),
  consolePayments: (req, env) => handleConsolePayments(req, env),
  consoleAiProvidersGet: async (req, env) => json(await getConsoleAiProviders(req, env), { headers: corsHeaders(req, env) }),
  consoleAiConfigGet: async (req, env) => json(await getConsoleAiConfig(req, env), { headers: corsHeaders(req, env) }),
  consoleAiConfigPut: async (req, env) => json(await putConsoleAiConfig(req, env), { headers: corsHeaders(req, env) }),
  consoleAiConfigDelete: async (req, env) => json(await deleteConsoleAiConfig(req, env), { headers: corsHeaders(req, env) }),
  consoleOrganizationGet: async (req, env) => json(await getConsoleOrganization(req, env), { headers: corsHeaders(req, env) }),
  consoleOrganizationPatch: async (req, env) => json(await patchConsoleOrganization(req, env), { headers: corsHeaders(req, env) }),
  consoleProjectsList: async (req, env) => json(await listConsoleProjects(req, env), { headers: corsHeaders(req, env) }),
  consoleProjectsCreate: async (req, env) => json(await createConsoleProject(req, env), { status: 201, headers: corsHeaders(req, env) }),
  consoleProjectGet: async (req, env, _ctx, params) => json(await getConsoleProject(req, env, params), { headers: corsHeaders(req, env) }),
  consoleProjectPatch: async (req, env, _ctx, params) => json(await patchConsoleProject(req, env, params), { headers: corsHeaders(req, env) }),
  consoleProjectDelete: async (req, env, _ctx, params) => json(await deleteConsoleProject(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentsList: async (req, env, _ctx, params) => json(await listConsoleEnvironments(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentsCreate: async (req, env, _ctx, params) => json(await createConsoleEnvironment(req, env, params), { status: 201, headers: corsHeaders(req, env) }),
  consoleEnvironmentGet: async (req, env, _ctx, params) => json(await getConsoleEnvironment(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentPatch: async (req, env, _ctx, params) => json(await patchConsoleEnvironment(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentDelete: async (req, env, _ctx, params) => json(await deleteConsoleEnvironment(req, env, params), { headers: corsHeaders(req, env) }),
  consoleCatalogSummary: (req, env, _ctx, params) => getConsoleCatalogSummary(req, env, params),
  consoleCatalogServicesList: (req, env, _ctx, params) => listConsoleCatalogServices(req, env, params),
  consoleCatalogEndpointsList: (req, env, _ctx, params) => listConsoleCatalogEndpoints(req, env, params),
  consoleCatalogEndpointGet: (req, env, _ctx, params) => getConsoleCatalogEndpoint(req, env, params),
  consoleCatalogEndpointEvidenceList: (req, env, _ctx, params) => listConsoleCatalogEndpointEvidence(req, env, params),
  consoleCatalogEndpointSchemasGet: (req, env, _ctx, params) => getConsoleCatalogEndpointSchemas(req, env, params),
  consoleCatalogEndpointLifecycleHistoryList: (req, env, _ctx, params) => listConsoleCatalogEndpointLifecycleHistory(req, env, params),
  consoleIntelligenceTestDesignContextGet: async (req, env, _ctx, params) => json(await getConsoleTestDesignContext(req, env, params), { headers: corsHeaders(req, env) }),
  consoleIntelligenceTestDesignGet: async (req, env, _ctx, params) => json(await getConsoleTestDesign(req, env, params), { headers: corsHeaders(req, env) }),
  consoleIntelligenceTestDesignPost: async (req, env, _ctx, params) => json(await postConsoleTestDesign(req, env, params, { rateLimiter: ({ key, windowMs, max }) => rateLimitOrThrow({ key, windowMs, max }) }), { headers: corsHeaders(req, env) }),
  internalRunnerRunBundleGet: async (req, env, _ctx, params) => json(await getInternalRunnerRunBundle(req, env, params), { headers: corsHeaders(req, env) }),
  internalRunnerRunClaimPost: async (req, env, _ctx, params) => json(await postInternalRunnerClaim(req, env, params), { headers: corsHeaders(req, env) }),
  internalRunnerRunHeartbeatPost: async (req, env, _ctx, params) => json(await postInternalRunnerHeartbeat(req, env, params), { headers: corsHeaders(req, env) }),
  internalRunnerRunRetryPost: async (req, env, _ctx, params) => json(await postInternalRunnerRetry(req, env, params), { headers: corsHeaders(req, env) }),
  internalRunnerRunReceivedPost: async (req, env, _ctx, params) => json(await postInternalRunnerReceived(req, env, params), { headers: corsHeaders(req, env) }),
  consoleRunsCreate: async (req, env, _ctx, params) => json(await postConsoleRun(req, env, params), { status: 201, headers: corsHeaders(req, env) }),
  consoleRunGet: async (req, env, _ctx, params) => json(await getConsoleRun(req, env, params), { headers: corsHeaders(req, env) }),
  consoleApiServicesList: async (req, env, _ctx, params) => json(await listConsoleApiServices(req, env, params), { headers: corsHeaders(req, env) }),
  consoleApiServicesCreate: async (req, env, _ctx, params) => json(await createConsoleApiService(req, env, params), { status: 201, headers: corsHeaders(req, env) }),
  consoleApiServiceGet: async (req, env, _ctx, params) => json(await getConsoleApiService(req, env, params), { headers: corsHeaders(req, env) }),
  consoleApiServicePatch: async (req, env, _ctx, params) => json(await patchConsoleApiService(req, env, params), { headers: corsHeaders(req, env) }),
  consoleApiServiceDelete: async (req, env, _ctx, params) => json(await deleteConsoleApiService(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentApiBindingsList: async (req, env, _ctx, params) => json(await listConsoleEnvironmentApiBindings(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentApiBindingGet: async (req, env, _ctx, params) => json(await getConsoleEnvironmentApiBinding(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentApiBindingPut: async (req, env, _ctx, params) => json(await putConsoleEnvironmentApiBinding(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentApiBindingDelete: async (req, env, _ctx, params) => json(await deleteConsoleEnvironmentApiBinding(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentVariablesList: async (req, env, _ctx, params) => json(await listConsoleEnvironmentVariables(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentVariablesCreate: async (req, env, _ctx, params) => json(await createConsoleEnvironmentVariable(req, env, params), { status: 201, headers: corsHeaders(req, env) }),
  consoleEnvironmentVariableGet: async (req, env, _ctx, params) => json(await getConsoleEnvironmentVariable(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentVariablePatch: async (req, env, _ctx, params) => json(await patchConsoleEnvironmentVariable(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentVariableDelete: async (req, env, _ctx, params) => json(await deleteConsoleEnvironmentVariable(req, env, params), { headers: corsHeaders(req, env) }),
  consoleEnvironmentRuntimeConfigGet: async (req, env, _ctx, params) => json(await getConsoleEnvironmentRuntimeConfig(req, env, params), { headers: corsHeaders(req, env) }),
  consoleSecretsList: async (req, env, _ctx, params) => json(await listConsoleSecrets(req, env, params), { headers: corsHeaders(req, env) }),
  consoleSecretsCreate: async (req, env, _ctx, params) => json(await createConsoleSecret(req, env, params), { status: 201, headers: corsHeaders(req, env) }),
  consoleSecretGet: async (req, env, _ctx, params) => json(await getConsoleSecret(req, env, params), { headers: corsHeaders(req, env) }),
  consoleSecretPatch: async (req, env, _ctx, params) => json(await patchConsoleSecret(req, env, params), { headers: corsHeaders(req, env) }),
  consoleSecretValuePut: async (req, env, _ctx, params) => json(await putConsoleSecretValue(req, env, params), { headers: corsHeaders(req, env) }),
  consoleSecretDelete: async (req, env, _ctx, params) => json(await deleteConsoleSecret(req, env, params), { headers: corsHeaders(req, env) }),
  consoleAuthProfilesList: async (req, env, _ctx, params) => json(await listConsoleAuthProfiles(req, env, params), { headers: corsHeaders(req, env) }),
  consoleAuthProfilesCreate: async (req, env, _ctx, params) => json(await createConsoleAuthProfile(req, env, params), { status: 201, headers: corsHeaders(req, env) }),
  consoleAuthProfileGet: async (req, env, _ctx, params) => json(await getConsoleAuthProfile(req, env, params), { headers: corsHeaders(req, env) }),
  consoleAuthProfilePatch: async (req, env, _ctx, params) => json(await patchConsoleAuthProfile(req, env, params), { headers: corsHeaders(req, env) }),
  consoleAuthProfileDelete: async (req, env, _ctx, params) => json(await deleteConsoleAuthProfile(req, env, params), { headers: corsHeaders(req, env) }),
  consoleAuthProfileEnvironmentBindingsList: async (req, env, _ctx, params) => json(await listConsoleAuthProfileEnvironmentBindings(req, env, params), { headers: corsHeaders(req, env) }),
  consoleAuthProfileEnvironmentBindingGet: async (req, env, _ctx, params) => json(await getConsoleAuthProfileEnvironmentBinding(req, env, params), { headers: corsHeaders(req, env) }),
  consoleAuthProfileEnvironmentBindingPut: async (req, env, _ctx, params) => json(await putConsoleAuthProfileEnvironmentBinding(req, env, params), { headers: corsHeaders(req, env) }),
  consoleAuthProfileEnvironmentBindingDelete: async (req, env, _ctx, params) => json(await deleteConsoleAuthProfileEnvironmentBinding(req, env, params), { headers: corsHeaders(req, env) }),
  rotateClientKey: (req, env) => handleRotateClientKey(req, env),
  debugPaymentEvent: (req, env, _ctx, params) => handleDebugPaymentEvent(req, env, params.provider, params.eventId),
  invalidDebugPaymentEvent: (req, env) => json({ ok: false, message: 'invalid debug path' }, { status: 400, headers: corsHeaders(req, env) }),
  getLicense: (req, env) => handleGetLicense(req, env),
  signupTrial: async (req, env, ctx) => settleAsyncHandlerResult(await handleSignupTrial(req, env), ctx),
  billingPlans: (req, env) => handleBillingPlans(req, env),
  billingCheckout: (req, env) => handleBillingCheckout(req, env),
  emailDispatchedWebhook: (req, env) => handleEmailDispatchedWebhook(req, env),
  paymentWebhook: async (req, env, ctx) => settleAsyncHandlerResult(await handlePaymentWebhook(req, env), ctx),
  generateTests: (req, env) => handleGenerateTestsRoute(req, env),
  autofill: (req, env) => handleAutofill(req, env),
};

export default {
  async fetch(req, env, ctx) {
    // LOG TEMPORÁRIO: registra o provider de IA resolvido no ambiente
    log('env_ai_provider', { provider: aiEngine.resolveProviderName(env) });
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

      const routedResponse = await dispatchGatewayRoute(req, env, ctx, gatewayRouteHandlers);
      if (routedResponse) {
        return routedResponse;
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
      const errorBody = { status: "error", code: e?.code || null, message: e?.message || String(e) };
      if (e?.publicDetails && typeof e.publicDetails === "object") errorBody.details = e.publicDetails;
      return json(errorBody, { status, headers });
    }
  },
};
