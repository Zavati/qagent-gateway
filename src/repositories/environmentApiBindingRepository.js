import { requireDataDb } from './dataDb.js';

const BINDING_SELECT = `
  SELECT
    b.binding_id AS bindingId,
    b.organization_id AS organizationId,
    b.project_id AS projectId,
    b.environment_id AS environmentId,
    b.api_service_id AS apiServiceId,
    s.name AS apiServiceName,
    s.service_key AS serviceKey,
    b.base_url AS baseUrl,
    b.status,
    b.created_by_user_id AS createdByUserId,
    b.created_at AS createdAt,
    b.updated_at AS updatedAt
  FROM environment_api_bindings b
  JOIN api_services s
    ON s.organization_id = b.organization_id
   AND s.project_id = b.project_id
   AND s.api_service_id = b.api_service_id
`;

export async function listEnvironmentApiBindings(env, organizationId, projectId, environmentId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const statusSql = includeArchived ? '' : ` AND b.status = 'active' AND s.status = 'active'`;
  const result = await db.prepare(`${BINDING_SELECT}
    WHERE b.organization_id = ? AND b.project_id = ? AND b.environment_id = ?${statusSql}
    ORDER BY s.service_key ASC
  `).bind(organizationId, projectId, environmentId).all();
  return result?.results || [];
}

export async function getEnvironmentApiBinding(env, organizationId, projectId, environmentId, apiServiceId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const statusSql = includeArchived ? '' : ` AND b.status = 'active' AND s.status = 'active'`;
  return db.prepare(`${BINDING_SELECT}
    WHERE b.organization_id = ? AND b.project_id = ? AND b.environment_id = ? AND b.api_service_id = ?${statusSql}
    LIMIT 1
  `).bind(organizationId, projectId, environmentId, apiServiceId).first();
}

export async function upsertEnvironmentApiBinding(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const existing = await getEnvironmentApiBinding(
    env,
    input.organizationId,
    input.projectId,
    input.environmentId,
    input.apiServiceId,
    { includeArchived: true },
  );

  if (existing) {
    await db.prepare(`
      UPDATE environment_api_bindings
      SET base_url = ?, status = 'active', updated_at = ?
      WHERE organization_id = ? AND project_id = ? AND environment_id = ? AND api_service_id = ?
    `).bind(
      input.baseUrl,
      now,
      input.organizationId,
      input.projectId,
      input.environmentId,
      input.apiServiceId,
    ).run();
  } else {
    const bindingId = input.bindingId || `bnd_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO environment_api_bindings (
        binding_id, organization_id, project_id, environment_id, api_service_id,
        base_url, status, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).bind(
      bindingId,
      input.organizationId,
      input.projectId,
      input.environmentId,
      input.apiServiceId,
      input.baseUrl,
      input.createdByUserId || null,
      now,
      now,
    ).run();
  }

  return getEnvironmentApiBinding(
    env,
    input.organizationId,
    input.projectId,
    input.environmentId,
    input.apiServiceId,
    { includeArchived: true },
  );
}

export async function archiveEnvironmentApiBinding(env, { organizationId, projectId, environmentId, apiServiceId }) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE environment_api_bindings
    SET status = 'archived', updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND environment_id = ? AND api_service_id = ?
  `).bind(now, organizationId, projectId, environmentId, apiServiceId).run();

  return getEnvironmentApiBinding(env, organizationId, projectId, environmentId, apiServiceId, { includeArchived: true });
}
