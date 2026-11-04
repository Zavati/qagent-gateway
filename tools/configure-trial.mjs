#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { resolveTrialDays } from '../src/lib/trialConfig.js';
import { parseJsonc, projectRoot } from './trial-tools-lib.mjs';
try {
 const a=process.argv.slice(2);if(a.length!==2||a[0]!=='--days')throw new Error('Uso: node tools/configure-trial.mjs --days 30 (ou 90)');
 const days=resolveTrialDays({QAGENT_TRIAL_DAYS:a[1]});const file=path.join(projectRoot,'wrangler.jsonc');const text=fs.readFileSync(file,'utf8');
 const config=parseJsonc(text);if(!Object.hasOwn(config.vars||{},'QAGENT_TRIAL_DAYS'))throw new Error('ROOT_TRIAL_VAR_MISSING');
 const pattern=/"QAGENT_TRIAL_DAYS"\s*:\s*(?:"[^"\r\n]*"|\d+)/g;
 if([...text.matchAll(pattern)].length!==1)throw new Error('AMBIGUOUS_TRIAL_CONFIG_EDIT_MANUALLY');
 const next=text.replace(pattern,`"QAGENT_TRIAL_DAYS": "${days}"`);
 if(resolveTrialDays(parseJsonc(next).vars)!==days)throw new Error('CONFIG_VERIFICATION_FAILED');
 fs.writeFileSync(file,next);console.log(`QAGENT_TRIAL_DAYS=${days}. Apenas configuracao local alterada; publique o Gateway. Licencas existentes nao foram modificadas.`);
}catch(e){console.error(e.message);process.exitCode=1;}
