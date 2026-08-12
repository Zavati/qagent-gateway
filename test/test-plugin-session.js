import assert from 'node:assert/strict';
import { postPluginSession } from '../src/handlers/pluginSession.js';
import { hashClientKey } from '../src/lib/keyService.js';

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
          async all() {
            if (/FROM\s+projects/i.test(sql)) {
              const [organizationId] = params;
              return {
                results: db.projects
                  .filter((row) => row.organizationId === organizationId && row.status === 'active')
                  .map((row) => ({ ...row })),
              };
            }

            if (/FROM\s+environments/i.test(sql)) {
              const [organizationId, projectId] = params;
              return {
                results: db.environments
                  .filter((row) => (
                    row.organizationId === organizationId
                    && row.projectId === projectId
                    && row.status === 'active'
                  ))
                  .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
                  .map((row) => ({ ...row })),
              };
            }

            return { results: [] };
          },

          async first() {
            if (/FROM\s+organizations/i.test(sql) && /legacy_customer_id\s*=\s*\?/i.test(sql)) {
              const [legacyCustomerId] = params;
              return db.organizations.find((row) => row.legacyCustomerId === legacyCustomerId) || null;
            }

            if (/FROM\s+projects/i.test(sql) && /project_id\s*=\s*\?/i.test(sql)) {
              const [organizationId, projectId] = params;
              return db.projects.find((row) => (
                row.organizationId === organizationId
                && row.projectId === projectId
                && row.status === 'active'
              )) || null;
            }

            return null;
          },

          async run() {
            throw new Error(`Unexpected D1 write in plugin session test: ${sql}`);
          },
        };
      },
    };
  }
}

async function expectFailure(request, env, expectedStatus, expectedCode) {
  try {
    await postPluginSession(request, env);
    assert.fail('Expected Plugin Session request to fail');
  } catch (error) {
    assert.equal(error.status, expectedStatus);
    assert.equal(error.code, expectedCode);
  }
}

await expectFailure(
  new Request('https://api.apiqagent.com/v1/plugin/session', { method: 'POST' }),
  { QAGENT_KV: new MemoryKv() },
  401,
  'PLUGIN_CLIENT_KEY_REQUIRED',
);

await expectFailure(
  new Request('https://api.apiqagent.com/v1/plugin/session', {
    method: 'POST',
    headers: { Authorization: 'Bearer not-a-client-key' },
  }),
  { QAGENT_KV: new MemoryKv() },
  401,
  'PLUGIN_CLIENT_KEY_REQUIRED',
);

await expectFailure(
  new Request('https://api.apiqagent.com/v1/plugin/session', {
    method: 'POST',
    headers: { Authorization: `Bearer qag_test_${'A'.repeat(40)}` },
  }),
  { QAGENT_KV: new MemoryKv() },
  403,
  'PLUGIN_CLIENT_KEY_INVALID',
);

// Multi-project workspace: the Plugin must return every active Project from the
// exact Organization resolved from the ClientKey, with Environments scoped by Project.
{
  const clientKey = `qag_test_${'B'.repeat(40)}`;
  const keyHash = await hashClientKey(clientKey);
  const customerId = 'cus_multi';
  const organizationId = 'org_multi';

  const kv = new MemoryKv({
    [`clientkey:${keyHash}`]: JSON.stringify({
      keyHash,
      customerId,
      clientKeyPrefix: 'qag_test_BBB',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    }),
    [`license:${keyHash}`]: JSON.stringify({
      licenseId: 'lic_multi',
      customerId,
      status: 'active',
      plan: 'pro',
      expiresAt: '2999-01-01T00:00:00.000Z',
    }),
    [`customer:${customerId}`]: JSON.stringify({
      customerId,
      email: 'multi@example.com',
      name: 'Multi Account',
      company: 'Multi Organization',
    }),
  });

  const db = new MemoryD1({
    organizations: [{
      organizationId,
      legacyCustomerId: customerId,
      name: 'Multi Organization',
      status: 'active',
    }],
    projects: [
      {
        projectId: 'prj_marketplace',
        organizationId,
        name: 'MarketPlace',
        slug: 'marketplace',
        description: 'Produtos e venda digital',
        status: 'active',
      },
      {
        projectId: 'prj_teste',
        organizationId,
        name: 'Teste',
        slug: 'teste',
        description: 'Analise de credito',
        status: 'active',
      },
    ],
    environments: [
      {
        environmentId: 'env_stg',
        organizationId,
        projectId: 'prj_marketplace',
        name: 'STG',
        slug: 'stg',
        environmentType: 'STG',
        webBaseUrl: 'https://stg.example.com',
        isDefault: 1,
        status: 'active',
      },
      {
        environmentId: 'env_dev',
        organizationId,
        projectId: 'prj_teste',
        name: 'DEV',
        slug: 'dev',
        environmentType: 'DEV',
        webBaseUrl: 'https://dev.example.com',
        isDefault: 1,
        status: 'active',
      },
    ],
  });

  const response = await postPluginSession(
    new Request('https://api.apiqagent.com/v1/plugin/session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientKey}`,
        'X-QAgent-Plugin-Version': '2.0.3',
      },
    }),
    { QAGENT_KV: kv, QAGENT_DB: db },
  );

  assert.equal(response.organization.organizationId, organizationId);
  assert.equal(response.projects.length, 2);
  assert.deepEqual(response.projects.map((p) => p.name), ['MarketPlace', 'Teste']);
  assert.equal(response.projects[0].environments.length, 1);
  assert.equal(response.projects[0].environments[0].name, 'STG');
  assert.equal(response.projects[1].environments.length, 1);
  assert.equal(response.projects[1].environments[0].name, 'DEV');
  assert.match(response.session.accessToken, /^qps_/);
}

// Historical safety: if a still-valid ClientKey belongs to an old customer
// record while the Console login for the same email points to a different
// customerId, do not silently cross tenants. Force a ClientKey rotation.
{
  const clientKey = `qag_test_${'C'.repeat(40)}`;
  const keyHash = await hashClientKey(clientKey);
  const staleCustomerId = 'cus_old';
  const currentCustomerId = 'cus_current';
  const userId = 'usr_current';

  const kv = new MemoryKv({
    [`clientkey:${keyHash}`]: JSON.stringify({
      keyHash,
      customerId: staleCustomerId,
      clientKeyPrefix: 'qag_test_CCC',
      revokedAt: null,
    }),
    [`license:${keyHash}`]: JSON.stringify({
      licenseId: 'lic_old',
      customerId: staleCustomerId,
      status: 'active',
      plan: 'pro',
      expiresAt: '2999-01-01T00:00:00.000Z',
    }),
    [`customer:${staleCustomerId}`]: JSON.stringify({
      customerId: staleCustomerId,
      email: 'owner@example.com',
      company: 'QAgent',
    }),
    'user_by_email:owner@example.com': userId,
    [`user:${userId}`]: JSON.stringify({
      userId,
      email: 'owner@example.com',
      customerId: currentCustomerId,
      tokenVersion: 1,
    }),
  });

  await expectFailure(
    new Request('https://api.apiqagent.com/v1/plugin/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientKey}` },
    }),
    { QAGENT_KV: kv, QAGENT_DB: new MemoryD1() },
    409,
    'PLUGIN_CLIENT_KEY_STALE_ACCOUNT_BINDING',
  );
}

console.log('plugin session boundary tests passed ✅');
