import { sanitizeString } from './sanitize.js';

export function getEnvNum(env, key, fallback) {
  const v = env?.[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getAutofillModel(body, env) {
  const candidate = (body?.meta?.model || body?.settings?.model || env?.AUTOFILL_MODEL || "gpt-3.5-turbo");
  try {
    return sanitizeString(candidate, 200);
  } catch (e) {
    return "gpt-3.5-turbo";
  }
}
