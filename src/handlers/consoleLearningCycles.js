import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { getSuiteRun } from '../repositories/suiteRunRepository.js';
import { getLearningCycleDetailV1 } from '../services/learningCycleService.js';

function normalizeSuiteRunId(value){const v=String(value??'').trim();if(!/^srun_[A-Za-z0-9_-]{8,220}$/.test(v)){const e=new Error('suiteRunId inválido.');e.status=400;e.code='LEARNING_CYCLE_SUITE_RUN_ID_INVALID';throw e;}return v;}
function clampLimit(value){const n=Number.parseInt(String(value??''),10);return Number.isFinite(n)?Math.max(1,Math.min(200,n)):80;}

export async function getConsoleLearningCycle(req,env,{projectId,suiteRunId},deps={}){
  const tenant=await (deps.requireTenant||requireConsoleTenant)(req,env);
  await (deps.getProject||getOrganizationProject)(env,tenant.organizationId,projectId);
  const id=normalizeSuiteRunId(suiteRunId);
  const suiteRun=await (deps.getSuiteRun||getSuiteRun)(env,tenant.organizationId,projectId,id);
  if(!suiteRun){const e=new Error('Suite Run não encontrado.');e.status=404;e.code='SUITE_RUN_NOT_FOUND';throw e;}
  const url=new URL(req.url);
  const data=await (deps.getCycle||getLearningCycleDetailV1)({env,organizationId:tenant.organizationId,projectId,suiteRunId:id,limit:clampLimit(url.searchParams.get('limit'))});
  if(!data){const e=new Error('Continuous Learning Cycle não encontrado para este Suite Run.');e.status=404;e.code='LEARNING_CYCLE_NOT_FOUND';throw e;}
  return {status:'ok',data};
}
