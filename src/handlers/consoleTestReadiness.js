import { readinessReconciliationEnabled } from '../readiness/readinessReconciliation.js';
import { getReadinessReconciliation } from '../services/readinessReconciliationClient.js';
import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { getProjectTestReadiness, getEndpointTestReadinessScenarios } from '../services/testRegistryClient.js';
import { parseTestReadinessQuery, isReadinessId, readinessError } from '../contracts/testReadiness.js';

async function read(req, env, {projectId,endpointId=null}, deps={}) {
  const tenant=await (deps.requireTenant||requireConsoleTenant)(req,env);
  await (deps.getProject||getOrganizationProject)(env,tenant.organizationId,projectId);
  if(!isReadinessId(projectId)||(endpointId&&!isReadinessId(endpointId)))throw readinessError('TEST_READINESS_QUERY_INVALID','Escopo de prontidão inválido.');
  const params=new URL(req.url).searchParams;
  const environmentId=params.get('environmentId');
  if(environmentId && (!endpointId || params.getAll('environmentId').length!==1 || !isReadinessId(environmentId)))throw readinessError('READINESS_RECONCILIATION_INPUT_INVALID','Ambiente inválido para reconciliação.');
  if(environmentId && !readinessReconciliationEnabled(env))throw readinessError('READINESS_RECONCILIATION_DISABLED','Habilite a reconciliação C neste ambiente.',409);
  params.delete('environmentId');
  const query=parseTestReadinessQuery(params,{detail:Boolean(endpointId)});
  const readFn=endpointId?(deps.getScenarios||getEndpointTestReadinessScenarios):(deps.getReadiness||getProjectTestReadiness);
  const data=await readFn({env,organizationId:tenant.organizationId,projectId,endpointId,query});
  if(endpointId && environmentId && data.items.length){
    const projection=await(deps.reconcile||getReadinessReconciliation)({env,organizationId:tenant.organizationId,projectId,endpointId,environmentId,testDesignVersionId:query.testDesignVersionId,scenarioIds:data.items.map(i=>i.scenarioId)});
    const byId=new Map(projection.items.map(i=>[i.scenarioId,i]));
    for(const item of data.items){const projected=byId.get(item.scenarioId);if(!projected)throw readinessError('READINESS_RECONCILIATION_RESPONSE_INVALID','Projeção incompleta.',502);
      item.snapshotReadinessV2=item.readinessV2;item.readinessV2=projected.readinessV2;item.effectiveReadiness=projected.effectiveReadiness;item.readinessReconciliation=projected.readinessReconciliation;
    }
    data.reconciliationEnvironmentId=environmentId;data.reconciliationComplete=projection.complete;
  }
  return {status:'ok',data};
}
export const getConsoleProjectTestReadiness=(req,env,params,deps)=>read(req,env,params,deps);
export const getConsoleEndpointTestReadinessScenarios=(req,env,params,deps)=>read(req,env,params,deps);
