#!/usr/bin/env python3
"""Hash-checked source delta application. No remote operations; no global lock."""
import argparse,datetime,hashlib,json,pathlib,re,shutil,sys
HERE=pathlib.Path(__file__).resolve().parent
SOURCE=HERE.parent
META=json.loads((HERE/'CHANGED-FILES.json').read_text())
def sha(data):return hashlib.sha256(data).hexdigest()
def normalized(data):return sha(data.replace(b'\r\n',b'\n'))
def safe(root,name):
 p=(root/name).resolve()
 if not p.is_relative_to(root.resolve()):raise ValueError('UNSAFE_PATH')
 return p
def config_merge(data):
 text=data.decode('utf-8');matches=list(re.finditer(r'"QAGENT_TRIAL_DAYS"\s*:\s*("\d+"|\d+)',text))
 if matches:
  if len(matches)!=1 or not 1<=int(matches[0][1].strip('"'))<=365:raise ValueError('CONFIG_REVIEW_REQUIRED')
  return data
 if 'QAGENT_TRIAL_DAYS' in text:raise ValueError('CONFIG_REVIEW_REQUIRED')
 roots=list(re.finditer(r'"vars"\s*:\s*\{',text))
 if len(roots)!=1:raise ValueError('CONFIG_REVIEW_REQUIRED')
 end=roots[0].end();newline='\r\n' if '\r\n' in text else '\n'
 return (text[:end]+newline+'        "QAGENT_TRIAL_DAYS": "30",'+text[end:]).encode()
def main():
 p=argparse.ArgumentParser();p.add_argument('--target',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--rollback');args=p.parse_args();target=pathlib.Path(args.target).resolve()
 if not target.is_dir():raise ValueError('TARGET_NOT_FOUND')
 if target==SOURCE:raise ValueError('TARGET_IS_DELIVERY_EXTRACT_TO_ANOTHER_DIRECTORY')
 if args.rollback:
  backup=pathlib.Path(args.rollback).resolve();manifest=json.loads((backup/'rollback.json').read_text())
  if manifest['target']!=str(target):raise ValueError('ROLLBACK_TARGET_MISMATCH')
  for item in manifest['files']:
   dest=safe(target,item['path'])
   if not dest.exists() or sha(dest.read_bytes())!=item['writtenSha256']:raise ValueError('ROLLBACK_CONFLICT: '+item['path'])
  for item in manifest['files']:
   dest=safe(target,item['path']);old=safe(backup,item['path'])
   if item['existed']:dest.write_bytes(old.read_bytes())
   else:dest.unlink()
  print('ROLLBACK_LOCAL_COMPLETED');return
 actions=[];conflicts=[]
 for item in META['changedFiles']:
  name=item['path'];src=safe(SOURCE,name);dest=safe(target,name)
  if sha(src.read_bytes())!=item['resultSha256']:raise ValueError('DELIVERY_INTEGRITY: '+name)
  current=dest.read_bytes() if dest.exists() else None
  if name=='wrangler.jsonc':
   if current is None:conflicts.append(name);continue
   try:new=config_merge(current)
   except ValueError:conflicts.append(name);continue
   if new!=current:actions.append((name,current,new))
   continue
  if current is not None and normalized(current)==item['resultNormalizedSha256']:continue
  if (current is None and item['baseSha256'] is None) or (current is not None and normalized(current)==item['baseNormalizedSha256']):actions.append((name,current,src.read_bytes()))
  else:conflicts.append(name)
 if conflicts:
  print(json.dumps({'status':'CONFLICT','files':conflicts},indent=2));sys.exit(2)
 # Additional current files remain untouched; only the mapped delta is written.
 print('READY_LOCAL_ONLY');print('Mapped writes:',len(actions));print('Other config fields and files are preserved. Runtime compatibility of unrelated edits is not certified.')
 if not args.apply:return
 if not actions:print('ALREADY_APPLIED');return
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup=target/'.qagent-ops'/('source-backup-'+stamp);backup.mkdir(parents=True)
 manifest={'target':str(target),'files':[]}
 for name,old,new in actions:
  if old is not None:
   b=safe(backup,name);b.parent.mkdir(parents=True,exist_ok=True);b.write_bytes(old)
  manifest['files'].append({'path':name,'existed':old is not None,'writtenSha256':sha(new)})
 (backup/'rollback.json').write_text(json.dumps(manifest,indent=2))
 for name,old,new in actions:
  dest=safe(target,name);observed=dest.read_bytes() if dest.exists() else None
  if observed!=old:raise ValueError('CONCURRENT_LOCAL_EDIT: '+name+'; stop and inspect backup '+str(backup))
  dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(new)
 print('APPLIED_LOCAL_ONLY; backup:',backup)
if __name__=='__main__':
 try:main()
 except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
