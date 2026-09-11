/** 08.1.6 FIX-2. Bounded, value-free structural evidence and monotone enrichment.
 * Kept byte-identical at service boundaries. This is NOT an AI validator: all rules
 * below are deterministic and preserve the constraints of the original contract.
 */
export const STRUCTURAL_EVIDENCE_VERSION = 'qagent.structural-response-evidence.v1';
export const STRUCTURAL_BUDGET = Object.freeze({ nodes: 2000, depth: 24, properties: 200, arrayItems: 500, bytes: 32768 });
const TYPES = new Set(['object','array','string','integer','number','boolean','null','unknown']);
const FORMATS = new Set(['date','date-time','uuid','time','email']);
const NODE_KEYS = new Set(['type','format','properties','items','x-qagent-partial','x-qagent-observed-required','x-qagent-coverage-reasons','x-qagent-inference-version']);
export const EVIDENCE_REASONS = new Set(['DEPTH_LIMIT','PROPERTY_LIMIT','ARRAY_SAMPLE_LIMIT','NODE_LIMIT','STRUCTURE_BYTE_LIMIT','BODY_UNAVAILABLE','BODY_TRUNCATED','SANITIZED_VALUE','SANITIZED_CONTAINER','UNSUPPORTED_VALUE','UNSUPPORTED_PROPERTY','UNKNOWN_STRUCTURE','ENVELOPE_BUDGET','PARTIAL_CAPTURE']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const canonicalLearningJson = v => JSON.stringify(canonical(v));
function canonical(v) { return Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v; }
function err(code) { throw Object.assign(new Error('Structural learning evidence is not safe or compatible.'), { code, status:409 }); }
export function safeStructuralKey(k) { return typeof k==='string' && k.length>0 && k.length<=128 && !/[\x00-\x1f\x7f<>]/.test(k) && !['__proto__','prototype','constructor'].includes(k); }
export function sensitiveStructuralKey(k) { return /^(?:password|passwd|pwd|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|cookie|set-cookie|credential|credentials|private[_-]?key|client[_-]?secret|token)$/i.test(k); }
function kinds(n) { return Array.isArray(n?.type) ? n.type : [n?.type]; }
function coveredType(t, allowed) { return allowed.includes(t) || (t==='integer' && allowed.includes('number')); }
export function structuralIsPartial(schema) {
 let seen=0;
 function visit(n,d) { if(!object(n)||++seen>STRUCTURAL_BUDGET.nodes||d>STRUCTURAL_BUDGET.depth)return true;
   return n['x-qagent-partial']===true || (n['x-qagent-coverage-reasons']||[]).length>0 || kinds(n).includes('unknown') || Object.values(n.properties||{}).some(x=>visit(x,d+1)) || !!(n.items&&visit(n.items,d+1)); }
 return visit(schema,0);
}
export function validateLearningSchema(schema,{allowPartial=true}={}) {
 let count=0;
 function visit(n,d) {
   if(!object(n)||d>STRUCTURAL_BUDGET.depth||++count>STRUCTURAL_BUDGET.nodes||Object.keys(n).some(k=>!NODE_KEYS.has(k)))err('LEARNING_SCHEMA_INVALID');
   const ts=kinds(n);
   if(!ts.length||ts.length>7||new Set(ts).size!==ts.length||ts.some(t=>!TYPES.has(t)))err('LEARNING_SCHEMA_INVALID');
   if(n.format!==undefined&&(!FORMATS.has(n.format)||!ts.includes('string')))err('LEARNING_SCHEMA_INVALID');
   if(n['x-qagent-partial']!==undefined&&typeof n['x-qagent-partial']!=='boolean')err('LEARNING_SCHEMA_INVALID');
   if(n['x-qagent-coverage-reasons']!==undefined&&(!Array.isArray(n['x-qagent-coverage-reasons'])||n['x-qagent-coverage-reasons'].length>16||n['x-qagent-coverage-reasons'].some(x=>!EVIDENCE_REASONS.has(x))))err('LEARNING_SCHEMA_INVALID');
   if(n['x-qagent-inference-version']!==undefined&&n['x-qagent-inference-version']!=='qagent.structural-inference.v2')err('LEARNING_SCHEMA_INVALID');
   if(n.properties!==undefined){if(!ts.includes('object')||!object(n.properties)||Object.keys(n.properties).length>STRUCTURAL_BUDGET.properties)err('LEARNING_SCHEMA_INVALID');
     for(const [k,v] of Object.entries(n.properties)){if(!safeStructuralKey(k))err('LEARNING_SCHEMA_UNSAFE_PROPERTY');visit(v,d+1);}}
   if(n.items!==undefined){if(!ts.includes('array'))err('LEARNING_SCHEMA_INVALID');visit(n.items,d+1);}
   if(n['x-qagent-observed-required']!==undefined){const r=n['x-qagent-observed-required'];if(!Array.isArray(r)||r.length>STRUCTURAL_BUDGET.properties||new Set(r).size!==r.length||r.some(k=>!safeStructuralKey(k)||!Object.hasOwn(n.properties||{},k)))err('LEARNING_SCHEMA_INVALID');}
 }
 visit(schema,0);
 if(new TextEncoder().encode(canonicalLearningJson(schema)).byteLength>STRUCTURAL_BUDGET.bytes)err('LEARNING_SCHEMA_TOO_LARGE');
 if(!allowPartial&&structuralIsPartial(schema))err('LEARNING_SCHEMA_INCOMPLETE');
 return schema;
}
function valueType(v) { return v===null?'null':Array.isArray(v)?'array':typeof v==='number'?(Number.isInteger(v)?'integer':'number'):typeof v; }
function formatOf(v) {
 if(typeof v!=='string')return undefined;
 if(/^\d{4}-\d\d-\d\d$/.test(v)){const x=Date.parse(v+'T00:00:00.000Z');if(Number.isFinite(x)&&new Date(x).toISOString().slice(0,10)===v)return 'date';}
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)&&Number.isFinite(Date.parse(v)))return 'date-time';
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))return 'uuid';
 return undefined;
}
function mergeSamples(samples) {
 if(!samples.length)return undefined;
 const ts=[...new Set(samples.flatMap(kinds))].sort();
 const out={type:ts.length===1?ts[0]:ts};
 if(samples.some(s=>s['x-qagent-partial']===true))out['x-qagent-partial']=true;
 const os=samples.filter(s=>kinds(s).includes('object'));
 if(os.length){const keys=[...new Set(os.flatMap(s=>Object.keys(s.properties||{})))].sort();out.properties=Object.fromEntries(keys.map(k=>[k,mergeSamples(os.map(s=>s.properties?.[k]).filter(Boolean))]));
   out['x-qagent-observed-required']=keys.filter(k=>os.every(s=>(s['x-qagent-observed-required']||[]).includes(k)));}
 const arrays=samples.filter(s=>kinds(s).includes('array'));const items=mergeSamples(arrays.map(s=>s.items).filter(Boolean));if(items)out.items=items;
 const strings=samples.filter(s=>kinds(s).includes('string'));
 if(strings.length&&strings.every(s=>s.format&&s.format===strings[0].format))out.format=strings[0].format;
 return out;
}
/** Inference never copies domain VALUES; secret-bearing nodes are explicitly unknown. */
export function inferResponseStructure(value,{available=true,truncated=false,budget={},sensitiveValues=[]}={}) {
 const cap={...STRUCTURAL_BUDGET,...budget},reasons=new Set();let visited=0;
 const unknown=reason=>{reasons.add(reason);return {type:'unknown','x-qagent-partial':true};};
 function infer(v,d,key=''){
   if(++visited>cap.nodes)return unknown('NODE_LIMIT');
   if(d>cap.depth)return unknown('DEPTH_LIMIT');
   if(sensitiveStructuralKey(key)||typeof v==='string'&&/^(?:\[REDACTED\]|\[TRUNCATED\]|__qagent_redacted__)$/i.test(v))return unknown('SANITIZED_VALUE');
   const t=valueType(v);if(!TYPES.has(t)||t==='number'&&!Number.isFinite(v))return unknown('UNKNOWN_STRUCTURE');
   if(t==='object'){
     if(v._qagent&&/REDACTED|TRUNCATED/i.test(String(v._qagent)))return unknown('SANITIZED_VALUE');
     const keys=Object.keys(v).sort(),selected=keys.slice(0,cap.properties);const p={};let partial=keys.length>selected.length;
     if(partial)reasons.add('PROPERTY_LIMIT');
     for(const k of selected){if(!safeStructuralKey(k)||sensitiveValues.some(x=>typeof x==='string'&&x.length>=4&&k.includes(x))||/^(?:Bearer\s|eyJ[A-Za-z0-9_-]{8,}\.)/i.test(k)){reasons.add('UNSUPPORTED_PROPERTY');partial=true;continue;}p[k]=infer(v[k],d+1,k);if(visited>cap.nodes)break;}
     if(visited>cap.nodes)partial=true;
     return {type:'object',properties:p,'x-qagent-observed-required':Object.keys(p),...(partial?{'x-qagent-partial':true}:{})};
   }
   if(t==='array'){
     const a=[];for(const item of v.slice(0,cap.arrayItems)){a.push(infer(item,d+1));if(visited>cap.nodes)break;}
     const items=mergeSamples(a), partial=a.length<v.length;
     if(partial)reasons.add('ARRAY_SAMPLE_LIMIT');
     return {type:'array',...(items?{items}:{}),...(partial?{'x-qagent-partial':true}:{})};
   }
   const format=t==='string'?formatOf(v):undefined;return {type:t,...(format?{format}:{})};
 }
 let schema=available?infer(value,0):unknown('BODY_UNAVAILABLE');
 if(truncated){reasons.add('BODY_TRUNCATED');schema['x-qagent-partial']=true;}
 if(new TextEncoder().encode(canonicalLearningJson(schema)).byteLength>cap.bytes)schema=unknown('STRUCTURE_BYTE_LIMIT');
 try { validateLearningSchema(schema); } catch { schema=unknown('STRUCTURE_BYTE_LIMIT'); }
 if(structuralIsPartial(schema)&&!reasons.size)reasons.add('PARTIAL_CAPTURE');
 return {contractVersion:STRUCTURAL_EVIDENCE_VERSION,source:'RUNNER_BODY_JSON',coverage:reasons.size?'PARTIAL':'COMPLETE',reasons:[...reasons].sort(),schema};
}
export function validateStructuralEvidence(v) {
 if(!object(v)||Object.keys(v).some(k=>!['contractVersion','source','coverage','reasons','schema'].includes(k))||v.contractVersion!==STRUCTURAL_EVIDENCE_VERSION||v.source!=='RUNNER_BODY_JSON'||!['COMPLETE','PARTIAL'].includes(v.coverage)||!Array.isArray(v.reasons)||v.reasons.length>16||v.reasons.some(r=>!EVIDENCE_REASONS.has(r)))err('LEARNING_EVIDENCE_INVALID');
 validateLearningSchema(v.schema);
 if((v.coverage==='COMPLETE')!==(v.reasons.length===0&&!structuralIsPartial(v.schema)))err('LEARNING_EVIDENCE_COVERAGE_MISMATCH');
 return v;
}
/** Return a reviewed candidate which preserves every old known rule. Missing data
 * are not removal evidence. A type/format conflict is NEVER repaired by enrichment. */
export function enrichStructuralSchema(current,observed) {
 validateLearningSchema(current);validateLearningSchema(observed,{allowPartial:false});
 const conflicts=[], learned=[];
 function merge(a,b,path){
   if(!b)return structuredClone(a);
   const at=kinds(a).filter(t=>t!=='unknown'),bt=kinds(b);
   if(!at.length){learned.push(path);return structuredClone(b);}
   if(bt.some(t=>!coveredType(t,at))){conflicts.push({path,code:'KNOWN_TYPE_CONFLICT'});return structuredClone(a);}
   if(a.format&&b.format!==a.format){conflicts.push({path,code:'KNOWN_FORMAT_CONFLICT'});return structuredClone(a);}
   const out=structuredClone(a);delete out['x-qagent-partial'];delete out['x-qagent-coverage-reasons'];
   // Preserve the existing union, including known variants not present this time.
   if(kinds(a).includes('unknown'))out.type=at.length===1?at[0]:at;
   if(b.properties){out.properties={...(out.properties||{})};for(const [k,v] of Object.entries(b.properties)){const p=`${path}/${k.replace(/~/g,'~0').replace(/\//g,'~1')}`;if(out.properties[k])out.properties[k]=merge(out.properties[k],v,p);else{out.properties[k]=structuredClone(v);learned.push(p);}}
     out['x-qagent-observed-required']=[...new Set([...(a['x-qagent-observed-required']||[]),...(b['x-qagent-observed-required']||[])])].sort();
     for(const k of a['x-qagent-observed-required']||[])if(!Object.hasOwn(b.properties,k))conflicts.push({path:`${path}/${k}`,code:'KNOWN_PRESENCE_CONFLICT'});
   }
   if(b.items)out.items=a.items?merge(a.items,b.items,`${path}/*`):structuredClone(b.items);
   if(a['x-qagent-partial']||kinds(a).includes('unknown'))learned.push(path);
   return out;
 }
 const schema=merge(current,observed,'');
 validateLearningSchema(schema);
 const complete=!structuralIsPartial(schema);
 const changed=canonicalLearningJson(current)!==canonicalLearningJson(schema);
 return {schema,complete,changed,conflicts:conflicts.slice(0,80),conflictCount:conflicts.length,learnedPaths:[...new Set(learned)].slice(0,80),eligible:!conflicts.length&&complete&&changed,reason:conflicts.length?'LEARNING_KNOWN_RULE_CONFLICT':!complete?'LEARNING_EVIDENCE_STILL_INCOMPLETE':!changed?'LEARNING_NO_PROGRESS':'LEARNING_SCHEMA_ENRICHMENT_AVAILABLE'};
}
/** Defense-in-depth against a forged internal apply: no type widening/removals. */
export function assertSchemaRefinement(current,candidate) {
 validateLearningSchema(current);validateLearningSchema(candidate,{allowPartial:false});
 function walk(a,b){if(!b)err('LEARNING_INVARIANT_REMOVED');const at=kinds(a).filter(t=>t!=='unknown');if(at.length&&kinds(b).some(t=>!coveredType(t,at)))err('LEARNING_INVARIANT_WEAKENED');if(a.format&&a.format!==b.format)err('LEARNING_INVARIANT_WEAKENED');
 for(const k of a['x-qagent-observed-required']||[])if(!(b['x-qagent-observed-required']||[]).includes(k))err('LEARNING_INVARIANT_REMOVED');
 for(const [k,v] of Object.entries(a.properties||{}))walk(v,b.properties?.[k]);if(a.items)walk(a.items,b.items);}
 walk(current,candidate);return true;
}
