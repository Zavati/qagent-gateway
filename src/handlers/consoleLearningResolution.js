import { NEGATIVE_REPAIR_CHANGE, validateNegativeStrategy, negativeEffectivePath, negativePreparationGate } from '../negativeRequestStrategy.js';
import { COVERAGE_ASSERTION_TYPES, validateCoverageAssertion, validateCoverageEvaluation, assertionCoverageGaps } from '../coverageAssertions.js';
import { assessExploratoryLearning, learningBlockerCodes, learningReadinessDiagnostics } from '../learningScenarioEligibility.js';
import { prepareExploratoryLearningData, learningDataSummary } from '../services/exploratoryLearningData.js';
import { resolveEndpointTestDataBindingsForRun } from '../services/testDataBindingService.js';
import { resolveObservedTestDataForRun } from '../services/observedTestDataRuntimeResolver.js';
/** FIX-2: bounded entry points into the existing Evolution machinery.
 * Analysis, approval and verification are deliberately separate writes.
 * No monitored HTTP request is performed by analyze/apply.
 */
import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { getLatestTestDesign } from '../services/testRegistryClient.js';
import { listResultsProjectResultSets, getResultsProjectResultSet } from '../services/resultsReadClient.js';
import { inspectResultEvolution, createEvolutionProposal, getEvolutionPolicy, getEvolutionProposal, getEvolutionProposalContext, assessEvolutionProposal, approveEvolutionProposalsBatch } from '../services/testEvolutionClient.js';
import { assessTestEvolutionWithAi } from '../services/testEvolutionAiService.js';
import { createEvolutionRerunV1 } from '../services/evolutionRerunService.js';
import { recordManualEvolutionApprovalInLearningCycle } from '../services/learningCycleService.js';
import { baselineLearningEligibility } from '../baselineContract.js';

const VERSION='qagent.learning-resolution.v1';
const SAFE=new Set(['GET','HEAD','OPTIONS']);
const ID=/^[A-Za-z0-9_-]{1,160}$/;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
function fail(code,status=400){const e=new Error(code);e.code=code;e.status=status;throw e;}
function exact(x,keys){if(!plain(x)||Object.keys(x).some(k=>!keys.includes(k)))fail('LEARNING_RESOLUTION_INPUT_INVALID');}
function id(x){if(typeof x!=='string'||!ID.test(x))fail('LEARNING_RESOLUTION_ID_INVALID');return x;}
function code(e){return typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{0,119}$/.test(e.code)?e.code:'LEARNING_RESOLUTION_DEPENDENCY_FAILED';}
async function body(req){const raw=await req.text();if(new TextEncoder().encode(raw).length>32768)fail('LEARNING_RESOLUTION_INPUT_TOO_LARGE',413);try{return JSON.parse(raw)}catch{fail('LEARNING_RESOLUTION_JSON_INVALID');}}
async function auth(req,env,projectId,deps){const t=await(deps.requireTenant||requireConsoleTenant)(req,env);await(deps.getProject||getOrganizationProject)(env,t.organizationId,projectId);if(!['owner','admin','member'].includes(t.organizationRole))fail('LEARNING_RESOLUTION_FORBIDDEN',403);return {tenant:t,common:{env,organizationId:t.organizationId,projectId,userId:t.user?.userId||null}};}
function codes(x){return Array.isArray(x)?x.filter(s=>typeof s==='string'&&/^[A-Z][A-Z0-9_:-]{0,119}$/.test(s)).slice(0,20):[];}
function safeDiff(diff){
  if(!plain(diff))return null;
  const project=(x)=>Object.fromEntries(Object.entries(x||{}).filter(([k,v])=>['path','type','format','fromType','toType','fromFormat','toFormat'].includes(k)&&typeof v==='string'&&v.length<=300));
  return {added:(diff.added||[]).slice(0,40).map(project),changed:(diff.changed||[]).slice(0,40).map(project),removed:(diff.removed||[]).slice(0,40).map(project),truncated:diff.truncated===true||(diff.added?.length||0)>40||(diff.changed?.length||0)>40};
}
function safeNegativeRepair(c){
 const p=c.proposed?.repairProof,s=validateNegativeStrategy(p?.strategy);
 return {operation:s.operation,target:s.target,selector:s.selector,sourcePath:s.sourcePath,effectivePath:negativeEffectivePath(s.sourcePath,s),...(s.operation==='QUERY_VALUE_PROBE'?{probeValue:s.probeValue}:{}),basis:s.basis,invalidityProven:false,assertionsUnchanged:true,readinessAfter:'REVIEW_REQUIRED',requiresVerification:true,addedBindings:(p.addedBindings||[]).map(b=>({target:b.target,selector:b.selector,source:b.source})),warning:s.operation==='OMIT_PATH_SEGMENT'?'Variante de rota revisada: remover o segmento não garante que a mesma rota lógica será atendida. O status continua hipótese.':'Valor de sondagem diferente do usado na execução fonte. Não é comprovadamente inválido; 2xx não autoriza aprender sucesso como rejeição.'};
}
function safeExtension(c){
  const proof=c.proposed?.coverageProof;
  return {readinessBefore:c.current?.readiness,readinessAfter:'READY',existingAssertionsPreserved:true,
    assertionsUnchanged:false,existingAssertionCount:proof?.execution?.assertionCount||0,
    addedAssertions:(proof?.additions||[]).slice(0,6).map(a=>a.type==='STATUS'?{type:'STATUS',expectedStatusCodes:a.expectedStatusCodes}:validateCoverageAssertion(a)),
    observations:(proof?.observations||[]).slice(0,5).map(o=>o.kind==='JSON_TYPE'?{kind:o.kind,path:o.path,expectedType:o.expectedType,actualType:o.actualType}:{kind:o.kind,path:o.path,selector:o.selector,actualLength:o.actualLength,requestBound:o.requestBound}),
    requiresVerification:true};
}
/** A no-change result is informational, not a readiness mutation or confirmation.
 * Do not reuse an older green after examining a newer compatible result.
 */
function alreadyReadyAndPassed(source,result){
  if(source.automation?.readiness!=='READY'||result.outcome!=='PASSED'||result.http?.outcome!=='RESPONSE'||result.http?.errorCode)return false;
  const expected=source.spec?.assertions||[],actual=result.assertions||[];
  if(!expected.length||expected.length!==actual.length)return false;
  const seen=new Set();
  return actual.every(a=>{
    const e=expected[a.assertionIndex];
    if(!e||!Number.isInteger(a.assertionIndex)||seen.has(a.assertionIndex)||e.type!==a.type||a.outcome!=='PASSED'||a.errorCode)return false;seen.add(a.assertionIndex);
    if(e.type==='STATUS')return a.actualStatusCode===result.http.statusCode&&e.expectedStatusCodes?.includes(result.http.statusCode)&&JSON.stringify(a.expectedStatusCodes)===JSON.stringify(e.expectedStatusCodes);
    if(e.type==='SCHEMA')return a.schemaRef===e.schemaRef;
    if(['JSON_PATH_EXISTS','JSON_PATH_EQUALS'].includes(e.type))return a.path===e.path;
    if(e.type==='HEADER_EXISTS')return String(a.headerName).toLowerCase()===String(e.name).toLowerCase();
    if(e.type==='CONTENT_TYPE')return JSON.stringify(a.expectedContentTypes)===JSON.stringify(e.expected);
    if(COVERAGE_ASSERTION_TYPES.has(e.type)){
      try{const c=validateCoverageEvaluation(a.coverage,e.type);if(JSON.stringify(c.assertion)!==JSON.stringify(e))return false;
        return e.type==='JSON_PATH_TYPE'?(c.actualType===e.expectedType||(e.expectedType==='number'&&c.actualType==='integer')):c.actualType==='array'&&c.actualLength!=null&&c.requestBound!=null&&c.actualLength<=c.requestBound;
      }catch{return false;}
    }
    return false;
  });
}
function safeProposal(p){
  if(!p)return null;
  return {proposalId:p.proposalId,status:p.status,source:p.source,result:p.result,risk:p.risk,confidence:p.confidence,
    changes:(p.changes||[]).slice(0,30).map(c=>({changeId:c.changeId,changeType:c.changeType,assertionIndex:c.assertionIndex,risk:c.risk,confidence:c.confidence,
      learningMode:c.proposed?.learningMode||null,requiresHumanApproval:c.proposed?.requiresHumanApproval===true,
      // Deliberately no inferred literal/request values in this triage projection.
      confirmation:c.changeType==='SCENARIO_READINESS_CONFIRMATION'?{readinessBefore:c.current?.readiness,readinessAfter:'READY',assertionsUnchanged:true,assertionCount:c.observed?.assertionCount,actualStatusCode:c.observed?.actualStatusCode,completedAt:c.observed?.completedAt,environmentId:c.proposed?.confirmationProof?.environmentId,addedBindings:(c.proposed?.confirmationProof?.addedBindings||[]).map(b=>({target:b.target,selector:b.selector,source:b.source,bindingKey:b.bindingKey})),resolvedBlockers:codes(c.proposed?.confirmationProof?.resolvedBlockers)}:null,
      repair:c.changeType===NEGATIVE_REPAIR_CHANGE?safeNegativeRepair(c):null,
      extension:c.changeType==='ASSERTION_COVERAGE_EXTENSION'?safeExtension(c):null,
      summary:c.changeType===NEGATIVE_REPAIR_CHANGE?'Reparar a construção do experimento negativo, preservando as assertions e a autenticação. A aprovação não comprova a rejeição.':c.changeType==='ASSERTION_COVERAGE_EXTENSION'?'Acrescentar verificações sustentadas pela execução, preservando as assertions existentes. Verificar a nova versão antes de concluir a aprendizagem.':c.changeType==='SCENARIO_READINESS_CONFIRMATION'?'Confirmar as expectativas atendidas e incorporar o cenário à regressão, sem alterar assertions.':c.proposed?.learningMode==='ENRICHMENT'?'Completar estrutura desconhecida preservando regras conhecidas.':`Revisar alteração ${c.changeType}.`,
      knownRulesPreserved:c.proposed?.learningMode==='ENRICHMENT'?c.proposed?.knownRulesPreserved===true:null,structuralDiff:safeDiff(c.observed?.diff),currentSchemaRef:c.current?.schemaRef||null,proposedSchemaHash:c.proposed?.schemaHash||null,
      currentStatusCodes:Array.isArray(c.current?.expectedStatusCodes)?c.current.expectedStatusCodes:[],proposedStatusCodes:Array.isArray(c.proposed?.expectedStatusCodes)?c.proposed.expectedStatusCodes:[]})),
    assessment:p.assessment?{classification:p.assessment.classification,decision:p.assessment.decision,confidence:p.assessment.confidence,reasonCodes:codes(p.assessment.reasonCodes),autoAction:p.assessment.autoAction}:null,
    outcomeVerification:p.outcomeVerification?{outcome:p.outcomeVerification.outcome,rerunRunId:p.outcomeVerification.rerun?.runId||p.outcomeVerification.rerunRunId,verifiedAt:p.outcomeVerification.verifiedAt}:null};
}
function learningCandidate(s,environmentId){
  if(s.generationClass==='OBSERVED_BASELINE'){
    if(s.baseline?.source?.environmentId!==environmentId)return {allowed:false,reason:'OBSERVED_BASELINE_ENVIRONMENT_MISMATCH'};
    const out=baselineLearningEligibility(s);return {allowed:out.allowed===true,reason:out.reason||null};
  }
  return assessExploratoryLearning(s);
}
function selected(input){
  exact(input,['environmentId','selections']);id(input.environmentId);
  if(!Array.isArray(input.selections)||input.selections.length<1||input.selections.length>5)fail('LEARNING_ANALYSIS_SELECTION_LIMIT');
  const seen=new Set();return input.selections.map(x=>{exact(x,['endpointId','testDesignVersionId','scenarioId']);Object.values(x).forEach(id);const key=`${x.endpointId}:${x.testDesignVersionId}:${x.scenarioId}`;if(seen.has(key))fail('LEARNING_ANALYSIS_DUPLICATE_SELECTION');seen.add(key);return x;});
}
export async function postConsoleLearningResolutionAnalyze(req,env,{projectId},deps={}){
  const {tenant,common}=await auth(req,env,projectId,deps),input=await body(req),selection=selected(input),items=[];
  const versions=new Map(),lists=new Map(),details=new Map(),inspections=new Map();let policyPromise;
  const memo=async(map,key,load)=>{if(!map.has(key))map.set(key,Promise.resolve().then(load));return map.get(key);};
  for(const target of selection){
    const base={...target,environmentId:input.environmentId};
    try{
      const latest=await memo(versions,target.endpointId,()=> (deps.getLatest||getLatestTestDesign)({...common,endpointId:target.endpointId}));
      if(!latest.exists||latest.testDesign?.versionId!==target.testDesignVersionId)fail('LEARNING_SOURCE_VERSION_STALE',409);
      const scenario=latest.testDesign.specification?.scenarios?.find(s=>s.scenarioId===target.scenarioId);
      if(!scenario)fail('LEARNING_SCENARIO_NOT_FOUND',404);
      let candidate=learningCandidate(scenario,input.environmentId);
      const inheritedId=scenario.baseline?.enrichment?.proposalId||scenario.learning?.proposalId;
      if(inheritedId&&scenario.learning?.kind!==NEGATIVE_REPAIR_CHANGE){const p=await(deps.getProposal||getEvolutionProposal)({...common,proposalId:inheritedId});items.push({...base,status:'APPLIED',proposal:safeProposal(p),learning:{allowed:false,reason:'LEARNING_ALREADY_APPLIED',requiresRuntimePreflight:true}});continue;}
      const list=await memo(lists,target.endpointId,()=> (deps.listResults||listResultsProjectResultSets)({...common,endpointId:target.endpointId,environmentId:input.environmentId,limit:5}));
      let proposal=null,lastReason=null,examined=0,noChangeEvidence=null;
      for(const ref of (list.items||[]).filter(x=>x.endpointId===target.endpointId&&x.environmentId===input.environmentId&&x.testDesignVersionId===target.testDesignVersionId)){
        const detail=await memo(details,ref.resultSetId,()=> (deps.getResult||getResultsProjectResultSet)({...common,resultSetId:ref.resultSetId}));
        const rs=detail.resultSet;
        if(!rs||rs.organizationId!==common.organizationId||rs.projectId!==projectId||rs.endpointId!==target.endpointId||rs.testDesignVersionId!==target.testDesignVersionId||rs.environmentId!==input.environmentId)fail('LEARNING_RESULT_SCOPE_MISMATCH',502);
        const found=detail.scenarios?.find(s=>s.scenarioId===target.scenarioId);if(!found)continue;examined++;
        const inspection=await memo(inspections,ref.resultSetId,()=> (deps.inspect||inspectResultEvolution)({...common,resultSetId:ref.resultSetId}));
        const match=inspection.scenarios?.find(s=>s.scenarioResultId===found.scenarioResultId);
        if(!match?.eligible){
          lastReason=match?.reason||'NO_SUPPORTED_EVOLUTION_CANDIDATE';
          if(examined===1&&candidate.allowed&&alreadyReadyAndPassed(scenario,found)){
            noChangeEvidence={resultSetId:rs.resultSetId,runId:rs.runId,scenarioResultId:found.scenarioResultId,completedAt:rs.completedAt,assertionCount:found.assertions.length};break;
          }
          continue;
        }
        if(examined>1&&match.changes?.some(c=>['SCENARIO_READINESS_CONFIRMATION','ASSERTION_COVERAGE_EXTENSION',NEGATIVE_REPAIR_CHANGE].includes(c.changeType))){lastReason='LEARNING_CONFIRMATION_NEWER_EVIDENCE_PRESENT';continue;}
        proposal=await(deps.createProposal||createEvolutionProposal)({...common,input:{resultSetId:ref.resultSetId,scenarioResultId:found.scenarioResultId}});
        if(['REJECTED','STALE'].includes(proposal.status)){lastReason=`EVOLUTION_PROPOSAL_${proposal.status}`;proposal=null;continue;}
        if(proposal.status==='PENDING_REVIEW'){
          policyPromise=policyPromise||Promise.resolve().then(()=>(deps.getPolicy||getEvolutionPolicy)(common));
          const policy=await policyPromise;if(policy.mode==='OFF')fail('TEST_EVOLUTION_PROJECT_DISABLED',409);
          const context=await(deps.getContext||getEvolutionProposalContext)({...common,proposalId:proposal.proposalId});
          if(proposal.assessment?.contextFingerprint===context.contextFingerprint)break;
          const reasoning=await(deps.aiAssess||assessTestEvolutionWithAi)({env,accountId:tenant.accountId||null,context});
          const assessed=await(deps.assess||assessEvolutionProposal)({...common,proposalId:proposal.proposalId,input:{contextFingerprint:context.contextFingerprint,assessment:reasoning.assessment,ai:reasoning.ai,analysisOnly:true}});
          proposal={...(assessed.proposal||proposal),assessment:assessed.assessment||(assessed.proposal||proposal).assessment||null};
        }
        break;
      }
      if (!proposal && !noChangeEvidence && candidate.allowed && scenario.generationClass !== 'OBSERVED_BASELINE') {
        try {
          const needsConfig=(scenario.spec?.testData?.bindings || []).length || /\{[^}]+\}/.test(scenario.spec?.target?.path || '');
          const configured=needsConfig ? await (deps.resolveTestDataBindings || resolveEndpointTestDataBindingsForRun)(env,common.organizationId,projectId,target.endpointId,input.environmentId) : [];
          const prepared=prepareExploratoryLearningData(scenario,configured);
          if ((prepared.spec?.testData?.bindings || []).some(b=>b.source==='OBSERVED')) {
            await (deps.resolveObservedTestData || resolveObservedTestDataForRun)({env,organizationId:common.organizationId,projectId,endpointId:target.endpointId,environmentId:input.environmentId,selectedScenarios:[prepared]});
          }
          candidate={...candidate,dataResolution:learningDataSummary(prepared)};
        } catch(error) {
          if (Number(error?.status || 0) >= 500) throw error;
          candidate={...candidate,allowed:false,reason:code(error),blockers:[code(error)],dataResolution:{status:'UNRESOLVED',noValuesExposed:true}};
        }
      }
      if(proposal?.changes?.some(c=>c.changeType===NEGATIVE_REPAIR_CHANGE)){
        const settings=await(deps.resolveTestDataBindings||resolveEndpointTestDataBindingsForRun)(env,common.organizationId,projectId,target.endpointId,input.environmentId);
        for(const change of proposal.changes.filter(c=>c.changeType===NEGATIVE_REPAIR_CHANGE)){
          const strategy=validateNegativeStrategy(change.proposed?.repairProof?.strategy);
          if(settings.some(b=>b.target===strategy.target&&b.selector===strategy.selector))fail('NEGATIVE_REQUEST_EXPLICIT_CONFIGURATION_CONFLICT',409);
        }
      }
      items.push({...base,status:proposal?'PROPOSAL_AVAILABLE':noChangeEvidence?'NO_CHANGE_REQUIRED':candidate.allowed?'LEARNING_AVAILABLE':'BLOCKED',proposal:safeProposal(proposal),
        reason:proposal?(proposal.changes?.some(c=>c.changeType===NEGATIVE_REPAIR_CHANGE)?'NEGATIVE_REQUEST_REPAIR_AVAILABLE':proposal.changes?.some(c=>c.changeType==='SCENARIO_READINESS_CONFIRMATION')?'LEARNING_HYPOTHESIS_CONFIRMED':proposal.changes?.some(c=>c.changeType==='ASSERTION_COVERAGE_EXTENSION')?'LEARNING_ASSERTION_EXTENSION_AVAILABLE':null):noChangeEvidence?'LEARNING_READY_EXECUTION_PASSED':(!candidate.allowed?candidate.reason:(lastReason||candidate.reason))||'NO_COMPATIBLE_EXECUTION_EVIDENCE',examinedResultCount:examined,
        search:{maxRecentResultSets:5,hasMore:list.page?.hasMore===true||list.hasMore===true},
        learning:{...candidate,allowed:proposal||noChangeEvidence?false:candidate.allowed,requiresRuntimePreflight:true},blockers:candidate.blockers || learningBlockerCodes(scenario),knowledgeWarnings:candidate.knowledgeWarnings || [],semanticDiagnostics:learningReadinessDiagnostics(scenario),evidence:noChangeEvidence});
    }catch(error){items.push({...base,status:'ERROR',errorCode:code(error),learning:{allowed:false,requiresRuntimePreflight:true},proposal:null});}
  }
  return {status:'ok',data:{contractVersion:VERSION,projectId,operation:'ANALYZE',items,executionStarted:false,appliedByThisOperation:false}};
}
export async function postConsoleLearningResolutionApprove(req,env,{projectId},deps={}){
  const {common}=await auth(req,env,projectId,deps),input=await body(req);exact(input,['items','reason']);
  if(!Array.isArray(input.items)||input.items.length<1||input.items.length>10||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)fail('LEARNING_APPROVAL_INPUT_INVALID');
  const seen=new Set(),groups=new Map();let changes=0;
  // Validate all selections before any write. Group-level failures do not claim atomicity across endpoints.
  for(const x of input.items){exact(x,['proposalId','acceptedChangeIds']);id(x.proposalId);if(seen.has(x.proposalId))fail('LEARNING_DUPLICATE_PROPOSAL');seen.add(x.proposalId);if(!Array.isArray(x.acceptedChangeIds)||!x.acceptedChangeIds.length)fail('LEARNING_APPROVAL_EMPTY');x.acceptedChangeIds.forEach(id);changes+=x.acceptedChangeIds.length;if(changes>30)fail('LEARNING_APPROVAL_CHANGE_LIMIT');
    const p=await(deps.getProposal||getEvolutionProposal)({...common,proposalId:x.proposalId});const key=`${p.source.testDesignId}:${p.source.testDesignVersionId}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);
  }
  const items=[];
  for(const members of groups.values())try{
    const result=await(deps.approveBatch||approveEvolutionProposalsBatch)({...common,input:{items:members,reason:input.reason.trim()}});
    let ledgerDeferred=false;
    for(const p of result.proposals||[])if(p.status==='APPLIED')try{await(deps.recordLearningApproval||recordManualEvolutionApprovalInLearningCycle)(env,{...common,proposal:p});}catch{ledgerDeferred=true;}
    items.push({groupId:result.groupId,status:result.status,result:result.result,proposals:(result.proposals||[]).map(safeProposal),ledgerProjection:ledgerDeferred?'DEFERRED':'RECORDED'});
  }catch(error){items.push({status:'ERROR',proposalIds:members.map(x=>x.proposalId),errorCode:code(error)});}
  return {status:'ok',data:{contractVersion:VERSION,projectId,operation:'APPROVE',items,executionStarted:false}};
}
export async function postConsoleLearningResolutionVerify(req,env,{projectId},deps={}){
  const {common}=await auth(req,env,projectId,deps),input=await body(req);exact(input,['proposalIds','confirmExecution']);
  if(input.confirmExecution!==true||!Array.isArray(input.proposalIds)||input.proposalIds.length<1||input.proposalIds.length>10)fail('LEARNING_VERIFICATION_CONFIRMATION_REQUIRED');input.proposalIds.forEach(id);if(new Set(input.proposalIds).size!==input.proposalIds.length)fail('LEARNING_DUPLICATE_PROPOSAL');
  const items=[];
  for(const proposalId of input.proposalIds)try{
    const p=await(deps.getProposal||getEvolutionProposal)({...common,proposalId});
    if(p.status!=='APPLIED'||!p.result?.testDesignVersionId)fail('LEARNING_PROPOSAL_NOT_APPLIED',409);
    if(p.outcomeVerification){items.push({proposalId,status:'VERIFIED',verification:safeProposal(p).outcomeVerification});continue;}
    const detail=await(deps.getResult||getResultsProjectResultSet)({...common,resultSetId:p.source.resultSetId}),rs=detail.resultSet,s=detail.scenarios?.find(x=>x.scenarioResultId===p.source.scenarioResultId);
    if(!rs||rs.organizationId!==common.organizationId||rs.projectId!==projectId||rs.endpointId!==p.source.endpointId||rs.testDesignVersionId!==p.source.testDesignVersionId||s?.scenarioId!==p.source.scenarioId)fail('LEARNING_RESULT_SCOPE_MISMATCH',502);
    if(!SAFE.has(s?.http?.method))fail('LEARNING_MUTATION_VERIFICATION_REQUIRES_EXISTING_POLICY',409);
    const created=await(deps.createRerun||createEvolutionRerunV1)({...common,sourceRunId:rs.runId,testDesignVersionId:p.result.testDesignVersionId,environmentId:rs.environmentId,scenarioId:p.source.scenarioId,...(p.changes.some(c=>c.changeType===NEGATIVE_REPAIR_CHANGE)||s?.evidence?.request?.negativeRequest?{purpose:'LEARNING'}:{}),idempotencyKey:`test-evolution-rerun:${proposalId}:${p.result.testDesignVersionId}`});
    items.push({proposalId,status:'CREATED',runId:created.run?.runId,runStatus:created.run?.status,testDesignVersionId:p.result.testDesignVersionId});
  }catch(error){items.push({proposalId,status:'ERROR',errorCode:code(error)});}
  return {status:'ok',data:{contractVersion:VERSION,projectId,operation:'VERIFY',items}};
}
