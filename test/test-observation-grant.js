import assert from 'node:assert/strict';
import { postPluginObservationGrant } from '../src/handlers/pluginObservationGrant.js';
import { hashAccessToken } from '../src/lib/keyService.js';
import { verifyObservationGrantToken } from '../src/security/observationGrantToken.js';

class MemoryKv {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  async get(key) {
    return this.entries.get(key) ?? null;
  }

  async put(key, value) {
    this.entries.set(key, value);
  }
}

class MemoryD1 {
  constructor({ organizations = [], projects = [], environments = [] } = {}) {
    this.organizations = organizations;
    this.projects = projects;
    this.environments = environments;
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...params) {
        return {
          async first() {
            if (/FROM\s+organizations/i.test(sql) && /organization_id\s*=\s*\?/i.test(sql)) {
              const [organizationId] = params;
              return db.organizations.find((row) => row.organizationId === organizationId) || null;
            }

            if (/FROM\s+projects/i.test(sql) && /project_id\s*=\s*\?/i.test(sql)) {
              const [organizationId, projectId] = params;
              return db.projects.find((row) => (
                row.organizationId === organizationId
                && row.projectId === projectId
                && (sql.includes("status = 'active'") ? row.status === 'active' : true)
              )) || null;
            }

            if (/FROM\s+environments/i.test(sql) && /environment_id\s*=\s*\?/i.test(sql)) {
              const [organizationId, projectId, environmentId] = params;
              return db.environments.find((row) => (
                row.organizationId === organizationId
                && row.projectId === projectId
                && row.environmentId === environmentId
                && (sql.includes("status = 'active'") ? row.status === 'active' : true)
              )) || null;
            }

            return null;
          },
        };
      },
    };
  }
}

const GRANT_SECRET = 'test-observation-grant-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const organizationId = 'org_acme-123';
const projectId = 'prj_checkout-123';
const environmentId = 'env_stg-123';
const otherProjectId = 'prj_other-456';
const otherEnvironmentId = 'env_other-456';
const qps = `qps_${'S'.repeat(48)}`;
const qpsHash = await hashAccessToken(qps);
const keyHash = `sha256:${'a'.repeat(64)}`;
const pluginSessionId = 'psn_12345678-1234-1234-1234-123456789abc';

function makeEnv(overrides = {}) {
  const now = Date.now();
  return {
    QAGENT_KV: new MemoryKv({
      [`plugin_session:${qpsHash}`]: JSON.stringify({
        tokenHash: qpsHash,
        pluginSessionId,
        keyHash,
        customerId: 'cus_acme',
        organizationId,
        issuedAt: new Date(now - 10_000).toISOString(),
        expiresAt: new Date(now + 10 * 60_000).toISOString(),
        pluginVersion: '2.0.4',
      }),
      [`license:${keyHash}`]: JSON.stringify({
        licenseId: 'lic_acme',
        customerId: 'cus_acme',
        status: 'active',
        plan: 'pro',
        expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
      }),
    }),
    QAGENT_DB: new MemoryD1({
      organizations: [{
        organizationId,
        legacyCustomerId: 'cus_acme',
        name: 'Acme',
        status: 'active',
      }],
      projects: [
        { projectId, organizationId, name: 'Checkout', slug: 'checkout', status: 'active' },
        { projectId: otherProjectId, organizationId, name: 'Other', slug: 'other', status: 'active' },
      ],
      environments: [
        {
          environmentId,
          organizationId,
          projectId,
          name: 'STG',
          slug: 'stg',
          environmentType: 'STG',
          status: 'active',
          isDefault: 1,
        },
        {
          environmentId: otherEnvironmentId,
          organizationId,
          projectId: otherProjectId,
          name: 'DEV',
          slug: 'dev',
          environmentType: 'DEV',
          status: 'active',
          isDefault: 1,
        },
      ],
    }),
    OBSERVATION_GRANT_SECRET: GRANT_SECRET,
    OBSERVATION_GRANT_TTL_SECONDS: '120',
    ...overrides,
  };
}

function request(body, token = qps) {
  return new Request('https://api.apiqagent.com/v1/plugin/observation-grants', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function expectFailure(req, env, status, code) {
  try {
    await postPluginObservationGrant(req, env);
    assert.fail(`Expected ${code} failure`);
  } catch (error) {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
  }
}

// Happy path: exact tenant/project/environment tuple becomes a short-lived signed qog_*.
{
  const env = makeEnv();
  const response = await postPluginObservationGrant(request({ projectId, environmentId }), env);

  assert.equal(response.status, 'ok');
  assert.match(response.grant.token, /^qog_v1\./);
  assert.equal(response.grant.audience, 'qagent-observation');
  assert.equal(response.grant.expiresInSeconds, 120);
  assert.deepEqual(response.context, {
    organizationId,
    projectId,
    environmentId,
    pluginSessionId,
  });

  const verified = await verifyObservationGrantToken(env, response.grant.token);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.iss, 'qagent-gateway');
  assert.equal(verified.payload.aud, 'qagent-observation');
  assert.equal(verified.payload.organizationId, organizationId);
  assert.equal(verified.payload.projectId, projectId);
  assert.equal(verified.payload.environmentId, environmentId);
  assert.equal(verified.payload.pluginSessionId, pluginSessionId);
  assert.equal('keyHash' in verified.payload, false);
  assert.equal('customerId' in verified.payload, false);
  assert.equal(JSON.stringify(verified.payload).includes('qag_'), false);
  assert.equal(JSON.stringify(verified.payload).includes(qps), false);

  const tamperedParts = response.grant.token.split('.');
  tamperedParts[1] = `${tamperedParts[1][0] === 'A' ? 'B' : 'A'}${tamperedParts[1].slice(1)}`;
  const tampered = tamperedParts.join('.');
  const tamperedVerification = await verifyObservationGrantToken(env, tampered);
  assert.equal(tamperedVerification.ok, false);
}

// Environment from another Project cannot be paired with an otherwise valid Project.
await expectFailure(
  request({ projectId, environmentId: otherEnvironmentId }),
  makeEnv(),
  404,
  'ENVIRONMENT_NOT_FOUND',
);

// Project not owned by the qps Organization is not resolvable.
await expectFailure(
  request({ projectId: 'prj_foreign-999', environmentId }),
  makeEnv(),
  404,
  'PROJECT_NOT_FOUND',
);

// Invalid/missing qps never reaches tenant lookup.
await expectFailure(
  request({ projectId, environmentId }, `qps_${'X'.repeat(48)}`),
  makeEnv(),
  401,
  'PLUGIN_SESSION_INVALID',
);

// Expired qps cannot mint a new grant.
{
  const env = makeEnv();
  env.QAGENT_KV.entries.set(`plugin_session:${qpsHash}`, JSON.stringify({
    tokenHash: qpsHash,
    pluginSessionId,
    keyHash,
    customerId: 'cus_acme',
    organizationId,
    issuedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
  }));

  await expectFailure(
    request({ projectId, environmentId }),
    env,
    401,
    'PLUGIN_SESSION_EXPIRED',
  );
}

// Entitlement is checked again at grant issuance, not trusted from old qps creation time.
{
  const env = makeEnv();
  env.QAGENT_KV.entries.set(`license:${keyHash}`, JSON.stringify({
    licenseId: 'lic_expired',
    customerId: 'cus_acme',
    status: 'trial',
    plan: 'pro',
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
  }));

  await expectFailure(
    request({ projectId, environmentId }),
    env,
    403,
    'OBSERVATION_ENTITLEMENT_EXPIRED',
  );
}

// Signing key is mandatory and intentionally separate from SESSION_SECRET.
await expectFailure(
  request({ projectId, environmentId }),
  makeEnv({ OBSERVATION_GRANT_SECRET: '' }),
  500,
  'OBSERVATION_GRANT_SECRET_INVALID',
);

console.log('observation grant boundary tests passed ✅');
