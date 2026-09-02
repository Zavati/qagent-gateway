import assert from 'node:assert/strict';import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
assert.deepEqual(resolveGatewayRoute('GET','/v1/console/projects/prj_1/automation/results/rset_1/evolution'),{name:'consoleResultEvolutionInspectionGet',params:{projectId:'prj_1',resultSetId:'rset_1'}});
assert.deepEqual(resolveGatewayRoute('POST','/v1/console/projects/prj_1/test-evolution/proposals'),{name:'consoleEvolutionProposalPost',params:{projectId:'prj_1'}});
assert.deepEqual(resolveGatewayRoute('GET','/v1/console/projects/prj_1/test-evolution/proposals/tep_1'),{name:'consoleEvolutionProposalGet',params:{projectId:'prj_1',proposalId:'tep_1'}});
assert.equal(resolveGatewayRoute('POST','/v1/console/projects/prj_1/test-evolution/proposals/tep_1/approve').name,'consoleEvolutionApprovePost');
assert.equal(resolveGatewayRoute('POST','/v1/console/projects/prj_1/test-evolution/proposals/tep_1/reject').name,'consoleEvolutionRejectPost');
console.log('Foundation 07.8-A Gateway Test Evolution routes: PASS');
