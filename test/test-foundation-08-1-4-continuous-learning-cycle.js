import assert from 'node:assert/strict';
import { buildLearningReconciliationTrigger, determineLearningCycleStatus, isTerminalLearningCycleStatus } from '../src/services/learningCycleService.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

assert.equal(determineLearningCycleStatus({suiteStatus:'RUNNING'}),'COLLECTING');
assert.equal(determineLearningCycleStatus({suiteStatus:'FAILED',expectedResultSetCount:10,resultSetCount:8}),'ANALYZING');
assert.equal(determineLearningCycleStatus({suiteStatus:'FAILED',expectedResultSetCount:10,resultSetCount:10,pendingAnalysisCount:2}),'ANALYZING');
assert.equal(determineLearningCycleStatus({suiteStatus:'FAILED',expectedResultSetCount:10,resultSetCount:10,pendingVerificationCount:1}),'VERIFYING');
assert.equal(determineLearningCycleStatus({suiteStatus:'FAILED',expectedResultSetCount:10,resultSetCount:10,attentionCount:3}),'WAITING_REVIEW');
assert.equal(determineLearningCycleStatus({suiteStatus:'ERROR',expectedResultSetCount:8,resultSetCount:8,errorUnits:1}),'WAITING_REVIEW');
assert.equal(determineLearningCycleStatus({suiteStatus:'PASSED',expectedResultSetCount:8,resultSetCount:8}),'COMPLETED');
assert.equal(isTerminalLearningCycleStatus('WAITING_REVIEW'),true);
assert.equal(isTerminalLearningCycleStatus('COMPLETED'),true);
assert.equal(isTerminalLearningCycleStatus('VERIFYING'),false);

const reconciled=buildLearningReconciliationTrigger({organizationId:'org_1',projectId:'prj_1',runId:'run_1',data:{resultSet:{resultSetId:'rset_1',endpointId:'cep_1',environmentId:'env_1',testDesignVersionId:'tdv_1',testDesignVersion:1},scenarios:[{scenarioId:'test_001',scenarioResultId:'sres_1',outcome:'FAILED',assertionFailedCount:1,http:{outcome:'NETWORK_ERROR',statusCode:null},evidence:{request:{bodyFields:[{value:'must-not-leak'}]}}}]}});
assert.deepEqual(reconciled.scenarioIds,['test_001']);
assert.equal(reconciled.scenarioSummaries[0].httpOutcome,'NETWORK_ERROR');
assert.equal(JSON.stringify(reconciled).includes('must-not-leak'),false);

const route=resolveGatewayRoute('GET','/v1/console/projects/prj_1/suite-runs/srun_12345678/learning-cycle');
assert.deepEqual(route,{name:'consoleLearningCycleGet',params:{projectId:'prj_1',suiteRunId:'srun_12345678'}});

console.log('08.1.4 Continuous Learning Cycle lifecycle + route: PASS');
