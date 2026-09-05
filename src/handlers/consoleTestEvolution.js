import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import {
  inspectResultEvolution,
  createEvolutionProposal,
  getEvolutionProposal,
  approveEvolutionProposal,
  rejectEvolutionProposal,
  getEvolutionPolicy,
  updateEvolutionPolicy,
  getEvolutionProposalContext,
  assessEvolutionProposal,
} from '../services/testEvolutionClient.js';
import { assessTestEvolutionWithAi } from '../services/testEvolutionAiService.js';
import { createRunV1 } from '../services/runService.js';

async function auth(req,env,projectId,deps={}){
  const t=await (deps.requireTenant||requireConsoleTenant)(req,env);
  await (deps.getProject||getOrganizationProject)(env,t.organizationId,projectId);
  return t;
}
async function read(req){
  const text=await req.text();
  if(!text.trim())return {};
  try{return JSON.parse(text)}catch{const e=new Error('JSON inválido.');e.status=400;e.code='TEST_EVOLUTION_JSON_INVALID';throw e}
}
function actor(t){return t.user?.userId||null}

export async function getConsoleResultEvolutionInspection(req,env,{projectId,resultSetId},deps={}){
  const t=await auth(req,env,projectId,deps);
  return {status:'ok',data:await (deps.inspect||inspectResultEvolution)({
    env,organizationId:t.organizationId,projectId,userId:actor(t),resultSetId,
  })};
}
export async function postConsoleEvolutionProposal(req,env,{projectId},deps={}){
  const t=await auth(req,env,projectId,deps);
  return {status:'ok',data:await (deps.create||createEvolutionProposal)({
    env,organizationId:t.organizationId,projectId,userId:actor(t),input:await read(req),
  })};
}
export async function getConsoleEvolutionProposal(req,env,{projectId,proposalId},deps={}){
  const t=await auth(req,env,projectId,deps);
  return {status:'ok',data:await (deps.get||getEvolutionProposal)({
    env,organizationId:t.organizationId,projectId,userId:actor(t),proposalId,
  })};
}
export async function postConsoleEvolutionApprove(req,env,{projectId,proposalId},deps={}){
  const t=await auth(req,env,projectId,deps);
  return {status:'ok',data:await (deps.approve||approveEvolutionProposal)({
    env,organizationId:t.organizationId,projectId,userId:actor(t),proposalId,input:await read(req),
  })};
}
export async function postConsoleEvolutionReject(req,env,{projectId,proposalId},deps={}){
  const t=await auth(req,env,projectId,deps);
  return {status:'ok',data:await (deps.reject||rejectEvolutionProposal)({
    env,organizationId:t.organizationId,projectId,userId:actor(t),proposalId,input:await read(req),
  })};
}

export async function getConsoleEvolutionPolicy(req,env,{projectId},deps={}){
  const t=await auth(req,env,projectId,deps);
  return {status:'ok',data:await (deps.getPolicy||getEvolutionPolicy)({
    env,organizationId:t.organizationId,projectId,userId:actor(t),
  })};
}
export async function putConsoleEvolutionPolicy(req,env,{projectId},deps={}){
  const t=await auth(req,env,projectId,deps);
  return {status:'ok',data:await (deps.updatePolicy||updateEvolutionPolicy)({
    env,organizationId:t.organizationId,projectId,userId:actor(t),input:await read(req),
  })};
}

async function maybeCreateEvolutionRerun({env,tenant,projectId,proposalId,result,deps={}}){
  const recommendation=result?.rerun;
  if(!recommendation?.requested)return {
    requested:false,
    reason:recommendation?.reason||'NOT_REQUESTED',
    run:null,
  };
  try{
    const created=await (deps.createRun||createRunV1)({
      env,
      organizationId:tenant.organizationId,
      projectId,
      userId:actor(tenant),
      input:{
        contractVersion:'qagent.run-create.v1',
        testDesignVersionId:recommendation.testDesignVersionId,
        environmentId:recommendation.environmentId,
        scenarioIds:[recommendation.scenarioId],
        confirmDiscoveredRuntime:false,
      },
      idempotencyKey:`test-evolution-rerun:${proposalId}:${recommendation.testDesignVersionId}`,
    });
    return {
      requested:true,
      reason:recommendation.reason,
      status:'CREATED',
      run:created?.run?{
        runId:created.run.runId,
        status:created.run.status,
        testDesignVersionId:recommendation.testDesignVersionId,
        scenarioId:recommendation.scenarioId,
      }:null,
    };
  }catch(error){
    return {
      requested:true,
      reason:recommendation.reason,
      status:'CREATE_FAILED',
      errorCode:error?.code||'EVOLUTION_RERUN_CREATE_FAILED',
      run:null,
    };
  }
}

export async function postConsoleEvolutionAnalyze(req,env,{projectId,proposalId},deps={}){
  const t=await auth(req,env,projectId,deps);
  // Body is currently reserved for future caller metadata. Reading it also keeps malformed JSON fail-closed.
  await read(req);
  const common={env,organizationId:t.organizationId,projectId,userId:actor(t),proposalId};
  const context=await (deps.getContext||getEvolutionProposalContext)(common);
  const reasoned=await (deps.aiAssess||assessTestEvolutionWithAi)({
    env,
    accountId:t.accountId||null,
    context,
  });
  const result=await (deps.assess||assessEvolutionProposal)({
    ...common,
    input:{
      contextFingerprint:context.contextFingerprint,
      assessment:reasoned.assessment,
      ai:reasoned.ai,
    },
  });
  const rerun=await maybeCreateEvolutionRerun({env,tenant:t,projectId,proposalId,result,deps});
  return {
    status:'ok',
    data:{
      ...result,
      rerun,
    },
  };
}
