import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuthProfileConfig } from '../src/lib/authProfileConfig.js';
import { profileFromRuntime } from '../src/services/uiExecutionProjectProfiles.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
const scope = { organizationId:'org_test',projectId:'prj_test',environmentId:'env_test' };
const uiLogin = { loginPath:'/login', usernameSelector:'input[name="username"]',passwordSelector:'input[name="password"]',submitSelector:'button[type=submit]',successSelector:'#signed-in' };
test('BASIC UI form preserves existing Vault kind and exposes public selector config only', () => {
  assert.deepEqual(normalizeAuthProfileConfig('basic', { browserLogin: uiLogin }), { browserLogin: uiLogin });
  assert.deepEqual(normalizeAuthProfileConfig('basic', {}), {});
  assert.throws(() => normalizeAuthProfileConfig('basic', { browserLogin: { ...uiLogin, loginPath:'https://evil.test' } }), /relativo/);
  assert.throws(() => normalizeAuthProfileConfig('basic', { browserLogin: { ...uiLogin, usernameSelector:'javascript:alert(1)' } }), /inválido/);
});
test('project profile freezes a browserAuth reference without Vault credentials', () => {
  const row=profileFromRuntime({ ...scope, environment:{environmentId:scope.environmentId,webBaseUrl:'https://example.test/',name:'STG'},apiServices:{}, authProfiles:{web:{authProfileId:'authp_a',type:'basic',credentialsConfigured:true,config:{ browserLogin:uiLogin }}} },scope)[0];
  assert.equal(row.preparationMode,'BROWSER_AUTH');
  assert.equal(row.browserAuth.authProfileId,'authp_a');
  assert.equal(JSON.stringify(row).includes('passwordValue'),false);
});
test('ambiguous login configuration fails closed', () => {
 const a={authProfileId:'authp_a',type:'basic',config:{browserLogin:uiLogin}};
 assert.throws(() => profileFromRuntime({...scope,environment:{environmentId:scope.environmentId,webBaseUrl:'https://example.test/'},authProfiles:{one:a,two:{...a,authProfileId:'authp_b'}}},scope),/UI_EXECUTION_BROWSER_AUTH_AMBIGUOUS/);
});
