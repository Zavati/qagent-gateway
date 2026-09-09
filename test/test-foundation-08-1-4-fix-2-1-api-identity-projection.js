import assert from 'node:assert/strict';
import { normalizeTestEvolutionTrigger } from '../src/handlers/testEvolutionQueue.js';

const normalized=normalizeTestEvolutionTrigger({
  contractVersion:'qagent.test-evolution-result-trigger.v1',
  organizationId:'org_123',
  projectId:'prj_123',
  resultSetId:`rset_${'a'.repeat(64)}`,
  runId:'run_12345678',
  endpointId:'cep_12345678',
  environmentId:'env_12345678',
  testDesignVersionId:'tdv_12345678',
  testDesignVersion:5,
  method:'get',
  path:'/web/index.php/api/v2/employees',
  scenarioIds:['test_008'],
  scenarioSummaries:[{
    scenarioId:'test_008',
    scenarioResultId:'sres_12345678',
    outcome:'FAILED',
    httpOutcome:'RESPONSE',
    statusCode:422,
    assertionFailedCount:1,
    method:'post',
    path:'/web/index.php/api/v2/employees?limit=99',
  }],
});
assert.ok(normalized);
assert.equal(normalized.method,'GET');
assert.equal(normalized.path,'/web/index.php/api/v2/employees');
assert.equal(normalized.scenarioSummaries[0].method,'POST');
assert.equal(normalized.scenarioSummaries[0].path,'/web/index.php/api/v2/employees?limit=99');

const bounded=normalizeTestEvolutionTrigger({
  contractVersion:'qagent.test-evolution-result-trigger.v1',
  organizationId:'org_123',
  projectId:'prj_123',
  resultSetId:`rset_${'b'.repeat(64)}`,
  runId:'run_12345678',
  endpointId:'cep_12345678',
  method:'not a method',
  path:'x'.repeat(2049),
  scenarioIds:['test_001'],
  scenarioSummaries:[{scenarioId:'test_001',method:'GET',path:'/v1/health'}],
});
assert.ok(bounded);
assert.equal(bounded.method,null);
assert.equal(bounded.path,null);
assert.equal(bounded.scenarioSummaries[0].method,'GET');
assert.equal(bounded.scenarioSummaries[0].path,'/v1/health');

console.log('08.1.4 FIX-2.1 API identity projection queue normalization: PASS');
