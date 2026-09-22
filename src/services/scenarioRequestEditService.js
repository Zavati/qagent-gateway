import { getRunnerTestArtifact, createScenarioRequestEditVersion } from './testRegistryClient.js';
import { getProjectEndpointTestDataBinding, resolveEndpointTestDataBindingsForRun } from './testDataBindingService.js';
import { pathPlaceholderDescriptors } from '../intelligence/testDataPlanner.js';
import { isSensitiveTestDataSelector } from '../lib/testDataPolicy.js';

const TARGETS=new Set(['BODY','QUERY','PATH_PARAM']);
const VALUE_TYPES=new Set(['STRING','NUMBER','INTEGER','BOOLEAN','JSON']);
const GENERATORS=new Set(['AUTO','TEXT','TEXT_SENTENCE','FIRST_NAME','LAST_NAME','FULL_NAME','EMAIL','UUID','BR_CPF','BR_CNPJ','BR_CEP','PHONE','INTEGER','NUMBER','BOOLEAN','DATE','DATE_TIME','CURRENT_DATE','CURRENT_DATE_TIME','STRING_LIST','INTEGER_LIST','NUMBER_LIST','BOOLEAN_LIST','JSON_SCHEMA']);
const STRING_GENERATORS=new Set(['AUTO','TEXT','TEXT_SENTENCE','FIRST_NAME','LAST_NAME','FULL_NAME','EMAIL','UUID','BR_CPF','BR_CNPJ','BR_CEP','PHONE','DATE','DATE_TIME','CURRENT_DATE','CURRENT_DATE_TIME']);
const BODY_SELECTOR=/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,7}$/;
const SIMPLE_SELECTOR=/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;

function fail(message,code='SCENARIO_REQUEST_EDIT_INVALID',status=400,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.publicDetails=details;throw e;}
function text(v,name,max=320){const x=String(v??'').trim();if(!x||x.length>max)fail(`${name} inválido.`);return x;}
function plain(v){return Boolean(v)&&typeof v==='object'&&!Array.isArray(v);}
function normalizeValueType(v){const x=String(v||'STRING').toUpperCase();if(!VALUE_TYPES.has(x))fail('valueType inválido.');return x;}
function normalizeTarget(v){const x=String(v||'').toUpperCase();if(!TARGETS.has(x))fail('target inválido.');return x;}
function selector(target,v){const x=text(v,'selector',320);if(target==='BODY'){if(!BODY_SELECTOR.test(x))fail('BODY selector inválido.');}else if(!SIMPLE_SELECTOR.test(x))fail('Selector inválido.');return x;}
function fixedValue(value,type){if(value===undefined)fail('value é obrigatório.');let out;if(type==='STRING')out=String(value);else if(type==='INTEGER'){const n=Number(value);if(!Number.isInteger(n))fail('INTEGER inválido.');out=n;}else if(type==='NUMBER'){const n=Number(value);if(!Number.isFinite(n))fail('NUMBER inválido.');out=n;}else if(type==='BOOLEAN'){if(typeof value==='boolean')out=value;else if(String(value).toLowerCase()==='true')out=true;else if(String(value).toLowerCase()==='false')out=false;else fail('BOOLEAN inválido.');}else out=value;let s;try{s=JSON.stringify(out);}catch{fail('JSON inválido.');}if(s===undefined||new TextEncoder().encode(s).byteLength>16384)fail('Valor excede o limite.','SCENARIO_REQUEST_EDIT_VALUE_TOO_LARGE',413);return out;}
function generatorCompatibility(kind,type){if(kind==='AUTO')return true;if(STRING_GENERATORS.has(kind)&&type==='STRING')return true;if(kind==='INTEGER'&&type==='INTEGER')return true;if((kind==='INTEGER'||kind==='NUMBER')&&type==='NUMBER')return true;if(kind==='BOOLEAN'&&type==='BOOLEAN')return true;if((kind.endsWith('_LIST')||kind==='JSON_SCHEMA')&&type==='JSON')return true;return false;}
function temporalConfig(raw){const c=plain(raw)?raw:{};const timezone=String(c.timezone||'UTC').trim();const offsetDays=c.offsetDays==null?0:Number(c.offsetDays);if(!Number.isInteger(offsetDays)||offsetDays < -3660||offsetDays>3660)fail('offsetDays inválido.');try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(new Date(0));}catch{fail('timezone IANA inválido.');}return {timezone,offsetDays};}
function generator(raw,valueType){if(!plain(raw))fail('generator é obrigatório.');const kind=String(raw.kind||'').toUpperCase();if(!GENERATORS.has(kind)||!generatorCompatibility(kind,valueType))fail('generatorKind incompatível.');let config={};if(kind==='CURRENT_DATE'||kind==='CURRENT_DATE_TIME')config=temporalConfig(raw.config);else if(raw.config!=null){if(!plain(raw.config))fail('generator.config inválido.');let s;try{s=JSON.stringify(raw.config);}catch{fail('generator.config inválido.');}if(new TextEncoder().encode(s).byteLength>8192)fail('generator.config excede o limite.','SCENARIO_REQUEST_EDIT_GENERATOR_TOO_LARGE',413);config=structuredClone(raw.config);}return {kind,config};}
function localKey(scenarioId,target,selectorValue){return `SCENARIO:${scenarioId}:${target}:${selectorValue}`;}
function observedBindingKey(scenario,target,selectorValue){if(target!=='PATH_PARAM')return `${target}:${selectorValue}`;const matches=pathPlaceholderDescriptors(scenario?.spec?.target?.path).filter(d=>d.selector===selectorValue);if(matches.length!==1)fail('PATH_PARAM OBSERVED requer placeholder único nesta versão.','SCENARIO_REQUEST_EDIT_PATH_AMBIGUOUS',409,{selector:selectorValue,matchCount:matches.length});return matches[0].bindingKey;}

function normalizePublicInput(input,scenario){
  if(!plain(input)||input.contractVersion!=='qagent.scenario-request-edit.v1')fail('contractVersion inválido.');
  const sourceTestDesignVersionId=text(input.sourceTestDesignVersionId,'sourceTestDesignVersionId',180);
  const scenarioId=text(input.scenarioId,'scenarioId',180);if(scenarioId!==scenario.scenarioId)fail('scenarioId não corresponde ao cenário source.','SCENARIO_REQUEST_EDIT_SCENARIO_MISMATCH',409);
  if(!Array.isArray(input.changes)||input.changes.length<1||input.changes.length>20)fail('Informe 1..20 alterações.');
  const seen=new Set();
  const changes=input.changes.map((raw,i)=>{
    if(!plain(raw))fail(`changes[${i}] inválido.`);const operation=String(raw.operation||'').toUpperCase();const target=normalizeTarget(raw.target);const sel=selector(target,raw.selector);const key=`${target}:${sel}`;if(seen.has(key))fail('Selector duplicado.');seen.add(key);
    if(operation==='OMIT'){if(target==='PATH_PARAM')fail('Omissão de PATH_PARAM deve usar o fluxo governado de intenção negativa.','SCENARIO_REQUEST_EDIT_PATH_OMIT_FORBIDDEN',409);return {type:'OMIT',scenarioId,target,selector:sel};}
    const valueType=normalizeValueType(raw.valueType);
    if(valueType==='JSON'&&target!=='BODY')fail('JSON scenario-local é suportado apenas em BODY.','SCENARIO_REQUEST_EDIT_JSON_TARGET_UNSUPPORTED',409);
    if(operation==='FIXED'){if(isSensitiveTestDataSelector(target,sel))fail('Campo sensível deve usar SECRET/Vault.','SCENARIO_REQUEST_EDIT_SECRET_REQUIRED',409);return {type:'SET_FIXED_LOCAL',scenarioId,target,selector:sel,valueType,value:fixedValue(raw.value,valueType),bindingKey:localKey(scenarioId,target,sel)};}
    if(operation==='GENERATED'){if(isSensitiveTestDataSelector(target,sel))fail('Campo sensível não pode ser gerado.','SCENARIO_REQUEST_EDIT_SECRET_REQUIRED',409);return {type:'SET_GENERATED',scenarioId,target,selector:sel,valueType,generator:generator(raw.generator,valueType)};}
    if(operation==='OBSERVED'){if(isSensitiveTestDataSelector(target,sel))fail('Campo sensível não pode usar OBSERVED.','SCENARIO_REQUEST_EDIT_SECRET_REQUIRED',409);return {type:'SET_OBSERVED',scenarioId,target,selector:sel,valueType,bindingKey:observedBindingKey(scenario,target,sel)};}
    if(operation==='SHARED'){return {type:'USE_SHARED',scenarioId,target,selector:sel,valueType,sharedBindingId:text(raw.sharedBindingId,'sharedBindingId',180)};}
    fail('Operação não suportada.','SCENARIO_REQUEST_EDIT_OPERATION_UNSUPPORTED');
  });
  return {sourceTestDesignVersionId,scenarioId,environmentId:input.environmentId?text(input.environmentId,'environmentId',180):null,editId:input.editId?text(input.editId,'editId',180):`sre_${crypto.randomUUID()}`,reason:String(input.reason||'Edição manual da request deste cenário.').trim().slice(0,1000),changes};
}

export async function createScenarioRequestEditV1({env,organizationId,projectId,endpointId,userId,input,deps={}}={}){
  if(!userId)fail('Edição de cenário requer usuário autenticado.','SCENARIO_REQUEST_EDIT_ACTOR_REQUIRED',403);
  const getArtifact=deps.getArtifact||getRunnerTestArtifact;
  const sourceVersionId=text(input?.sourceTestDesignVersionId,'sourceTestDesignVersionId',180);
  const artifact=await getArtifact({env,organizationId,projectId,testDesignVersionId:sourceVersionId});
  if(artifact.endpointId!==endpointId)fail('Test Design pertence a outro endpoint.','SCENARIO_REQUEST_EDIT_SCOPE_MISMATCH',409);
  const sourceScenario=(artifact.specification?.scenarios||[]).find(s=>s?.scenarioId===String(input?.scenarioId||'').trim());
  if(!sourceScenario)fail('Cenário não encontrado.','SCENARIO_REQUEST_EDIT_SCENARIO_NOT_FOUND',404);
  if(sourceScenario.generationClass==='OBSERVED_BASELINE')fail('Baseline observada exige revisão de origem; não aceita edição ad hoc da request.','OBSERVED_BASELINE_REBASELINE_REQUIRED',409);
  const normalized=normalizePublicInput(input,sourceScenario);
  const prepared=[];
  for(const change of normalized.changes){
    if(change.type!=='USE_SHARED'){prepared.push(change);continue;}
    const shared=await (deps.getSharedBinding||getProjectEndpointTestDataBinding)(env,organizationId,projectId,endpointId,change.sharedBindingId);
    if(!shared||shared.status!=='active'||shared.target!==change.target||shared.selector!==change.selector)fail('Configuração compartilhada não corresponde ao campo selecionado.','SCENARIO_REQUEST_EDIT_SHARED_BINDING_MISMATCH',409,{bindingId:change.sharedBindingId});
    if(shared.environmentId&&shared.environmentId!==normalized.environmentId)fail('Configuração compartilhada pertence a outro Environment.','SCENARIO_REQUEST_EDIT_SHARED_ENVIRONMENT_MISMATCH',409);
    if(shared.sourceType==='SECRET'&&change.valueType!=='STRING')fail('SECRET suporta apenas STRING.');
    if(isSensitiveTestDataSelector(change.target,change.selector)&&shared.sourceType!=='SECRET')fail('Campo sensível deve usar SECRET/Vault.','SCENARIO_REQUEST_EDIT_SECRET_REQUIRED',409);
    if(!['FIXED','SECRET','GENERATED'].includes(shared.sourceType))fail('Fonte compartilhada não suportada.','SCENARIO_REQUEST_EDIT_SHARED_SOURCE_UNSUPPORTED',409);
    if(normalized.environmentId){const effective=await (deps.resolveShared||resolveEndpointTestDataBindingsForRun)(env,organizationId,projectId,endpointId,normalized.environmentId);if(!effective.some(b=>b.bindingId===shared.bindingId))fail('Binding selecionado não é o binding efetivo para o Environment.','SCENARIO_REQUEST_EDIT_SHARED_NOT_EFFECTIVE',409);}
    prepared.push({type:'USE_SHARED',scenarioId:change.scenarioId,target:change.target,selector:change.selector,valueType:shared.valueType,sourceType:shared.sourceType,bindingKey:`${change.target}:${change.selector}`,sharedBindingId:shared.bindingId,...(shared.sourceType==='GENERATED'?{generator:{kind:shared.generatorKind||'AUTO',config:shared.generatorConfig||{}}}:{})});
  }
  const payload={contractVersion:'qagent.scenario-request-edit-registry.v1',organizationId,projectId,endpointId,sourceTestDesignVersionId:normalized.sourceTestDesignVersionId,edit:{editId:normalized.editId,scenarioId:normalized.scenarioId,approvedByUserId:userId,reason:normalized.reason},changes:prepared};
  const registry=await (deps.createVersion||createScenarioRequestEditVersion)({env,organizationId,projectId,payload});
  return {contractVersion:'qagent.scenario-request-edit-result.v1',created:registry.created,idempotentReplay:registry.idempotentReplay,sourceTestDesignVersionId:normalized.sourceTestDesignVersionId,scenarioId:normalized.scenarioId,editId:normalized.editId,testDesign:registry.testDesign,executionStarted:false};
}
