import { getCustomerById } from '../lib/customerService.js';
import { getUserByEmail } from '../lib/userService.js';
import { assertPremiumAllowed, getOrCreateLicense } from '../lib/licenseService.js';
import { generateAccessToken, hashAccessToken, hashClientKey, validateClientKeyFormat } from '../lib/keyService.js';
import {
  createOrganization,
  getOrganizationByLegacyCustomerId,
} from '../repositories/organizationRepository.js';
import { listOrganizationProjects } from './projectService.js';
import { listProjectEnvironments } from './environmentService.js';

const DEFAULT_PLUGIN_SESSION_TTL_SECONDS = 15 * 60;
const MIN_PLUGIN_SESSION_TTL_SECONDS = 5 * 60;
const MAX_PLUGIN_SESSION_TTL_SECONDS = 60 * 60;

function getBearerToken(req) {
  const raw = req.headers.get('Authorization') || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || '').trim();
}

function pluginSessionTtlSeconds(env) {
  const raw = Number(env?.PLUGIN_SESSION_TTL_SECONDS || DEFAULT_PLUGIN_SESSION_TTL_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_PLUGIN_SESSION_TTL_SECONDS;
  return Math.min(MAX_PLUGIN_SESSION_TTL_SECONDS, Math.max(MIN_PLUGIN_SESSION_TTL_SECONDS, Math.trunc(raw)));
}

function organizationDisplayName(customer) {
  return String(customer?.company || customer?.name || customer?.email || 'QAgent Organization')
    .trim()
    .slice(0, 160) || 'QAgent Organization';
}

async function loadClientKeyRecord(env, keyHash) {
  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  const raw = await env.QAGENT_KV.get(`clientkey:${keyHash}`);
  const record = raw ? JSON.parse(raw) : null;

  if (!record || !record.customerId) {
    const err = new Error('ClientKey inválida ou não encontrada.');
    err.status = 403;
    err.code = 'PLUGIN_CLIENT_KEY_INVALID';
    throw err;
  }

  if (record.revokedAt) {
    const err = new Error('ClientKey revogada. Gere uma nova chave no Console.');
    err.status = 403;
    err.code = 'PLUGIN_CLIENT_KEY_REVOKED';
    throw err;
  }

  return record;
}

async function resolvePluginAccountBinding(env, clientKeyRecord, license) {
  const clientKeyCustomerId = String(clientKeyRecord?.customerId || '').trim();
  const licenseCustomerId = String(license?.customerId || '').trim();

  if (!clientKeyCustomerId) {
    const err = new Error('ClientKey sem vínculo de conta. Gere uma nova chave no Console.');
    err.status = 409;
    err.code = 'PLUGIN_CLIENT_KEY_ACCOUNT_MISSING';
    throw err;
  }

  // ClientKey e licença são duas representações da mesma credencial comercial.
  // Divergência entre elas indica dado legado/corrompido e nunca deve ser
  // resolvida silenciosamente para outro tenant.
  if (licenseCustomerId && licenseCustomerId !== clientKeyCustomerId) {
    const err = new Error('ClientKey possui vínculo de conta inconsistente. Gere uma nova chave no Console.');
    err.status = 409;
    err.code = 'PLUGIN_CLIENT_KEY_ACCOUNT_MISMATCH';
    throw err;
  }

  const customer = await getCustomerById(env, clientKeyCustomerId);
  if (!customer) {
    const err = new Error('Conta vinculada à ClientKey não foi encontrada. Gere uma nova chave no Console.');
    err.status = 409;
    err.code = 'PLUGIN_CLIENT_KEY_ACCOUNT_NOT_FOUND';
    throw err;
  }

  // O Console resolve o tenant a partir de user.customerId. Em instalações
  // antigas pode existir uma ClientKey ainda válida apontando para um customer
  // anterior do mesmo login. Não promovemos essa chave automaticamente para o
  // tenant atual: isso atravessaria um boundary de segurança. Em vez disso,
  // falhamos explicitamente e exigimos rotação da chave pelo Console atual.
  const email = String(customer.email || '').trim().toLowerCase();
  if (email) {
    const user = await getUserByEmail(env, email);
    const consoleCustomerId = String(user?.customerId || '').trim();
    if (consoleCustomerId && consoleCustomerId !== clientKeyCustomerId) {
      const err = new Error('ClientKey vinculada a uma conta legada. Gere uma nova ClientKey no Console e conecte novamente.');
      err.status = 409;
      err.code = 'PLUGIN_CLIENT_KEY_STALE_ACCOUNT_BINDING';
      throw err;
    }
  }

  return {
    customerId: clientKeyCustomerId,
    customer,
  };
}

async function resolveOrganization(env, customerId, customer = null) {
  // New Console signups provision Organization + owner during signup.
  // This creation path remains only as a compatibility fallback for legacy accounts.
  let organization = await getOrganizationByLegacyCustomerId(env, customerId);
  if (organization) return organization;

  const resolvedCustomer = customer || await getCustomerById(env, customerId);
  organization = await createOrganization(env, {
    legacyCustomerId: customerId,
    name: organizationDisplayName(resolvedCustomer),
  });

  if (!organization) {
    const err = new Error('Não foi possível resolver a organização da ClientKey.');
    err.status = 500;
    err.code = 'PLUGIN_ORGANIZATION_RESOLUTION_FAILED';
    throw err;
  }

  return organization;
}

async function loadPluginProjects(env, organizationId) {
  const projects = await listOrganizationProjects(env, organizationId);
  return Promise.all(projects.map(async (project) => ({
    projectId: project.projectId,
    name: project.name,
    slug: project.slug,
    description: project.description || null,
    status: project.status,
    environments: (await listProjectEnvironments(env, organizationId, project.projectId)).map((environment) => ({
      environmentId: environment.environmentId,
      name: environment.name,
      slug: environment.slug,
      environmentType: environment.environmentType,
      webBaseUrl: environment.webBaseUrl || null,
      isDefault: Boolean(environment.isDefault),
      status: environment.status,
    })),
  })));
}

async function savePluginSession(env, context) {
  const accessToken = generateAccessToken('qps', 48);
  const tokenHash = await hashAccessToken(accessToken);
  const ttlSeconds = pluginSessionTtlSeconds(env);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);

  await env.QAGENT_KV.put(
    `plugin_session:${tokenHash}`,
    JSON.stringify({
      tokenHash,
      keyHash: context.keyHash,
      customerId: context.customerId,
      organizationId: context.organization.organizationId,
      clientKeyPrefix: context.clientKeyRecord.clientKeyPrefix || null,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      pluginVersion: context.pluginVersion || null,
    }),
    { expirationTtl: ttlSeconds },
  );

  return {
    accessToken,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: ttlSeconds,
  };
}

export async function createPluginSession(req, env) {
  const clientKey = getBearerToken(req);
  if (!clientKey || !validateClientKeyFormat(clientKey)) {
    const err = new Error('ClientKey inválida ou ausente.');
    err.status = 401;
    err.code = 'PLUGIN_CLIENT_KEY_REQUIRED';
    throw err;
  }

  const keyHash = await hashClientKey(clientKey);
  const clientKeyRecord = await loadClientKeyRecord(env, keyHash);
  const license = await getOrCreateLicense(env, clientKey);
  assertPremiumAllowed(license);

  const account = await resolvePluginAccountBinding(env, clientKeyRecord, license);
  const organization = await resolveOrganization(env, account.customerId, account.customer);
  if (organization.status !== 'active') {
    const err = new Error('Organização indisponível para o Plugin.');
    err.status = 403;
    err.code = 'PLUGIN_ORGANIZATION_UNAVAILABLE';
    throw err;
  }

  const pluginVersion = String(req.headers.get('X-QAgent-Plugin-Version') || '').trim().slice(0, 40) || null;
  const projects = await loadPluginProjects(env, organization.organizationId);
  const session = await savePluginSession(env, {
    keyHash,
    customerId: account.customerId,
    clientKeyRecord,
    organization,
    pluginVersion,
  });

  await env.QAGENT_KV.put(`clientkey:${keyHash}`, JSON.stringify({
    ...clientKeyRecord,
    lastUsedAt: new Date().toISOString(),
  }));

  return {
    status: 'ok',
    session,
    organization: {
      organizationId: organization.organizationId,
      name: organization.name,
    },
    projects,
  };
}
