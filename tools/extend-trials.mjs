#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildPlan, executePlan } from './trial-extension-lib.mjs';
import { projectRoot, loadTarget, createWranglerKv } from './trial-tools-lib.mjs';

const HELP=`QAgent: estender trials existentes (KV remoto; nunca rotaciona clientKeys).
PLAN (somente leitura remota, backup/plano local):
  node tools/extend-trials.mjs plan --days 30 --operation-id trial-plus-30d-01
APPLY (grava SOMENTE licencas elegiveis do plano revisado):
  node tools/extend-trials.mjs apply --plan .qagent-ops/trial-plus-30d-01.json --confirm-maintenance
VERIFY (somente leitura):
  node tools/extend-trials.mjs verify --plan .qagent-ops/trial-plus-30d-01.json
ROLLBACK (restaura somente valores ainda identicos a esta operacao):
  node tools/extend-trials.mjs rollback --plan .qagent-ops/trial-plus-30d-01.json --confirm-maintenance
Opcionais: --config wrangler.jsonc --env NOME_WRANGLER; no plan: --customer-id cus_... --out caminho.json.
Usa o Wrangler ja instalado/autenticado. Nao passe clientKeys ou tokens neste comando.
ATENCAO: KV nao tem compare-and-swap. --confirm-maintenance confirma ausencia de outros
escritores das licencas/chaves (rotacao, revogacao, billing e normalizacao de status) durante
apply/rollback. Rechecagem detecta conflitos, mas NAO substitui lock ou transacao.
Repita o MESMO plano para retomar: o alvo de data fica fixo; nao soma outros 30 dias.
`;
function args(argv){const [mode,...rest]=argv;const o={mode};for(let i=0;i<rest.length;i++){
 const k=rest[i];if(k==='--confirm-maintenance'||k==='--help'){o[k.slice(2)]=true;continue;}
 if(!['--days','--operation-id','--out','--plan','--customer-id','--config','--env'].includes(k)||!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('INVALID_ARGUMENT');
 if(Object.hasOwn(o,k.slice(2)))throw new Error('DUPLICATE_ARGUMENT');o[k.slice(2)]=rest[++i];}return o;}
function summary(rows){return rows.reduce((a,r)=>{const k=r.status||r.reason;a[k]=(a[k]||0)+1;return a;},{});}
try {
 const o=args(process.argv.slice(2));
 if(!o.mode||o.mode==='--help'||o.help){console.log(HELP);process.exit(0);}
 if(!['plan','apply','verify','rollback'].includes(o.mode))throw new Error('INVALID_MODE');
 if(process.env.CLOUDFLARE_ENV && !o.env)throw new Error('SET_EXPLICIT_WRANGLER_ENV_OR_UNSET_CLOUDFLARE_ENV');
 const configPath=path.resolve(o.config||path.join(projectRoot,'wrangler.jsonc'));
 const target=loadTarget(configPath,o.env||null);const kv=createWranglerKv({configPath,target});
 console.log(JSON.stringify({mode:o.mode,target},null,2));
 if(o.mode==='plan'){
  const plan=await buildPlan(kv,{days:Number(o.days??30),operationId:o['operation-id'],target,customerId:o['customer-id']||null});
  const file=path.resolve(o.out||path.join(projectRoot,'.qagent-ops',plan.operationId+'.json'));
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({plan:file,scanned:plan.scanned,eligible:plan.entries.length,skipped:summary(plan.skipped),remoteWrites:0},null,2));
  console.table(plan.entries.map(e=>({license:e.before.licenseId,customer:e.before.customerId,status:e.before.status,from:e.before.expiresAt||e.before.trialEndsAt,to:e.after.expiresAt})));
 }else{
  if(!o.plan)throw new Error('PLAN_REQUIRED');
  if(o.mode!=='verify'&&!o['confirm-maintenance'])throw new Error('CONFIRM_MAINTENANCE_REQUIRED');
  const file=path.resolve(o.plan),plan=JSON.parse(fs.readFileSync(file,'utf8'));
  const journal=file+'.journal.jsonl';
  const rows=await executePlan(kv,plan,{target,mode:o.mode,record:async entry=>{
   fs.appendFileSync(journal,JSON.stringify({time:new Date().toISOString(),operationId:plan.operationId,mode:o.mode,...entry})+'\n',{mode:0o600});
  }});
  console.log(JSON.stringify({mode:o.mode,results:summary(rows),journal},null,2));
  if(o.mode==='apply')console.log('PUT confirmado nao prova propagacao global. Execute verify; nao gere outra operacao para repetir esta prorrogacao.');
  const good=o.mode==='verify'?['VERIFIED']:o.mode==='rollback'?['ROLLBACK_ACKNOWLEDGED','ALREADY_ROLLED_BACK']:['WRITE_ACKNOWLEDGED','ALREADY_APPLIED','ALREADY_APPLIED_STATE_CHANGED'];
  if(rows.some(r=>!good.includes(r.status)))process.exitCode=2;
 }
} catch(e){console.error('Operacao interrompida:',e.message);process.exitCode=1;}
