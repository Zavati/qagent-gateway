/** Real SQLite migrations and existing scoped Environment/API/Auth repositories.
 * Tenant authentication and Orchestrator transport are test doubles here.
 * No remote environment, secrets decryption, HTTP execution or provider call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RetrySQLiteD1 } from './helpers/verificationRetryD1.mjs';
import { consoleAutonomous } from '../src/autonomous/handlers.js';
import { normalizePolicy, assertOrigin } from '../src/autonomous/contracts.js';

const S = { organizationId: 'org_i', projectId: 'prj_i', environmentId: 'env_stg' };
const P = 'qagent.autonomous-learning-policy.v1';
function setup(t) {
    const db = new RetrySQLiteD1(); t.after(() => db.close()); const sqls = [], original = db.prepare.bind(db);
    db.prepare = sql => { sqls.push(sql); return original(sql); };
    for (const f of ['0002_foundation_07_organization_project_environment.sql', '0003_foundation_07_2_environment_api_services_variables.sql', '0004_foundation_07_3_secret_vault_auth_profiles.sql']) db.raw.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
    const now = new Date().toISOString();
    const run = (sql, ...args) => db.raw.prepare(sql).run(...args);
    for (const [o, p] of [['org_i', 'prj_i'], ['org_other', 'prj_other']]) {
        run('INSERT INTO organizations(organization_id,name,created_at,updated_at) VALUES(?,?,?,?)', o, o, now, now);
        run('INSERT INTO projects(project_id,organization_id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?,?)', p, o, p, p, now, now);
    }
    function environment(id, url, o = 'org_i', p = 'prj_i') { run('INSERT INTO environments(environment_id,organization_id,project_id,name,slug,environment_type,web_base_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, o, p, id, id, 'STG', url, now, now); }
    environment('env_stg', 'https://web.stg.test/app'); environment('env_qa', 'https://web.qa.test/app'); environment('env_other', 'https://foreign.test', 'org_other', 'prj_other');
    function service(key, stgUrl, qaUrl, status = 'active') {
        run('INSERT INTO api_services(api_service_id,organization_id,project_id,name,service_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', 'apis_' + key, S.organizationId, S.projectId, key, key, status, now, now);
        for (const [e, url] of [['env_stg', stgUrl], ['env_qa', qaUrl]]) if (url) run('INSERT INTO environment_api_bindings(binding_id,organization_id,project_id,environment_id,api_service_id,base_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', key + '_' + e, S.organizationId, S.projectId, e, 'apis_' + key, url, now, now);
    }
    service('api', 'https://api.stg.test/v2', 'https://api.qa.test/v3'); service('identity', 'https://id.stg.test/oauth', 'https://id.qa.test/oauth'); service('old', 'https://archived.test', null, 'archived');
    run('INSERT INTO secrets(secret_id,organization_id,project_id,name,kind,ciphertext,iv,key_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', 'sec_test', S.organizationId, S.projectId, 'PRIVATE_SECRET_NAME', 'oauth2_client_credentials', 'NEVER_DECRYPT_ME', 'iv', 'v1', now, now);
    function auth(id, e, enabled, key = 'identity') {
        run('INSERT INTO auth_profiles(auth_profile_id,organization_id,project_id,name,profile_key,type,config_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, S.organizationId, S.projectId, 'PRIVATE_PROFILE_NAME', id, 'oauth2_client_credentials', JSON.stringify({ targetMode: 'api_service', apiServiceKey: key, path: '/token', audience: 'PRIVATE_AUDIENCE' }), enabled, now, now);
        run('INSERT INTO auth_profile_environment_bindings(binding_id,organization_id,project_id,environment_id,auth_profile_id,secret_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', 'bind_' + id, S.organizationId, S.projectId, e, id, 'sec_test', now, now);
    }
    auth('auth_stg', 'env_stg', 1); auth('auth_qa_only', 'env_qa', 1); auth('auth_disabled', 'env_stg', 0, 'nonexistent');
    const calls = [], savedPolicies = []; let saved = null;
    const env = { QAGENT_DB: db, SCENARIO_READINESS_V2_ENABLED: 'true', SCENARIO_READINESS_RECONCILIATION_ENABLED: 'true', AUTONOMOUS_LEARNING_HMAC_SECRET: 'test-only-signing-material-do-not-deploy' };
    const deps = { requireTenant: async () => ({ organizationId: S.organizationId, organizationRole: 'owner', user: { userId: 'usr_i' } }), client: async a => { calls.push(a); if (a.method === 'PUT') { saved = structuredClone(normalizePolicy(a.body.policy)); savedPolicies.push(saved); } return { policy: saved }; } };
    const request = (method = 'GET', body, e = 'env_stg') => new Request('https://api.apiqagent.com/v1/console/projects/prj_i/autonomous-learning/policy?environmentId=' + e, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const call = (method, body, e) => consoleAutonomous(request(method, body, e), env, { projectId: 'prj_i', resource: 'policy' }, deps);
    const draft = hash => ({ contractVersion: P, enabled: true, expectedRevision: savedPolicies.length, confirmDelegation: true, confirmControlledEnvironment: true, profile: 'CONTROLLED_READS_V1', originSelection: { source: 'ENVIRONMENT_CONFIG', originsHash: hash }, allowedChangeTypes: ['ASSERTION_COVERAGE_EXTENSION'], expiresAt: new Date(Date.now() + 86400000).toISOString(), limits: {} });
    return { db, env, deps, calls, savedPolicies, call, draft, sqls, run, service, environment };
}
const changes = db => db.raw.prepare('SELECT total_changes() AS n').get().n;
test('metadata is environment scoped, active-only, read-only and secret-free through actual repositories', async t => {
    const x = setup(t), before = changes(x.db), result = await x.call('GET'); const c = result.data.environmentOrigins;
    assert.equal(c.status, 'READY'); assert.deepEqual(c.allowedOrigins, ['https://api.stg.test', 'https://id.stg.test', 'https://web.stg.test']);
    assert.deepEqual(c.entries.find(x => x.origin === 'https://id.stg.test').sources, ['API_SERVICE', 'AUTH_API_SERVICE']);
    assert.equal(changes(x.db), before); assert.equal(x.calls.length, 1); assert.equal(x.calls[0].method, undefined);
    for (const privateText of ['NEVER_DECRYPT_ME', 'PRIVATE_SECRET_NAME', 'PRIVATE_PROFILE_NAME', 'PRIVATE_AUDIENCE', '/token', '/v2', 'qa.test', 'archived.test']) assert(!JSON.stringify(result).includes(privateText));
    assert(!x.sqls.some(s => /ciphertext|environment_variables/.test(s)));
});
test('derived policy materializes the displayed set without writing Environment URLs', async t => {
    const x = setup(t), c = (await x.call('GET')).data.environmentOrigins, before = changes(x.db); const urlsBefore = x.db.raw.prepare('SELECT base_url FROM environment_api_bindings ORDER BY binding_id').all();
    await x.call('PUT', x.draft(c.originsHash)); assert.equal(changes(x.db), before); assert.deepEqual(x.savedPolicies[0].allowedOrigins, c.allowedOrigins); assert.deepEqual(x.db.raw.prepare('SELECT base_url FROM environment_api_bindings ORDER BY binding_id').all(), urlsBefore); assert.equal(x.calls.filter(c => c.method === 'PUT').length, 1); assert(x.calls.every(c => c.path.includes('/policy?')));
});
test('new configured host changes preview, not persisted policy; stale save is refused', async t => {
    const x = setup(t), c = (await x.call('GET')).data.environmentOrigins; await x.call('PUT', x.draft(c.originsHash)); const old = structuredClone(x.savedPolicies[0]);
    x.service('new', 'https://new.stg.test/path'); await assert.rejects(x.call('PUT', x.draft(c.originsHash)), { code: 'AUTONOMOUS_ENVIRONMENT_ORIGINS_CHANGED' });
    const updated = (await x.call('GET')).data; assert.deepEqual(updated.policy.allowedOrigins, old.allowedOrigins); assert(updated.environmentOrigins.allowedOrigins.includes('https://new.stg.test')); assert.equal(x.savedPolicies.length, 1); assert.throws(() => assertOrigin('https://new.stg.test', old.allowedOrigins));
    await x.call('PUT', x.draft(updated.environmentOrigins.originsHash)); assert.equal(x.savedPolicies.length, 2); assert(x.savedPolicies[1].allowedOrigins.includes('https://new.stg.test')); assert(!x.savedPolicies[0].allowedOrigins.includes('https://new.stg.test'));
});
test('API path change alone does not require a new destination authorization', async t => { const x = setup(t), a = (await x.call('GET')).data.environmentOrigins; x.run("UPDATE environment_api_bindings SET base_url='https://api.stg.test/v900/' WHERE binding_id='api_env_stg'"); const b = (await x.call('GET')).data.environmentOrigins; assert.equal(a.originsHash, b.originsHash); await x.call('PUT', x.draft(a.originsHash)); assert.equal(x.savedPolicies.length, 1); });
test('another environment derives its own URLs and cannot replay the first environment hash', async t => { const x = setup(t), a = (await x.call('GET')).data.environmentOrigins, b = (await x.call('GET', null, 'env_qa')).data.environmentOrigins; assert.deepEqual(b.allowedOrigins, ['https://api.qa.test', 'https://id.qa.test', 'https://web.qa.test']); assert.notEqual(a.originsHash, b.originsHash); await assert.rejects(x.call('PUT', x.draft(a.originsHash), 'env_qa'), { code: 'AUTONOMOUS_ENVIRONMENT_ORIGINS_CHANGED' }); assert.equal(x.savedPolicies.length, 0); });
test('foreign Environment cannot be fetched through another tenant/project', async t => { const x = setup(t); await assert.rejects(x.call('GET', null, 'env_other'), { code: 'ENVIRONMENT_NOT_FOUND' }); assert.equal(x.calls.length, 0); });
test('archived API binding is not auto-authorized and dependent auth requires configuration', async t => { const x = setup(t); x.run("UPDATE environment_api_bindings SET status='archived' WHERE binding_id='identity_env_stg'"); const c = (await x.call('GET')).data.environmentOrigins; assert.equal(c.status, 'CONFIGURATION_REQUIRED'); assert(c.issues.some(i => i.code === 'AUTONOMOUS_AUTH_SERVICE_BINDING_REQUIRED')); await assert.rejects(x.call('PUT', x.draft('0'.repeat(64))), { code: 'AUTONOMOUS_ENVIRONMENT_CONFIGURATION_REQUIRED' }); assert.equal(x.savedPolicies.length, 0); });
test('a database failure does not prevent explicit revocation or expose underlying exception', async t => { const x = setup(t); x.db.prepare = () => { throw Error('sensitive upstream message'); }; x.deps.getProject = async () => ({}); x.deps.getEnvironment = async () => ({ ...S, environmentType: 'STG' }); const read = await x.call('GET'); assert.equal(read.data.environmentOrigins.status, 'UNAVAILABLE'); assert(!JSON.stringify(read).includes('sensitive')); await x.call('PUT', { contractVersion: P, enabled: false, expectedRevision: 0 }); assert.equal(x.savedPolicies[0].enabled, false); });
