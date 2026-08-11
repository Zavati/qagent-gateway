import { requireDataDb } from './dataDb.js';

const VARIABLE_SELECT = `
  SELECT
    variable_id AS variableId,
    organization_id AS organizationId,
    project_id AS projectId,
    environment_id AS environmentId,
    variable_key AS variableKey,
    variable_value AS variableValue,
    value_type AS valueType,
    description,
    status,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM environment_variables
`;

export async function listEnvironmentVariables(env, organizationId, projectId, environmentId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${VARIABLE_SELECT} WHERE organization_id = ? AND project_id = ? AND environment_id = ? ORDER BY variable_key ASC, created_at ASC`
    : `${VARIABLE_SELECT} WHERE organization_id = ? AND project_id = ? AND environment_id = ? AND status = 'active' ORDER BY variable_key ASC`;
  const result = await db.prepare(sql).bind(organizationId, projectId, environmentId).all();
  return result?.results || [];
}

export async function getEnvironmentVariable(env, organizationId, projectId, environmentId, variableId, { includeArchived = false } = {}) {
  if (!variableId) return null;
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${VARIABLE_SELECT} WHERE organization_id = ? AND project_id = ? AND environment_id = ? AND variable_id = ? LIMIT 1`
    : `${VARIABLE_SELECT} WHERE organization_id = ? AND project_id = ? AND environment_id = ? AND variable_id = ? AND status = 'active' LIMIT 1`;
  return db.prepare(sql).bind(organizationId, projectId, environmentId, variableId).first();
}

export async function createEnvironmentVariable(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const variableId = input.variableId || `var_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO environment_variables (
      variable_id, organization_id, project_id, environment_id,
      variable_key, variable_value, value_type, description, status,
      created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    variableId,
    input.organizationId,
    input.projectId,
    input.environmentId,
    input.variableKey,
    input.variableValue,
    input.valueType,
    input.description || null,
    input.createdByUserId || null,
    now,
    now,
  ).run();
  return getEnvironmentVariable(env, input.organizationId, input.projectId, input.environmentId, variableId, { includeArchived: true });
}

export async function updateEnvironmentVariable(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE environment_variables
    SET variable_key = ?, variable_value = ?, value_type = ?, description = ?, status = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND environment_id = ? AND variable_id = ?
  `).bind(
    input.variableKey,
    input.variableValue,
    input.valueType,
    input.description || null,
    input.status,
    now,
    input.organizationId,
    input.projectId,
    input.environmentId,
    input.variableId,
  ).run();
  return getEnvironmentVariable(env, input.organizationId, input.projectId, input.environmentId, input.variableId, { includeArchived: true });
}
