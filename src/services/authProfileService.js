import { cleanConfigText } from '../lib/environmentConfig.js';
import {
  expectedSecretKindForAuthType,
  normalizeAuthProfileConfig,
  normalizeAuthProfileType,
  normalizeProfileKey,
  publicAuthProfileConfig,
} from '../lib/authProfileConfig.js';
import {
  archiveAuthProfileAndBindings,
  createAuthProfile as insertAuthProfile,
  getAuthProfile,
  listAuthProfiles,
  updateAuthProfile as persistAuthProfile,
} from '../repositories/authProfileRepository.js';
import { getOrganizationProject } from './projectService.js';
import { listProjectApiServices } from './apiServiceService.js';

function publicProfile(profile) {
  if (!profile) return null;
  const { configJson, ...rest } = profile;
  return { ...rest, config: publicAuthProfileConfig(configJson) };
}

async function validateReferencedService(env, organizationId, projectId, type, config) {
  if (!['oauth2_client_credentials', 'login_http_json'].includes(type)) return;
  if (config?.targetMode === 'runtime_origin') return;
  const services = await listProjectApiServices(env, organizationId, projectId);
  if (!services.some((service) => service.serviceKey === config.apiServiceKey)) {
    const err = new Error(`API Service '${config.apiServiceKey}' não encontrado no Project.`);
    err.status = 400;
    err.code = 'AUTH_PROFILE_API_SERVICE_NOT_FOUND';
    throw err;
  }
}

function mapDbConflict(error) {
  if (String(error?.message || '').includes('UNIQUE constraint failed')) {
    const err = new Error('Já existe um Auth Profile ativo com esta profileKey no Project.');
    err.status = 409;
    err.code = 'DUPLICATE_AUTH_PROFILE';
    throw err;
  }
  throw error;
}

export async function listProjectAuthProfiles(env, organizationId, projectId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId);
  return (await listAuthProfiles(env, organizationId, projectId, options)).map(publicProfile);
}

export async function getProjectAuthProfile(env, organizationId, projectId, authProfileId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId, { includeArchived: options.includeArchived === true });
  const profile = await getAuthProfile(env, organizationId, projectId, authProfileId, options);
  if (!profile) {
    const err = new Error('Auth Profile não encontrado.');
    err.status = 404;
    err.code = 'AUTH_PROFILE_NOT_FOUND';
    throw err;
  }
  return publicProfile(profile);
}

export async function createProjectAuthProfile(env, { organizationId, projectId, userId, input }) {
  await getOrganizationProject(env, organizationId, projectId);
  const name = cleanConfigText(input?.name, 160);
  if (name.length < 2) {
    const err = new Error('Nome do Auth Profile é obrigatório.');
    err.status = 400;
    err.code = 'AUTH_PROFILE_NAME_REQUIRED';
    throw err;
  }
  const profileKey = normalizeProfileKey(input?.profileKey || input?.key || name);
  const type = normalizeAuthProfileType(input?.type || 'none');
  const config = normalizeAuthProfileConfig(type, input?.config || {});
  await validateReferencedService(env, organizationId, projectId, type, config);
  try {
    return publicProfile(await insertAuthProfile(env, {
      organizationId,
      projectId,
      name,
      profileKey,
      type,
      configJson: JSON.stringify(config),
      enabled: input?.enabled !== false,
      createdByUserId: userId,
    }));
  } catch (error) {
    return mapDbConflict(error);
  }
}

export async function patchProjectAuthProfile(env, { organizationId, projectId, authProfileId, input }) {
  const currentRaw = await getAuthProfile(env, organizationId, projectId, authProfileId, { includeArchived: true });
  if (!currentRaw) {
    const err = new Error('Auth Profile não encontrado.');
    err.status = 404;
    err.code = 'AUTH_PROFILE_NOT_FOUND';
    throw err;
  }
  if (currentRaw.status === 'archived') {
    const err = new Error('Auth Profile arquivado não pode ser alterado.');
    err.status = 409;
    err.code = 'AUTH_PROFILE_ARCHIVED';
    throw err;
  }
  const requestedKey = input?.profileKey === undefined && input?.key === undefined
    ? currentRaw.profileKey
    : normalizeProfileKey(input?.profileKey || input?.key);
  if (requestedKey !== currentRaw.profileKey) {
    const err = new Error('profileKey é imutável porque será usada como referência estável nos Test Definitions.');
    err.status = 409;
    err.code = 'AUTH_PROFILE_KEY_IMMUTABLE';
    throw err;
  }
  const requestedType = input?.type === undefined ? currentRaw.type : normalizeAuthProfileType(input.type);
  if (requestedType !== currentRaw.type) {
    const err = new Error('type é imutável porque define o contrato de credenciais do Auth Profile. Crie outro perfil para trocar o tipo.');
    err.status = 409;
    err.code = 'AUTH_PROFILE_TYPE_IMMUTABLE';
    throw err;
  }

  const name = input?.name === undefined ? currentRaw.name : cleanConfigText(input.name, 160);
  if (name.length < 2) {
    const err = new Error('Nome do Auth Profile é obrigatório.');
    err.status = 400;
    throw err;
  }
  const currentConfig = publicAuthProfileConfig(currentRaw.configJson);
  const config = input?.config === undefined ? currentConfig : normalizeAuthProfileConfig(currentRaw.type, input.config);
  await validateReferencedService(env, organizationId, projectId, currentRaw.type, config);
  const enabled = input?.enabled === undefined ? currentRaw.enabled : input.enabled === true;

  try {
    return publicProfile(await persistAuthProfile(env, {
      ...currentRaw,
      organizationId,
      projectId,
      authProfileId,
      name,
      profileKey: currentRaw.profileKey,
      type: currentRaw.type,
      configJson: JSON.stringify(config),
      enabled,
      status: currentRaw.status,
    }));
  } catch (error) {
    return mapDbConflict(error);
  }
}

export async function archiveProjectAuthProfile(env, { organizationId, projectId, authProfileId }) {
  const current = await getProjectAuthProfile(env, organizationId, projectId, authProfileId, { includeArchived: true });
  if (current.status === 'archived') return current;
  return publicProfile(await archiveAuthProfileAndBindings(env, { organizationId, projectId, authProfileId }));
}

export { publicProfile as publicAuthProfile, expectedSecretKindForAuthType };
