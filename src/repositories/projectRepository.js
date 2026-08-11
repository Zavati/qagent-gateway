import { requireDataDb } from './dataDb.js';

const PROJECT_SELECT = `
  SELECT
    project_id AS projectId,
    organization_id AS organizationId,
    name,
    slug,
    description,
    status,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM projects
`;

export async function listProjects(env, organizationId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${PROJECT_SELECT} WHERE organization_id = ? ORDER BY created_at DESC`
    : `${PROJECT_SELECT} WHERE organization_id = ? AND status = 'active' ORDER BY created_at DESC`;
  const result = await db.prepare(sql).bind(organizationId).all();
  return result?.results || [];
}

export async function getProject(env, organizationId, projectId, { includeArchived = false } = {}) {
  if (!organizationId || !projectId) return null;
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${PROJECT_SELECT} WHERE organization_id = ? AND project_id = ? LIMIT 1`
    : `${PROJECT_SELECT} WHERE organization_id = ? AND project_id = ? AND status = 'active' LIMIT 1`;
  return db.prepare(sql).bind(organizationId, projectId).first();
}

export async function createProject(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const projectId = input.projectId || `prj_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO projects (
      project_id, organization_id, name, slug, description,
      status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    projectId,
    input.organizationId,
    input.name,
    input.slug,
    input.description || null,
    input.createdByUserId || null,
    now,
    now,
  ).run();
  return getProject(env, input.organizationId, projectId, { includeArchived: true });
}

export async function updateProject(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE projects
    SET name = ?, slug = ?, description = ?, status = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ?
  `).bind(
    input.name,
    input.slug,
    input.description || null,
    input.status,
    now,
    input.organizationId,
    input.projectId,
  ).run();
  return getProject(env, input.organizationId, input.projectId, { includeArchived: true });
}
