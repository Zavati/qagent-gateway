import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonc,parseCliJson,createWranglerKv,loadTarget } from '../tools/trial-tools-lib.mjs';
test('jsonc retains strings with URL/comment text and removes comments/trailing commas',()=>assert.deepEqual(parseJsonc('{/*h*/"url":"https://test/a,}",//hello\n"a":[1,2,],}'),{url:'https://test/a,}',a:[1,2]}));
test('jsonc rejects unterminated comment',()=>assert.throws(()=>parseJsonc('{/*')));
test('CLI parses list with informational header',()=>assert.deepEqual(parseCliJson('Wrangler 4\n[\n {"name":"license:a"}\n]\n','array'),[{name:'license:a'}]));
test('CLI rejects incomplete JSON rather than interpreting as empty result',()=>assert.throws(()=>parseCliJson('[{"name":','array')));
test('config selects exact KV binding',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qagent-test-'));try{const file=path.join(dir,'w.jsonc');fs.writeFileSync(file,'{"name":"qagent","kv_namespaces":[{"binding":"QAGENT_KV","id":"'+'a'.repeat(32)+'"}]}');assert.equal(loadTarget(file).namespaceId,'a'.repeat(32));assert.throws(()=>loadTarget(file,'not-defined'));}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('Wrangler adapter uses files for values, explicit remote namespace, preserves metadata, no shell',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qagent-kv-test-')),calls=[];try{
 const run=async(executable,args,options)=>{calls.push({executable,args,options});if(args.includes('put')){const file=args[args.indexOf('--path')+1];assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{expiresAt:'example'});assert.equal(args.includes(JSON.stringify({expiresAt:'example'})),false);return {stdout:'Success!'};}return {stdout:args.includes('list')?'[{"name":"license:test"}]':'{"status":"trial"}'};};
 const kv=createWranglerKv({configPath:path.join(dir,'config.jsonc'),target:{namespaceId:'a'.repeat(32),envName:null},workDir:dir,run});assert.equal((await kv.list('license:')).length,1);assert.deepEqual(await kv.get('license:test'),{status:'trial'});await kv.put('license:test',{expiresAt:'example'},{tag:'keep'});for(const c of calls){assert.ok(c.args.includes('--remote'));assert.equal(c.args[c.args.indexOf('--namespace-id')+1],'a'.repeat(32));assert.equal(c.options.shell,undefined);}assert.equal(fs.readdirSync(dir).length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}});
