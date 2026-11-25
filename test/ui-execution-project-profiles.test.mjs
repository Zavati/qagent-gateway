import test from 'node:test';
import assert from 'node:assert/strict';
import { profileFromRuntime, projectExecutionProfiles } from '../src/services/uiExecutionProjectProfiles.js';
const scope = { organizationId: 'org_test', projectId: 'prj_test', environmentId: 'env_test' };
const runtime = { organizationId:scope.organizationId, projectId:scope.projectId,
  environment:{environmentId:scope.environmentId, name:'Homologação', webBaseUrl:'https://app.example.test/web'},
  apiServices:{main:{baseUrl:'https://api.example.test/v1'},second:{baseUrl:'https://api.example.test/v2'}},
  authProfiles:{admin:{authProfileId:'auth_private',credentialsConfigured:true}} };
test('gets target and deduplicated API origins from existing project environment', () => {
  const [p] = profileFromRuntime(runtime, scope);
  assert.equal(p.profileId,'profile_ui_env_test');
  assert.equal(p.targetBaseUrl,'https://app.example.test/web');
  assert.deepEqual(p.allowedOrigins,['https://app.example.test','https://api.example.test']);
  assert.equal(p.preparationMode,'UNAUTHENTICATED');
  assert.equal(JSON.stringify(p).includes('auth_private'),false);
});
test('does not invent missing web URL or leak auth configuration', () => {
  assert.deepEqual(profileFromRuntime({...runtime,environment:{...runtime.environment,webBaseUrl:null}},scope),[]);
  assert.throws(()=>profileFromRuntime(runtime,{...scope,environmentId:'env_other'}),{code:'UI_EXECUTION_PROFILE_SCOPE_INVALID'});
});
test('loads from authoritative project runtime when JSON secret not present',async()=>{
  let calls=0;
  const out=await projectExecutionProfiles({},scope,{runtime:async(_env,org,prj,environment)=>{calls++;assert.deepEqual([org,prj,environment],Object.values(scope));return runtime;}});
  assert.equal(calls,1); assert.equal(out.length,1);
});
test('rejects malformed environment API origin',()=>{
  assert.throws(()=>profileFromRuntime({...runtime,apiServices:{bad:{baseUrl:'ftp://wrong.example.test'}}},scope));
});

test('PROJECT source explicitly overrides stale legacy profile secret for safe rollout', async () => {
  const profiles = await projectExecutionProfiles({ UI_EXECUTION_PROFILE_SOURCE:'PROJECT', UI_EXECUTION_PROFILES_JSON:'not valid json' },scope,{runtime:async()=>runtime});
  assert.equal(profiles[0].profileId,'profile_ui_env_test');
});
