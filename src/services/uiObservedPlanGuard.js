/** UI-TD-3 portable, closed declarative reference-plan contract. No I/O or code evaluation. */
export const UI_OBSERVED_COMPILER_VERSION = 'qagent_ui_test_design_compiler_v2';
export const UI_OBSERVED_COMPILATION_VERSION = 'qagent.ui-test-design-compilation.v2';
export const UI_OBSERVED_SPECIFICATION_VERSION = 'qagent.ui-test-design.v2';
export const UI_OBSERVED_RULE_SET_VERSION = 'qagent_ui_observed_validation_rules_v1';
export const UI_OBSERVED_DEFAULT_PROFILE = Object.freeze({contractVersion:'qagent.ui-test-design-profile.v2',revision:2,comparisonPolicyVersion:'qagent_ui_observed_comparison_v1',layoutTolerancePx:2,coveragePolicy:'ALL_OBSERVED'});
export const UI_OBSERVED_SECTIONS = Object.freeze([
  {section:'ACTIONS',pointer:'/journey/actions',rule:'ACTION_SEQUENCE_ALL'},
  {section:'CHECKPOINTS',pointer:'/pageIndex/states',rule:'CHECKPOINT_FIELDS_ALL'},
  {section:'INTERACTIONS',pointer:'/pageIndex/interactions',rule:'NETWORK_INTERACTIONS_ALL'},
  {section:'FIXTURES',pointer:'/bundle/fixtures',rule:'FIXTURE_CONSUMPTION_ALL'},
  {section:'DOCUMENTS',pointer:'/pageIndex/documents',rule:'DOCUMENT_FIELDS_ALL'},
  {section:'RESOURCES',pointer:'/pageIndex/resources',rule:'RESOURCE_FIELDS_ALL'},
  {section:'STATE_RESOURCES',pointer:'/pageIndex/stateResources',rule:'STATE_RESOURCE_LINKS_ALL'},
  {section:'ARTIFACTS',pointer:'/bundle/artifacts',rule:'ARTIFACT_BYTES_AND_FIELDS_ALL'},
  {section:'SOURCE_METADATA',pointer:'',rule:'SOURCE_METADATA_ALL'},
].map(s=>Object.freeze(s)));
export const UI_OBSERVED_COVERAGE_KEYS = Object.freeze(['actionsTotal','actionsPlanned','checkpointsTotal','checkpointsPlanned','stableCheckpoints','unstableCheckpoints','interactionsTotal','interactionsPlanned','businessFixtures','usableFixtures','unavailableFixtures','sourceMetadataValues','documentsTotal','resourcesTotal','stateResourceLinksTotal','artifactsTotal','referencedArtifacts','verifiedArtifacts','artifactBytesReferenced','artifactsReadDuringCompilation','checksGenerated','validationUnitsPlanned','validationUnitsPending','validationUnitsExecuted']);
const sections = UI_OBSERVED_SECTIONS.map(s=>s.section);
function fail(path){const e=new Error('Invalid immutable observed validation plan.');e.code='UI_TEST_DESIGN_CONTRACT_INVALID';e.status=422;e.path=path;throw e;}
function object(v,keys,path,optional=[]){if(!v||typeof v!=='object'||Array.isArray(v)||keys.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!keys.includes(k)&&!optional.includes(k)))fail(path);return v;}
function literal(v,w,path){if(v!==w)fail(path);}
function text(v,path,max=8192,min=0){if(typeof v!=='string'||v.length>max||v.length<min)fail(path);}
function id(v,path){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,179}$/.test(v))fail(path);}
function hash(v,path){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail(path);}
function count(v,path){if(!Number.isSafeInteger(v)||v<0)fail(path);}
function nullable(v,path,check){if(v!==null)check(v,path);}
function list(v,path,max){if(!Array.isArray(v)||v.length>max)fail(path);return v;}
function codes(v,path){list(v,path,1500).forEach(x=>{if(typeof x!=='string'||!/^[A-Z0-9_]{1,128}$/.test(x))fail(path);});}
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function same(a,b,path){if(stable(a)!==stable(b))fail(path);}
function finite(v){let n=0;function visit(x,d){if(++n>100000||d>48)fail('structure');if(x===null||['string','boolean'].includes(typeof x))return;if(typeof x==='number'&&Number.isFinite(x))return;if(Array.isArray(x)){for(let i=0;i<x.length;i++){if(!Object.hasOwn(x,i))fail('structure');visit(x[i],d+1);}return;}if(x&&typeof x==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(x))){for(const [k,y]of Object.entries(x)){if(['__proto__','constructor','prototype'].includes(k))fail('structure');visit(y,d+1);}return;}fail('structure');}visit(v,0);}
function scope(v,path){object(v,['organizationId','projectId','environmentId'],path);Object.entries(v).forEach(([k,x])=>id(x,path+'.'+k));}
function source(v,path){object(v,['scope','captureId','bundleVersionId','sourceHash','manifestHash'],path);scope(v.scope,path+'.scope');id(v.captureId,path+'.captureId');id(v.bundleVersionId,path+'.bundleVersionId');hash(v.sourceHash,path+'.sourceHash');hash(v.manifestHash,path+'.manifestHash');}
/** @param {any} value */
export function validateUiObservedProfileShape(value=UI_OBSERVED_DEFAULT_PROFILE){
  const p='profile';object(value,Object.keys(UI_OBSERVED_DEFAULT_PROFILE),p);
  for(const k of ['contractVersion','revision','comparisonPolicyVersion','coveragePolicy'])literal(value[k],UI_OBSERVED_DEFAULT_PROFILE[k],p+'.'+k);
  if(typeof value.layoutTolerancePx!=='number'||!Number.isFinite(value.layoutTolerancePx)||value.layoutTolerancePx<0||value.layoutTolerancePx>20)fail(p+'.layoutTolerancePx');
  return value;
}
export function validateUiObservedPlanShape(spec){
  finite(spec);const p='specification';
  object(spec,['contractVersion','compilerVersion','templateVersion','adapterVersion','canonicalizerVersion','scope','source','profile','executionModes','entryUrl','sourceBuildRef','preparation','plan','evidenceVerification','coverage','limitations','readiness','executionPerformed'],p);
  for(const[k,v]of Object.entries({contractVersion:UI_OBSERVED_SPECIFICATION_VERSION,compilerVersion:UI_OBSERVED_COMPILER_VERSION,templateVersion:'qagent_ui_observed_templates_v2',adapterVersion:'qagent_ui_page_evidence_adapter_v1',canonicalizerVersion:'qagent.ui-canonical-json.v1'}))literal(spec[k],v,p+'.'+k);
  scope(spec.scope,p+'.scope');source(spec.source,p+'.source');same(spec.scope,spec.source.scope,p+'.scope');validateUiObservedProfileShape(spec.profile);
  same(spec.executionModes,['UI_REPLAY','UI_LIVE'],p+'.executionModes');literal(spec.executionPerformed,false,p+'.executionPerformed');
  text(spec.entryUrl,p+'.entryUrl',8192,1);try{if(!['http:','https:'].includes(new URL(spec.entryUrl).protocol))fail(p+'.entryUrl');}catch{fail(p+'.entryUrl');}nullable(spec.sourceBuildRef,p+'.sourceBuildRef',id);
  same(spec.preparation,{strategy:'EXECUTE_TARGET_BUILD',observedBootstrapPointer:'/profile/bootstrap',targetBuildPinRequired:true,freshContextPerMode:true,livePreparationRequired:true,observedResponsesRestoreWholeState:false},p+'.preparation');
  object(spec.plan,['contractVersion','ruleSetVersion','selection','expectedValues','expansion','unknownData','unstableEvidence','silentOmissionAllowed','completion','pendingCannotPass','sections'],p+'.plan');
  for(const[k,v]of Object.entries({contractVersion:'qagent.ui-observed-validation-plan.v1',ruleSetVersion:UI_OBSERVED_RULE_SET_VERSION,selection:'ALL_OBSERVED',expectedValues:'IMMUTABLE_SOURCE_REFERENCES',expansion:'PAGED',unknownData:'PENDING_WITH_REASON',unstableEvidence:'PENDING_WITH_REASON',silentOmissionAllowed:false,completion:'ALL_SECTIONS_AND_ARTIFACT_CONTENT',pendingCannotPass:true}))literal(spec.plan[k],v,p+'.plan.'+k);
  const rows=list(spec.plan.sections,p+'.plan.sections',UI_OBSERVED_SECTIONS.length);if(rows.length!==UI_OBSERVED_SECTIONS.length)fail(p+'.plan.sections');
  rows.forEach((row,index)=>{object(row,['section','pointer','count','rule'],p+'.plan.sections');for(const k of ['section','pointer','rule'])literal(row[k],UI_OBSERVED_SECTIONS[index][k],p+'.plan.sections.'+k);count(row.count,p+'.plan.sections.count');});
  same(spec.evidenceVerification,{manifest:'VERIFIED',artifactBytes:'VERIFIED_AT_BUNDLE_ASSEMBLY',artifactBytesRecheckedDuringCompilation:false},p+'.evidenceVerification');
  object(spec.coverage,UI_OBSERVED_COVERAGE_KEYS,p+'.coverage');for(const[k,v]of Object.entries(spec.coverage))count(v,p+'.coverage.'+k);
  const c=spec.coverage;literal(c.actionsPlanned,c.actionsTotal,p+'.coverage.actionsPlanned');literal(c.checkpointsPlanned,c.checkpointsTotal,p+'.coverage.checkpointsPlanned');literal(c.interactionsPlanned,c.interactionsTotal,p+'.coverage.interactionsPlanned');literal(c.stableCheckpoints+c.unstableCheckpoints,c.checkpointsTotal,p+'.coverage.checkpointsTotal');literal(c.usableFixtures+c.unavailableFixtures,c.businessFixtures,p+'.coverage.businessFixtures');literal(c.referencedArtifacts,c.artifactsTotal,p+'.coverage.referencedArtifacts');literal(c.verifiedArtifacts,c.artifactsTotal,p+'.coverage.verifiedArtifacts');
  for(const key of ['artifactsReadDuringCompilation','checksGenerated','validationUnitsExecuted'])literal(c[key],0,p+'.coverage.'+key);
  const expectedCounts=[c.actionsTotal,c.checkpointsTotal,c.interactionsTotal,c.businessFixtures,c.documentsTotal,c.resourcesTotal,c.stateResourceLinksTotal,c.artifactsTotal,c.sourceMetadataValues];rows.forEach((row,i)=>literal(row.count,expectedCounts[i],p+'.plan.sections.count'));literal(c.validationUnitsPlanned,expectedCounts.reduce((a,b)=>a+b,0),p+'.coverage.validationUnitsPlanned');if(c.validationUnitsPending>c.validationUnitsPlanned)fail(p+'.coverage.validationUnitsPending');
  codes(spec.limitations,p+'.limitations');object(spec.readiness,['UI_REPLAY','UI_LIVE'],p+'.readiness');for(const mode of ['UI_REPLAY','UI_LIVE']){const r=object(spec.readiness[mode],['status','reasonCodes'],p+'.readiness.'+mode);if(!['BLOCKED','REQUIRES_CONFIGURATION'].includes(r.status))fail(p+'.readiness.'+mode);codes(r.reasonCodes,p+'.readiness.'+mode+'.reasonCodes');}
  return spec;
}
export function validateUiObservedPlanPageShape(page){
  finite(page);object(page,['contractVersion','source','specificationHash','section','artifactId','items','totalItems','nextCursor','executionPerformed'],'page');
  literal(page.contractVersion,'qagent.ui-test-design-plan-page.v1','page.contractVersion');source(page.source,'page.source');hash(page.specificationHash,'page.specificationHash');
  if(![...sections,'ARTIFACT_CONTENT'].includes(page.section))fail('page.section');nullable(page.artifactId,'page.artifactId',id);if((page.section==='ARTIFACT_CONTENT')!==(page.artifactId!==null))fail('page.artifactId');count(page.totalItems,'page.totalItems');nullable(page.nextCursor,'page.nextCursor',v=>text(v,'page.nextCursor',4096,1));literal(page.executionPerformed,false,'page.executionPerformed');
  let prev=-1;for(const row of list(page.items,'page.items',100)){object(row,['index','id','sourceRef','validation','preview'],'page.items');count(row.index,'page.items.index');if(row.index<=prev||row.index>=page.totalItems||(prev>=0&&row.index!==prev+1))fail('page.items.index');prev=row.index;text(row.id,'page.items.id',200,1);
    const ref=object(row.sourceRef,['manifestHash','pointer','artifactId','sha256','byteLength'],'page.sourceRef');literal(ref.manifestHash,page.source.manifestHash,'page.sourceRef.manifestHash');text(ref.pointer,'page.sourceRef.pointer',16384);nullable(ref.artifactId,'page.sourceRef.artifactId',id);nullable(ref.sha256,'page.sourceRef.sha256',hash);nullable(ref.byteLength,'page.sourceRef.byteLength',count);if(page.section!=='ARTIFACT_CONTENT'&&page.section!=='ARTIFACTS'&&(ref.artifactId!==null||ref.sha256!==null||ref.byteLength!==null))fail('page.sourceRef');if(page.section==='ARTIFACTS'&&(ref.artifactId===null||ref.sha256===null||ref.byteLength===null))fail('page.sourceRef');if(page.section==='ARTIFACT_CONTENT'){literal(ref.artifactId,page.artifactId,'page.sourceRef.artifactId');if(ref.sha256===null||ref.byteLength===null)fail('page.sourceRef');}
    const v=object(row.validation,['rule','status','reasonCodes'],'page.validation');if(!UI_OBSERVED_SECTIONS.map(s=>s.rule).concat(['ARTIFACT_JSON_VALUE','ARTIFACT_OPAQUE_BYTES']).includes(v.rule))fail('page.validation.rule');if(page.section!=='ARTIFACT_CONTENT'&&v.rule!==UI_OBSERVED_SECTIONS.find(s=>s.section===page.section)?.rule)fail('page.validation.rule');if(page.section==='ARTIFACT_CONTENT'&&!['ARTIFACT_JSON_VALUE','ARTIFACT_OPAQUE_BYTES'].includes(v.rule))fail('page.validation.rule');if(!['PLANNED','PENDING'].includes(v.status))fail('page.validation.status');codes(v.reasonCodes,'page.validation.reasonCodes');if(v.status==='PENDING'&&!v.reasonCodes.length)fail('page.validation.reasonCodes');if(!row.preview||typeof row.preview!=='object'||Array.isArray(row.preview))fail('page.preview');
  }if(page.totalItems===0){if(page.items.length||page.nextCursor!==null)fail('page.pagination');}else{if(!page.items.length)fail('page.pagination');if((prev+1<page.totalItems)!==(page.nextCursor!==null))fail('page.pagination');}return page;
}
