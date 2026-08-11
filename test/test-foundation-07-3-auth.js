import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeAuthProfileConfig,
  normalizeAuthProfileType,
  normalizeAuthSecretPayload,
  normalizeProfileKey,
} from '../src/lib/authProfileConfig.js';
import { encryptSecretPayload, decryptSecretPayload } from '../src/security/secretVaultCrypto.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

assert.equal(normalizeProfileKey('Default Customer'), 'default-customer');
assert.equal(normalizeAuthProfileType('LOGIN_HTTP_JSON'), 'login_http_json');
assert.throws(() => normalizeAuthProfileType('browser_token'), /type inválido/i);

assert.deepEqual(normalizeAuthProfileConfig('basic', {}), {});
assert.deepEqual(normalizeAuthProfileConfig('api_key', { placement: 'header', name: 'X-Tenant-Key' }), {
  placement: 'header',
  name: 'X-Tenant-Key',
  prefix: '',
});

const loginConfig = normalizeAuthProfileConfig('login_http_json', {
  apiServiceKey: 'Identity API',
  path: '/v1/login',
  usernameField: 'email',
  passwordField: 'password',
  staticBody: { tenant: 'qa' },
  tokenSource: 'json',
  tokenJsonPath: 'data.accessToken',
});
assert.equal(loginConfig.apiServiceKey, 'identity-api');
assert.equal(loginConfig.path, '/v1/login');
assert.equal(loginConfig.method, 'POST');
assert.equal(loginConfig.tokenJsonPath, 'data.accessToken');
assert.equal(loginConfig.targetHeader, 'Authorization');
assert.equal(loginConfig.scheme, 'Bearer');
assert.throws(
  () => normalizeAuthProfileConfig('login_http_json', {
    apiServiceKey: 'identity',
    path: '/login',
    staticBody: { DB_PASSWORD: 'plaintext' },
  }),
  /Secret Vault/i,
);
assert.throws(
  () => normalizeAuthProfileConfig('login_http_json', { apiServiceKey: 'identity', path: 'https://evil.example/login' }),
  /path relativo/i,
);

assert.deepEqual(normalizeAuthSecretPayload('basic', { username: 'qa', password: 'secret' }), {
  username: 'qa', password: 'secret',
});
assert.deepEqual(normalizeAuthSecretPayload('api_key', { apiKey: 'k_123', extra: 'ignored' }), { apiKey: 'k_123' });
assert.throws(() => normalizeAuthSecretPayload('oauth2_client_credentials', { clientId: 'id' }), /clientSecret/i);

const env = {
  QAGENT_SECRETS_ACTIVE_KEY_VERSION: 'v1',
  QAGENT_SECRETS_KEY_V1: Buffer.alloc(32, 11).toString('base64url'),
};
const context = { organizationId: 'org_a', secretId: 'sec_1', kind: 'login_http_json' };
const encrypted = await encryptSecretPayload(env, { username: 'qa@example.com', password: 'p@ss' }, context);
assert.ok(encrypted.ciphertext);
assert.ok(encrypted.iv);
assert.equal(encrypted.algorithm, 'AES-256-GCM');
assert.ok(!encrypted.ciphertext.includes('qa@example.com'));
assert.deepEqual(await decryptSecretPayload(env, encrypted, context), { username: 'qa@example.com', password: 'p@ss' });
await assert.rejects(
  () => decryptSecretPayload(env, encrypted, { ...context, organizationId: 'org_b' }),
  (err) => err?.code === 'SECRET_VAULT_DECRYPT_FAILED',
);
await assert.rejects(
  () => decryptSecretPayload(env, encrypted, { ...context, secretId: 'sec_2' }),
  (err) => err?.code === 'SECRET_VAULT_DECRYPT_FAILED',
);
await assert.rejects(
  () => decryptSecretPayload(env, encrypted, { ...context, kind: 'basic' }),
  (err) => err?.code === 'SECRET_VAULT_DECRYPT_FAILED',
);

const migration = await readFile(new URL('../migrations/0004_foundation_07_3_secret_vault_auth_profiles.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS secrets/);
assert.match(migration, /AES-256-GCM/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_profiles/);
assert.match(migration, /idx_auth_profiles_active_profile_key/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_profile_environment_bindings/);
assert.match(migration, /FOREIGN KEY \(organization_id, project_id, environment_id\)/);
assert.match(migration, /FOREIGN KEY \(organization_id, project_id, auth_profile_id\)/);
assert.match(migration, /FOREIGN KEY \(organization_id, project_id, secret_id\)/);

assert.deepEqual(resolveGatewayRoute('GET', '/v1/console/projects/prj_1/secrets'), {
  name: 'consoleSecretsList', params: { projectId: 'prj_1' },
});
assert.deepEqual(resolveGatewayRoute('PUT', '/v1/console/projects/prj_1/secrets/sec_1/value'), {
  name: 'consoleSecretValuePut', params: { projectId: 'prj_1', secretId: 'sec_1' },
});
assert.deepEqual(resolveGatewayRoute('POST', '/v1/console/projects/prj_1/auth-profiles'), {
  name: 'consoleAuthProfilesCreate', params: { projectId: 'prj_1' },
});
assert.deepEqual(resolveGatewayRoute('PUT', '/v1/console/projects/prj_1/auth-profiles/authp_1/environments/env_1'), {
  name: 'consoleAuthProfileEnvironmentBindingPut',
  params: { projectId: 'prj_1', authProfileId: 'authp_1', environmentId: 'env_1' },
});

console.log('Foundation 07.3 Secret Vault/Auth Profiles tests passed ✅');
