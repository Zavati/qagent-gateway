import {
  archiveApiServiceAndBindings,
  createApiService as insertApiService,
  getApiService,
  listApiServices,
  updateApiService as persistApiService,
} from '../repositories/apiServiceRepository.js';
import { cleanConfigText, normalizeServiceKey } from '../lib/environmentConfig.js';
import { getOrganizationProject } from './projectService.js';

function mapDbConflict(error) {
  const message = String(error?.message || '');
  if (message.includes('UNIQUE constraint failed')) {
    const err = new Error('Já existe um API Service com este serviceKey no Project.');
    err.status = 409;
    err.code = 'DUPLICATE_API_SERVICE';
    throw err;
  }
  throw error;
}

export async function listProjectApiServices(env, organizationId, projectId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId);
  return listApiServices(env, organizationId, projectId, options);
}

export async function getProjectApiService(env, organizationId, projectId, apiServiceId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId, { includeArchived: options.includeArchived === true });
  const apiService = await getApiService(env, organizationId, projectId, apiServiceId, options);
  if (!apiService) {
    const err = new Error('API Service não encontrado.');
    err.status = 404;
    err.code = 'API_SERVICE_NOT_FOUND';
    throw err;
  }
  return apiService;
}

export async function createProjectApiService(env, { organizationId, projectId, userId, input }) {
  await getOrganizationProject(env, organizationId, projectId);
  const name = cleanConfigText(input?.name, 120);
  if (name.length < 2) {
    const err = new Error('Nome do API Service é obrigatório.');
    err.status = 400;
    err.code = 'API_SERVICE_NAME_REQUIRED';
    throw err;
  }

  const serviceKey = normalizeServiceKey(input?.serviceKey || input?.key || name);
  const description = cleanConfigText(input?.description, 2000) || null;
  try {
    return await insertApiService(env, {
      organizationId,
      projectId,
      name,
      serviceKey,
      description,
      createdByUserId: userId,
    });
  } catch (error) {
    return mapDbConflict(error);
  }
}

export async function patchProjectApiService(env, { organizationId, projectId, apiServiceId, input }) {
  const current = await getProjectApiService(env, organizationId, projectId, apiServiceId, { includeArchived: true });
  if (current.status === 'archived') {
    const err = new Error('API Service arquivado não pode ser alterado.');
    err.status = 409;
    err.code = 'API_SERVICE_ARCHIVED';
    throw err;
  }

  const name = input?.name === undefined ? current.name : cleanConfigText(input.name, 120);
  if (name.length < 2) {
    const err = new Error('Nome do API Service é obrigatório.');
    err.status = 400;
    throw err;
  }
  const requestedServiceKey = input?.serviceKey === undefined && input?.key === undefined
    ? current.serviceKey
    : normalizeServiceKey(input?.serviceKey || input?.key);
  if (requestedServiceKey !== current.serviceKey) {
    const err = new Error('serviceKey é imutável porque será usada como referência estável nos testes. Crie outro API Service para trocar a chave.');
    err.status = 409;
    err.code = 'API_SERVICE_KEY_IMMUTABLE';
    throw err;
  }
  const serviceKey = current.serviceKey;
  const description = input?.description === undefined ? current.description : (cleanConfigText(input.description, 2000) || null);

  try {
    return await persistApiService(env, {
      ...current,
      organizationId,
      projectId,
      apiServiceId,
      name,
      serviceKey,
      description,
      status: current.status,
    });
  } catch (error) {
    return mapDbConflict(error);
  }
}

export async function archiveProjectApiService(env, { organizationId, projectId, apiServiceId }) {
  const current = await getProjectApiService(env, organizationId, projectId, apiServiceId, { includeArchived: true });
  if (current.status === 'archived') return current;
  return archiveApiServiceAndBindings(env, { organizationId, projectId, apiServiceId });
}
