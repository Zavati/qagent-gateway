import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { inspectResultEvolution,createEvolutionProposal,getEvolutionProposal,approveEvolutionProposal,rejectEvolutionProposal } from '../services/testEvolutionClient.js';
async function auth(req,env,projectId,deps={}){const t=await (deps.requireTenant||requireConsoleTenant)(req,env);await (deps.getProject||getOrganizationProject)(env,t.organizationId,projectId);return t;}
async function read(req){try{return JSON.parse(await req.text())}catch{const e=new Error('JSON inválido.');e.status=400;e.code='TEST_EVOLUTION_JSON_INVALID';throw e}}
function actor(t){return t.user?.userId||null}
export async function getConsoleResultEvolutionInspection(req,env,{projectId,resultSetId},deps={}){const t=await auth(req,env,projectId,deps);return {status:'ok',data:await (deps.inspect||inspectResultEvolution)({env,organizationId:t.organizationId,projectId,userId:actor(t),resultSetId})};}
export async function postConsoleEvolutionProposal(req,env,{projectId},deps={}){const t=await auth(req,env,projectId,deps);return {status:'ok',data:await (deps.create||createEvolutionProposal)({env,organizationId:t.organizationId,projectId,userId:actor(t),input:await read(req)})};}
export async function getConsoleEvolutionProposal(req,env,{projectId,proposalId},deps={}){const t=await auth(req,env,projectId,deps);return {status:'ok',data:await (deps.get||getEvolutionProposal)({env,organizationId:t.organizationId,projectId,userId:actor(t),proposalId})};}
export async function postConsoleEvolutionApprove(req,env,{projectId,proposalId},deps={}){const t=await auth(req,env,projectId,deps);return {status:'ok',data:await (deps.approve||approveEvolutionProposal)({env,organizationId:t.organizationId,projectId,userId:actor(t),proposalId,input:await read(req)})};}
export async function postConsoleEvolutionReject(req,env,{projectId,proposalId},deps={}){const t=await auth(req,env,projectId,deps);return {status:'ok',data:await (deps.reject||rejectEvolutionProposal)({env,organizationId:t.organizationId,projectId,userId:actor(t),proposalId,input:await read(req)})};}
