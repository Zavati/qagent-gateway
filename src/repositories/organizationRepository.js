import { requireDataDb } from './dataDb.js';

const ORGANIZATION_SELECT = `
  SELECT
    organization_id AS organizationId,
    legacy_customer_id AS legacyCustomerId,
    name,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM organizations
`;

export async function getOrganizationById(env, organizationId) {
  if (!organizationId) return null;
  const db = requireDataDb(env);
  return db.prepare(`${ORGANIZATION_SELECT} WHERE organization_id = ? LIMIT 1`)
    .bind(organizationId)
    .first();
}

export async function getOrganizationByLegacyCustomerId(env, legacyCustomerId) {
  if (!legacyCustomerId) return null;
  const db = requireDataDb(env);
  return db.prepare(`${ORGANIZATION_SELECT} WHERE legacy_customer_id = ? LIMIT 1`)
    .bind(legacyCustomerId)
    .first();
}

export async function createOrganization(env, input) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const organizationId = input.organizationId || `org_${crypto.randomUUID()}`;

  await db.prepare(`
    INSERT OR IGNORE INTO organizations (
      organization_id, legacy_customer_id, name, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?)
  `).bind(
    organizationId,
    input.legacyCustomerId || null,
    input.name,
    now,
    now,
  ).run();

  if (input.legacyCustomerId) {
    return getOrganizationByLegacyCustomerId(env, input.legacyCustomerId);
  }
  return getOrganizationById(env, organizationId);
}

export async function updateOrganization(env, organizationId, { name, status }) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE organizations
    SET name = ?, status = ?, updated_at = ?
    WHERE organization_id = ?
  `).bind(name, status, now, organizationId).run();
  return getOrganizationById(env, organizationId);
}

export async function upsertOrganizationMember(env, { organizationId, userId, role = 'member' }) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO organization_members (
      organization_id, user_id, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?)
    ON CONFLICT(organization_id, user_id) DO UPDATE SET
      role = excluded.role,
      status = 'active',
      updated_at = excluded.updated_at
  `).bind(organizationId, userId, role, now, now).run();
}

export async function getOrganizationMember(env, organizationId, userId) {
  if (!organizationId || !userId) return null;
  const db = requireDataDb(env);
  return db.prepare(`
    SELECT
      organization_id AS organizationId,
      user_id AS userId,
      role,
      status,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM organization_members
    WHERE organization_id = ? AND user_id = ?
    LIMIT 1
  `).bind(organizationId, userId).first();
}
