import { requireDataDb } from './dataDb.js';

const PROFILE_SELECT = `
  SELECT
    auth_profile_id AS authProfileId,
    organization_id AS organizationId,
    project_id AS projectId,
    name,
    profile_key AS profileKey,
    type,
    config_json AS configJson,
    enabled,
    status,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM auth_profiles
`;

const BINDING_SELECT = `
  SELECT
    b.binding_id AS bindingId,
    b.organization_id AS organizationId,
    b.project_id AS projectId,
    b.environment_id AS environmentId,
    e.name AS environmentName,
    e.slug AS environmentSlug,
    e.environment_type AS environmentType,
    b.auth_profile_id AS authProfileId,
    p.name AS authProfileName,
    p.profile_key AS profileKey,
    p.type AS authProfileType,
    p.config_json AS configJson,
    p.enabled AS authProfileEnabled,
    b.secret_id AS secretId,
    s.name AS secretName,
    s.kind AS secretKind,
    s.status AS secretStatus,
    b.status,
    b.created_by_user_id AS createdByUserId,
    b.created_at AS createdAt,
    b.updated_at AS updatedAt
  FROM auth_profile_environment_bindings b
  JOIN environments e
    ON e.organization_id = b.organization_id
    AND e.project_id = b.project_id
    AND e.environment_id = b.environment_id
  JOIN auth_profiles p
    ON p.organization_id = b.organization_id
    AND p.project_id = b.project_id
    AND p.auth_profile_id = b.auth_profile_id
  LEFT JOIN secrets s
    ON s.organization_id = b.organization_id
    AND s.project_id = b.project_id
    AND s.secret_id = b.secret_id
`;

function normalizeProfile(row) {
  if (!row) return null;
  return { ...row, enabled: Number(row.enabled) === 1 };
}

function normalizeBinding(row) {
  if (!row) return null;
  return {
    ...row,
    authProfileEnabled: Number(row.authProfileEnabled) === 1,
    credentialsConfigured: Boolean(row.secretId && row.secretStatus === 'active'),
  };
}

export async function listAuthProfiles(env, organizationId, projectId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${PROFILE_SELECT} WHERE organization_id = ? AND project_id = ? ORDER BY created_at ASC`
    : `${PROFILE_SELECT} WHERE organization_id = ? AND project_id = ? AND status = 'active' ORDER BY created_at ASC`;
  const result = await db.prepare(sql).bind(organizationId, projectId).all();
  return (result?.results || []).map(normalizeProfile);
}

export async function getAuthProfile(env, organizationId, projectId, authProfileId, { includeArchived = false } = {}) {
  if (!organizationId || !projectId || !authProfileId) return null;
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${PROFILE_SELECT} WHERE organization_id = ? AND project_id = ? AND auth_profile_id = ? LIMIT 1`
    : `${PROFILE_SELECT} WHERE organization_id = ? AND project_id = ? AND auth_profile_id = ? AND status = 'active' LIMIT 1`;
  return normalizeProfile(await db.prepare(sql).bind(organizationId, projectId, authProfileId).first());
}

export async function getAuthProfileByKey(env, organizationId, projectId, profileKey) {
  if (!organizationId || !projectId || !profileKey) return null;
  const db = requireDataDb(env);
  return normalizeProfile(await db.prepare(`${PROFILE_SELECT}
    WHERE organization_id = ? AND project_id = ? AND profile_key = ? AND status = 'active' LIMIT 1
  `).bind(organizationId, projectId, profileKey).first());
}

export async function createAuthProfile(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const authProfileId = input.authProfileId || `authp_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO auth_profiles (
      auth_profile_id, organization_id, project_id, name, profile_key,
      type, config_json, enabled, status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(
    authProfileId,
    input.organizationId,
    input.projectId,
    input.name,
    input.profileKey,
    input.type,
    input.configJson,
    input.enabled === false ? 0 : 1,
    input.createdByUserId || null,
    now,
    now,
  ).run();
  return getAuthProfile(env, input.organizationId, input.projectId, authProfileId, { includeArchived: true });
}

export async function updateAuthProfile(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE auth_profiles
    SET name = ?, profile_key = ?, type = ?, config_json = ?, enabled = ?, status = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND auth_profile_id = ?
  `).bind(
    input.name,
    input.profileKey,
    input.type,
    input.configJson,
    input.enabled ? 1 : 0,
    input.status,
    now,
    input.organizationId,
    input.projectId,
    input.authProfileId,
  ).run();
  return getAuthProfile(env, input.organizationId, input.projectId, input.authProfileId, { includeArchived: true });
}

export async function archiveAuthProfileAndBindings(env, { organizationId, projectId, authProfileId }) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const archiveProfile = db.prepare(`
    UPDATE auth_profiles SET status = 'archived', enabled = 0, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND auth_profile_id = ?
  `).bind(now, organizationId, projectId, authProfileId);
  const archiveBindings = db.prepare(`
    UPDATE auth_profile_environment_bindings SET status = 'archived', updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND auth_profile_id = ? AND status = 'active'
  `).bind(now, organizationId, projectId, authProfileId);
  if (typeof db.batch === 'function') await db.batch([archiveProfile, archiveBindings]);
  else {
    await archiveProfile.run();
    await archiveBindings.run();
  }
  return getAuthProfile(env, organizationId, projectId, authProfileId, { includeArchived: true });
}

export async function listAuthProfileBindings(env, organizationId, projectId, authProfileId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${BINDING_SELECT} WHERE b.organization_id = ? AND b.project_id = ? AND b.auth_profile_id = ? ORDER BY e.created_at ASC`
    : `${BINDING_SELECT} WHERE b.organization_id = ? AND b.project_id = ? AND b.auth_profile_id = ? AND b.status = 'active' ORDER BY e.created_at ASC`;
  const result = await db.prepare(sql).bind(organizationId, projectId, authProfileId).all();
  return (result?.results || []).map(normalizeBinding);
}

export async function listEnvironmentAuthProfileBindings(env, organizationId, projectId, environmentId) {
  const db = requireDataDb(env);
  const result = await db.prepare(`${BINDING_SELECT}
    WHERE b.organization_id = ? AND b.project_id = ? AND b.environment_id = ?
      AND b.status = 'active' AND p.status = 'active' AND p.enabled = 1
    ORDER BY p.created_at ASC
  `).bind(organizationId, projectId, environmentId).all();
  return (result?.results || []).map(normalizeBinding);
}

export async function getAuthProfileBinding(env, organizationId, projectId, authProfileId, environmentId, { includeArchived = false } = {}) {
  const db = requireDataDb(env);
  const sql = includeArchived
    ? `${BINDING_SELECT} WHERE b.organization_id = ? AND b.project_id = ? AND b.auth_profile_id = ? AND b.environment_id = ? LIMIT 1`
    : `${BINDING_SELECT} WHERE b.organization_id = ? AND b.project_id = ? AND b.auth_profile_id = ? AND b.environment_id = ? AND b.status = 'active' LIMIT 1`;
  return normalizeBinding(await db.prepare(sql).bind(organizationId, projectId, authProfileId, environmentId).first());
}

export async function upsertAuthProfileBinding(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const bindingId = input.bindingId || `authb_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO auth_profile_environment_bindings (
      binding_id, organization_id, project_id, environment_id,
      auth_profile_id, secret_id, status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(organization_id, project_id, environment_id, auth_profile_id)
    DO UPDATE SET
      secret_id = excluded.secret_id,
      status = 'active',
      updated_at = excluded.updated_at
  `).bind(
    bindingId,
    input.organizationId,
    input.projectId,
    input.environmentId,
    input.authProfileId,
    input.secretId || null,
    input.createdByUserId || null,
    now,
    now,
  ).run();
  return getAuthProfileBinding(env, input.organizationId, input.projectId, input.authProfileId, input.environmentId, { includeArchived: true });
}

export async function archiveAuthProfileBinding(env, { organizationId, projectId, authProfileId, environmentId }) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE auth_profile_environment_bindings
    SET status = 'archived', updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND auth_profile_id = ? AND environment_id = ?
  `).bind(now, organizationId, projectId, authProfileId, environmentId).run();
  return getAuthProfileBinding(env, organizationId, projectId, authProfileId, environmentId, { includeArchived: true });
}
