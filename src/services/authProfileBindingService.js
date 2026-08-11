import {
  archiveAuthProfileBinding as persistArchiveBinding,
  getAuthProfile,
  getAuthProfileBinding,
  listAuthProfileBindings,
  upsertAuthProfileBinding,
} from '../repositories/authProfileRepository.js';
import { getSecretMetadata } from '../repositories/secretRepository.js';
import { expectedSecretKindForAuthType, publicAuthProfileConfig } from '../lib/authProfileConfig.js';
import { getProjectEnvironment } from './environmentService.js';
import { getOrganizationProject } from './projectService.js';
import { createProjectSecret, rotateProjectSecret } from './secretVaultService.js';

function publicBinding(binding) {
  if (!binding) return null;
  const { configJson, secretStatus, ...rest } = binding;
  return {
    ...rest,
    authProfileConfig: publicAuthProfileConfig(configJson),
    credentialsConfigured: Boolean(binding.credentialsConfigured),
  };
}

async function requireProfile(env, organizationId, projectId, authProfileId, { includeArchived = false } = {}) {
  const profile = await getAuthProfile(env, organizationId, projectId, authProfileId, { includeArchived });
  if (!profile) {
    const err = new Error('Auth Profile não encontrado.');
    err.status = 404;
    err.code = 'AUTH_PROFILE_NOT_FOUND';
    throw err;
  }
  return profile;
}

export async function listProjectAuthProfileEnvironmentBindings(env, organizationId, projectId, authProfileId) {
  await getOrganizationProject(env, organizationId, projectId);
  await requireProfile(env, organizationId, projectId, authProfileId);
  return (await listAuthProfileBindings(env, organizationId, projectId, authProfileId)).map(publicBinding);
}

export async function getProjectAuthProfileEnvironmentBinding(env, organizationId, projectId, authProfileId, environmentId, options = {}) {
  await getProjectEnvironment(env, organizationId, projectId, environmentId, { includeArchived: options.includeArchived === true });
  await requireProfile(env, organizationId, projectId, authProfileId, { includeArchived: options.includeArchived === true });
  const binding = await getAuthProfileBinding(env, organizationId, projectId, authProfileId, environmentId, options);
  if (!binding) {
    const err = new Error('Auth Profile não está configurado neste Environment.');
    err.status = 404;
    err.code = 'AUTH_PROFILE_ENVIRONMENT_BINDING_NOT_FOUND';
    throw err;
  }
  return publicBinding(binding);
}

export async function putProjectAuthProfileEnvironmentBinding(env, { organizationId, projectId, authProfileId, environmentId, userId, input }) {
  const environment = await getProjectEnvironment(env, organizationId, projectId, environmentId);
  const profile = await requireProfile(env, organizationId, projectId, authProfileId);
  const existing = await getAuthProfileBinding(env, organizationId, projectId, authProfileId, environmentId, { includeArchived: true });
  const expectedKind = expectedSecretKindForAuthType(profile.type);
  const suppliedSecretId = String(input?.secretId || '').trim() || null;
  const suppliedCredentials = input?.credentials ?? input?.value ?? null;

  if (suppliedSecretId && suppliedCredentials) {
    const err = new Error('Informe secretId ou credentials, não ambos.');
    err.status = 400;
    err.code = 'AUTH_BINDING_SECRET_SOURCE_CONFLICT';
    throw err;
  }

  let secretId = null;
  if (profile.type === 'none') {
    if (suppliedSecretId || suppliedCredentials) {
      const err = new Error('Auth Profile do tipo none não aceita credenciais.');
      err.status = 400;
      err.code = 'AUTH_NONE_CREDENTIALS_FORBIDDEN';
      throw err;
    }
  } else if (suppliedSecretId) {
    const secret = await getSecretMetadata(env, organizationId, projectId, suppliedSecretId);
    if (!secret) {
      const err = new Error('Secret informado não existe neste Project.');
      err.status = 404;
      err.code = 'SECRET_NOT_FOUND';
      throw err;
    }
    if (secret.kind !== expectedKind) {
      const err = new Error(`Secret incompatível com Auth Profile ${profile.type}.`);
      err.status = 400;
      err.code = 'AUTH_SECRET_KIND_MISMATCH';
      throw err;
    }
    secretId = suppliedSecretId;
  } else if (suppliedCredentials) {
    if (existing?.secretId) {
      const currentSecret = await getSecretMetadata(env, organizationId, projectId, existing.secretId);
      if (!currentSecret || currentSecret.kind !== expectedKind) {
        const err = new Error('Secret atual do binding é incompatível e precisa ser substituído explicitamente.');
        err.status = 409;
        err.code = 'AUTH_EXISTING_SECRET_MISMATCH';
        throw err;
      }
      await rotateProjectSecret(env, {
        organizationId,
        projectId,
        secretId: existing.secretId,
        input: { credentials: suppliedCredentials },
      });
      secretId = existing.secretId;
    } else {
      const created = await createProjectSecret(env, {
        organizationId,
        projectId,
        userId,
        forcedKind: expectedKind,
        forcedName: `${profile.name} · ${environment.name}`,
        input: { credentials: suppliedCredentials },
      });
      secretId = created.secretId;
    }
  } else if (existing?.secretId) {
    secretId = existing.secretId;
  } else {
    const err = new Error('Credenciais são obrigatórias para configurar este Auth Profile no Environment.');
    err.status = 400;
    err.code = 'AUTH_CREDENTIALS_REQUIRED';
    throw err;
  }

  return publicBinding(await upsertAuthProfileBinding(env, {
    bindingId: existing?.bindingId,
    organizationId,
    projectId,
    environmentId,
    authProfileId,
    secretId,
    createdByUserId: userId,
  }));
}

export async function deleteProjectAuthProfileEnvironmentBinding(env, { organizationId, projectId, authProfileId, environmentId }) {
  const current = await getProjectAuthProfileEnvironmentBinding(env, organizationId, projectId, authProfileId, environmentId, { includeArchived: true });
  if (current.status === 'archived') return current;
  return publicBinding(await persistArchiveBinding(env, { organizationId, projectId, authProfileId, environmentId }));
}
