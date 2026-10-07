import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertExecutionAuthorization, assertOrigin } from '../src/autonomous/contracts.js';
import { normalizeRunCreateInput } from '../src/lib/runContracts.js';
import { sourceRunKey } from '../src/autonomous/commands.js';
const scope = { organizationId: 'org_test', projectId: 'prj_test', environmentId: 'env_test', testDesignVersionId: 'tdv_test', scenarioIds: ['s'], purpose: 'LEARNING' };
const authorization = () => ({ contractVersion: 'qagent.autonomous-execution-authorization.v1', kind: 'POLICY_DELEGATION', policyId: 'alp_test', policyRevision: 1, cycleId: 'alc_test', itemId: 'ali_test', operationId: 'alo_test', ...scope, allowedOrigins: ['https://fixture.invalid'], expiresAt: new Date(Date.now() + 60000).toISOString() });
function a() { const x = authorization(); delete x.purpose; return x; }
test('valid private authority is confined to one environment/version/scenario and reads', () => assert.equal(assertExecutionAuthorization(a(), scope).policyId, 'alp_test'));
for (const [name, mutate] of [['environment', x => x.environmentId = 'env_other'], ['version', x => x.testDesignVersionId = 'tdv_other'], ['scenario', x => x.scenarioIds = ['other']], ['multiple scenarios', x => x.scenarioIds.push('other')], ['organization', x => x.organizationId = 'org_other'], ['expired', x => x.expiresAt = '2001-01-01T00:00:00Z'], ['arbitrary field', x => x.force = true]])
    test('private execution rejects ' + name, () => { const x = a(); mutate(x); assert.throws(() => assertExecutionAuthorization(x, scope)); });
test('private learning delegation does not authorize regression directly', () => assert.throws(() => assertExecutionAuthorization(a(), { ...scope, purpose: 'REGRESSION' })));
test('public run JSON cannot provide private execution authority', () => { const input = { contractVersion: 'qagent.run-create.v1', testDesignVersionId: 'tdv_test', environmentId: 'env_test', scenarioIds: ['s'], purpose: 'LEARNING', executionAuthorization: a() }; assert.throws(() => normalizeRunCreateInput(input)); });
test('source retry key is stable per attempt and never a bounded verification identity', () => { const c = { cycleId: 'alc_test' }, i = { itemId: 'ali_test' }; assert.equal(sourceRunKey(c, i, 's', 1), sourceRunKey(c, i, 's', 1)); assert.notEqual(sourceRunKey(c, i, 's', 1), sourceRunKey(c, i, 's', 2)); assert.throws(() => sourceRunKey(c, i, 's', 4)); });
test('runtime integration checks actual materialized services including auth services', () => { const text = readFileSync(new URL('../src/services/executionPlanMaterializerService.js', import.meta.url), 'utf8'); assert.match(text, /assertExecutionAuthorization\(executionAuthorization/); assert.match(text, /Object\.values\(runtimeRefs\.apiServices/); assert.match(text, /assertOrigin\(service\.baseUrl,executionAuthorization\.allowedOrigins\)/); assert.throws(() => assertOrigin('https://auth.other.test', ['https://fixture.invalid'])); });
