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
  let customer = null;
  let created = false;

  if (!organization) {
    customer = await getCustomerById(env, legacyCustomerId);
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
  let resolvedRole = existingMember?.role || null;

  if (!existingMember) {
    // Compatibilidade para contas criadas antes do Foundation 07.4.2-F ou para
    // uma Organization criada pelo fallback legado do Plugin. O usuário primário
    // da conta (mesmo email do customer) continua sendo owner, não member.
    if (!customer) customer = await getCustomerById(env, legacyCustomerId);
    const customerEmail = String(customer?.email || '').trim().toLowerCase();
    const userEmail = String(sessionContext.user?.email || '').trim().toLowerCase();
    const isPrimaryAccountUser = Boolean(customerEmail && userEmail && customerEmail === userEmail);
    resolvedRole = (created || isPrimaryAccountUser) ? 'owner' : 'member';

    await upsertOrganizationMember(env, {
      organizationId: organization.organizationId,
      userId: sessionContext.user.userId,
      role: resolvedRole,
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
    organizationRole: resolvedRole,
  };
}
