import { requireDataDb } from './dataDb.js';

const SECRET_META_SELECT = `
  SELECT
    secret_id AS secretId,
    organization_id AS organizationId,
    project_id AS projectId,
    name,
    kind,
    key_version AS keyVersion,
    algorithm,
    status,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt,
    rotated_at AS rotatedAt
  FROM secrets
`;

const SECRET_FULL_SELECT = `
  SELECT
    secret_id AS secretId,
    organization_id AS organizationId,
    project_id AS projectId,
    name,
    kind,
    ciphertext,
    iv,
    key_version AS keyVersion,
    algorithm,
    status,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt,
    rotated_at AS rotatedAt
  FROM secrets
`;

export async function listSecrets(env, organizationId, projectId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${SECRET_META_SELECT} WHERE organization_id = ? AND project_id = ? ORDER BY created_at ASC`
    : `${SECRET_META_SELECT} WHERE organization_id = ? AND project_id = ? AND status = 'active' ORDER BY created_at ASC`;
  const result = await db.prepare(sql).bind(organizationId, projectId).all();
  return result?.results || [];
}

export async function getSecretMetadata(env, organizationId, projectId, secretId, { includeArchived = false } = {}) {
  if (!organizationId || !projectId || !secretId) return null;
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${SECRET_META_SELECT} WHERE organization_id = ? AND project_id = ? AND secret_id = ? LIMIT 1`
    : `${SECRET_META_SELECT} WHERE organization_id = ? AND project_id = ? AND secret_id = ? AND status = 'active' LIMIT 1`;
  return db.prepare(sql).bind(organizationId, projectId, secretId).first();
}

export async function getSecretRecord(env, organizationId, projectId, secretId, { includeArchived = false } = {}) {
  if (!organizationId || !projectId || !secretId) return null;
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${SECRET_FULL_SELECT} WHERE organization_id = ? AND project_id = ? AND secret_id = ? LIMIT 1`
    : `${SECRET_FULL_SELECT} WHERE organization_id = ? AND project_id = ? AND secret_id = ? AND status = 'active' LIMIT 1`;
  return db.prepare(sql).bind(organizationId, projectId, secretId).first();
}

export async function createSecret(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const secretId = input.secretId || `sec_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO secrets (
      secret_id, organization_id, project_id, name, kind,
      ciphertext, iv, key_version, algorithm, status,
      created_by_user_id, created_at, updated_at, rotated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).bind(
    secretId,
    input.organizationId,
    input.projectId,
    input.name,
    input.kind,
    input.ciphertext,
    input.iv,
    input.keyVersion,
    input.algorithm || 'AES-256-GCM',
    input.createdByUserId || null,
    now,
    now,
    now,
  ).run();
  return getSecretMetadata(env, input.organizationId, input.projectId, secretId, { includeArchived: true });
}

export async function updateSecretMetadata(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE secrets
    SET name = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND secret_id = ?
  `).bind(input.name, now, input.organizationId, input.projectId, input.secretId).run();
  return getSecretMetadata(env, input.organizationId, input.projectId, input.secretId, { includeArchived: true });
}

export async function rotateSecretValue(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE secrets
    SET ciphertext = ?, iv = ?, key_version = ?, algorithm = ?, updated_at = ?, rotated_at = ?
    WHERE organization_id = ? AND project_id = ? AND secret_id = ? AND status = 'active'
  `).bind(
    input.ciphertext,
    input.iv,
    input.keyVersion,
    input.algorithm || 'AES-256-GCM',
    now,
    now,
    input.organizationId,
    input.projectId,
    input.secretId,
  ).run();
  return getSecretMetadata(env, input.organizationId, input.projectId, input.secretId, { includeArchived: true });
}

export async function countActiveSecretBindings(env, organizationId, projectId, secretId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM auth_profile_environment_bindings
    WHERE organization_id = ? AND project_id = ? AND secret_id = ? AND status = 'active'
  `).bind(organizationId, projectId, secretId).first();
  return Number(row?.total || 0);
}

export async function archiveSecret(env, { organizationId, projectId, secretId }) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE secrets
    SET status = 'archived', updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND secret_id = ?
  `).bind(now, organizationId, projectId, secretId).run();
  return getSecretMetadata(env, organizationId, projectId, secretId, { includeArchived: true });
}
