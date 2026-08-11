import {
  createProject as insertProject,
  getProject,
  listProjects,
  updateProject as persistProject,
} from '../repositories/projectRepository.js';

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

export function slugify(value, fallback = 'item') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function mapDbConflict(error, entity = 'Project') {
  const message = String(error?.message || '');
  if (message.includes('UNIQUE constraint failed')) {
    const err = new Error(`${entity} já existe com este identificador.`);
    err.status = 409;
    err.code = 'DUPLICATE_RESOURCE';
    throw err;
  }
  throw error;
}

export async function listOrganizationProjects(env, organizationId, options = {}) {
  return listProjects(env, organizationId, options);
}

export async function getOrganizationProject(env, organizationId, projectId, options = {}) {
  const project = await getProject(env, organizationId, projectId, options);
  if (!project) {
    const err = new Error('Project não encontrado.');
    err.status = 404;
    err.code = 'PROJECT_NOT_FOUND';
    throw err;
  }
  return project;
}

export async function createOrganizationProject(env, { organizationId, userId, input }) {
  const name = cleanText(input?.name, 120);
  if (name.length < 2) {
    const err = new Error('Nome do Project é obrigatório.');
    err.status = 400;
    err.code = 'PROJECT_NAME_REQUIRED';
    throw err;
  }

  const slug = slugify(input?.slug || name, `project-${crypto.randomUUID().slice(0, 8)}`);
  const description = cleanText(input?.description, 2000) || null;

  try {
    return await insertProject(env, {
      organizationId,
      name,
      slug,
      description,
      createdByUserId: userId,
    });
  } catch (error) {
    return mapDbConflict(error, 'Project');
  }
}

export async function patchOrganizationProject(env, { organizationId, projectId, input }) {
  const current = await getOrganizationProject(env, organizationId, projectId, { includeArchived: true });
  if (current.status === 'archived') {
    const err = new Error('Project arquivado não pode ser alterado.');
    err.status = 409;
    err.code = 'PROJECT_ARCHIVED';
    throw err;
  }

  const name = input?.name == null ? current.name : cleanText(input.name, 120);
  if (name.length < 2) {
    const err = new Error('Nome do Project é obrigatório.');
    err.status = 400;
    throw err;
  }

  const slug = input?.slug == null ? current.slug : slugify(input.slug, current.slug);
  const description = input?.description == null ? current.description : (cleanText(input.description, 2000) || null);

  try {
    return await persistProject(env, {
      ...current,
      organizationId,
      projectId,
      name,
      slug,
      description,
      status: current.status,
    });
  } catch (error) {
    return mapDbConflict(error, 'Project');
  }
}

export async function archiveOrganizationProject(env, { organizationId, projectId }) {
  const current = await getOrganizationProject(env, organizationId, projectId, { includeArchived: true });
  if (current.status === 'archived') return current;
  return persistProject(env, { ...current, organizationId, projectId, status: 'archived' });
}
