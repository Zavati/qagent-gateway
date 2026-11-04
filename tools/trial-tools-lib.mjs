import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Remove JSONC comments/trailing commas outside quoted strings. Never eval config. */
export function parseJsonc(text) {
  let clean='', inString=false, escaped=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i], next=text[i+1];
    if(inString) {clean+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
    if(ch==='"'){inString=true;clean+=ch;continue;}
    if(ch==='/'&&next==='/'){while(i<text.length&&text[i]!=='\n')i++;clean+='\n';continue;}
    if(ch==='/'&&next==='*'){i+=2;while(i<text.length&&!(text[i]==='*'&&text[i+1]==='/'))i++;if(i>=text.length)throw new Error('CONFIG_COMMENT_UNTERMINATED');i++;clean+=' ';continue;}
    clean+=ch;
  }
  let result='';inString=false;escaped=false;
  for(let i=0;i<clean.length;i++){
    const ch=clean[i];
    if(inString){result+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
    if(ch==='"')inString=true;
    if(ch===','){let j=i+1;while(/\s/.test(clean[j]||'')&&j<clean.length)j++;if(clean[j]===']'||clean[j]==='}')continue;}
    result+=ch;
  }
  return JSON.parse(result);
}
export function loadTarget(configPath, envName=null) {
  const config=parseJsonc(fs.readFileSync(configPath,'utf8'));
  if(envName && !config.env?.[envName])throw new Error('WRANGLER_ENV_NOT_FOUND');
  const source=envName?config.env[envName]:config;
  const bindings=(source.kv_namespaces||[]).filter(x=>x.binding==='QAGENT_KV');
  if(bindings.length!==1||!/^[a-f0-9]{32}$/.test(bindings[0].id||''))throw new Error('QAGENT_KV_BINDING_INVALID');
  return {worker:source.name||config.name, namespaceId:bindings[0].id, envName, binding:'QAGENT_KV'};
}
export function parseCliJson(output, kind) {
  const text=String(output).replace(/\u001b\[[0-9;]*m/g,'').trim();
  const opening=kind==='array'?'[':'{', closing=kind==='array'?']':'}';
  for(let index=0;index<text.length;index++) {
    if(text[index]!==opening || (index>0&&text[index-1]!=='\n'))continue;
    try {const v=JSON.parse(text.slice(index,text.lastIndexOf(closing)+1));if(kind==='array'?Array.isArray(v):v&&typeof v==='object'&&!Array.isArray(v))return v;} catch {}
  }
  throw new Error('WRANGLER_JSON_OUTPUT_INVALID');
}
export function createWranglerKv({configPath, target, workDir=path.join(projectRoot,'.qagent-ops'), run=exec}) {
  const bin=path.join(projectRoot,'node_modules','wrangler','bin','wrangler.js');
  if(!fs.existsSync(bin)&&run===exec)throw new Error('WRANGLER_NOT_INSTALLED_RUN_NPM_CI');
  const globalArgs=['--remote','--namespace-id',target.namespaceId,'--config',configPath,...(target.envName?['--env',target.envName]:[])];
  async function call(args) {
    try { return await run(process.execPath,[bin,'kv','key',...args,...globalArgs],{cwd:projectRoot,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false',NO_COLOR:'1',CI:'true'}}); }
    catch {throw new Error('WRANGLER_COMMAND_FAILED_CHECK_LOGIN_ACCOUNT_AND_KV_PERMISSION');}
  }
  return {
    async list(prefix) {const out=await call(['list','--prefix',prefix]);const rows=parseCliJson(out.stdout,'array');if(!rows.every(x=>typeof x?.name==='string'&&x.name.startsWith(prefix)))throw new Error('WRANGLER_LIST_INVALID');return rows;},
    async get(key) {const out=await call(['get',key,'--text']);return parseCliJson(out.stdout,'object');},
    async put(key,value,metadata) {
      fs.mkdirSync(workDir,{recursive:true,mode:0o700});const dir=fs.mkdtempSync(path.join(workDir,'kv-write-'));
      const valuePath=path.join(dir,'value.json');fs.writeFileSync(valuePath,JSON.stringify(value),{mode:0o600});
      try {await call(['put',key,'--path',valuePath,...(metadata==null?[]:['--metadata',JSON.stringify(metadata)])]);}
      finally {fs.rmSync(dir,{recursive:true,force:true});}
    }
  };
}
