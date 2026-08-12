import {
  createOrganization,
  getOrganizationByLegacyCustomerId,
  getOrganizationMember,
  upsertOrganizationMember,
} from '../repositories/organizationRepository.js';

function organizationDisplayName(customer, user) {
  return String(
    customer?.company || customer?.name || user?.email || 'QAgent Organization'
  ).trim().slice(0, 160) || 'QAgent Organization';
}

/**
 * Foundation 07.4.2-F
 *
 * Provision the tenant root for a newly-created Console account.
 * The operation is intentionally idempotent because signup spans KV + D1 and
 * may be retried by recovery flows.
 */
export async function provisionSignupTenant(env, { customer, user }) {
  if (!customer?.customerId || !user?.userId) {
    const err = new Error('Customer e usuário são obrigatórios para provisionar a organização.');
    err.status = 500;
    err.code = 'SIGNUP_TENANT_INPUT_INVALID';
    throw err;
  }

  let organization = await getOrganizationByLegacyCustomerId(env, customer.customerId);
  if (!organization) {
    organization = await createOrganization(env, {
      legacyCustomerId: customer.customerId,
      name: organizationDisplayName(customer, user),
    });
  }

  if (!organization) {
    const err = new Error('Não foi possível criar a organização da conta.');
    err.status = 500;
    err.code = 'SIGNUP_ORGANIZATION_CREATE_FAILED';
    throw err;
  }

  if (organization.status !== 'active') {
    const err = new Error('A organização criada para a conta está indisponível.');
    err.status = 409;
    err.code = 'SIGNUP_ORGANIZATION_UNAVAILABLE';
    throw err;
  }

  const currentMember = await getOrganizationMember(env, organization.organizationId, user.userId);
  if (!currentMember || currentMember.role !== 'owner' || currentMember.status !== 'active') {
    await upsertOrganizationMember(env, {
      organizationId: organization.organizationId,
      userId: user.userId,
      role: 'owner',
    });
  }

  const ownerMembership = await getOrganizationMember(env, organization.organizationId, user.userId);
  if (!ownerMembership || ownerMembership.role !== 'owner' || ownerMembership.status !== 'active') {
    const err = new Error('Não foi possível vincular o proprietário à organização.');
    err.status = 500;
    err.code = 'SIGNUP_ORGANIZATION_OWNER_FAILED';
    throw err;
  }

  return {
    organization,
    membership: ownerMembership,
  };
}
