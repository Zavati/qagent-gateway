import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { getSuiteRun } from '../repositories/suiteRunRepository.js';
import {
  getLearningCycleDetailV1,
  getLatestLearningCycleV1,
  listLearningAttentionV1,
  listLearningCycleHistoryV1,
} from '../services/learningCycleService.js';

function normalizeSuiteRunId(value){const v=String(value??'').trim();if(!/^srun_[A-Za-z0-9_-]{8,220}$/.test(v)){const e=new Error('suiteRunId inválido.');e.status=400;e.code='LEARNING_CYCLE_SUITE_RUN_ID_INVALID';throw e;}return v;}
function clampLimit(value,fallback=80,max=200){const n=Number.parseInt(String(value??''),10);return Number.isFinite(n)?Math.max(1,Math.min(max,n)):fallback;}
function normalizeOptionalId(value,prefix){const v=String(value??'').trim();if(!v)return null;if(prefix&&!v.startsWith(prefix)){const e=new Error('Filtro inválido.');e.status=400;e.code='LEARNING_CYCLE_FILTER_INVALID';throw e;}return v.slice(0,240);}
function normalizeEnum(value,allowed){const v=String(value??'').trim().toUpperCase();if(!v)return null;if(!allowed.has(v)){const e=new Error('Filtro inválido.');e.status=400;e.code='LEARNING_CYCLE_FILTER_INVALID';throw e;}return v;}
const CLASSIFICATIONS=new Set(['EXPECTED_BEHAVIOR_LEARNED','EXPECTATION_DRIFT','TEST_DATA_DRIFT','APPLICATION_BUG_SUSPECTED','RUNTIME_FAILURE','INCONCLUSIVE']);
const ACTION_TYPES=new Set(['REVIEW_PROPOSAL','REQUEST_DATA_REPAIR','APPLICATION_INVESTIGATION','RUNTIME_REVIEW','VERIFICATION_REVIEW','REVIEW_RESULT','AWAITING_VERIFICATION']);
const ATTENTION_STATUSES=new Set(['OPEN','PENDING_VERIFICATION','RESOLVED','ALL']);

async function context(req,env,projectId,deps){const tenant=await (deps.requireTenant||requireConsoleTenant)(req,env);await (deps.getProject||getOrganizationProject)(env,tenant.organizationId,projectId);return tenant;}

export async function getConsoleLearningCycle(req,env,{projectId,suiteRunId},deps={}){
  const tenant=await context(req,env,projectId,deps);
  const id=normalizeSuiteRunId(suiteRunId);
  const suiteRun=await (deps.getSuiteRun||getSuiteRun)(env,tenant.organizationId,projectId,id);
  if(!suiteRun){const e=new Error('Suite Run não encontrado.');e.status=404;e.code='SUITE_RUN_NOT_FOUND';throw e;}
  const url=new URL(req.url);
  const data=await (deps.getCycle||getLearningCycleDetailV1)({env,organizationId:tenant.organizationId,projectId,suiteRunId:id,limit:clampLimit(url.searchParams.get('limit'))});
  if(!data){const e=new Error('Continuous Learning Cycle não encontrado para este Suite Run.');e.status=404;e.code='LEARNING_CYCLE_NOT_FOUND';throw e;}
  return {status:'ok',data};
}

export async function getConsoleLatestLearningCycle(req,env,{projectId},deps={}){
  const tenant=await context(req,env,projectId,deps);
  const url=new URL(req.url);
  const data=await (deps.getLatest||getLatestLearningCycleV1)({env,organizationId:tenant.organizationId,projectId,environmentId:normalizeOptionalId(url.searchParams.get('environmentId'),'env_')});
  return {status:'ok',data};
}

export async function listConsoleLearningCycles(req,env,{projectId},deps={}){
  const tenant=await context(req,env,projectId,deps);
  const url=new URL(req.url);
  const data=await (deps.listHistory||listLearningCycleHistoryV1)({env,organizationId:tenant.organizationId,projectId,environmentId:normalizeOptionalId(url.searchParams.get('environmentId'),'env_'),limit:clampLimit(url.searchParams.get('limit'),12,50)});
  return {status:'ok',data};
}

export async function listConsoleLearningAttention(req,env,{projectId},deps={}){
  const tenant=await context(req,env,projectId,deps);
  const url=new URL(req.url);
  const data=await (deps.listAttention||listLearningAttentionV1)({
    env,organizationId:tenant.organizationId,projectId,
    environmentId:normalizeOptionalId(url.searchParams.get('environmentId'),'env_'),
    limit:clampLimit(url.searchParams.get('limit'),100,200),
    classification:normalizeEnum(url.searchParams.get('classification'),CLASSIFICATIONS),
    actionType:normalizeEnum(url.searchParams.get('actionType'),ACTION_TYPES),
    status:normalizeEnum(url.searchParams.get('status'),ATTENTION_STATUSES)||'OPEN',
  });
  return {status:'ok',data};
}
