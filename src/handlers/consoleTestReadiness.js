import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { getProjectTestReadiness, getEndpointTestReadinessScenarios } from '../services/testRegistryClient.js';
import { parseTestReadinessQuery, isReadinessId, readinessError } from '../contracts/testReadiness.js';

async function read(req, env, {projectId,endpointId=null}, deps={}) {
  const tenant=await (deps.requireTenant||requireConsoleTenant)(req,env);
  await (deps.getProject||getOrganizationProject)(env,tenant.organizationId,projectId);
  if(!isReadinessId(projectId)||(endpointId&&!isReadinessId(endpointId)))throw readinessError('TEST_READINESS_QUERY_INVALID','Escopo de prontidão inválido.');
  const query=parseTestReadinessQuery(new URL(req.url).searchParams,{detail:Boolean(endpointId)});
  const readFn=endpointId?(deps.getScenarios||getEndpointTestReadinessScenarios):(deps.getReadiness||getProjectTestReadiness);
  const data=await readFn({env,organizationId:tenant.organizationId,projectId,endpointId,query});
  return {status:'ok',data};
}
export const getConsoleProjectTestReadiness=(req,env,params,deps)=>read(req,env,params,deps);
export const getConsoleEndpointTestReadinessScenarios=(req,env,params,deps)=>read(req,env,params,deps);
