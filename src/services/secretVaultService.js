import { cleanConfigText } from '../lib/environmentConfig.js';
import { normalizeAuthSecretPayload } from '../lib/authProfileConfig.js';
import { encryptSecretPayload, decryptSecretPayload } from '../security/secretVaultCrypto.js';
import {
  archiveSecret as persistArchiveSecret,
  countActiveSecretBindings,
  createSecret as insertSecret,
  getSecretMetadata,
  getSecretRecord,
  listSecrets,
  rotateSecretValue as persistRotateSecretValue,
  updateSecretMetadata,
} from '../repositories/secretRepository.js';
import { getOrganizationProject } from './projectService.js';
import { countActiveTestDataSecretBindings } from '../repositories/testDataBindingRepository.js';

const SECRET_KINDS = new Set(['generic', 'basic', 'api_key', 'oauth2_client_credentials', 'login_http_json']);

function normalizeSecretKind(value) {
  const kind = cleanConfigText(value || 'generic', 64).toLowerCase();
  if (!SECRET_KINDS.has(kind)) {
    const err = new Error('Secret kind inválido.');
    err.status = 400;
    err.code = 'INVALID_SECRET_KIND';
    throw err;
  }
  return kind;
}

function publicSecret(secret) {
  if (!secret) return null;
  const { ciphertext, iv, ...safe } = secret;
  return { ...safe, valueConfigured: true };
}

export async function listProjectSecrets(env, organizationId, projectId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId);
  return (await listSecrets(env, organizationId, projectId, options)).map(publicSecret);
}

export async function getProjectSecret(env, organizationId, projectId, secretId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId, { includeArchived: options.includeArchived === true });
  const secret = await getSecretMetadata(env, organizationId, projectId, secretId, options);
  if (!secret) {
    const err = new Error('Secret não encontrado.');
    err.status = 404;
    err.code = 'SECRET_NOT_FOUND';
    throw err;
  }
  return publicSecret(secret);
}

export async function createProjectSecret(env, { organizationId, projectId, userId, input, forcedKind, forcedName }) {
  await getOrganizationProject(env, organizationId, projectId);
  const name = cleanConfigText(forcedName || input?.name, 160);
  if (name.length < 2) {
    const err = new Error('Nome do Secret é obrigatório.');
    err.status = 400;
    err.code = 'SECRET_NAME_REQUIRED';
    throw err;
  }
  const kind = normalizeSecretKind(forcedKind || input?.kind || 'generic');
  const payload = normalizeAuthSecretPayload(kind, input?.value ?? input?.payload ?? input?.credentials);
  const secretId = `sec_${crypto.randomUUID()}`;
  const encrypted = await encryptSecretPayload(env, payload, { organizationId, secretId, kind });
  const saved = await insertSecret(env, {
    secretId,
    organizationId,
    projectId,
    name,
    kind,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    keyVersion: encrypted.keyVersion,
    algorithm: encrypted.algorithm,
    createdByUserId: userId,
  });
  return publicSecret(saved);
}

export async function renameProjectSecret(env, { organizationId, projectId, secretId, input }) {
  const current = await getProjectSecret(env, organizationId, projectId, secretId, { includeArchived: true });
  if (current.status === 'archived') {
    const err = new Error('Secret arquivado não pode ser alterado.');
    err.status = 409;
    err.code = 'SECRET_ARCHIVED';
    throw err;
  }
  const name = input?.name === undefined ? current.name : cleanConfigText(input.name, 160);
  if (name.length < 2) {
    const err = new Error('Nome do Secret é obrigatório.');
    err.status = 400;
    throw err;
  }
  return publicSecret(await updateSecretMetadata(env, { organizationId, projectId, secretId, name }));
}

export async function rotateProjectSecret(env, { organizationId, projectId, secretId, input }) {
  const record = await getSecretRecord(env, organizationId, projectId, secretId);
  if (!record) {
    const err = new Error('Secret não encontrado.');
    err.status = 404;
    err.code = 'SECRET_NOT_FOUND';
    throw err;
  }
  const payload = normalizeAuthSecretPayload(record.kind, input?.value ?? input?.payload ?? input?.credentials);
  const encrypted = await encryptSecretPayload(env, payload, {
    organizationId,
    secretId,
    kind: record.kind,
  });
  return publicSecret(await persistRotateSecretValue(env, {
    organizationId,
    projectId,
    secretId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    keyVersion: encrypted.keyVersion,
    algorithm: encrypted.algorithm,
  }));
}

export async function archiveProjectSecret(env, { organizationId, projectId, secretId }) {
  const current = await getProjectSecret(env, organizationId, projectId, secretId, { includeArchived: true });
  if (current.status === 'archived') return current;
  const [authBindings, testDataBindings] = await Promise.all([
    countActiveSecretBindings(env, organizationId, projectId, secretId),
    countActiveTestDataSecretBindings(env, organizationId, projectId, secretId),
  ]);
  if (authBindings > 0 || testDataBindings > 0) {
    const err = new Error('Secret está vinculado a uma configuração ativa de Auth/Test Data. Remova o binding antes de arquivar.');
    err.status = 409;
    err.code = 'SECRET_IN_USE';
    throw err;
  }
  return publicSecret(await persistArchiveSecret(env, { organizationId, projectId, secretId }));
}

export async function resolveProjectSecretValue(env, organizationId, projectId, secretId) {
  const record = await getSecretRecord(env, organizationId, projectId, secretId);
  if (!record) {
    const err = new Error('Secret não encontrado para execução.');
    err.status = 404;
    err.code = 'SECRET_NOT_FOUND';
    throw err;
  }
  const value = await decryptSecretPayload(env, record, {
    organizationId,
    secretId: record.secretId,
    kind: record.kind,
  });
  return { metadata: publicSecret(record), value };
}
