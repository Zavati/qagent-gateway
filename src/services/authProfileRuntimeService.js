// INTERNAL ONLY: this resolver can return decrypted credentials in memory. Never expose it through Console/public routes.
import {
  getAuthProfile,
  getAuthProfileBinding,
  listEnvironmentAuthProfileBindings,
} from '../repositories/authProfileRepository.js';
import { publicAuthProfileConfig, expectedSecretKindForAuthType } from '../lib/authProfileConfig.js';
import { resolveProjectSecretValue } from './secretVaultService.js';
import { getProjectEnvironment } from './environmentService.js';
import { listProjectEnvironmentApiBindings } from './environmentApiBindingService.js';

export async function listEnvironmentAuthProfilesPublic(env, organizationId, projectId, environmentId) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId);
  const bindings = await listEnvironmentAuthProfileBindings(env, organizationId, projectId, environmentId);
  const out = {};
  for (const binding of bindings) {
    out[binding.profileKey] = {
      authProfileId: binding.authProfileId,
      name: binding.authProfileName,
      type: binding.authProfileType,
      config: publicAuthProfileConfig(binding.configJson),
      credentialsConfigured: Boolean(binding.credentialsConfigured || binding.authProfileType === 'none'),
    };
  }
  return out;
}

export async function resolveAuthProfileCredentialsJit(env, organizationId, projectId, environmentId, authProfileId) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId);
  const profile = await getAuthProfile(env, organizationId, projectId, authProfileId);
  if (!profile || !profile.enabled) {
    const err = new Error('Auth Profile não disponível para execução.');
    err.status = 404;
    err.code = 'AUTH_PROFILE_NOT_AVAILABLE';
    throw err;
  }
  const binding = await getAuthProfileBinding(env, organizationId, projectId, authProfileId, environmentId);
  if (!binding) {
    const err = new Error('Auth Profile não configurado para este Environment.');
    err.status = 409;
    err.code = 'AUTH_PROFILE_ENVIRONMENT_NOT_CONFIGURED';
    throw err;
  }

  let credentials = null;
  if (profile.type !== 'none') {
    if (!binding.secretId) {
      const err = new Error('Auth Profile sem Secret configurado para este Environment.');
      err.status = 409;
      err.code = 'AUTH_PROFILE_SECRET_MISSING';
      throw err;
    }
    const resolved = await resolveProjectSecretValue(env, organizationId, projectId, binding.secretId);
    const expectedKind = expectedSecretKindForAuthType(profile.type);
    if (resolved.metadata.kind !== expectedKind) {
      const err = new Error('Secret incompatível com o Auth Profile durante resolução.');
      err.status = 500;
      err.code = 'AUTH_PROFILE_SECRET_KIND_MISMATCH';
      throw err;
    }
    credentials = resolved.value;
  }

  return {
    organizationId,
    projectId,
    environmentId,
    authProfileId: profile.authProfileId,
    profileKey: profile.profileKey,
    type: profile.type,
    credentials,
  };
}

export async function resolveAuthProfileRuntimePlan(env, organizationId, projectId, environmentId, authProfileId) {
  const resolved = await resolveAuthProfileCredentialsJit(env, organizationId, projectId, environmentId, authProfileId);
  const profile = await getAuthProfile(env, organizationId, projectId, authProfileId);
  const config = publicAuthProfileConfig(profile?.configJson);

  let target = null;
  if (['oauth2_client_credentials', 'login_http_json'].includes(resolved.type)) {
    const apiBindings = await listProjectEnvironmentApiBindings(env, organizationId, projectId, environmentId);
    const apiBinding = apiBindings.find((item) => item.serviceKey === config.apiServiceKey);
    if (!apiBinding) {
      const err = new Error(`API Service '${config.apiServiceKey}' não possui Base URL neste Environment.`);
      err.status = 409;
      err.code = 'AUTH_API_SERVICE_ENVIRONMENT_BINDING_MISSING';
      throw err;
    }
    target = {
      apiServiceKey: config.apiServiceKey,
      apiServiceId: apiBinding.apiServiceId,
      baseUrl: apiBinding.baseUrl,
      path: config.path,
      method: config.method || 'POST',
    };
  }

  return {
    ...resolved,
    config,
    target,
  };
}
