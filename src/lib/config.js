import { sanitizeString } from './sanitize.js';

export function getEnvNum(env, key, fallback) {
  const v = env?.[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeModel(candidate, fallback = 'gpt-4o-mini') {
  try {
    return sanitizeString(candidate || fallback, 200);
  } catch {
    return fallback;
  }
}

function getRequestedModel(body) {
  return body?.meta?.model || body?.settings?.model || null;
}

export function getAutofillModel(body, env) {
  const candidate = getRequestedModel(body) || env?.AUTOFILL_MODEL || 'gpt-4o-mini';
  return sanitizeModel(candidate);
}

export function getGenerateTestsModel(body, env) {
  // AUTOFILL_MODEL remains a compatibility fallback for existing environments.
  const candidate = getRequestedModel(body)
    || env?.GENERATE_TESTS_MODEL
    || env?.AUTOFILL_MODEL
    || 'gpt-4o-mini';
  return sanitizeModel(candidate);
}

export function getTestDesignModel(env) {
  const candidate = env?.TEST_DESIGN_MODEL
    || env?.GENERATE_TESTS_MODEL
    || env?.AUTOFILL_MODEL
    || 'gpt-4o-mini';
  return sanitizeModel(candidate);
}
