import {
  createEnvironmentVariable as insertEnvironmentVariable,
  getEnvironmentVariable,
  listEnvironmentVariables,
  updateEnvironmentVariable as persistEnvironmentVariable,
} from '../repositories/environmentVariableRepository.js';
import {
  assertNonSecretVariable,
  cleanConfigText,
  normalizeVariableValue,
} from '../lib/environmentConfig.js';
import { getProjectEnvironment } from './environmentService.js';

function mapDbConflict(error) {
  const message = String(error?.message || '');
  if (message.includes('UNIQUE constraint failed')) {
    const err = new Error('Já existe uma Environment Variable ativa com esta chave.');
    err.status = 409;
    err.code = 'DUPLICATE_ENVIRONMENT_VARIABLE';
    throw err;
  }
  throw error;
}

export async function listProjectEnvironmentVariables(env, organizationId, projectId, environmentId, options = {}) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId);
  return listEnvironmentVariables(env, organizationId, projectId, environmentId, options);
}

export async function getProjectEnvironmentVariable(env, organizationId, projectId, environmentId, variableId, options = {}) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId, { includeArchived: options.includeArchived === true });
  const variable = await getEnvironmentVariable(env, organizationId, projectId, environmentId, variableId, options);
  if (!variable) {
    const err = new Error('Environment Variable não encontrada.');
    err.status = 404;
    err.code = 'ENVIRONMENT_VARIABLE_NOT_FOUND';
    throw err;
  }
  return variable;
}

export async function createProjectEnvironmentVariable(env, { organizationId, projectId, environmentId, userId, input }) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId);
  const variableKey = assertNonSecretVariable(input);
  const { valueType, variableValue } = normalizeVariableValue(input?.value, input?.valueType || input?.type || 'STRING');
  const description = cleanConfigText(input?.description, 1000) || null;

  try {
    return await insertEnvironmentVariable(env, {
      organizationId,
      projectId,
      environmentId,
      variableKey,
      variableValue,
      valueType,
      description,
      createdByUserId: userId,
    });
  } catch (error) {
    return mapDbConflict(error);
  }
}

export async function patchProjectEnvironmentVariable(env, { organizationId, projectId, environmentId, variableId, input }) {
  const current = await getProjectEnvironmentVariable(env, organizationId, projectId, environmentId, variableId, { includeArchived: true });
  if (current.status === 'archived') {
    const err = new Error('Environment Variable arquivada não pode ser alterada.');
    err.status = 409;
    err.code = 'ENVIRONMENT_VARIABLE_ARCHIVED';
    throw err;
  }

  const requestedVariableKey = input?.variableKey === undefined && input?.key === undefined
    ? current.variableKey
    : assertNonSecretVariable({ ...input, variableKey: input?.variableKey ?? input?.key });
  if (requestedVariableKey !== current.variableKey) {
    const err = new Error('variableKey é imutável porque será usada como referência estável nos testes. Crie outra variável para trocar a chave.');
    err.status = 409;
    err.code = 'ENVIRONMENT_VARIABLE_KEY_IMMUTABLE';
    throw err;
  }
  const variableKey = current.variableKey;

  if (input?.secret === true || input?.sensitive === true) assertNonSecretVariable({ ...input, variableKey });

  let valueType = current.valueType;
  let variableValue = current.variableValue;
  if (input?.value !== undefined || input?.valueType !== undefined || input?.type !== undefined) {
    const normalized = normalizeVariableValue(
      input?.value === undefined ? current.variableValue : input.value,
      input?.valueType || input?.type || current.valueType,
    );
    valueType = normalized.valueType;
    variableValue = normalized.variableValue;
  }

  const description = input?.description === undefined ? current.description : (cleanConfigText(input.description, 1000) || null);

  try {
    return await persistEnvironmentVariable(env, {
      ...current,
      organizationId,
      projectId,
      environmentId,
      variableId,
      variableKey,
      variableValue,
      valueType,
      description,
      status: current.status,
    });
  } catch (error) {
    return mapDbConflict(error);
  }
}

export async function archiveProjectEnvironmentVariable(env, { organizationId, projectId, environmentId, variableId }) {
  const current = await getProjectEnvironmentVariable(env, organizationId, projectId, environmentId, variableId, { includeArchived: true });
  if (current.status === 'archived') return current;
  return persistEnvironmentVariable(env, {
    ...current,
    organizationId,
    projectId,
    environmentId,
    variableId,
    status: 'archived',
  });
}
