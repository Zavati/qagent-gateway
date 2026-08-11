import {
  archiveEnvironmentApiBinding,
  getEnvironmentApiBinding,
  listEnvironmentApiBindings,
  upsertEnvironmentApiBinding,
} from '../repositories/environmentApiBindingRepository.js';
import { normalizeApiBaseUrl } from '../lib/environmentConfig.js';
import { getProjectApiService } from './apiServiceService.js';
import { getProjectEnvironment } from './environmentService.js';

export async function listProjectEnvironmentApiBindings(env, organizationId, projectId, environmentId, options = {}) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId);
  return listEnvironmentApiBindings(env, organizationId, projectId, environmentId, options);
}


export async function getProjectEnvironmentApiBinding(env, organizationId, projectId, environmentId, apiServiceId, options = {}) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId, { includeArchived: options.includeArchived === true });
  await getProjectApiService(env, organizationId, projectId, apiServiceId, { includeArchived: options.includeArchived === true });
  const binding = await getEnvironmentApiBinding(env, organizationId, projectId, environmentId, apiServiceId, options);
  if (!binding) {
    const err = new Error('API Service não está configurado neste Environment.');
    err.status = 404;
    err.code = 'ENVIRONMENT_API_BINDING_NOT_FOUND';
    throw err;
  }
  return binding;
}

export async function putProjectEnvironmentApiBinding(env, {
  organizationId,
  projectId,
  environmentId,
  apiServiceId,
  userId,
  input,
}) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId);
  await getProjectApiService(env, organizationId, projectId, apiServiceId);
  const baseUrl = normalizeApiBaseUrl(input?.baseUrl);

  return upsertEnvironmentApiBinding(env, {
    organizationId,
    projectId,
    environmentId,
    apiServiceId,
    baseUrl,
    createdByUserId: userId,
  });
}

export async function deleteProjectEnvironmentApiBinding(env, { organizationId, projectId, environmentId, apiServiceId }) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId);
  await getProjectApiService(env, organizationId, projectId, apiServiceId);
  const current = await getEnvironmentApiBinding(env, organizationId, projectId, environmentId, apiServiceId, { includeArchived: true });
  if (!current) {
    const err = new Error('API Service não está configurado neste Environment.');
    err.status = 404;
    err.code = 'ENVIRONMENT_API_BINDING_NOT_FOUND';
    throw err;
  }
  if (current.status === 'archived') return current;
  return archiveEnvironmentApiBinding(env, { organizationId, projectId, environmentId, apiServiceId });
}
