import assert from 'node:assert/strict';
import { learningAttentionActionType } from '../src/services/learningCycleService.js';
import { listConsoleLearningAttention } from '../src/handlers/consoleLearningCycles.js';
import { postConsoleEvolutionApprove } from '../src/handlers/consoleTestEvolution.js';

assert.equal(learningAttentionActionType({attentionStatus:'PENDING_VERIFICATION',effectiveState:'PENDING_VERIFICATION'}),'AWAITING_VERIFICATION');
assert.equal(learningAttentionActionType({attentionStatus:'OPEN',requestIssueDetected:true,effectiveState:'REVIEW_REQUIRED'}),'REQUEST_DATA_REPAIR');

const common={requireTenant:async()=>({organizationId:'org_1',organizationRole:'admin',user:{userId:'usr_1'}}),getProject:async()=>({projectId:'prj_1'})};
const attention=await listConsoleLearningAttention(new Request('https://example.test/v1/console/projects/prj_1/continuous-learning/attention?status=PENDING_VERIFICATION'),{}, {projectId:'prj_1'},{...common,listAttention:async(input)=>({contractVersion:'qagent.continuous-learning-attention.v1',summary:{openCount:0,pendingVerificationCount:1},items:[],input})});
assert.equal(attention.data.input.status,'PENDING_VERIFICATION');

let recorded=null;
const approved=await postConsoleEvolutionApprove(new Request('https://example.test/v1/console/projects/prj_1/test-evolution/proposals/tep_1/approve',{method:'POST',body:JSON.stringify({acceptedChangeIds:['tec_1'],reason:'approved'})}),{}, {projectId:'prj_1',proposalId:'tep_1'},{...common,approve:async()=>({proposalId:'tep_1',status:'APPLIED',result:{testDesignVersionId:'tdv_2',testDesignVersion:2}}),recordLearningApproval:async(_env,input)=>{recorded=input;}});
assert.equal(approved.data.status,'APPLIED');
assert.equal(recorded.proposal.proposalId,'tep_1');
assert.equal(recorded.organizationId,'org_1');

console.log('08.1.4 FIX-2 attention filters + manual approval hook: PASS');
