import assert from 'node:assert/strict';
import {
  resolveExecutionPlanScenarioIdentity,
  resolveLearningRequestIdentity,
} from '../src/services/learningCycleService.js';

const executionPlan={
  runId:'run_post_12345678',
  plan:{
    contractVersion:'qagent.execution-plan.v1',
    scenarios:[
      {scenarioId:'test_post',spec:{target:{method:'POST',path:'/web/index.php/api/v2/leave/leave-requests'}}},
      {scenarioId:'test_patch',spec:{target:{method:'PATCH',path:'/web/index.php/api/v2/employees/{id}'}}},
      {scenarioId:'test_delete',spec:{target:{method:'DELETE',path:'/web/index.php/api/v2/employees/{id}'}}},
    ],
  },
};

assert.deepEqual(
  resolveExecutionPlanScenarioIdentity(executionPlan,'test_post'),
  {method:'POST',path:'/web/index.php/api/v2/leave/leave-requests'},
);
assert.deepEqual(
  resolveExecutionPlanScenarioIdentity(executionPlan,'test_patch'),
  {method:'PATCH',path:'/web/index.php/api/v2/employees/{id}'},
);
assert.deepEqual(
  resolveExecutionPlanScenarioIdentity(executionPlan,'missing'),
  {method:null,path:null},
);

// Current production trigger shape can arrive without HTTP identity. The immutable
// Execution Plan must fill that gap before the learning scenario is persisted.
assert.deepEqual(
  resolveLearningRequestIdentity({
    summary:{scenarioId:'test_post',method:null,path:null},
    trigger:{method:null,path:null},
    executionPlan,
    scenarioId:'test_post',
  }),
  {method:'POST',path:'/web/index.php/api/v2/leave/leave-requests'},
);

// Existing producer identity remains preferred; the Execution Plan is a fallback,
// not a rewrite of already-grounded queue data.
assert.deepEqual(
  resolveLearningRequestIdentity({
    summary:{scenarioId:'test_post',method:'PUT',path:'/v1/from-result'},
    trigger:{method:'POST',path:'/v1/from-trigger'},
    executionPlan,
    scenarioId:'test_post',
  }),
  {method:'PUT',path:'/v1/from-result'},
);

console.log('08.1.4 FIX-2.2 Attention execution identity recovery: PASS');
