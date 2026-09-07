import assert from 'node:assert/strict';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { postConsoleEvolutionVerifyOutcome } from '../src/handlers/consoleTestEvolution.js';

const path='/v1/console/projects/prj_1/test-evolution/proposals/tep_1/verify-outcome';
const route=resolveGatewayRoute('POST',path);
assert.equal(route.name,'consoleEvolutionVerifyOutcomePost');
assert.deepEqual(route.params,{projectId:'prj_1',proposalId:'tep_1'});

let captured=null;
const req=new Request(`https://api.apiqagent.com${path}`,{method:'POST',body:JSON.stringify({rerunRunId:'run_2'}),headers:{'content-type':'application/json'}});
const response=await postConsoleEvolutionVerifyOutcome(req,{},route.params,{
  requireTenant:async()=>({organizationId:'org_1',user:{userId:'usr_1'}}),
  getProject:async()=>({projectId:'prj_1'}),
  getRun:async()=>({runId:'run_2',idempotencyKey:'test-evolution-rerun:tep_1:tdv_2'}),
  verifyOutcome:async(input)=>{captured=input;return {outcome:'RECOVERED_BY_EVOLUTION',recoveryConfirmed:true};},
});
assert.equal(response.status,'ok');
assert.equal(response.data.outcome,'RECOVERED_BY_EVOLUTION');
assert.equal(captured.organizationId,'org_1');
assert.equal(captured.projectId,'prj_1');
assert.equal(captured.proposalId,'tep_1');
assert.deepEqual(captured.input,{rerunRunId:'run_2'});

console.log('Foundation 08.1.2 Gateway recovery attribution route/BFF: PASS');
