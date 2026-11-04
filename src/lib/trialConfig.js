/** Commercial trial duration only. Never used for auth/session/grant TTLs. */
export const DEFAULT_TRIAL_DAYS = 30;
export const MAX_TRIAL_DAYS = 365;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveTrialDays(env = {}) {
  const raw = env?.QAGENT_TRIAL_DAYS;
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return DEFAULT_TRIAL_DAYS;
  const text = typeof raw === 'string' ? raw.trim() : raw;
  const days = (typeof text === 'number' || (typeof text === 'string' && /^\d+$/.test(text))) ? Number(text) : NaN;
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_TRIAL_DAYS) {
    const error = new Error(`QAGENT_TRIAL_DAYS deve ser um inteiro entre 1 e ${MAX_TRIAL_DAYS}.`);
    error.code = 'TRIAL_DURATION_CONFIG_INVALID';
    error.status = 500;
    throw error;
  }
  return days;
}
