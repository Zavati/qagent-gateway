import { canonicalizeJson, sha256Hex } from '../lib/runContracts.js';
import { getResultsProjectResultSet } from './resultsReadClient.js';
import { getRunnerTestArtifact, createHumanRequestRepairVersion } from './testRegistryClient.js';
import { inspectResultEvolution } from './testEvolutionClient.js';
import {
  listProjectEndpointTestDataBindings,
  createProjectEndpointTestDataBinding,
  patchProjectEndpointTestDataBinding,
  archiveProjectEndpointTestDataBinding,
} from './testDataBindingService.js';
import { createEvolutionRerunV1 } from './evolutionRerunService.js';
import { recordHumanRepairInLearningCycle } from './learningCycleService.js';

const VALUE_TYPES=new Set(['STRING','NUMBER','INTEGER','BOOLEAN']);
const SENSITIVE=/(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i;
const BODY_SELECTOR_RE=/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,3}$/;
const QUERY_SELECTOR_RE=/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;
function fail(message,code,status=400,publicDetails=null){const e=new Error(message);e.code=code;e.status=status;if(publicDetails)e.publicDetails=publicDetails;throw e;}
function text(v,name,max=320){const x=String(v??'').trim();if(!x||x.length>max)fail(`${name} inválido.`,'HUMAN_REQUEST_REPAIR_INVALID',400);return x;}
function normalizeInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Payload de correção inválido.','HUMAN_REQUEST_REPAIR_INVALID');
  if(input.contractVersion!=='qagent.human-request-repair-create.v1')fail('contractVersion de correção inválido.','HUMAN_REQUEST_REPAIR_CONTRACT_INVALID');
  const resultSetId=text(input.resultSetId,'resultSetId',220),scenarioId=text(input.scenarioId,'scenarioId',180),sourceTestDesignVersionId=text(input.sourceTestDesignVersionId,'sourceTestDesignVersionId',220);
  if(!Array.isArray(input.changes)||input.changes.length<1||input.changes.length>10)fail('Informe 1..10 alterações de payload.','HUMAN_REQUEST_REPAIR_CHANGES_INVALID');
  const seen=new Set();
  const changes=input.changes.map((raw,i)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(`changes[${i}] inválido.`,'HUMAN_REQUEST_REPAIR_CHANGE_INVALID');
    const operation=String(raw.operation||'').trim().toUpperCase();
    const target=String(raw.target||'').trim().toUpperCase();
    const selector=text(raw.selector,'selector',320);
    const valueType=String(raw.valueType||'').trim().toUpperCase();if(!VALUE_TYPES.has(valueType))fail('valueType inválido.','HUMAN_REQUEST_REPAIR_VALUE_TYPE_INVALID');
    if(raw.value===undefined)fail('Novo valor é obrigatório.','HUMAN_REQUEST_REPAIR_VALUE_REQUIRED');
    if(SENSITIVE.test(selector))fail('Selector sensível não pode receber literal pela tela.','HUMAN_REQUEST_REPAIR_SELECTOR_FORBIDDEN');
    if(operation==='SET_FIXED'){
      if(target!=='BODY')fail('SET_FIXED suporta somente BODY nesta versão.','HUMAN_REQUEST_REPAIR_TARGET_UNSUPPORTED');
      if(!BODY_SELECTOR_RE.test(selector))fail('Selector BODY não permitido para correção humana.','HUMAN_REQUEST_REPAIR_SELECTOR_FORBIDDEN');
    }else if(operation==='ADD_REQUEST_BINDING'){
      if(target!=='QUERY')fail('ADD_REQUEST_BINDING suporta somente QUERY nesta versão.','HUMAN_REQUEST_REPAIR_TARGET_UNSUPPORTED');
      if(!QUERY_SELECTOR_RE.test(selector))fail('Selector QUERY não permitido para correção humana.','HUMAN_REQUEST_REPAIR_SELECTOR_FORBIDDEN');
    }else fail('Operação de correção não suportada.','HUMAN_REQUEST_REPAIR_OPERATION_UNSUPPORTED');
    const key=`${target}:${selector}`;if(seen.has(key))fail('Selector duplicado na correção.','HUMAN_REQUEST_REPAIR_CHANGE_DUPLICATE');seen.add(key);
    return {target,selector,operation,valueType,value:raw.value};
  });
  const reason=String(input.reason||'Correção humana de request após diagnóstico do QAgent.').trim().slice(0,1000);
  return {resultSetId,scenarioId,sourceTestDesignVersionId,changes,reason,rerun:input.rerun===true};
}
function findScenarioArtifact(artifact,scenarioId){return (artifact?.specification?.scenarios||[]).find((s)=>s?.scenarioId===scenarioId)||null;}
function exactEndpointBinding(bindings,environmentId,target,selector){return (bindings||[]).find((b)=>b?.status==='active'&&b.scopeType==='ENDPOINT'&&b.environmentId===environmentId&&b.target===target&&b.selector===selector)||null;}
function findExistingBodyDiagnostic(requestIssue,selector){return (requestIssue?.fields||[]).find((f)=>f?.target==='BODY'&&f?.selector===selector)||null;}
function findUnboundSuggestion(requestIssue,target,selector){
  return (requestIssue?.fields||[]).find((field)=>{
    const suggestion=field?.suggestion;
    return suggestion?.contractVersion==='qagent.unbound-request-parameter-suggestion.v1'
      && suggestion?.actionType==='ADD_REQUEST_BINDING'
      && suggestion?.requiresHumanConfirmation===true
      && String(suggestion?.candidateTarget||'').toUpperCase()===target
      && String(suggestion?.candidateSelector||'')===selector;
  })||null;
}
async function rollbackBindings(env,scope,endpointId,actions){
  for(const action of [...actions].reverse()){
    try{
      if(action.kind==='CREATED')await archiveProjectEndpointTestDataBinding(env,{organizationId:scope.organizationId,projectId:scope.projectId,endpointId,bindingId:action.binding.bindingId});
      else if(action.kind==='PATCHED'){
        const b=action.before;
        await patchProjectEndpointTestDataBinding(env,{organizationId:scope.organizationId,projectId:scope.projectId,endpointId,bindingId:b.bindingId,userId:scope.userId,input:{sourceType:b.sourceType,valueType:b.valueType,...(b.sourceType==='FIXED'?{value:b.value}:{}),...(b.sourceType==='GENERATED'?{generatorKind:b.generatorKind,generatorConfig:b.generatorConfig}:{}),description:b.description},originOverride:b.origin||'LEGACY_UNKNOWN'});
      }
    }catch{}
  }
}
export async function createHumanRequestRepairV1({env,organizationId,projectId,userId,input,deps={}}={}){
  if(!userId)fail('Correção humana requer usuário autenticado.','HUMAN_REQUEST_REPAIR_ACTOR_REQUIRED',403);
  const normalized=normalizeInput(input);const scope={organizationId,projectId,userId};
  const getResult=deps.getResult||getResultsProjectResultSet, getArtifact=deps.getArtifact||getRunnerTestArtifact, inspect=deps.inspect||inspectResultEvolution;
  const [resultData,inspection]=await Promise.all([
    getResult({env,organizationId,projectId,resultSetId:normalized.resultSetId}),
    inspect({env,organizationId,projectId,userId,resultSetId:normalized.resultSetId}),
  ]);
  const rs=resultData?.resultSet;if(!rs)fail('Result Set não encontrado.','HUMAN_REQUEST_REPAIR_RESULT_NOT_FOUND',404);
  if(rs.testDesignVersionId!==normalized.sourceTestDesignVersionId)fail('Result Set pertence a outra versão do Test Design.','HUMAN_REQUEST_REPAIR_SOURCE_MISMATCH',409);
  const resultScenario=(resultData.scenarios||[]).find((s)=>s?.scenarioId===normalized.scenarioId);if(!resultScenario)fail('Cenário não encontrado no Result Set.','HUMAN_REQUEST_REPAIR_SCENARIO_NOT_FOUND',404);
  const inspected=(inspection?.scenarios||[]).find((s)=>s?.scenarioId===normalized.scenarioId);if(!inspected?.requestIssueDetected||!inspected?.requestIssue)fail('Cenário não possui diagnóstico de request reparável/revisável.','HUMAN_REQUEST_REPAIR_DIAGNOSTIC_REQUIRED',409);
  const artifact=await getArtifact({env,organizationId,projectId,testDesignVersionId:normalized.sourceTestDesignVersionId});
  if(artifact.endpointId!==rs.endpointId)fail('Artifact e Result Set divergem no endpoint.','HUMAN_REQUEST_REPAIR_SOURCE_MISMATCH',409);
  const scenario=findScenarioArtifact(artifact,normalized.scenarioId);if(!scenario)fail('Cenário não existe no Test Design source.','HUMAN_REQUEST_REPAIR_SCENARIO_NOT_FOUND',409);
  const bindings=scenario?.spec?.testData?.bindings||[];
  const bodyEvidence=new Map((resultScenario?.evidence?.request?.bodyFields||[]).map((f)=>[f.path,f]));
  const registryChanges=[];let nextBindingIndex=bindings.length;
  for(const change of normalized.changes){
    if(change.operation==='SET_FIXED'){
      const diagnostic=findExistingBodyDiagnostic(inspected.requestIssue,change.selector);if(!diagnostic)fail('Somente campos BODY identificados pelo diagnóstico podem ser corrigidos nesta tela.','HUMAN_REQUEST_REPAIR_FIELD_NOT_DIAGNOSED',409,{selector:change.selector});
      if(String(diagnostic.bindingSource||'').toUpperCase()==='SECRET')fail('Campo SECRET não pode receber literal pela tela.','HUMAN_REQUEST_REPAIR_SECRET_FORBIDDEN',409);
      const evidenceField=bodyEvidence.get(change.selector);if(evidenceField?.redacted===true)fail('Campo sanitizado/redacted não pode ser corrigido pela tela.','HUMAN_REQUEST_REPAIR_REDACTED_FORBIDDEN',409);
      const bindingIndex=bindings.findIndex((b)=>b?.target==='BODY'&&b?.selector===change.selector);if(bindingIndex<0)fail('Binding BODY não existe no Test Design source.','HUMAN_REQUEST_REPAIR_BINDING_NOT_FOUND',409,{selector:change.selector});
      const sourceBinding=bindings[bindingIndex];if(sourceBinding.source==='SECRET')fail('Campo SECRET não pode receber literal pela tela.','HUMAN_REQUEST_REPAIR_SECRET_FORBIDDEN',409);
      registryChanges.push({type:'SET_FIXED_TEST_DATA',scenarioId:normalized.scenarioId,bindingIndex,target:'BODY',selector:change.selector,currentSource:sourceBinding.source,valueType:change.valueType});
      continue;
    }
    const field=findUnboundSuggestion(inspected.requestIssue,change.target,change.selector);
    if(!field)fail('Novo binding somente pode ser criado a partir de uma sugestão explícita do diagnóstico atual.','HUMAN_REQUEST_REPAIR_SUGGESTION_REQUIRED',409,{target:change.target,selector:change.selector});
    if(SENSITIVE.test(field.key)||SENSITIVE.test(change.selector))fail('Parâmetro sensível não pode receber literal pela tela.','HUMAN_REQUEST_REPAIR_SECRET_FORBIDDEN',409);
    if(bindings.some((b)=>b?.target===change.target&&b?.selector===change.selector))fail('O binding sugerido já existe no Test Design source.','HUMAN_REQUEST_REPAIR_BINDING_EXISTS',409,{target:change.target,selector:change.selector});
    registryChanges.push({type:'ADD_FIXED_TEST_DATA',scenarioId:normalized.scenarioId,bindingIndex:nextBindingIndex++,target:change.target,selector:change.selector,valueType:change.valueType});
  }
  const repairHash=await sha256Hex(canonicalizeJson({organizationId,projectId,userId:userId||null,resultSetId:normalized.resultSetId,scenarioId:normalized.scenarioId,sourceTestDesignVersionId:normalized.sourceTestDesignVersionId,changes:normalized.changes}));
  const repairId=`hrr_${repairHash.slice(0,48)}`;
  const existing=await (deps.listBindings||listProjectEndpointTestDataBindings)(env,organizationId,projectId,rs.endpointId,{environmentId:rs.environmentId});
  const actions=[];const updatedBindings=[];
  try{
    for(const change of normalized.changes){
      const current=exactEndpointBinding(existing,rs.environmentId,change.target,change.selector);
      if(current?.sourceType==='SECRET')fail('Override endpoint existente é SECRET e não pode ser sobrescrito.','HUMAN_REQUEST_REPAIR_SECRET_FORBIDDEN',409);
      if(change.operation==='ADD_REQUEST_BINDING'&&current)fail('Já existe configuração ativa para o parâmetro sugerido.','HUMAN_REQUEST_REPAIR_BINDING_EXISTS',409,{target:change.target,selector:change.selector});
      if(current){
        const updated=await (deps.patchBinding||patchProjectEndpointTestDataBinding)(env,{organizationId,projectId,endpointId:rs.endpointId,bindingId:current.bindingId,userId,input:{sourceType:'FIXED',valueType:change.valueType,value:change.value,description:`Human request repair ${repairId}`},originOverride:'USER_DEFINED'});
        actions.push({kind:'PATCHED',before:current,binding:updated});updatedBindings.push(updated);
      }else{
        const created=await (deps.createBinding||createProjectEndpointTestDataBinding)(env,{organizationId,projectId,endpointId:rs.endpointId,userId,input:{scopeType:'ENDPOINT',environmentId:rs.environmentId,target:change.target,selector:change.selector,sourceType:'FIXED',valueType:change.valueType,value:change.value,description:`Human request repair ${repairId}`}});
        actions.push({kind:'CREATED',binding:created});updatedBindings.push(created);
      }
    }
    const derived=await (deps.createRegistryVersion||createHumanRequestRepairVersion)({env,organizationId,projectId,payload:{organizationId,projectId,sourceTestDesignVersionId:normalized.sourceTestDesignVersionId,repair:{repairId,sourceResultSetId:normalized.resultSetId,sourceScenarioResultId:resultScenario.scenarioResultId,sourceScenarioId:normalized.scenarioId,approvedByUserId:userId,reason:normalized.reason},changes:registryChanges}});
    let rerun={requested:false,reason:'NOT_REQUESTED',run:null};
    if(normalized.rerun){
      try{
        const created=await (deps.createRerun||createEvolutionRerunV1)({env,organizationId,projectId,userId,sourceRunId:rs.runId,testDesignVersionId:derived.testDesign.versionId,environmentId:rs.environmentId,scenarioId:normalized.scenarioId,idempotencyKey:`human-request-repair-rerun:${repairId}:${derived.testDesign.versionId}`});
        rerun={requested:true,reason:'EXPLICIT_HUMAN_RERUN',status:'CREATED',run:created?.run?{runId:created.run.runId,status:created.run.status,testDesignVersionId:derived.testDesign.versionId,scenarioId:normalized.scenarioId}:null,runtimeReuse:created?.evolutionRuntimeReuse||null};
      }catch(error){rerun={requested:true,reason:'EXPLICIT_HUMAN_RERUN',status:'CREATE_FAILED',errorCode:error?.code||'HUMAN_REQUEST_REPAIR_RERUN_FAILED',run:null};}
    }
    await (deps.recordLearning||recordHumanRepairInLearningCycle)(env,{organizationId,projectId,resultSetId:normalized.resultSetId,scenarioId:normalized.scenarioId,repairId,testDesignVersionId:derived.testDesign.versionId,testDesignVersion:derived.testDesign.version,rerunRunId:rerun?.run?.runId||null}).catch(()=>{});
    return {contractVersion:'qagent.human-request-repair-result.v1',repairId,resultSetId:normalized.resultSetId,scenarioId:normalized.scenarioId,sourceTestDesignVersionId:normalized.sourceTestDesignVersionId,testDesign:{testDesignId:derived.testDesign.id,testDesignVersionId:derived.testDesign.versionId,testDesignVersion:derived.testDesign.version},bindings:updatedBindings.map((b)=>({bindingId:b.bindingId,target:b.target,selector:b.selector,sourceType:b.sourceType,valueType:b.valueType,origin:b.origin})),rerun};
  }catch(error){await rollbackBindings(env,scope,rs.endpointId,actions);throw error;}
}
