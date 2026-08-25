import {
  SUITE_RUN_CONTRACT_VERSION,
  buildSuiteRunRequestedMessage,
  fingerprintSuiteRunCreateInput,
  isTerminalSuiteRunStatus,
} from '../lib/suiteRunContracts.js';
import { sha256Hex } from '../lib/runContracts.js';
import { getProjectEnvironment } from './environmentService.js';
import { getSuiteExecutionSlice } from './testRegistryClient.js';
import { createRunV1 } from './runService.js';
import {
  advanceSuiteRunCursor,
  createSuiteRunRoot,
  getSuiteRun,
  getSuiteRunById,
  getSuiteRunByIdempotencyKey,
  getSuiteRunDispatch,
  getSuiteRunProgress,
  markSuiteRunChildCreateError,
  markSuiteRunChildCreated,
  markSuiteRunDispatchFailed,
  markSuiteRunProcessing,
  markSuiteRunPublished,
  refreshSuiteRunTerminalState,
  upsertSuiteRunChildPending,
} from '../repositories/suiteRunRepository.js';

function suiteError(message, code, status=409, retryable=false, details=null) {
  const e=new Error(message); e.code=code; e.status=status; e.retryable=retryable; if(details)e.publicDetails=details; throw e;
}
function logger(env){ if(typeof env?.log==='function')return env.log; return (...args)=>{try{console.log(...args);}catch{}}; }
function parseBoundedInt(value,fallback,min,max){const n=Number.parseInt(String(value??''),10);return Number.isFinite(n)?Math.min(Math.max(n,min),max):fallback;}
export function resolveSuiteFanoutBatchSize(env){return parseBoundedInt(env?.SUITE_ORCHESTRATOR_CHILD_BATCH_SIZE,4,1,10);}
export function resolveSuiteChildConcurrency(env){return parseBoundedInt(env?.SUITE_ORCHESTRATOR_CHILD_CONCURRENCY,3,1,5);}
function isUniqueConflict(error){return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(String(error?.message||error||''));}
function isRetryable(error){return error?.retryable===true || Number(error?.status||0)>=500 || error?.code==='RUN_QUEUE_DISPATCH_FAILED';}

function safeEnvelope(state,{idempotentReplay=false}={}){
  if(!state?.suiteRun)return null; const r=state.suiteRun,d=state.dispatch,c=state.counts||{};
  return {
    contractVersion:SUITE_RUN_CONTRACT_VERSION,
    suiteRun:{suiteRunId:r.suiteRunId,status:r.status,projectId:r.projectId,suiteId:r.suiteId,suiteVersionId:r.suiteVersionId,suiteVersion:r.suiteVersion,environmentId:r.environmentId,endpointCount:r.endpointCount,scenarioCount:r.scenarioCount,createdAt:r.createdAt,updatedAt:r.updatedAt,terminalAt:r.terminalAt||null},
    orchestration:d?{status:d.status,cursor:d.cursor,total:r.endpointCount,dispatchAttemptCount:d.dispatchAttemptCount,publishedAt:d.publishedAt||null,completedAt:d.completedAt||null,lastErrorCode:d.lastErrorCode||null}:null,
    progress:{materializedChildren:Number(c.materialized||0),activeChildren:Number(c.active||0),passedChildren:Number(c.passed||0),failedChildren:Number(c.failed||0),errorChildren:Number(c.error||0)+Number(c.createError||0),cancelledChildren:Number(c.cancelled||0),completedChildren:Number(c.passed||0)+Number(c.failed||0)+Number(c.error||0)+Number(c.createError||0)+Number(c.cancelled||0)},
    children:(state.children||[]).map((x)=>({suiteRunChildId:x.suiteRunChildId,ordinal:x.ordinal,endpointId:x.endpointId,testDesignVersionId:x.testDesignVersionId,testDesignVersion:x.testDesignVersion,scenarioCount:x.scenarioCount,runId:x.runId||null,orchestrationStatus:x.orchestrationStatus,runStatus:x.runStatus||null,lastErrorCode:x.lastErrorCode||null})),
    childrenTruncated:Number(c.materialized||0)>(state.children||[]).length,
    idempotentReplay,
  };
}

async function publishInitial({env,suiteRun,dispatch,deps={}}){
  if(isTerminalSuiteRunStatus(suiteRun?.status))return;
  if(dispatch?.status==='PUBLISHED'||dispatch?.status==='PROCESSING'||dispatch?.status==='COMPLETED')return;
  const queue=deps.queue||env?.SUITE_ORCHESTRATOR_QUEUE;
  if(!queue||typeof queue.send!=='function')suiteError('Suite Orchestrator Queue não configurada.','SUITE_ORCHESTRATOR_QUEUE_NOT_CONFIGURED',503,true);
  try{await queue.send(buildSuiteRunRequestedMessage({suiteRunId:suiteRun.suiteRunId,organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,expectedCursor:0}));await (deps.markPublished||markSuiteRunPublished)(env,suiteRun.organizationId,suiteRun.projectId,suiteRun.suiteRunId);}
  catch(error){await (deps.markDispatchFailed||markSuiteRunDispatchFailed)(env,suiteRun.organizationId,suiteRun.projectId,suiteRun.suiteRunId,'SUITE_ORCHESTRATOR_QUEUE_DISPATCH_FAILED');suiteError('Falha ao publicar Suite Run para orquestração.','SUITE_ORCHESTRATOR_QUEUE_DISPATCH_FAILED',503,true);}
}

export async function createSuiteRunV1({env,organizationId,projectId,userId=null,input,idempotencyKey,deps={}}={}){
  const fp=await fingerprintSuiteRunCreateInput(input); const find=deps.getByIdempotency||getSuiteRunByIdempotencyKey; const loadSlice=deps.getSuiteExecutionSlice||getSuiteExecutionSlice;
  const existing=await find(env,organizationId,projectId,idempotencyKey);
  if(existing){if(existing.requestFingerprint!==fp)suiteError('Idempotency-Key já foi usada com outro Suite Run.','SUITE_RUN_IDEMPOTENCY_CONFLICT',409,false);const dispatch=await (deps.getDispatch||getSuiteRunDispatch)(env,organizationId,projectId,existing.suiteRunId);await publishInitial({env,suiteRun:existing,dispatch,deps});const state=await (deps.getProgress||getSuiteRunProgress)(env,organizationId,projectId,existing.suiteRunId,{limit:50});return safeEnvelope(state,{idempotentReplay:true});}
  await (deps.getEnvironment||getProjectEnvironment)(env,organizationId,projectId,input.environmentId);
  const slice=await loadSlice({env,organizationId,projectId,suiteVersionId:input.suiteVersionId,offset:0,limit:1});
  if(!slice?.suite||slice.totalItems<1||slice.suite.scenarioCount<1)suiteError('Suite Version não possui itens executáveis.','SUITE_RUN_EMPTY_SUITE',409,false);
  const now=new Date().toISOString(); const suiteRunId=`srun_${crypto.randomUUID()}`;
  const suiteRun={suiteRunId,organizationId,projectId,contractVersion:SUITE_RUN_CONTRACT_VERSION,suiteId:slice.suite.suiteId,suiteVersionId:input.suiteVersionId,suiteVersion:slice.suite.version,suiteInventoryFingerprint:slice.suite.inventoryFingerprint,environmentId:input.environmentId,endpointCount:slice.suite.endpointCount,scenarioCount:slice.suite.scenarioCount,confirmDiscoveredRuntime:input.confirmDiscoveredRuntime===true,idempotencyKey,requestFingerprint:fp,createdByUserId:userId,createdAt:now,updatedAt:now};
  let root;
  try{root=await (deps.createRoot||createSuiteRunRoot)(env,{suiteRun});}catch(error){if(!isUniqueConflict(error))throw error;const replay=await find(env,organizationId,projectId,idempotencyKey);if(!replay||replay.requestFingerprint!==fp)throw error;root={suiteRun:replay,dispatch:await (deps.getDispatch||getSuiteRunDispatch)(env,organizationId,projectId,replay.suiteRunId)};}
  await publishInitial({env,suiteRun:root.suiteRun,dispatch:root.dispatch,deps});
  logger(env)('suite_run_created',{suiteRunId:root.suiteRun.suiteRunId,projectId,suiteVersionId:input.suiteVersionId,environmentId:input.environmentId,endpointCount:root.suiteRun.endpointCount,scenarioCount:root.suiteRun.scenarioCount});
  const state=await (deps.getProgress||getSuiteRunProgress)(env,organizationId,projectId,root.suiteRun.suiteRunId,{limit:50}); return safeEnvelope(state,{idempotentReplay:false});
}

export async function getSuiteRunV1({env,organizationId,projectId,suiteRunId,deps={}}={}){
  let run=await (deps.getSuiteRun||getSuiteRun)(env,organizationId,projectId,suiteRunId);if(!run)suiteError('Suite Run não encontrado.','SUITE_RUN_NOT_FOUND',404,false);
  if(!isTerminalSuiteRunStatus(run.status)) await (deps.refresh||refreshSuiteRunTerminalState)(env,organizationId,projectId,suiteRunId);
  const state=await (deps.getProgress||getSuiteRunProgress)(env,organizationId,projectId,suiteRunId,{limit:50});return safeEnvelope(state);
}

async function mapLimit(items,limit,worker){const out=[];let cursor=0;async function lane(){while(cursor<items.length){const i=cursor++;out[i]=await worker(items[i]);}}await Promise.all(Array.from({length:Math.min(limit,items.length)},lane));return out;}

export async function processSuiteRunOrchestrationMessage({env,message,deps={}}={}){
  if(message?.contractVersion!=='qagent.suite-run-requested.v1')suiteError('Mensagem do Suite Orchestrator inválida.','SUITE_ORCHESTRATOR_MESSAGE_INVALID',400,false);
  const loadById=deps.getSuiteRunById||getSuiteRunById; const suiteRun=await loadById(env,message.suiteRunId); if(!suiteRun)return {ignored:true,reason:'NOT_FOUND'};
  if(suiteRun.organizationId!==message.organizationId||suiteRun.projectId!==message.projectId)suiteError('Escopo da mensagem de Suite Run inválido.','SUITE_ORCHESTRATOR_SCOPE_MISMATCH',400,false);
  if(isTerminalSuiteRunStatus(suiteRun.status))return {ignored:true,reason:'TERMINAL'};
  const dispatch=await (deps.getDispatch||getSuiteRunDispatch)(env,suiteRun.organizationId,suiteRun.projectId,suiteRun.suiteRunId);if(!dispatch)return {ignored:true,reason:'DISPATCH_MISSING'};
  const expected=Number(message.expectedCursor||0);if(dispatch.cursor!==expected)return {ignored:true,reason:'STALE_CURSOR',cursor:dispatch.cursor};
  await (deps.markProcessing||markSuiteRunProcessing)(env,suiteRun.organizationId,suiteRun.projectId,suiteRun.suiteRunId);
  const batchSize=resolveSuiteFanoutBatchSize(env); const slice=await (deps.getSuiteExecutionSlice||getSuiteExecutionSlice)({env,organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,suiteVersionId:suiteRun.suiteVersionId,offset:expected,limit:batchSize});
  if(slice.suite.inventoryFingerprint!==suiteRun.suiteInventoryFingerprint||slice.suite.endpointCount!==suiteRun.endpointCount)suiteError('Suite Version divergiu do snapshot do Suite Run.','SUITE_RUN_PINNED_SUITE_MISMATCH',409,false);
  const concurrency=resolveSuiteChildConcurrency(env);
  const outcomes=await mapLimit(slice.items,concurrency,async(item)=>{
    const childId=`srchild_${(await sha256Hex(`${suiteRun.suiteRunId}|${item.ordinal}|${item.testDesignVersionId}`)).slice(0,48)}`;
    await (deps.upsertChild||upsertSuiteRunChildPending)(env,{suiteRunId:suiteRun.suiteRunId,organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,ordinal:item.ordinal,endpointId:item.endpointId,testDesignVersionId:item.testDesignVersionId,testDesignVersion:item.testDesignVersion,scenarioCount:item.scenarioCount,childId});
    try{
      const child=await (deps.createRun||createRunV1)({env,organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,userId:suiteRun.createdByUserId,input:{contractVersion:'qagent.run-create.v1',testDesignVersionId:item.testDesignVersionId,environmentId:suiteRun.environmentId,scenarioIds:item.scenarioIds,confirmDiscoveredRuntime:suiteRun.confirmDiscoveredRuntime},idempotencyKey:`suite:${suiteRun.suiteRunId}:${item.ordinal}`});
      await (deps.markChildCreated||markSuiteRunChildCreated)(env,{organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,suiteRunId:suiteRun.suiteRunId,ordinal:item.ordinal,runId:child.run.runId});return {ok:true};
    }catch(error){if(isRetryable(error))throw error;await (deps.markChildError||markSuiteRunChildCreateError)(env,{organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,suiteRunId:suiteRun.suiteRunId,ordinal:item.ordinal,errorCode:error?.code||'SUITE_CHILD_CREATE_FAILED'});return {ok:false,errorCode:error?.code||'SUITE_CHILD_CREATE_FAILED'};}
  });
  const next=Number(slice.nextOffset); const queue=deps.queue||env?.SUITE_ORCHESTRATOR_QUEUE;
  if(slice.hasMore){if(!queue||typeof queue.send!=='function')suiteError('Suite Orchestrator Queue não configurada.','SUITE_ORCHESTRATOR_QUEUE_NOT_CONFIGURED',503,true);await queue.send(buildSuiteRunRequestedMessage({suiteRunId:suiteRun.suiteRunId,organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,expectedCursor:next}));}
  const advanced=await (deps.advanceCursor||advanceSuiteRunCursor)(env,{organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,suiteRunId:suiteRun.suiteRunId,expectedCursor:expected,nextCursor:next,complete:!slice.hasMore});
  if(!advanced)return {ignored:true,reason:'CURSOR_RACE'};
  if(!slice.hasMore)await (deps.refresh||refreshSuiteRunTerminalState)(env,suiteRun.organizationId,suiteRun.projectId,suiteRun.suiteRunId);
  logger(env)('suite_run_orchestration_batch',{suiteRunId:suiteRun.suiteRunId,projectId:suiteRun.projectId,from:expected,to:next,itemCount:slice.items.length,hasMore:slice.hasMore,successCount:outcomes.filter(x=>x.ok).length,createErrorCount:outcomes.filter(x=>!x.ok).length});
  return {processed:true,nextCursor:next,hasMore:slice.hasMore};
}
