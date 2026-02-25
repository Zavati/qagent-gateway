import { isAdminToken, safeId, hashClientKey, validateClientKeyFormat } from './keyService.js';

const TRIAL_DAYS = 6;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

// Duração padrão de licença paga quando o provedor não envia período explícito
const PAID_DAYS = 30;
const PAID_MS = PAID_DAYS * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function addMsToIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

export function daysLeft(expiresAt) {
  const exp = Date.parse(expiresAt || '');
  if (!Number.isFinite(exp)) return 0;
  const diff = exp - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function licenseKeyForToken(token) {
  return `license:t:${safeId(token)}`;
}

export function licenseKeyForKeyHash(keyHash) {
  return `license:${keyHash}`;
}

async function kvGetJson(env, key) {
  const raw = await env.QAGENT_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function kvPutJson(env, key, value) {
  await env.QAGENT_KV.put(key, JSON.stringify(value));
}

const ALLOWED_LICENSE_TRANSITIONS = {
  trial: ['trial', 'active', 'expired', 'revoked'],
  active: ['active', 'past_due', 'grace_period', 'canceled', 'revoked'],
  past_due: ['past_due', 'grace_period', 'active', 'canceled', 'revoked'],
  grace_period: ['grace_period', 'active', 'canceled', 'revoked'],
  canceled: ['canceled', 'revoked'],
  expired: ['expired', 'active', 'revoked'],
  revoked: ['revoked'],
};

function normalizeLicenseStatusLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'active' || raw === 'trial' || raw === 'expired' || raw === 'revoked') return raw;
  if (raw === 'past_due' || raw === 'past-due' || raw === 'pastdue' || raw === 'failed') return 'past_due';
  if (raw === 'grace_period' || raw === 'grace-period' || raw === 'grace') return 'grace_period';
  if (raw === 'canceled' || raw === 'cancelled' || raw === 'inactive' || raw === 'unpaid') return 'canceled';
  return null;
}

function inferTargetStatusFromPayment(payload) {
  const byBilling = normalizeLicenseStatusLabel(payload?.billing?.status);
  if (byBilling) return byBilling;

  const eventType = String(payload?.eventType || '').toLowerCase();
  if (!eventType) return null;
  if (eventType.includes('payment_failed') || eventType.includes('failed')) return 'past_due';
  if (eventType.includes('canceled') || eventType.includes('cancelled')) return 'canceled';
  // Accept a broader set of success/completion synonyms emitted by providers
  if (
    eventType.includes('completed') ||
    eventType.includes('paid') ||
    eventType.includes('active') ||
    eventType.includes('succeed') ||
    eventType.includes('success')
  ) return 'active';
  return null;
}

function canTransitionLicense(fromStatus, toStatus) {
  const from = normalizeLicenseStatusLabel(fromStatus) || 'trial';
  const to = normalizeLicenseStatusLabel(toStatus);
  if (!to) return false;
  return (ALLOWED_LICENSE_TRANSITIONS[from] || []).includes(to);
}

export async function applyPaymentToLicense(env, { keyHash, paymentPayload }) {
  if (!keyHash) {
    return { updated: false, blocked: true, reason: 'missing_key_hash', license: null };
  }

  const key = licenseKeyForKeyHash(keyHash);
  const current = await kvGetJson(env, key);
  const targetStatus = inferTargetStatusFromPayment(paymentPayload);
  if (!targetStatus) {
    return { updated: false, blocked: true, reason: 'unknown_target_status', license: current || null };
  }

  const now = nowIso();
  const periodStart = paymentPayload?.billing?.periodStart || null;
  let periodEnd = paymentPayload?.billing?.periodEnd || null;

  // Se o provedor não informou período, para pagamentos bem-sucedidos
  // consideramos uma janela padrão de 30 dias a partir de agora.
  if (!periodEnd && targetStatus === 'active') {
    periodEnd = addMsToIso(PAID_MS);
  }

  if (!current) {
    const created = {
      licenseId: `lic_${crypto.randomUUID()}`,
      customerId: paymentPayload?.customer?.customerId || null,
      status: targetStatus,
      plan: paymentPayload?.billing?.plan || 'pro',
      trialEndsAt: null,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      expiresAt: periodEnd || null,
      provider: paymentPayload?.provider || null,
      providerCustomerId: paymentPayload?.reference?.providerCustomerId || null,
      providerSubscriptionId: paymentPayload?.reference?.providerSubscriptionId || null,
      createdAt: now,
      updatedAt: now,
    };
    await kvPutJson(env, key, created);
    return { updated: true, blocked: false, reason: null, license: created };
  }

  const from = normalizeLicenseStatusLabel(current.status) || 'trial';
  if (!canTransitionLicense(from, targetStatus)) {
    return { updated: false, blocked: true, reason: `invalid_transition:${from}->${targetStatus}`, license: current };
  }

  const next = {
    ...current,
    status: targetStatus,
    plan: paymentPayload?.billing?.plan || current.plan,
    currentPeriodStart: periodStart || current.currentPeriodStart || null,
    currentPeriodEnd: periodEnd || current.currentPeriodEnd || null,
    expiresAt: periodEnd || current.expiresAt || null,
    provider: paymentPayload?.provider || current.provider || null,
    providerCustomerId: paymentPayload?.reference?.providerCustomerId || current.providerCustomerId || null,
    providerSubscriptionId: paymentPayload?.reference?.providerSubscriptionId || current.providerSubscriptionId || null,
    updatedAt: now,
  };

  await kvPutJson(env, key, next);
  return { updated: true, blocked: false, reason: null, license: next };
}

function normalizeLicenseStatus(lic) {
  const expiresAt = lic?.expiresAt || lic?.trialEndsAt;
  if (!expiresAt) return lic;

  const exp = Date.parse(expiresAt);
  if (Number.isFinite(exp) && Date.now() > exp && lic.status !== 'expired') {
    return { ...lic, status: 'expired', updatedAt: nowIso() };
  }
  return lic;
}

export async function getLicenseByKeyHash(env, keyHash) {
  if (!keyHash) return null;
  return await kvGetJson(env, licenseKeyForKeyHash(keyHash));
}

export async function createTrialLicenseForKeyHash(env, { keyHash, customerId, plan = 'pro' }) {
  const createdAt = nowIso();
  const trialEndsAt = addMsToIso(TRIAL_MS);
  const lic = {
    licenseId: `lic_${crypto.randomUUID()}`,
    customerId,
    status: 'trial',
    plan,
    trialEndsAt,
    expiresAt: trialEndsAt,
    createdAt,
    updatedAt: createdAt,
  };
  await kvPutJson(env, licenseKeyForKeyHash(keyHash), lic);
  return lic;
}

export async function getOrCreateLicense(env, token) {
  if (isAdminToken(env, token)) {
    return {
      licenseId: 'admin',
      status: 'active',
      plan: 'pro',
      expiresAt: '2999-01-01T00:00:00.000Z',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  if (validateClientKeyFormat(token)) {
    const keyHash = await hashClientKey(token);
    const byKeyHash = await getLicenseByKeyHash(env, keyHash);
    if (!byKeyHash) {
      const err = new Error('clientKey inválida ou não encontrada.');
      err.status = 403;
      throw err;
    }
    const updatedByKeyHash = normalizeLicenseStatus(byKeyHash);
    if (updatedByKeyHash.status !== byKeyHash.status) {
      await kvPutJson(env, licenseKeyForKeyHash(keyHash), updatedByKeyHash);
      return updatedByKeyHash;
    }
    return byKeyHash;
  }

  const key = licenseKeyForToken(token);
  let lic = await kvGetJson(env, key);

  if (!lic) {
    const createdAt = nowIso();
    lic = {
      licenseId: `lic_${crypto.randomUUID()}`,
      status: 'trial',
      plan: 'pro',
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

export function assertPremiumAllowed(license) {
  if (!license) {
    const err = new Error('Licença não encontrada.');
    err.status = 403;
    throw err;
  }

  if (license.status !== 'trial' && license.status !== 'active' && license.status !== 'grace_period') {
    const err = new Error('Seu trial expirou. Ative o plano para continuar usando recursos premium.');
    err.status = 403;
    throw err;
  }
}
