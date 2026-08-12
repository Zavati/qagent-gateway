import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { provisionSignupTenant } from '../src/services/accountTenantProvisioningService.js';

class MemoryKv {
  constructor() {
    this.entries = new Map();
  }

  async get(key) {
    return this.entries.get(key) ?? null;
  }

  async put(key, value) {
    this.entries.set(key, value);
  }
}

class MemoryD1 {
  constructor() {
    this.organizations = [];
    this.members = [];
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...params) {
        return {
          async first() {
            if (/FROM\s+organizations/i.test(sql) && /legacy_customer_id\s*=\s*\?/i.test(sql)) {
              const [legacyCustomerId] = params;
              return db.organizations.find((row) => row.legacyCustomerId === legacyCustomerId) || null;
            }

            if (/FROM\s+organizations/i.test(sql) && /organization_id\s*=\s*\?/i.test(sql)) {
              const [organizationId] = params;
              return db.organizations.find((row) => row.organizationId === organizationId) || null;
            }

            if (/FROM\s+organization_members/i.test(sql)) {
              const [organizationId, userId] = params;
              return db.members.find((row) => (
                row.organizationId === organizationId && row.userId === userId
              )) || null;
            }

            return null;
          },

          async run() {
            if (/INSERT\s+OR\s+IGNORE\s+INTO\s+organizations/i.test(sql)) {
              const [organizationId, legacyCustomerId, name, createdAt, updatedAt] = params;
              const existing = db.organizations.find((row) => row.legacyCustomerId === legacyCustomerId);
              if (!existing) {
                db.organizations.push({
                  organizationId,
                  legacyCustomerId,
                  name,
                  status: 'active',
                  createdAt,
                  updatedAt,
                });
              }
              return { success: true };
            }

            if (/INSERT\s+INTO\s+organization_members/i.test(sql)) {
              const [organizationId, userId, role, createdAt, updatedAt] = params;
              const existing = db.members.find((row) => (
                row.organizationId === organizationId && row.userId === userId
              ));

              if (existing) {
                existing.role = role;
                existing.status = 'active';
                existing.updatedAt = updatedAt;
              } else {
                db.members.push({
                  organizationId,
                  userId,
                  role,
                  status: 'active',
                  createdAt,
                  updatedAt,
                });
              }
              return { success: true };
            }

            throw new Error(`Unexpected D1 write in signup tenant test: ${sql}`);
          },
        };
      },
    };
  }
}

const kv = new MemoryKv();
const db = new MemoryD1();
const env = {
  ENVIRONMENT: 'development',
  CLIENT_KEY_MODE: 'test',
  MAX_BODY_BYTES: '250000',
  QAGENT_KV: kv,
  QAGENT_DB: db,
};

const email = 'tenant.signup@example.com';
const response = await worker.fetch(new Request('https://api.apiqagent.com/v1/signup-trial', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email,
    name: 'Tenant Signup',
    company: 'Tenant Company',
    password: 'SenhaTeste123',
    passwordConfirmation: 'SenhaTeste123',
    acceptTerms: true,
    acceptPrivacy: true,
    source: 'console',
  }),
}), env);

assert.equal(response.status, 201);
const payload = await response.json();
assert.equal(payload.status, 'ok');
assert.ok(payload.credentials.clientKey.startsWith('qag_test_'));
assert.ok(payload.user?.userId?.startsWith('usr_'));
assert.ok(payload.organization?.organizationId?.startsWith('org_'));
assert.equal(payload.organization.name, 'Tenant Company');
assert.equal(payload.organization.role, 'owner');

assert.equal(db.organizations.length, 1, 'signup must create exactly one organization');
assert.equal(db.organizations[0].legacyCustomerId, payload.customer.customerId);
assert.equal(db.members.length, 1, 'signup must create exactly one membership');
assert.equal(db.members[0].organizationId, payload.organization.organizationId);
assert.equal(db.members[0].userId, payload.user.userId);
assert.equal(db.members[0].role, 'owner');
assert.equal(db.members[0].status, 'active');

// Provisioning must be idempotent and must repair an incorrect role.
db.members[0].role = 'member';
const customer = JSON.parse(await kv.get(`customer:${payload.customer.customerId}`));
const user = JSON.parse(await kv.get(`user:${payload.user.userId}`));
const reprovisioned = await provisionSignupTenant(env, { customer, user });

assert.equal(reprovisioned.organization.organizationId, payload.organization.organizationId);
assert.equal(reprovisioned.membership.role, 'owner');
assert.equal(db.organizations.length, 1);
assert.equal(db.members.length, 1);
assert.equal(db.members[0].role, 'owner');

console.log('Signup tenant provisioning tests passed ✅');
