import { getRunnerTestArtifact, createScenarioLifecycleVersion } from './testRegistryClient.js';
function fail(message,code='SCENARIO_LIFECYCLE_INVALID',status=400){const e=new Error(message);e.code=code;e.status=status;throw e;}
function text(v,name,max=500){const x=String(v??'').trim();if(!x||x.length>max)fail(`${name} inválido.`);return x;}
export async function createScenarioLifecycleV1({env,organizationId,projectId,endpointId,userId,input,deps={}}={}){
  if(!userId)fail('Operação requer usuário autenticado.','SCENARIO_LIFECYCLE_ACTOR_REQUIRED',403);
  if(!input||input.contractVersion!=='qagent.scenario-lifecycle.v1')fail('contractVersion inválido.');
  const sourceTestDesignVersionId=text(input.sourceTestDesignVersionId,'sourceTestDesignVersionId',180);
  const scenarioId=text(input.scenarioId,'scenarioId',180);
  const action=text(input.action,'action',40).toUpperCase(); if(!['CLONE','RENAME','REMOVE'].includes(action))fail('Ação não suportada.');
  const artifact=await (deps.getArtifact||getRunnerTestArtifact)({env,organizationId,projectId,testDesignVersionId:sourceTestDesignVersionId});
  if(artifact.endpointId!==endpointId)fail('Test Design pertence a outro endpoint.','SCENARIO_LIFECYCLE_SCOPE_MISMATCH',409);
  const scenario=(artifact.specification?.scenarios||[]).find(s=>s?.scenarioId===scenarioId); if(!scenario)fail('Cenário não encontrado.','SCENARIO_LIFECYCLE_SCENARIO_NOT_FOUND',404);
  if(scenario.generationClass==='OBSERVED_BASELINE')fail('Baseline observada exige revisão de origem.','OBSERVED_BASELINE_REBASELINE_REQUIRED',409);
  const operationId=input.operationId?text(input.operationId,'operationId',180):`slo_${crypto.randomUUID()}`;
  const op={operationId,action,scenarioId,approvedByUserId:userId,reason:String(input.reason||'Scenario lifecycle management.').trim().slice(0,1000)};
  if(action==='CLONE'){op.newScenarioId=input.newScenarioId?text(input.newScenarioId,'newScenarioId',180):`scn_${crypto.randomUUID().replaceAll('-','')}`;op.title=String(input.title||`${scenario.title||'Cenário'} · cópia`).trim().slice(0,500);if(input.objective)op.objective=String(input.objective).trim().slice(0,2000);}
  if(action==='RENAME'){op.title=text(input.title,'title',500);if(input.objective)fail('Renomear altera apenas o título; clone o cenário para mudar sua intenção.','SCENARIO_LIFECYCLE_RENAME_OBJECTIVE_FORBIDDEN',409);}
  const payload={contractVersion:'qagent.scenario-lifecycle-registry.v1',organizationId,projectId,endpointId,sourceTestDesignVersionId,operation:op};
  const registry=await (deps.createVersion||createScenarioLifecycleVersion)({env,organizationId,projectId,payload});
  return {contractVersion:'qagent.scenario-lifecycle-result.v1',created:registry.created,idempotentReplay:registry.idempotentReplay,action,scenarioId,newScenarioId:op.newScenarioId||null,operationId,sourceTestDesignVersionId,testDesign:registry.testDesign,executionStarted:false};
}
