import { requireConsoleUser } from './consoleSessionService.js';
import { getCustomerById } from '../lib/customerService.js';
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

export async function requireConsoleTenant(req, env) {
  const sessionContext = await requireConsoleUser(req, env);
  const legacyCustomerId = sessionContext.accountId;

  let organization = await getOrganizationByLegacyCustomerId(env, legacyCustomerId);
  let created = false;

  if (!organization) {
    const customer = await getCustomerById(env, legacyCustomerId);
    organization = await createOrganization(env, {
      legacyCustomerId,
      name: organizationDisplayName(customer, sessionContext.user),
    });
    created = true;
  }

  if (!organization || organization.status !== 'active') {
    const err = new Error('Organização indisponível para esta sessão.');
    err.status = 403;
    err.code = 'ORGANIZATION_UNAVAILABLE';
    throw err;
  }

  const existingMember = await getOrganizationMember(env, organization.organizationId, sessionContext.user.userId);
  if (!existingMember) {
    await upsertOrganizationMember(env, {
      organizationId: organization.organizationId,
      userId: sessionContext.user.userId,
      role: created ? 'owner' : 'member',
    });
  } else if (existingMember.status !== 'active') {
    const err = new Error('Usuário sem acesso ativo à organização.');
    err.status = 403;
    err.code = 'ORGANIZATION_MEMBER_DISABLED';
    throw err;
  }

  return {
    ...sessionContext,
    organizationId: organization.organizationId,
    organization,
    organizationRole: existingMember?.role || (created ? 'owner' : 'member'),
  };
}
