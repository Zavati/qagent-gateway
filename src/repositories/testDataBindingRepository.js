import { requireDataDb } from './dataDb.js';

const BINDING_SELECT = `
  SELECT
    binding_id AS bindingId,
    organization_id AS organizationId,
    project_id AS projectId,
    environment_id AS environmentId,
    endpoint_id AS endpointId,
    target,
    selector,
    source_type AS sourceType,
    value_type AS valueType,
    generator_kind AS generatorKind,
    generator_config_json AS generatorConfigJson,
    fixed_value_json AS fixedValueJson,
    secret_id AS secretId,
    description,
    status,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM endpoint_test_data_bindings
`;

export async function listEndpointTestDataBindings(env, organizationId, projectId, endpointId, { environmentId = null, includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const clauses = ['organization_id = ?', 'project_id = ?', 'endpoint_id = ?'];
  const args = [organizationId, projectId, endpointId];
  if (environmentId) {
    clauses.push('environment_id = ?');
    args.push(environmentId);
  }
  if (!includeArchived) clauses.push("status = 'active'");
  const result = await db.prepare(`${BINDING_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY environment_id ASC, target ASC, selector ASC`).bind(...args).all();
  return result?.results || [];
}

export async function getEndpointTestDataBinding(env, organizationId, projectId, endpointId, bindingId, { includeArchived = false } = {}) {
  if (!bindingId) return null;
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${BINDING_SELECT} WHERE organization_id = ? AND project_id = ? AND endpoint_id = ? AND binding_id = ? LIMIT 1`
    : `${BINDING_SELECT} WHERE organization_id = ? AND project_id = ? AND endpoint_id = ? AND binding_id = ? AND status = 'active' LIMIT 1`;
  return db.prepare(sql).bind(organizationId, projectId, endpointId, bindingId).first();
}

export async function createEndpointTestDataBinding(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const bindingId = input.bindingId || `tdb_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO endpoint_test_data_bindings (
      binding_id, organization_id, project_id, environment_id, endpoint_id,
      target, selector, source_type, value_type,
      generator_kind, generator_config_json, fixed_value_json, secret_id,
      description, status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    bindingId,
    input.organizationId,
    input.projectId,
    input.environmentId,
    input.endpointId,
    input.target,
    input.selector,
    input.sourceType,
    input.valueType,
    input.generatorKind || null,
    input.generatorConfigJson || null,
    input.fixedValueJson || null,
    input.secretId || null,
    input.description || null,
    input.createdByUserId || null,
    now,
    now,
  ).run();
  return getEndpointTestDataBinding(env, input.organizationId, input.projectId, input.endpointId, bindingId, { includeArchived: true });
}

export async function updateEndpointTestDataBinding(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE endpoint_test_data_bindings
    SET source_type = ?, value_type = ?, generator_kind = ?, generator_config_json = ?,
        fixed_value_json = ?, secret_id = ?, description = ?, status = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND endpoint_id = ? AND binding_id = ?
  `).bind(
    input.sourceType,
    input.valueType,
    input.generatorKind || null,
    input.generatorConfigJson || null,
    input.fixedValueJson || null,
    input.secretId || null,
    input.description || null,
    input.status,
    now,
    input.organizationId,
    input.projectId,
    input.endpointId,
    input.bindingId,
  ).run();
  return getEndpointTestDataBinding(env, input.organizationId, input.projectId, input.endpointId, input.bindingId, { includeArchived: true });
}

export async function countActiveTestDataSecretBindings(env, organizationId, projectId, secretId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM endpoint_test_data_bindings
    WHERE organization_id = ? AND project_id = ? AND secret_id = ? AND status = 'active'
  `).bind(organizationId, projectId, secretId).first();
  return Number(row?.total || 0);
}
