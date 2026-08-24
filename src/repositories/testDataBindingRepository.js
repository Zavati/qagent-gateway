import { requireDataDb } from './dataDb.js';

const BINDING_SELECT = `
  SELECT
    binding_id AS bindingId,
    organization_id AS organizationId,
    project_id AS projectId,
    scope_type AS scopeType,
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
  FROM test_data_bindings
`;

export async function listEndpointTestDataBindings(env, organizationId, projectId, endpointId, { environmentId = null, includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const clauses = ['organization_id = ?', 'project_id = ?'];
  const args = [organizationId, projectId];
  if (environmentId) {
    clauses.push("(scope_type = 'PROJECT' OR (scope_type = 'ENVIRONMENT' AND environment_id = ?) OR (scope_type = 'ENDPOINT' AND environment_id = ? AND endpoint_id = ?))");
    args.push(environmentId, environmentId, endpointId);
  } else {
    clauses.push("(scope_type = 'PROJECT' OR scope_type = 'ENVIRONMENT' OR (scope_type = 'ENDPOINT' AND endpoint_id = ?))");
    args.push(endpointId);
  }
  if (!includeArchived) clauses.push("status = 'active'");
  const sql = `${BINDING_SELECT}
    WHERE ${clauses.join(' AND ')}
    ORDER BY CASE scope_type WHEN 'PROJECT' THEN 1 WHEN 'ENVIRONMENT' THEN 2 ELSE 3 END ASC,
             COALESCE(environment_id, '') ASC, target ASC, selector ASC`;
  const result = await db.prepare(sql).bind(...args).all();
  return result?.results || [];
}

export async function getEndpointTestDataBinding(env, organizationId, projectId, endpointId, bindingId, { includeArchived = false } = {}) {
  if (!bindingId) return null;
  const db = requireDataDb(env);
  const clauses = [
    'organization_id = ?',
    'project_id = ?',
    'binding_id = ?',
    "(scope_type IN ('PROJECT', 'ENVIRONMENT') OR endpoint_id = ?)",
  ];
  if (!includeArchived) clauses.push("status = 'active'");
  return db.prepare(`${BINDING_SELECT} WHERE ${clauses.join(' AND ')} LIMIT 1`)
    .bind(organizationId, projectId, bindingId, endpointId)
    .first();
}

export async function createEndpointTestDataBinding(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const bindingId = input.bindingId || `tdb_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO test_data_bindings (
      binding_id, organization_id, project_id, scope_type, environment_id, endpoint_id,
      target, selector, source_type, value_type,
      generator_kind, generator_config_json, fixed_value_json, secret_id,
      description, status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    bindingId,
    input.organizationId,
    input.projectId,
    input.scopeType,
    input.environmentId || null,
    input.endpointId || null,
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
  return getEndpointTestDataBinding(env, input.organizationId, input.projectId, input.endpointContextId || input.endpointId || '', bindingId, { includeArchived: true });
}

export async function updateEndpointTestDataBinding(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE test_data_bindings
    SET source_type = ?, value_type = ?, generator_kind = ?, generator_config_json = ?,
        fixed_value_json = ?, secret_id = ?, description = ?, status = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND binding_id = ?
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
    input.bindingId,
  ).run();
  return getEndpointTestDataBinding(env, input.organizationId, input.projectId, input.endpointContextId || input.endpointId || '', input.bindingId, { includeArchived: true });
}

export async function countActiveTestDataSecretBindings(env, organizationId, projectId, secretId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM test_data_bindings
    WHERE organization_id = ? AND project_id = ? AND secret_id = ? AND status = 'active'
  `).bind(organizationId, projectId, secretId).first();
  return Number(row?.total || 0);
}
