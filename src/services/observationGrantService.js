import { assertPremiumAllowed, getLicenseByKeyHash } from '../lib/licenseService.js';
import { getProjectEnvironment } from './environmentService.js';
import { getOrganizationProject } from './projectService.js';
import { requirePluginSession } from './pluginAuthService.js';
import { createObservationGrantToken } from '../security/observationGrantToken.js';

const MAX_BODY_BYTES = 4096;

function validateScopedId(value, prefix, fieldName) {
  const id = String(value || '').trim();
  const pattern = new RegExp(`^${prefix}_[A-Za-z0-9-]{3,160}$`);
  if (!pattern.test(id)) {
    const err = new Error(`${fieldName} inválido ou ausente.`);
    err.status = 400;
    err.code = `OBSERVATION_${fieldName.replace(/Id$/, '').toUpperCase()}_REQUIRED`;
    throw err;
  }
  return id;
}

async function readInput(req) {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    const err = new Error('Payload do Observation Grant excede o limite permitido.');
    err.status = 413;
    err.code = 'OBSERVATION_GRANT_PAYLOAD_TOO_LARGE';
    throw err;
  }

  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    const err = new Error('Payload do Observation Grant excede o limite permitido.');
    err.status = 413;
    err.code = 'OBSERVATION_GRANT_PAYLOAD_TOO_LARGE';
    throw err;
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const err = new Error('JSON inválido no Observation Grant.');
    err.status = 400;
    err.code = 'OBSERVATION_GRANT_INVALID_JSON';
    throw err;
  }
}

function assertObservationEntitlement(license) {
  try {
    assertPremiumAllowed(license);
  } catch {
    const err = new Error('Licença sem entitlement válido para Observation.');
    err.status = 403;
    err.code = 'OBSERVATION_ENTITLEMENT_REQUIRED';
    throw err;
  }

  const expiresAt = license?.expiresAt || license?.trialEndsAt || null;
  const expiresAtMs = Date.parse(expiresAt || '');
  if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
    const err = new Error('Licença expirada para Observation.');
    err.status = 403;
    err.code = 'OBSERVATION_ENTITLEMENT_EXPIRED';
    throw err;
  }
}

export async function createObservationGrant(req, env) {
  const pluginSession = await requirePluginSession(req, env);
  const input = await readInput(req);
  const projectId = validateScopedId(input?.projectId, 'prj', 'projectId');
  const environmentId = validateScopedId(input?.environmentId, 'env', 'environmentId');

  // Tenant authority comes only from qps_*. User input never supplies organizationId.
  const organizationId = pluginSession.organizationId;
  const project = await getOrganizationProject(env, organizationId, projectId);
  const environment = await getProjectEnvironment(env, organizationId, project.projectId, environmentId);

  const license = await getLicenseByKeyHash(env, pluginSession.keyHash);
  assertObservationEntitlement(license);

  const signed = await createObservationGrantToken(env, {
    organizationId,
    projectId: project.projectId,
    environmentId: environment.environmentId,
    pluginSessionId: pluginSession.pluginSessionId,
  });

  return {
    status: 'ok',
    grant: {
      token: signed.token,
      audience: 'qagent-observation',
      expiresAt: signed.expiresAt,
      expiresInSeconds: signed.expiresInSeconds,
    },
    context: {
      organizationId,
      projectId: project.projectId,
      environmentId: environment.environmentId,
      pluginSessionId: pluginSession.pluginSessionId,
    },
  };
}
