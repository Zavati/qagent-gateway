/** Single global opt-in. Project access/tenant checks stay in their existing handlers.
 * OBSERVED_BASELINE_PROJECT_IDS is retired and intentionally ignored. */
export function observedBaselineGenerationEnabled(env = {}) {
  return ['1', 'true'].includes(String(env?.OBSERVED_BASELINE_GENERATION_ENABLED ?? 'false').trim().toLowerCase());
}
