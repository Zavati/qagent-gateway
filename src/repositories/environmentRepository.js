import { requireDataDb } from './dataDb.js';

const ENVIRONMENT_SELECT = `
  SELECT
    environment_id AS environmentId,
    organization_id AS organizationId,
    project_id AS projectId,
    name,
    slug,
    environment_type AS environmentType,
    web_base_url AS webBaseUrl,
    is_default AS isDefault,
    status,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM environments
`;

function normalizeRow(row) {
  if (!row) return null;
  return { ...row, isDefault: Number(row.isDefault) === 1 };
}

export async function listEnvironments(env, organizationId, projectId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${ENVIRONMENT_SELECT} WHERE organization_id = ? AND project_id = ? ORDER BY is_default DESC, created_at ASC`
    : `${ENVIRONMENT_SELECT} WHERE organization_id = ? AND project_id = ? AND status = 'active' ORDER BY is_default DESC, created_at ASC`;
  const result = await db.prepare(sql).bind(organizationId, projectId).all();
  return (result?.results || []).map(normalizeRow);
}

export async function getEnvironment(env, organizationId, projectId, environmentId, { includeArchived = false } = {}) {
  if (!organizationId || !projectId || !environmentId) return null;
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${ENVIRONMENT_SELECT} WHERE organization_id = ? AND project_id = ? AND environment_id = ? LIMIT 1`
    : `${ENVIRONMENT_SELECT} WHERE organization_id = ? AND project_id = ? AND environment_id = ? AND status = 'active' LIMIT 1`;
  return normalizeRow(await db.prepare(sql).bind(organizationId, projectId, environmentId).first());
}

export async function countActiveEnvironments(env, organizationId, projectId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM environments
    WHERE organization_id = ? AND project_id = ? AND status = 'active'
  `).bind(organizationId, projectId).first();
  return Number(row?.total || 0);
}

export async function createEnvironment(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const environmentId = input.environmentId || `env_${crypto.randomUUID()}`;

  const insert = db.prepare(`
    INSERT INTO environments (
      environment_id, organization_id, project_id, name, slug,
      environment_type, web_base_url, is_default, status,
      created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    environmentId,
    input.organizationId,
    input.projectId,
    input.name,
    input.slug,
    input.environmentType,
    input.webBaseUrl || null,
    input.isDefault ? 1 : 0,
    input.createdByUserId || null,
    now,
    now,
  );

  if (input.isDefault) {
    const clearDefault = db.prepare(`
      UPDATE environments
      SET is_default = 0, updated_at = ?
      WHERE organization_id = ? AND project_id = ? AND is_default = 1
    `).bind(now, input.organizationId, input.projectId);
    if (typeof db.batch === 'function') await db.batch([clearDefault, insert]);
    else {
      await clearDefault.run();
      await insert.run();
    }
  } else {
    await insert.run();
  }

  return getEnvironment(env, input.organizationId, input.projectId, environmentId, { includeArchived: true });
}

export async function updateEnvironment(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const update = db.prepare(`
    UPDATE environments
    SET name = ?, slug = ?, environment_type = ?, web_base_url = ?,
        is_default = ?, status = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND environment_id = ?
  `).bind(
    input.name,
    input.slug,
    input.environmentType,
    input.webBaseUrl || null,
    input.isDefault ? 1 : 0,
    input.status,
    now,
    input.organizationId,
    input.projectId,
    input.environmentId,
  );

  if (input.isDefault) {
    const clearDefault = db.prepare(`
      UPDATE environments
      SET is_default = 0, updated_at = ?
      WHERE organization_id = ? AND project_id = ? AND environment_id <> ? AND is_default = 1
    `).bind(now, input.organizationId, input.projectId, input.environmentId);
    if (typeof db.batch === 'function') await db.batch([clearDefault, update]);
    else {
      await clearDefault.run();
      await update.run();
    }
  } else {
    await update.run();
  }

  return getEnvironment(env, input.organizationId, input.projectId, input.environmentId, { includeArchived: true });
}


export async function archiveEnvironmentAndPromoteDefault(env, { organizationId, projectId, environmentId }) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const current = await getEnvironment(env, organizationId, projectId, environmentId, { includeArchived: true });
  if (!current) return null;
  if (current.status === 'archived') return current;

  const archive = db.prepare(`
    UPDATE environments
    SET status = 'archived', is_default = 0, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND environment_id = ?
  `).bind(now, organizationId, projectId, environmentId);

  const promote = db.prepare(`
    UPDATE environments
    SET is_default = 1, updated_at = ?
    WHERE organization_id = ?
      AND project_id = ?
      AND status = 'active'
      AND environment_id = (
        SELECT environment_id
        FROM environments
        WHERE organization_id = ?
          AND project_id = ?
          AND status = 'active'
          AND environment_id <> ?
        ORDER BY created_at ASC
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM environments
        WHERE organization_id = ?
          AND project_id = ?
          AND status = 'active'
          AND environment_id <> ?
          AND is_default = 1
      )
  `).bind(
    now,
    organizationId,
    projectId,
    organizationId,
    projectId,
    environmentId,
    organizationId,
    projectId,
    environmentId,
  );

  if (typeof db.batch === 'function') await db.batch([archive, promote]);
  else {
    await archive.run();
    await promote.run();
  }

  return getEnvironment(env, organizationId, projectId, environmentId, { includeArchived: true });
}
