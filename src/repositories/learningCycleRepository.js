import { requireDataDb } from './dataDb.js';

function n(v){return Number(v||0);}
function bool(v){return Number(v)===1;}
function parseJson(v,fallback=null){try{return JSON.parse(v);}catch{return fallback;}}
function mapCycle(row){if(!row)return null;return {...row,suiteVersion:n(row.suiteVersion)};}
function mapScenario(row){if(!row)return null;return {...row,sourceTestDesignVersion:row.sourceTestDesignVersion==null?null:n(row.sourceTestDesignVersion),statusCode:row.statusCode==null?null:n(row.statusCode),assertionFailedCount:n(row.assertionFailedCount),inspectionEligible:row.inspectionEligible==null?null:bool(row.inspectionEligible),requestIssueDetected:bool(row.requestIssueDetected),confidence:row.confidence==null?null:n(row.confidence),riskScore:row.riskScore==null?null:n(row.riskScore),evolvedTestDesignVersion:row.evolvedTestDesignVersion==null?null:n(row.evolvedTestDesignVersion),humanRepairTestDesignVersion:row.humanRepairTestDesignVersion==null?null:n(row.humanRepairTestDesignVersion),attentionVerificationRequired:bool(row.attentionVerificationRequired),attentionResolutionTestDesignVersion:row.attentionResolutionTestDesignVersion==null?null:n(row.attentionResolutionTestDesignVersion)};}
function attentionStatusForState(state){const value=String(state||'').toUpperCase();if(['REVIEW_REQUIRED','NOT_RECOVERED','VERIFICATION_BLOCKED','HUMAN_REPAIR_NOT_RECOVERED','HUMAN_VERIFICATION_BLOCKED'].includes(value))return 'OPEN';if(['VERIFYING','HUMAN_VERIFYING','PENDING_VERIFICATION'].includes(value))return 'PENDING_VERIFICATION';if(['HEALTHY','NO_EVOLUTION','RECOVERED_BY_EVOLUTION','RECOVERED_BY_HUMAN_REPAIR'].includes(value))return 'RESOLVED';return 'PROCESSING';}

const CYCLE_SELECT=`SELECT learning_cycle_id AS learningCycleId,organization_id AS organizationId,project_id AS projectId,suite_run_id AS suiteRunId,suite_version_id AS suiteVersionId,suite_version AS suiteVersion,environment_id AS environmentId,contract_version AS contractVersion,status,started_at AS startedAt,settled_at AS settledAt,completed_at AS completedAt,created_at AS createdAt,updated_at AS updatedAt FROM continuous_learning_cycles`;
const SCENARIO_SELECT=`SELECT learning_scenario_id AS learningScenarioId,learning_cycle_id AS learningCycleId,organization_id AS organizationId,project_id AS projectId,source_result_set_id AS sourceResultSetId,source_run_id AS sourceRunId,source_scenario_result_id AS sourceScenarioResultId,scenario_id AS scenarioId,endpoint_id AS endpointId,request_method AS requestMethod,request_path AS requestPath,source_test_design_version_id AS sourceTestDesignVersionId,source_test_design_version AS sourceTestDesignVersion,source_outcome AS sourceOutcome,http_outcome AS httpOutcome,status_code AS statusCode,assertion_failed_count AS assertionFailedCount,inspection_state AS inspectionState,inspection_eligible AS inspectionEligible,inspection_reason AS inspectionReason,request_issue_detected AS requestIssueDetected,proposal_id AS proposalId,classification,decision,confidence,risk_score AS riskScore,risk_level AS riskLevel,auto_action AS autoAction,evolved_test_design_version_id AS evolvedTestDesignVersionId,evolved_test_design_version AS evolvedTestDesignVersion,evolution_rerun_run_id AS evolutionRerunRunId,verification_outcome AS verificationOutcome,verification_reason_code AS verificationReasonCode,human_repair_id AS humanRepairId,human_repair_test_design_version_id AS humanRepairTestDesignVersionId,human_repair_test_design_version AS humanRepairTestDesignVersion,human_rerun_run_id AS humanRerunRunId,effective_state AS effectiveState,attention_status AS attentionStatus,attention_resolution_kind AS attentionResolutionKind,attention_resolution_ref_id AS attentionResolutionRefId,attention_resolution_test_design_version_id AS attentionResolutionTestDesignVersionId,attention_resolution_test_design_version AS attentionResolutionTestDesignVersion,attention_resolution_at AS attentionResolutionAt,attention_verification_required AS attentionVerificationRequired,first_seen_at AS firstSeenAt,analyzed_at AS analyzedAt,verified_at AS verifiedAt,updated_at AS updatedAt FROM continuous_learning_scenarios`;

export async function getLearningCycleBySuiteRunId(env,organizationId,projectId,suiteRunId){const db=requireDataDb(env);return mapCycle(await db.prepare(`${CYCLE_SELECT} WHERE organization_id=? AND project_id=? AND suite_run_id=? LIMIT 1`).bind(organizationId,projectId,suiteRunId).first());}
export async function getLearningCycleById(env,organizationId,projectId,learningCycleId){const db=requireDataDb(env);return mapCycle(await db.prepare(`${CYCLE_SELECT} WHERE organization_id=? AND project_id=? AND learning_cycle_id=? LIMIT 1`).bind(organizationId,projectId,learningCycleId).first());}
export async function ensureLearningCycle(env,input){const db=requireDataDb(env),now=input.now||new Date().toISOString();await db.prepare(`INSERT INTO continuous_learning_cycles(learning_cycle_id,organization_id,project_id,suite_run_id,suite_version_id,suite_version,environment_id,contract_version,status,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'qagent.continuous-learning-cycle.v1','COLLECTING',?,?,?) ON CONFLICT(organization_id,project_id,suite_run_id) DO NOTHING`).bind(input.learningCycleId,input.organizationId,input.projectId,input.suiteRunId,input.suiteVersionId,input.suiteVersion,input.environmentId,now,now,now).run();return getLearningCycleBySuiteRunId(env,input.organizationId,input.projectId,input.suiteRunId);}
export async function setLearningCycleStatus(env,{organizationId,projectId,learningCycleId,status,settled=false,completed=false}){const db=requireDataDb(env),now=new Date().toISOString();await db.prepare(`UPDATE continuous_learning_cycles SET status=?,settled_at=CASE WHEN ?=1 THEN COALESCE(settled_at,?) ELSE NULL END,completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,?) ELSE completed_at END,updated_at=? WHERE organization_id=? AND project_id=? AND learning_cycle_id=?`).bind(status,settled?1:0,now,completed?1:0,now,now,organizationId,projectId,learningCycleId).run();return getLearningCycleById(env,organizationId,projectId,learningCycleId);}

export async function upsertLearningScenario(env,input){const db=requireDataDb(env),now=input.now||new Date().toISOString();await db.prepare(`INSERT INTO continuous_learning_scenarios(learning_scenario_id,learning_cycle_id,organization_id,project_id,source_result_set_id,source_run_id,source_scenario_result_id,scenario_id,endpoint_id,request_method,request_path,source_test_design_version_id,source_test_design_version,source_outcome,http_outcome,status_code,assertion_failed_count,inspection_state,request_issue_detected,effective_state,first_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,0,'RECEIVED',?,?) ON CONFLICT(learning_cycle_id,source_result_set_id,scenario_id) DO UPDATE SET source_scenario_result_id=COALESCE(excluded.source_scenario_result_id,source_scenario_result_id),endpoint_id=COALESCE(excluded.endpoint_id,endpoint_id),request_method=COALESCE(excluded.request_method,request_method),request_path=COALESCE(excluded.request_path,request_path),source_test_design_version_id=COALESCE(excluded.source_test_design_version_id,source_test_design_version_id),source_test_design_version=COALESCE(excluded.source_test_design_version,source_test_design_version),source_outcome=COALESCE(excluded.source_outcome,source_outcome),http_outcome=COALESCE(excluded.http_outcome,http_outcome),status_code=COALESCE(excluded.status_code,status_code),assertion_failed_count=MAX(assertion_failed_count,excluded.assertion_failed_count),updated_at=excluded.updated_at`).bind(input.learningScenarioId,input.learningCycleId,input.organizationId,input.projectId,input.resultSetId,input.runId,input.scenarioResultId||null,input.scenarioId,input.endpointId||null,input.requestMethod||null,input.requestPath||null,input.testDesignVersionId||null,input.testDesignVersion??null,input.outcome||null,input.httpOutcome||null,input.statusCode??null,n(input.assertionFailedCount),'PENDING',now,now).run();return mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE learning_cycle_id=? AND source_result_set_id=? AND scenario_id=? LIMIT 1`).bind(input.learningCycleId,input.resultSetId,input.scenarioId).first());}

export async function updateLearningScenarioInspection(env,{learningCycleId,resultSetId,scenarioId,eligible,reason,requestIssueDetected,effectiveState}){const db=requireDataDb(env),now=new Date().toISOString(),attentionStatus=attentionStatusForState(effectiveState);await db.prepare(`UPDATE continuous_learning_scenarios SET inspection_state='ANALYZED',inspection_eligible=?,inspection_reason=?,request_issue_detected=?,effective_state=?,attention_status=?,attention_verification_required=CASE WHEN ?='PENDING_VERIFICATION' THEN 1 ELSE 0 END,analyzed_at=COALESCE(analyzed_at,?),updated_at=? WHERE learning_cycle_id=? AND source_result_set_id=? AND scenario_id=?`).bind(eligible?1:0,reason||null,requestIssueDetected?1:0,effectiveState,attentionStatus,attentionStatus,now,now,learningCycleId,resultSetId,scenarioId).run();}

export async function updateLearningScenarioProposal(env,{learningCycleId,resultSetId,scenarioId,proposalId,classification,decision,confidence,riskScore,riskLevel,autoAction,evolvedTestDesignVersionId,evolvedTestDesignVersion,evolutionRerunRunId,effectiveState}){const db=requireDataDb(env),now=new Date().toISOString(),attentionStatus=attentionStatusForState(effectiveState);await db.prepare(`UPDATE continuous_learning_scenarios SET proposal_id=?,classification=?,decision=?,confidence=?,risk_score=?,risk_level=?,auto_action=?,evolved_test_design_version_id=?,evolved_test_design_version=?,evolution_rerun_run_id=?,effective_state=?,attention_status=?,attention_verification_required=CASE WHEN ?='PENDING_VERIFICATION' THEN 1 ELSE 0 END,analyzed_at=COALESCE(analyzed_at,?),updated_at=? WHERE learning_cycle_id=? AND source_result_set_id=? AND scenario_id=?`).bind(proposalId||null,classification||null,decision||null,confidence??null,riskScore??null,riskLevel||null,autoAction||null,evolvedTestDesignVersionId||null,evolvedTestDesignVersion??null,evolutionRerunRunId||null,effectiveState,attentionStatus,attentionStatus,now,now,learningCycleId,resultSetId,scenarioId).run();}

export async function updateLearningScenarioVerificationByProposal(env,{proposalId,outcome,reasonCode,rerunRunId,effectiveState}){const db=requireDataDb(env),now=new Date().toISOString();const row=mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE proposal_id=? LIMIT 1`).bind(proposalId).first());if(!row)return null;const attentionStatus=attentionStatusForState(effectiveState);await db.prepare(`UPDATE continuous_learning_scenarios SET evolution_rerun_run_id=COALESCE(?,evolution_rerun_run_id),verification_outcome=?,verification_reason_code=?,effective_state=?,attention_status=?,attention_verification_required=CASE WHEN ?='PENDING_VERIFICATION' THEN 1 ELSE 0 END,verified_at=?,updated_at=? WHERE learning_scenario_id=?`).bind(rerunRunId||null,outcome||null,reasonCode||null,effectiveState,attentionStatus,attentionStatus,now,now,row.learningScenarioId).run();return mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE learning_scenario_id=?`).bind(row.learningScenarioId).first());}

export async function updateLearningScenarioHumanRepair(env,{learningCycleId,resultSetId,scenarioId,repairId,testDesignVersionId,testDesignVersion,humanRerunRunId,effectiveState,attentionStatus='PENDING_VERIFICATION',resolutionKind='HUMAN_REQUEST_REPAIR',verificationRequired=true}){const db=requireDataDb(env),now=new Date().toISOString();await db.prepare(`UPDATE continuous_learning_scenarios SET human_repair_id=?,human_repair_test_design_version_id=?,human_repair_test_design_version=?,human_rerun_run_id=?,effective_state=?,attention_status=?,attention_resolution_kind=?,attention_resolution_ref_id=?,attention_resolution_test_design_version_id=?,attention_resolution_test_design_version=?,attention_resolution_at=?,attention_verification_required=?,updated_at=? WHERE learning_cycle_id=? AND source_result_set_id=? AND scenario_id=?`).bind(repairId,testDesignVersionId||null,testDesignVersion??null,humanRerunRunId||null,effectiveState,attentionStatus,resolutionKind,repairId,testDesignVersionId||null,testDesignVersion??null,now,verificationRequired?1:0,now,learningCycleId,resultSetId,scenarioId).run();return mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE learning_cycle_id=? AND source_result_set_id=? AND scenario_id=? LIMIT 1`).bind(learningCycleId,resultSetId,scenarioId).first());}

export async function updateLearningScenarioHumanOutcomeByRerun(env,{humanRerunRunId,effectiveState,verificationOutcome,reasonCode}){const db=requireDataDb(env),now=new Date().toISOString();const row=mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE human_rerun_run_id=? LIMIT 1`).bind(humanRerunRunId).first());if(!row)return null;const attentionStatus=attentionStatusForState(effectiveState);await db.prepare(`UPDATE continuous_learning_scenarios SET verification_outcome=?,verification_reason_code=?,effective_state=?,attention_status=?,attention_verification_required=0,verified_at=?,updated_at=? WHERE learning_scenario_id=?`).bind(verificationOutcome,reasonCode,effectiveState,attentionStatus,now,now,row.learningScenarioId).run();return mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE learning_scenario_id=?`).bind(row.learningScenarioId).first());}

export async function getLearningScenarioBySource(env,{learningCycleId,resultSetId,scenarioId}){const db=requireDataDb(env);return mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE learning_cycle_id=? AND source_result_set_id=? AND scenario_id=? LIMIT 1`).bind(learningCycleId,resultSetId,scenarioId).first());}
export async function getLearningScenarioByProposalId(env,proposalId){const db=requireDataDb(env);return mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE proposal_id=? LIMIT 1`).bind(proposalId).first());}
export async function markLearningScenarioProposalPendingVerification(env,{proposalId,testDesignVersionId,testDesignVersion,resolutionKind='MANUAL_EVOLUTION_APPROVAL'}){const db=requireDataDb(env),now=new Date().toISOString();const row=mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE proposal_id=? LIMIT 1`).bind(proposalId).first());if(!row)return null;await db.prepare(`UPDATE continuous_learning_scenarios SET evolved_test_design_version_id=COALESCE(?,evolved_test_design_version_id),evolved_test_design_version=COALESCE(?,evolved_test_design_version),effective_state='PENDING_VERIFICATION',attention_status='PENDING_VERIFICATION',attention_resolution_kind=?,attention_resolution_ref_id=?,attention_resolution_test_design_version_id=COALESCE(?,attention_resolution_test_design_version_id),attention_resolution_test_design_version=COALESCE(?,attention_resolution_test_design_version),attention_resolution_at=?,attention_verification_required=1,updated_at=? WHERE learning_scenario_id=?`).bind(testDesignVersionId||null,testDesignVersion??null,resolutionKind,proposalId,testDesignVersionId||null,testDesignVersion??null,now,now,row.learningScenarioId).run();return mapScenario(await db.prepare(`${SCENARIO_SELECT} WHERE learning_scenario_id=?`).bind(row.learningScenarioId).first());}
export async function listLearningScenarios(env,{organizationId,projectId,learningCycleId,limit=50}){const db=requireDataDb(env);const rows=(await db.prepare(`${SCENARIO_SELECT} WHERE organization_id=? AND project_id=? AND learning_cycle_id=? ORDER BY first_seen_at ASC,scenario_id ASC LIMIT ?`).bind(organizationId,projectId,learningCycleId,Math.max(1,Math.min(200,n(limit)||50))).all())?.results||[];return rows.map(mapScenario);}
export async function listLearningCycleSourceRunIds(env,learningCycleId){const db=requireDataDb(env);const rows=(await db.prepare(`SELECT DISTINCT source_run_id AS runId FROM continuous_learning_scenarios WHERE learning_cycle_id=?`).bind(learningCycleId).all())?.results||[];return new Set(rows.map((r)=>r.runId).filter(Boolean));}

export async function aggregateLearningCycle(env,learningCycleId){const db=requireDataDb(env);const row=await db.prepare(`SELECT COUNT(*) AS scenario_count,SUM(CASE WHEN http_outcome='RESPONSE' THEN 1 ELSE 0 END) AS response_scenario_count,COUNT(DISTINCT source_result_set_id) AS result_set_count,SUM(CASE WHEN source_outcome='PASSED' THEN 1 ELSE 0 END) AS initial_passed,SUM(CASE WHEN source_outcome='FAILED' THEN 1 ELSE 0 END) AS initial_failed,SUM(CASE WHEN source_outcome='NOT_EVALUATED' THEN 1 ELSE 0 END) AS initial_not_evaluated,SUM(CASE WHEN inspection_state='ANALYZED' THEN 1 ELSE 0 END) AS analyzed_count,SUM(CASE WHEN inspection_state='PENDING' THEN 1 ELSE 0 END) AS pending_analysis_count,SUM(CASE WHEN inspection_eligible=1 THEN 1 ELSE 0 END) AS eligible_count,SUM(CASE WHEN proposal_id IS NOT NULL THEN 1 ELSE 0 END) AS proposal_count,SUM(CASE WHEN auto_action='AUTO_APPLIED' THEN 1 ELSE 0 END) AS auto_applied_count,SUM(CASE WHEN classification='EXPECTED_BEHAVIOR_LEARNED' THEN 1 ELSE 0 END) AS expected_behavior_learned_count,SUM(CASE WHEN classification='EXPECTATION_DRIFT' THEN 1 ELSE 0 END) AS expectation_drift_count,SUM(CASE WHEN classification='TEST_DATA_DRIFT' THEN 1 ELSE 0 END) AS test_data_drift_count,SUM(CASE WHEN classification='APPLICATION_BUG_SUSPECTED' THEN 1 ELSE 0 END) AS application_bug_suspected_count,SUM(CASE WHEN classification='RUNTIME_FAILURE' THEN 1 ELSE 0 END) AS runtime_failure_count,SUM(CASE WHEN classification='INCONCLUSIVE' THEN 1 ELSE 0 END) AS inconclusive_count,SUM(CASE WHEN effective_state='RECOVERED_BY_EVOLUTION' THEN 1 ELSE 0 END) AS recovered_evolution_count,SUM(CASE WHEN effective_state='NOT_RECOVERED' THEN 1 ELSE 0 END) AS not_recovered_count,SUM(CASE WHEN effective_state='VERIFICATION_BLOCKED' THEN 1 ELSE 0 END) AS verification_blocked_count,SUM(CASE WHEN effective_state='RECOVERED_BY_HUMAN_REPAIR' THEN 1 ELSE 0 END) AS recovered_human_count,SUM(CASE WHEN effective_state='HUMAN_REPAIR_NOT_RECOVERED' THEN 1 ELSE 0 END) AS human_not_recovered_count,SUM(CASE WHEN effective_state='HUMAN_VERIFICATION_BLOCKED' THEN 1 ELSE 0 END) AS human_verification_blocked_count,SUM(CASE WHEN human_repair_id IS NOT NULL THEN 1 ELSE 0 END) AS human_repair_count,SUM(CASE WHEN attention_status='PENDING_VERIFICATION' THEN 1 ELSE 0 END) AS pending_verification_count,SUM(CASE WHEN effective_state IN ('VERIFYING','HUMAN_VERIFYING') THEN 1 ELSE 0 END) AS active_verification_count,SUM(CASE WHEN attention_status='OPEN' THEN 1 ELSE 0 END) AS attention_count,SUM(CASE WHEN attention_status='RESOLVED' THEN 1 ELSE 0 END) AS resolved_attention_count,SUM(CASE WHEN effective_state='HEALTHY' THEN 1 ELSE 0 END) AS healthy_count FROM continuous_learning_scenarios WHERE learning_cycle_id=?`).bind(learningCycleId).first();return Object.fromEntries(Object.entries(row||{}).map(([k,v])=>[k,n(v)]));}

export async function appendLearningCycleEvent(env,{eventId,learningCycleId,learningScenarioId=null,organizationId,projectId,eventType,eventKey,metadata=null}){const db=requireDataDb(env),now=new Date().toISOString();await db.prepare(`INSERT INTO continuous_learning_events(event_id,learning_cycle_id,learning_scenario_id,organization_id,project_id,event_type,event_key,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(learning_cycle_id,event_key) DO NOTHING`).bind(eventId,learningCycleId,learningScenarioId,organizationId,projectId,eventType,eventKey,metadata==null?null:JSON.stringify(metadata),now).run();}
export async function listLearningCycleEvents(env,{organizationId,projectId,learningCycleId,limit=50}){const db=requireDataDb(env);const rows=(await db.prepare(`SELECT event_id AS eventId,learning_cycle_id AS learningCycleId,learning_scenario_id AS learningScenarioId,event_type AS eventType,event_key AS eventKey,metadata_json AS metadataJson,created_at AS createdAt FROM continuous_learning_events WHERE organization_id=? AND project_id=? AND learning_cycle_id=? ORDER BY created_at DESC LIMIT ?`).bind(organizationId,projectId,learningCycleId,Math.max(1,Math.min(100,n(limit)||50))).all())?.results||[];return rows.map((r)=>({...r,metadata:parseJson(r.metadataJson,null)}));}

export async function hasLearningCycleEvent(env,learningCycleId,eventKey){const db=requireDataDb(env);const row=await db.prepare(`SELECT event_id AS eventId FROM continuous_learning_events WHERE learning_cycle_id=? AND event_key=? LIMIT 1`).bind(learningCycleId,eventKey).first();return Boolean(row?.eventId);}


export async function listProjectLearningCycles(env,{organizationId,projectId,environmentId=null,limit=12}={}){
  const db=requireDataDb(env);
  const bounded=Math.max(1,Math.min(50,n(limit)||12));
  const where=environmentId?`organization_id=? AND project_id=? AND environment_id=?`:`organization_id=? AND project_id=?`;
  const params=environmentId?[organizationId,projectId,environmentId,bounded]:[organizationId,projectId,bounded];
  const rows=(await db.prepare(`${CYCLE_SELECT} WHERE ${where} ORDER BY started_at DESC,updated_at DESC LIMIT ?`).bind(...params).all())?.results||[];
  return rows.map(mapCycle);
}

export async function listLatestProjectLearningScenarioStates(env,{organizationId,projectId,environmentId=null,limit=1000}={}){
  const db=requireDataDb(env);
  const bounded=Math.max(1,Math.min(2000,n(limit)||1000));
  const environmentWhere=environmentId?`AND c.environment_id=?`:``;
  const params=environmentId?[organizationId,projectId,environmentId,bounded]:[organizationId,projectId,bounded];
  const sql=`WITH ranked AS (
    SELECT
      s.learning_scenario_id AS learningScenarioId,
      s.learning_cycle_id AS learningCycleId,
      c.suite_run_id AS suiteRunId,
      c.environment_id AS environmentId,
      c.status AS cycleStatus,
      c.started_at AS cycleStartedAt,
      c.settled_at AS cycleSettledAt,
      c.suite_version AS suiteVersion,
      s.source_result_set_id AS resultSetId,
      s.source_run_id AS runId,
      s.scenario_id AS scenarioId,
      s.endpoint_id AS endpointId,
      s.request_method AS requestMethod,
      s.request_path AS requestPath,
      s.source_test_design_version_id AS sourceTestDesignVersionId,
      s.source_test_design_version AS sourceTestDesignVersion,
      s.source_outcome AS sourceOutcome,
      s.http_outcome AS httpOutcome,
      s.status_code AS statusCode,
      s.assertion_failed_count AS assertionFailedCount,
      s.inspection_eligible AS inspectionEligible,
      s.inspection_reason AS inspectionReason,
      s.request_issue_detected AS requestIssueDetected,
      s.proposal_id AS proposalId,
      s.classification,
      s.decision,
      s.confidence,
      s.risk_score AS riskScore,
      s.risk_level AS riskLevel,
      s.auto_action AS autoAction,
      s.evolved_test_design_version_id AS evolvedTestDesignVersionId,
      s.evolved_test_design_version AS evolvedTestDesignVersion,
      s.evolution_rerun_run_id AS evolutionRerunRunId,
      s.verification_outcome AS verificationOutcome,
      s.verification_reason_code AS verificationReasonCode,
      s.human_repair_id AS humanRepairId,
      s.human_repair_test_design_version_id AS humanRepairTestDesignVersionId,
      s.human_repair_test_design_version AS humanRepairTestDesignVersion,
      s.human_rerun_run_id AS humanRerunRunId,
      s.effective_state AS effectiveState,
      s.attention_status AS attentionStatus,
      s.attention_resolution_kind AS attentionResolutionKind,
      s.attention_resolution_ref_id AS attentionResolutionRefId,
      s.attention_resolution_test_design_version_id AS attentionResolutionTestDesignVersionId,
      s.attention_resolution_test_design_version AS attentionResolutionTestDesignVersion,
      s.attention_resolution_at AS attentionResolutionAt,
      s.attention_verification_required AS attentionVerificationRequired,
      s.first_seen_at AS firstSeenAt,
      s.updated_at AS updatedAt,
      COUNT(*) OVER (PARTITION BY COALESCE(s.endpoint_id,s.source_test_design_version_id,s.source_run_id),s.scenario_id) AS occurrenceCount,
      ROW_NUMBER() OVER (PARTITION BY COALESCE(s.endpoint_id,s.source_test_design_version_id,s.source_run_id),s.scenario_id ORDER BY c.started_at DESC,s.updated_at DESC,s.learning_scenario_id DESC) AS rowNumber
    FROM continuous_learning_scenarios s
    JOIN continuous_learning_cycles c ON c.learning_cycle_id=s.learning_cycle_id
    WHERE s.organization_id=? AND s.project_id=? ${environmentWhere}
  ) SELECT * FROM ranked WHERE rowNumber=1 ORDER BY updatedAt DESC LIMIT ?`;
  const rows=(await db.prepare(sql).bind(...params).all())?.results||[];
  return rows.map((row)=>({...row,sourceTestDesignVersion:row.sourceTestDesignVersion==null?null:n(row.sourceTestDesignVersion),statusCode:row.statusCode==null?null:n(row.statusCode),assertionFailedCount:n(row.assertionFailedCount),inspectionEligible:row.inspectionEligible==null?null:bool(row.inspectionEligible),requestIssueDetected:bool(row.requestIssueDetected),confidence:row.confidence==null?null:n(row.confidence),riskScore:row.riskScore==null?null:n(row.riskScore),evolvedTestDesignVersion:row.evolvedTestDesignVersion==null?null:n(row.evolvedTestDesignVersion),humanRepairTestDesignVersion:row.humanRepairTestDesignVersion==null?null:n(row.humanRepairTestDesignVersion),attentionVerificationRequired:bool(row.attentionVerificationRequired),attentionResolutionTestDesignVersion:row.attentionResolutionTestDesignVersion==null?null:n(row.attentionResolutionTestDesignVersion),suiteVersion:n(row.suiteVersion),occurrenceCount:n(row.occurrenceCount)}));
}

/**
 * Operational projection after an explicit source/policy revision has been persisted in Registry.
 * No result/history mutation or synthetic human-repair attribution. Scoped, version-guarded,
 * atomic with its audit event and safe to retry after cross-service persistence succeeded.
 */
export async function markObservedBaselineRevisionPending(env, {
  organizationId, projectId, environmentId, endpointId, scenarioId,
  testDesignVersionId, testDesignVersion, baselineId, approvedByUserId, approvedAt,
}) {
  const db = requireDataDb(env);
  const row = await db.prepare(`SELECT s.learning_scenario_id AS scenarioKey,
    s.learning_cycle_id AS cycleKey, s.source_test_design_version AS sourceVersion,
    s.attention_resolution_test_design_version AS resolutionVersion
    FROM continuous_learning_scenarios s
    JOIN continuous_learning_cycles c ON c.learning_cycle_id=s.learning_cycle_id
    WHERE s.organization_id=? AND s.project_id=? AND c.environment_id=?
      AND s.endpoint_id=? AND s.scenario_id=?
    ORDER BY c.started_at DESC,s.updated_at DESC,s.learning_scenario_id DESC LIMIT 1`)
    .bind(organizationId,projectId,environmentId,endpointId,scenarioId).first();
  if (!row) return 'NOT_FOUND';
  if (Number(row.sourceVersion)>=testDesignVersion || Number(row.resolutionVersion)>testDesignVersion) return 'NEWER_EVIDENCE';
  const guard = `learning_scenario_id=? AND organization_id=? AND project_id=?
    AND COALESCE(source_test_design_version,0)<?
    AND COALESCE(attention_resolution_test_design_version,0)<=?`;
  const params = [row.scenarioKey,organizationId,projectId,testDesignVersion,testDesignVersion];
  const eventKey = `OBSERVED_BASELINE_REVISION:${testDesignVersionId}:${scenarioId}`;
  const metadata = JSON.stringify({baselineId,testDesignVersionId,testDesignVersion,approvedByUserId,attentionStatus:'PENDING_VERIFICATION'});
  // SELECT guard is evaluated before UPDATE in this transaction; retries share the same audit key.
  const result = await db.batch([
    db.prepare(`INSERT INTO continuous_learning_events
      (event_id,learning_cycle_id,learning_scenario_id,organization_id,project_id,event_type,event_key,metadata_json,created_at)
      SELECT ?,learning_cycle_id,learning_scenario_id,organization_id,project_id,'OBSERVED_BASELINE_REVISED',?,?,?
      FROM continuous_learning_scenarios WHERE ${guard}
      ON CONFLICT(learning_cycle_id,event_key) DO NOTHING`)
      .bind(`lce_${crypto.randomUUID()}`,eventKey,metadata,approvedAt,...params),
    db.prepare(`UPDATE continuous_learning_scenarios SET attention_status='PENDING_VERIFICATION',
      effective_state='PENDING_VERIFICATION', attention_resolution_kind='OBSERVED_REBASELINE',
      attention_resolution_ref_id=?,attention_resolution_test_design_version_id=?,
      attention_resolution_test_design_version=?,attention_resolution_at=?,attention_verification_required=1,
      updated_at=? WHERE ${guard}`)
      .bind(baselineId,testDesignVersionId,testDesignVersion,approvedAt,approvedAt,...params),
  ]);
  return Number(result[1]?.meta?.changes)>0 ? 'UPDATED' : 'NEWER_EVIDENCE';
}
