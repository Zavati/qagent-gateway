import assert from 'node:assert/strict';
import { slugify } from '../src/services/projectService.js';

assert.equal(slugify('Meu Projeto QA'), 'meu-projeto-qa');
assert.equal(slugify('Pagamentos / STG'), 'pagamentos-stg');
assert.equal(slugify('ÁÉÍÓÚ Çã'), 'aeiou-ca');

// Contract-level invariants for Foundation 07.1.
const migration = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../migrations/0002_foundation_07_organization_project_environment.sql', import.meta.url), 'utf8'));
assert.match(migration, /CREATE TABLE IF NOT EXISTS organizations/);
assert.match(migration, /legacy_customer_id TEXT UNIQUE/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS projects/);
assert.match(migration, /UNIQUE \(organization_id, slug\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS environments/);
assert.match(migration, /FOREIGN KEY \(organization_id, project_id\) REFERENCES projects/);
assert.match(migration, /idx_environments_one_default_per_project/);

console.log('Foundation 07 data architecture tests passed ✅');
