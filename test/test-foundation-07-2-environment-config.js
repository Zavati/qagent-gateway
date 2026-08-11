import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertNonSecretVariable,
  deserializeVariableValue,
  looksSensitiveVariableKey,
  normalizeApiBaseUrl,
  normalizeServiceKey,
  normalizeVariableKey,
  normalizeVariableValue,
} from '../src/lib/environmentConfig.js';

assert.equal(normalizeServiceKey('Payments API'), 'payments-api');
assert.equal(normalizeServiceKey('Catálogo'), 'catalogo');
assert.equal(normalizeApiBaseUrl('https://stg.example.com/api/'), 'https://stg.example.com/api');
assert.throws(() => normalizeApiBaseUrl('ftp://example.com'), /http ou https/);
assert.throws(() => normalizeApiBaseUrl('https://user:pass@example.com'), /usuário ou senha/);
assert.throws(() => normalizeApiBaseUrl('https://example.com/api?x=1'), /query string/);

assert.equal(normalizeVariableKey('CUSTOMER_ID'), 'CUSTOMER_ID');
assert.equal(normalizeVariableKey('checkout.timeout-ms'), 'checkout.timeout-ms');
assert.throws(() => normalizeVariableKey('1INVALID'), /Chave de variável inválida/);
assert.equal(looksSensitiveVariableKey('DB_PASSWORD'), true);
assert.equal(looksSensitiveVariableKey('PAYMENTS_API_KEY'), true);
assert.equal(looksSensitiveVariableKey('CUSTOMER_ID'), false);
assert.throws(
  () => assertNonSecretVariable({ variableKey: 'AUTH_TOKEN', value: 'x' }),
  /Secret Vault\/Auth Profiles/,
);
assert.throws(
  () => assertNonSecretVariable({ variableKey: 'NORMAL_VALUE', value: 'x', sensitive: true }),
  /Secret Vault\/Auth Profiles/,
);

assert.deepEqual(normalizeVariableValue(42, 'NUMBER'), { valueType: 'NUMBER', variableValue: '42' });
assert.deepEqual(normalizeVariableValue('false', 'BOOLEAN'), { valueType: 'BOOLEAN', variableValue: 'false' });
assert.deepEqual(normalizeVariableValue({ retry: 3 }, 'JSON'), { valueType: 'JSON', variableValue: '{"retry":3}' });
assert.equal(deserializeVariableValue('42', 'NUMBER'), 42);
assert.equal(deserializeVariableValue('true', 'BOOLEAN'), true);
assert.deepEqual(deserializeVariableValue('{"retry":3}', 'JSON'), { retry: 3 });

const migration = await readFile(new URL('../migrations/0003_foundation_07_2_environment_api_services_variables.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS api_services/);
assert.match(migration, /idx_api_services_active_service_key/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS environment_api_bindings/);
assert.match(migration, /FOREIGN KEY \(organization_id, project_id, environment_id\)/);
assert.match(migration, /FOREIGN KEY \(organization_id, project_id, api_service_id\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS environment_variables/);
assert.match(migration, /value_type IN \('STRING', 'NUMBER', 'BOOLEAN', 'JSON'\)/);
assert.match(migration, /idx_environment_variables_active_key/);

console.log('Foundation 07.2 environment config tests passed ✅');
