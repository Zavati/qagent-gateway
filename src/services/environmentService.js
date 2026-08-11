import {
  archiveEnvironmentAndPromoteDefault,
  countActiveEnvironments,
  createEnvironment as insertEnvironment,
  getEnvironment,
  listEnvironments,
  updateEnvironment as persistEnvironment,
} from '../repositories/environmentRepository.js';
import { getOrganizationProject, slugify } from './projectService.js';

const ENVIRONMENT_TYPES = new Set(['DEV', 'QA', 'STG', 'PROD', 'CUSTOM']);

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEnvironmentType(value, name = '') {
  const raw = cleanText(value, 20).toUpperCase();
  if (ENVIRONMENT_TYPES.has(raw)) return raw;
  const byName = cleanText(name, 20).toUpperCase();
  if (ENVIRONMENT_TYPES.has(byName)) return byName;
  return 'CUSTOM';
}

function normalizeBaseUrl(value) {
  const raw = cleanText(value, 2000);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    const err = new Error('Web Base URL inválida.');
    err.status = 400;
    err.code = 'INVALID_WEB_BASE_URL';
    throw err;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error('Web Base URL deve usar http ou https.');
    err.status = 400;
    err.code = 'INVALID_WEB_BASE_URL_SCHEME';
    throw err;
  }
  return raw.replace(/\/+$/, '');
}

function mapDbConflict(error) {
  const message = String(error?.message || '');
  if (message.includes('UNIQUE constraint failed')) {
    const err = new Error('Environment já existe com este identificador.');
    err.status = 409;
    err.code = 'DUPLICATE_ENVIRONMENT';
    throw err;
  }
  throw error;
}

export async function listProjectEnvironments(env, organizationId, projectId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId, { includeArchived: false });
  return listEnvironments(env, organizationId, projectId, options);
}

export async function getProjectEnvironment(env, organizationId, projectId, environmentId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId, { includeArchived: options.includeArchived === true });
  const environment = await getEnvironment(env, organizationId, projectId, environmentId, options);
  if (!environment) {
    const err = new Error('Environment não encontrado.');
    err.status = 404;
    err.code = 'ENVIRONMENT_NOT_FOUND';
    throw err;
  }
  return environment;
}

export async function createProjectEnvironment(env, { organizationId, projectId, userId, input }) {
  await getOrganizationProject(env, organizationId, projectId);

  const name = cleanText(input?.name, 120);
  if (name.length < 2) {
    const err = new Error('Nome do Environment é obrigatório.');
    err.status = 400;
    err.code = 'ENVIRONMENT_NAME_REQUIRED';
    throw err;
  }

  const slug = slugify(input?.slug || name, `environment-${crypto.randomUUID().slice(0, 8)}`);
  const environmentType = normalizeEnvironmentType(input?.environmentType || input?.type, name);
  const webBaseUrl = normalizeBaseUrl(input?.webBaseUrl);
  const activeCount = await countActiveEnvironments(env, organizationId, projectId);
  const isDefault = activeCount === 0 ? true : input?.isDefault === true;

  try {
    return await insertEnvironment(env, {
      organizationId,
      projectId,
      name,
      slug,
      environmentType,
      webBaseUrl,
      isDefault,
      createdByUserId: userId,
    });
  } catch (error) {
    return mapDbConflict(error);
  }
}

export async function patchProjectEnvironment(env, { organizationId, projectId, environmentId, input }) {
  const current = await getProjectEnvironment(env, organizationId, projectId, environmentId, { includeArchived: true });
  if (current.status === 'archived') {
    const err = new Error('Environment arquivado não pode ser alterado.');
    err.status = 409;
    err.code = 'ENVIRONMENT_ARCHIVED';
    throw err;
  }

  const name = input?.name == null ? current.name : cleanText(input.name, 120);
  if (name.length < 2) {
    const err = new Error('Nome do Environment é obrigatório.');
    err.status = 400;
    throw err;
  }

  const slug = input?.slug == null ? current.slug : slugify(input.slug, current.slug);
  const environmentType = input?.environmentType == null && input?.type == null
    ? current.environmentType
    : normalizeEnvironmentType(input?.environmentType || input?.type, name);
  const webBaseUrl = input?.webBaseUrl === undefined ? current.webBaseUrl : normalizeBaseUrl(input.webBaseUrl);
  const isDefault = input?.isDefault === undefined ? current.isDefault : input.isDefault === true;
  if (current.isDefault && input?.isDefault === false) {
    const err = new Error('Defina outro Environment como default antes de remover o default atual.');
    err.status = 409;
    err.code = 'DEFAULT_ENVIRONMENT_REQUIRED';
    throw err;
  }

  try {
    return await persistEnvironment(env, {
      ...current,
      organizationId,
      projectId,
      environmentId,
      name,
      slug,
      environmentType,
      webBaseUrl,
      isDefault,
      status: current.status,
    });
  } catch (error) {
    return mapDbConflict(error);
  }
}

export async function archiveProjectEnvironment(env, { organizationId, projectId, environmentId }) {
  const current = await getProjectEnvironment(env, organizationId, projectId, environmentId, { includeArchived: true });
  if (current.status === 'archived') return current;

  return archiveEnvironmentAndPromoteDefault(env, {
    organizationId,
    projectId,
    environmentId,
  });
}
