import { deserializeVariableValue } from '../lib/environmentConfig.js';
import { getProjectEnvironment } from './environmentService.js';
import { listProjectEnvironmentApiBindings } from './environmentApiBindingService.js';
import { listProjectEnvironmentVariables } from './environmentVariableService.js';
import { listEnvironmentAuthProfilesPublic } from './authProfileRuntimeService.js';

export async function resolveEnvironmentRuntimeConfig(env, organizationId, projectId, environmentId) {
  const environment = await getProjectEnvironment(env, organizationId, projectId, environmentId);
  const [bindings, variables, authProfiles] = await Promise.all([
    listProjectEnvironmentApiBindings(env, organizationId, projectId, environmentId),
    listProjectEnvironmentVariables(env, organizationId, projectId, environmentId),
    listEnvironmentAuthProfilesPublic(env, organizationId, projectId, environmentId),
  ]);

  const apiServices = {};
  for (const binding of bindings) {
    apiServices[binding.serviceKey] = {
      apiServiceId: binding.apiServiceId,
      name: binding.apiServiceName,
      baseUrl: binding.baseUrl,
    };
  }

  const resolvedVariables = {};
  for (const variable of variables) {
    resolvedVariables[variable.variableKey] = deserializeVariableValue(variable.variableValue, variable.valueType);
  }

  return {
    organizationId,
    projectId,
    environment: {
      environmentId: environment.environmentId,
      name: environment.name,
      slug: environment.slug,
      environmentType: environment.environmentType,
      webBaseUrl: environment.webBaseUrl,
      isDefault: environment.isDefault,
    },
    apiServices,
    variables: resolvedVariables,
    authProfiles,
  };
}
