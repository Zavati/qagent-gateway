/** Resolve UI execution profiles from the existing QAgent environment configuration.
 * No per-tenant profile secret or duplicated profile table is required.
 */
import { resolveEnvironmentRuntimeConfig } from './environmentRuntimeConfigService.js';
import { executionError, executionProfiles, httpUrl, textValue } from './uiExecutionContract.js';

const stableId = id => `profile_ui_${id}`;
function safeOrigin(value) {
  const url = httpUrl(value);
  if (url.search || url.hash) throw executionError('PROFILE_INVALID', 503);
  return url.origin;
}
export function profileFromRuntime(runtime, scope) {
  if (!runtime || runtime.organizationId !== scope.organizationId || runtime.projectId !== scope.projectId || runtime.environment?.environmentId !== scope.environmentId)
    throw executionError('PROFILE_SCOPE_INVALID', 503);
  const environment = runtime.environment;
  if (!environment.webBaseUrl) return [];
  const target = httpUrl(textValue(environment.webBaseUrl, 2048));
  if (target.search || target.hash) throw executionError('PROFILE_INVALID', 503);
  const origins = [target.origin];
  for (const api of Object.values(runtime.apiServices ?? {})) {
    if (api.baseUrl) origins.push(safeOrigin(api.baseUrl));
  }
  // Scope, URL, API origins and public auth readiness come from the existing
  // environment configuration. Authentication credentials are NEVER serialized.
  // Browser auth is deliberately pending rather than misusing API bearer tokens.
  const browserCandidates = Object.values(runtime.authProfiles ?? {}).filter(p =>
    p.type === 'basic' && p.config?.browserLogin);
  // Ambiguous login is a configuration error; do not silently disable auth.
  if (browserCandidates.length > 1) throw executionError('BROWSER_AUTH_AMBIGUOUS', 409);
  const browserAuth = browserCandidates.length === 1 ? {
    authProfileId: browserCandidates[0].authProfileId,
    config: browserCandidates[0].config.browserLogin,
  } : null;
  return [{
    profileId: stableId(scope.environmentId),
    name: `${environment.name || environment.slug || 'Environment'} · Chromium`,
    scope,
    targetBaseUrl: target.href,
    allowedOrigins: [...new Set(origins)],
    originMap: {},
    preparationMode: browserAuth ? 'BROWSER_AUTH' : 'UNAUTHENTICATED',
    preparationKey: browserAuth ? 'browser-login' : 'unprepared',
    ...(browserAuth ? { browserAuth } : {}),
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    stepTimeoutMs: 7000,
    modeTimeoutMs: 600000,
    browser: 'chromium',
  }];
}
export async function projectExecutionProfiles(env, scope, { runtime = resolveEnvironmentRuntimeConfig } = {}) {
  // A legacy JSON config may remain in unit-test fixtures or during a staged
  // rollout, but production environments without it use project data directly.
  if (env.UI_EXECUTION_PROFILE_SOURCE !== 'PROJECT' && env.UI_EXECUTION_PROFILES_JSON) return executionProfiles(env, scope);
  const config = await runtime(env, scope.organizationId, scope.projectId, scope.environmentId);
  return profileFromRuntime(config, scope);
}
