import assert from 'node:assert/strict';
import { learningAttentionActionType } from '../src/services/learningCycleService.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { getConsoleLatestLearningCycle, listConsoleLearningAttention, listConsoleLearningCycles } from '../src/handlers/consoleLearningCycles.js';

assert.equal(learningAttentionActionType({requestIssueDetected:true,effectiveState:'REVIEW_REQUIRED'}),'REQUEST_DATA_REPAIR');
assert.equal(learningAttentionActionType({classification:'APPLICATION_BUG_SUSPECTED',effectiveState:'REVIEW_REQUIRED'}),'APPLICATION_INVESTIGATION');
assert.equal(learningAttentionActionType({classification:'RUNTIME_FAILURE',effectiveState:'REVIEW_REQUIRED'}),'RUNTIME_REVIEW');
assert.equal(learningAttentionActionType({proposalId:'tep_1',effectiveState:'REVIEW_REQUIRED'}),'REVIEW_PROPOSAL');
assert.equal(learningAttentionActionType({effectiveState:'NOT_RECOVERED'}),'VERIFICATION_REVIEW');

assert.deepEqual(resolveGatewayRoute('GET','/v1/console/projects/prj_1/continuous-learning/latest'),{name:'consoleLatestLearningCycleGet',params:{projectId:'prj_1'}});
assert.deepEqual(resolveGatewayRoute('GET','/v1/console/projects/prj_1/continuous-learning/cycles'),{name:'consoleLearningCyclesList',params:{projectId:'prj_1'}});
assert.deepEqual(resolveGatewayRoute('GET','/v1/console/projects/prj_1/continuous-learning/attention'),{name:'consoleLearningAttentionList',params:{projectId:'prj_1'}});

const tenant={organizationId:'org_1'};
const common={requireTenant:async()=>tenant,getProject:async()=>({projectId:'prj_1'})};
const latest=await getConsoleLatestLearningCycle(new Request('https://example.test/v1/console/projects/prj_1/continuous-learning/latest?environmentId=env_1'),{}, {projectId:'prj_1'},{...common,getLatest:async(input)=>({contractVersion:'qagent.continuous-learning-latest.v1',exists:true,cycle:{environmentId:input.environmentId}})});
assert.equal(latest.data.exists,true);assert.equal(latest.data.cycle.environmentId,'env_1');
const history=await listConsoleLearningCycles(new Request('https://example.test/v1/console/projects/prj_1/continuous-learning/cycles?limit=7'),{}, {projectId:'prj_1'},{...common,listHistory:async(input)=>({contractVersion:'qagent.continuous-learning-history.v1',items:[],count:input.limit})});
assert.equal(history.data.count,7);
const attention=await listConsoleLearningAttention(new Request('https://example.test/v1/console/projects/prj_1/continuous-learning/attention?actionType=REQUEST_DATA_REPAIR&classification=TEST_DATA_DRIFT'),{}, {projectId:'prj_1'},{...common,listAttention:async(input)=>({contractVersion:'qagent.continuous-learning-attention.v1',summary:{openCount:0},items:[],input})});
assert.equal(attention.data.input.actionType,'REQUEST_DATA_REPAIR');assert.equal(attention.data.input.classification,'TEST_DATA_DRIFT');

console.log('08.1.4 FIX-1 Durable Learning Workspace routes + action projection: PASS');
