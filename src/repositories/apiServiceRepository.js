import { requireDataDb } from './dataDb.js';

const API_SERVICE_SELECT = `
  SELECT
    api_service_id AS apiServiceId,
    organization_id AS organizationId,
    project_id AS projectId,
    name,
    service_key AS serviceKey,
    description,
    status,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM api_services
`;

export async function listApiServices(env, organizationId, projectId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${API_SERVICE_SELECT} WHERE organization_id = ? AND project_id = ? ORDER BY created_at ASC`
    : `${API_SERVICE_SELECT} WHERE organization_id = ? AND project_id = ? AND status = 'active' ORDER BY created_at ASC`;
  const result = await db.prepare(sql).bind(organizationId, projectId).all();
  return result?.results || [];
}

export async function getApiService(env, organizationId, projectId, apiServiceId, { includeArchived = false } = {}) {
  if (!organizationId || !projectId || !apiServiceId) return null;
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${API_SERVICE_SELECT} WHERE organization_id = ? AND project_id = ? AND api_service_id = ? LIMIT 1`
    : `${API_SERVICE_SELECT} WHERE organization_id = ? AND project_id = ? AND api_service_id = ? AND status = 'active' LIMIT 1`;
  return db.prepare(sql).bind(organizationId, projectId, apiServiceId).first();
}

export async function createApiService(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const apiServiceId = input.apiServiceId || `svc_${crypto.randomUUID()}`;

  await db.prepare(`
    INSERT INTO api_services (
      api_service_id, organization_id, project_id, name, service_key,
      description, status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    apiServiceId,
    input.organizationId,
    input.projectId,
    input.name,
    input.serviceKey,
    input.description || null,
    input.createdByUserId || null,
    now,
    now,
  ).run();

  return getApiService(env, input.organizationId, input.projectId, apiServiceId, { includeArchived: true });
}

export async function updateApiService(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE api_services
    SET name = ?, service_key = ?, description = ?, status = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND api_service_id = ?
  `).bind(
    input.name,
    input.serviceKey,
    input.description || null,
    input.status,
    now,
    input.organizationId,
    input.projectId,
    input.apiServiceId,
  ).run();

  return getApiService(env, input.organizationId, input.projectId, input.apiServiceId, { includeArchived: true });
}

export async function archiveApiServiceAndBindings(env, { organizationId, projectId, apiServiceId }) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const archiveService = db.prepare(`
    UPDATE api_services
    SET status = 'archived', updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND api_service_id = ?
  `).bind(now, organizationId, projectId, apiServiceId);
  const archiveBindings = db.prepare(`
    UPDATE environment_api_bindings
    SET status = 'archived', updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND api_service_id = ? AND status = 'active'
  `).bind(now, organizationId, projectId, apiServiceId);

  if (typeof db.batch === 'function') await db.batch([archiveService, archiveBindings]);
  else {
    await archiveService.run();
    await archiveBindings.run();
  }

  return getApiService(env, organizationId, projectId, apiServiceId, { includeArchived: true });
}
