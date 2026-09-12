/** FIX-2.4 — bounded negative request strategies.
 * A missing value is not an instruction to omit it. A new value is not proof
 * that it is invalid. These strategies describe a reviewed experiment, never
 * a license to change an expected rejection into success.
 * Kept identical at the existing trust boundaries until the policy refactor.
 */
export const NEGATIVE_STRATEGY_VERSION = 'qagent.negative-request-strategy.v1';
export const NEGATIVE_EXECUTION_VERSION = 'qagent.negative-request-execution.v1';
export const NEGATIVE_REPAIR_CHANGE = 'NEGATIVE_REQUEST_REPAIR';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const OMIT = 'OMIT_PATH_SEGMENT', PROBE = 'QUERY_VALUE_PROBE';
const KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,59}$/;
const SECRET = /(?:password|passwd|secret|token|auth|cookie|credential|session|api.?key|private.?key)/i;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o || {},k);
const plain = o => o && typeof o === 'object' && !Array.isArray(o) && [Object.prototype,null].includes(Object.getPrototypeOf(o));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const fail = code => { throw Object.assign(new Error('A condição negativa requer uma estratégia compatível e aprovada.'), {code,status:409,permanent:true}); };
export function negativeCanonical(o) {
  if (Array.isArray(o)) return '['+o.map(negativeCanonical).join(',')+']';
  if (plain(o)) return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+negativeCanonical(o[k])).join(',')+'}';
  return JSON.stringify(o);
}
export function negativePathDescriptors(path) {
  if(typeof path!=='string'||path.length>2000||!path.startsWith('/')||path.startsWith('//')||/[?#\\\s]/.test(path))return [];
  const parts=path.slice(1).split('/');
  const out=[];
  for(let i=0;i<parts.length;i++){const m=/^\{([A-Za-z_][A-Za-z0-9_-]{0,59})\}$/.exec(parts[i]);if(m)out.push({selector:m[1],segmentIndex:i});}
  return out;
}
function safePath(path){
 if(typeof path!=='string'||path.length>2000||!path.startsWith('/')||path.startsWith('//')||/[?#\\\s%]/.test(path)||path.slice(1).split('/').some(x=>!x||x==='.'||x==='..'))fail('NEGATIVE_REQUEST_PATH_UNSUPPORTED');
 return path;
}
export function negativeProbeValue(selector) {
 if(!KEY.test(selector)||SECRET.test(selector)||['__proto__','constructor','prototype'].includes(selector))fail('NEGATIVE_REQUEST_SELECTOR_FORBIDDEN');
 return `qagent_probe_${selector}_unobserved_v1`;
}
/** Bounded legacy interpretation. It uses title/objective plus DSL, not IDs,
 * endpoint names, AI reason strings or a browser-supplied permission bit. */
export function detectNegativeIntent(scenario) {
 if(scenario?.generationClass==='OBSERVED_BASELINE'||scenario?.baseline||scenario?.category!=='NEGATIVE')return null;
 const spec=scenario.spec||{},t=norm(`${scenario.title||''} ${scenario.objective||''}`),descriptors=negativePathDescriptors(spec.target?.path);
 const missing=/(?:\bsem\b|nao\s+fornecer|ausencia|omit(?:ir|ted|ting)?|without|missing).{0,45}\b(?:id|identificador|identifier)\b/.test(t);
 if(missing){
  const chosen=descriptors.filter(d=>/^(?:id|uuid|objectId|ulid)$/i.test(d.selector));
  return {kind:OMIT,target:'PATH_PARAM',selector:chosen.length===1?chosen[0].selector:null,segmentIndex:chosen.length===1?chosen[0].segmentIndex:null,ambiguous:chosen.length!==1||descriptors.length!==1};
 }
 const invalidQuery=/(?:query|consulta).{0,35}inval|inval.{0,35}(?:query|consulta)/.test(t);
 if(invalidQuery){
  const keys=[...new Set([...Object.keys(spec.request?.query||{}),...(spec.testData?.bindings||[]).filter(b=>b.target==='QUERY').map(b=>b.selector)])];
  const usable=keys.filter(k=>KEY.test(k)&&!SECRET.test(k)&&!['__proto__','constructor','prototype'].includes(k));
  // An explicitly declared scalar is not silently replaced by a probe.
  const literals=usable.filter(k=>own(spec.request?.query,k));
  return {kind:PROBE,target:'QUERY',selector:usable.length===1?usable[0]:null,ambiguous:usable.length!==1||descriptors.length>1,explicit:literals.length>0};
 }
 return null;
}
export function validateNegativeStrategy(value, target=null) {
 if(!plain(value))fail('NEGATIVE_REQUEST_STRATEGY_INVALID');
 const shared=['contractVersion','operation','target','selector','sourcePath','basis'];
 const keys=value.operation===OMIT?[...shared,'segmentIndex']:[...shared,'probeValue'];
 if(Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k))||value.contractVersion!==NEGATIVE_STRATEGY_VERSION||!KEY.test(value.selector)||SECRET.test(value.selector))fail('NEGATIVE_REQUEST_STRATEGY_INVALID');
 safePath(value.sourcePath);
 const descriptors=negativePathDescriptors(value.sourcePath);
 if(descriptors.length>1)fail('NEGATIVE_REQUEST_PATH_AMBIGUOUS');
 if(target&&(value.sourcePath!==target.path||!SAFE.has(target.method)))fail('NEGATIVE_REQUEST_SCOPE_MISMATCH');
 if(value.operation===OMIT){
  if(value.target!=='PATH_PARAM'||value.basis!=='REVIEWED_PATH_VARIANT'||descriptors.length!==1||!Number.isInteger(value.segmentIndex)||descriptors[0].selector!==value.selector||descriptors[0].segmentIndex!==value.segmentIndex||value.segmentIndex===0)fail('NEGATIVE_REQUEST_PATH_AMBIGUOUS');
  const parts=value.sourcePath.slice(1).split('/');parts.splice(value.segmentIndex,1);safePath('/'+parts.join('/'));
 }else if(value.operation===PROBE){
  if(value.target!=='QUERY'||value.basis!=='UNVERIFIED_VALUE_HYPOTHESIS'||value.probeValue!==negativeProbeValue(value.selector))fail('NEGATIVE_REQUEST_PROBE_INVALID');
 }else fail('NEGATIVE_REQUEST_OPERATION_UNSUPPORTED');
 return structuredClone(value);
}
export function negativeEffectivePath(path,strategy){
 if(!strategy)return path;
 const s=validateNegativeStrategy(strategy,{path,method:'GET'});
 if(s.operation!==OMIT)return path;
 const parts=path.slice(1).split('/');parts.splice(s.segmentIndex,1);return '/'+parts.join('/');
}
export function suggestedNegativeStrategy(scenario){
 const intent=detectNegativeIntent(scenario),spec=scenario?.spec||{};
 if(!intent||intent.ambiguous||intent.explicit)fail('NEGATIVE_REQUEST_STRATEGY_REVIEW_REQUIRED');
 if(!SAFE.has(spec.target?.method)||!['REQUIRED','NONE'].includes(spec.auth?.requirement))fail('NEGATIVE_REQUEST_OPERATION_UNSUPPORTED');
 const assertions=spec.assertions||[];
 if(!assertions.some(a=>a.type==='STATUS'&&a.expectedStatusCodes?.length&&a.expectedStatusCodes.every(x=>[400,404,422].includes(x))))fail('NEGATIVE_REQUEST_EXPECTATION_UNSUPPORTED');
 const targetBindings=(spec.testData?.bindings||[]).filter(b=>b.target===intent.target&&b.selector===intent.selector);
 if(targetBindings.some(b=>b.source!=='OBSERVED')||own(intent.target==='QUERY'?spec.request?.query:spec.request?.pathParams,intent.selector))fail('NEGATIVE_REQUEST_EXPLICIT_CONFIGURATION_CONFLICT');
 const value={contractVersion:NEGATIVE_STRATEGY_VERSION,operation:intent.kind,target:intent.target,selector:intent.selector,sourcePath:spec.target.path,
  ...(intent.kind===OMIT?{basis:'REVIEWED_PATH_VARIANT',segmentIndex:intent.segmentIndex}:{basis:'UNVERIFIED_VALUE_HYPOTHESIS',probeValue:negativeProbeValue(intent.selector)})};
 return validateNegativeStrategy(value,spec.target);
}
/** Validates the declaration before the request is prepared. No data access. */
export function negativePreparationGate(scenario) {
 const spec=scenario?.spec||{},intent=detectNegativeIntent(scenario),strategy=spec.negativeStrategy;
 if(!strategy){
  if(!intent)return {allowed:true,required:false};
  if(intent.explicit&&intent.kind===PROBE&&!intent.ambiguous){
    const v=spec.request?.query?.[intent.selector];
    if(!['string','number','boolean'].includes(typeof v)||!Number.isFinite(typeof v==='number'?v:0)||(spec.testData?.bindings||[]).some(b=>b.target==='QUERY'&&b.selector===intent.selector))return {allowed:false,required:true,intent,reason:'NEGATIVE_REQUEST_TARGET_BINDING_CONFLICT'};
    return {allowed:true,required:true,legacyExplicit:true,intent};
  }
  return {allowed:false,required:true,intent,reason:'NEGATIVE_REQUEST_STRATEGY_REQUIRED'};
 }
 try{
  const s=validateNegativeStrategy(strategy,spec.target);
  if(!intent||intent.ambiguous||intent.kind!==s.operation||intent.selector!==s.selector)fail('NEGATIVE_REQUEST_INTENT_MISMATCH');
  if(scenario.baseline||scenario.generationClass==='OBSERVED_BASELINE')fail('NEGATIVE_REQUEST_BASELINE_PROTECTED');
  if((spec.testData?.bindings||[]).some(b=>b.target===s.target&&b.selector===s.selector))fail('NEGATIVE_REQUEST_TARGET_BINDING_CONFLICT');
  if(s.operation===OMIT&&own(spec.request?.pathParams,s.selector))fail('NEGATIVE_REQUEST_CONDITION_OVERWRITTEN');
  if(s.operation===PROBE&&spec.request?.query?.[s.selector]!==s.probeValue)fail('NEGATIVE_REQUEST_CONDITION_OVERWRITTEN');
  return {allowed:true,required:true,intent,strategy:s};
 }catch(e){return {allowed:false,required:true,reason:e.code||'NEGATIVE_REQUEST_STRATEGY_INVALID'};}
}
function matchPath(template,path){
 if(typeof path!=='string'||/[?#\\]/.test(path)||path.includes('{'))return false;
 const a=template.split('/'),b=path.split('/');return a.length===b.length&&a.every((v,i)=>/^\{[^}]+\}$/.test(v)?Boolean(b[i])&&b[i]!=='.'&&b[i]!=='..':v===b[i]);
}
export function negativeExecutionEvidence(strategy,{method,path,query,pathParams=[]}){
 const s=validateNegativeStrategy(strategy),expected=negativeEffectivePath(s.sourcePath,s);
 if(path===expected&&path.includes('{')){
  path=expected.replace(/\{([^}]+)\}/g,(_m,name)=>{const p=pathParams.filter(p=>p.name===name);if(p.length!==1||p[0].redacted===true||p[0].value==null||String(p[0].value)===''||/REDACTED|TRUNCATED|[{}]/.test(String(p[0].value)))fail('NEGATIVE_REQUEST_EVIDENCE_REQUIRED');return encodeURIComponent(String(p[0].value));});
 }
 if(!SAFE.has(method)||!matchPath(expected,path))fail('NEGATIVE_REQUEST_EXECUTION_MISMATCH');
 if(s.operation===OMIT){
  if(pathParams.some(p=>(p.name||p.selector)===s.selector))fail('NEGATIVE_REQUEST_CONDITION_OVERWRITTEN');
 }else{
  const q=(query||[]).filter(q=>q.name===s.selector);
  if(q.length!==1||q[0].redacted===true||q[0].source!=='DESIGN'||!Array.isArray(q[0].values)||q[0].values.length!==1||q[0].values[0]!==s.probeValue)fail('NEGATIVE_REQUEST_CONDITION_OVERWRITTEN');
 }
 return {contractVersion:NEGATIVE_EXECUTION_VERSION,strategy:s,conditionEstablished:true,routeVariant:s.operation===OMIT,invalidityProven:false};
}
/** Re-evaluates the condition from actual persisted request evidence. A field
 * named conditionEstablished is never trusted on its own. */
export function assessNegativeExecution(source,result){
 const gate=negativePreparationGate(source),http=result?.http,req=result?.evidence?.request;
 if(!gate.required)return {required:false,established:true};
 if(!gate.allowed)return {required:true,established:false,reason:gate.reason};
 if(!http||http.outcome!=='RESPONSE'||http.errorCode||http.redirectCount!==0||!req||req.method!==source.spec.target.method||http.method!==req.method)return {required:true,established:false,reason:'NEGATIVE_REQUEST_EVIDENCE_REQUIRED'};
 try{
  if(gate.strategy){
   if(negativeCanonical(req.negativeRequest?.strategy)!==negativeCanonical(gate.strategy))fail('NEGATIVE_REQUEST_EXECUTION_PROOF_REQUIRED');
   const proof=negativeExecutionEvidence(gate.strategy,{method:req.method,path:http.path,query:req.query,pathParams:req.pathParams});
   // Sanitized request path may be a template; it must still be the chosen variant.
   const expectedPath=negativeEffectivePath(source.spec.target.path,gate.strategy);
   if(req.path!==expectedPath&&!matchPath(expectedPath,req.path))fail('NEGATIVE_REQUEST_EXECUTION_MISMATCH');
   if(negativeCanonical(proof)!==negativeCanonical(req.negativeRequest))fail('NEGATIVE_REQUEST_EXECUTION_PROOF_INVALID');
  }else{
   if(http.path!==source.spec.target.path&&!matchPath(source.spec.target.path,http.path))fail('NEGATIVE_REQUEST_EXECUTION_MISMATCH');
   for(const [name,value] of Object.entries(source.spec.request?.query||{})){
    const q=(req.query||[]).filter(q=>q.name===name),values=(Array.isArray(value)?value:[value]).map(String);
    if(q.length!==1||q[0].redacted||negativeCanonical(q[0].values)!==negativeCanonical(values)||q[0].source!=='DESIGN')fail('NEGATIVE_REQUEST_CONDITION_OVERWRITTEN');
   }
  }
  return {required:true,established:true,invalidityProven:false,routeVariant:gate.strategy?.operation===OMIT};
 }catch(e){return {required:true,established:false,reason:e.code||'NEGATIVE_REQUEST_EVIDENCE_REQUIRED'};}
}
export function assertNegativeExpectationChange(source,result,change){
 const x=assessNegativeExecution(source,result);
 if(x.required&&!x.established)fail(x.reason);
 const expected=(source?.spec?.assertions||[]).filter(a=>a.type==='STATUS').flatMap(a=>a.expectedStatusCodes||[]);
 if(source?.category==='NEGATIVE'&&expected.length&&expected.every(x=>x>=400&&x<500)&&change?.changeType==='STATUS_EXPECTATION'&&(change.proposed?.expectedStatusCodes||[]).some(x=>x<400||x>=500))fail('NEGATIVE_EXPECTATION_SUCCESS_REQUIRES_REVIEW');
 if(x.required&&x.established&&change?.changeType==='STATUS_EXPECTATION'&&(change.proposed?.expectedStatusCodes||[]).some(x=>![400,404,405,422].includes(x)))fail('NEGATIVE_EXPECTATION_REJECTION_UNSUPPORTED');
 return x;
}
