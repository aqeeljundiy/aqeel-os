#!/usr/bin/env node
// Take the keys that reach customers and money out of the support agents' own folders (audit 12 Nov 2026, H3).
// DRY RUN by default: it prints what it would do and changes nothing. Run on the box, as the box user, after the app with
// agent-keys.mjs / agent-ops.mjs / payment-providers.mjs is live:
//   node scripts/migrate-agent-keys.mjs                      what would happen, for every agent with a Kirimdev line
//   node scripts/migrate-agent-keys.mjs --apply              do it
//   node scripts/migrate-agent-keys.mjs --apply --agent x    one agent only
// Options: --data <aqeelOS data folder> (default: AQEELOS_DATA, else ~/apps/hermes-ui-data), --work <workspaces> (default ~/workspaces),
//          --hermes <HERMES_HOME> (default ~/.hermes).
// For each agent it:
//   1. copies KIRIMDEV_API_KEY, TRIPAY_API_KEY, TRIPAY_PRIVATE_KEY, XENDIT_SECRET_KEY, XENDIT_CALLBACK_TOKEN from
//      workspaces/<agent>/.secrets to <data>/agent-keys/<agent>/ (folder 700, files 600), reads each copy back, and only then
//      deletes the workspace file. KIRIMDEV_API_KEY is not copied (the app already has it in HERMES_HOME/secrets/kirimdev.env); it is
//      compared with the app's and deleted.
//   2. removes KIRIMDEV_API_KEY / TRIPAY_* / XENDIT_* lines from the agent's profile .env (a backup of the file is kept beside it, mode 600).
//   3. replaces the payment scripts that read those keys (.tools/qris, .tools/pay, .tools/card) with a stub that says payments are made
//      by create_payment; the old script is kept as <name>.before-keys-moved (it holds no key, only the code that read it).
//   4. deletes old backup copies of key-reading scripts (.tools/kirim.bak-*, kirim_cli.py is rewritten by the app at its next start).
//   5. sets payment.provider in kirimdev.json (Tripay merchant code read from the old script) so the app makes the payments itself,
//      unless the line already has one.
// It never prints a key. Afterwards: restart the app (it writes .tools/kirim, kirim_cli.py and .tools/label that call /agent-ops), then
// run this script again without --apply: it must report nothing left to move.
import {readFile,writeFile,rename,mkdir,unlink,stat,readdir,chmod,copyFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const MOVED=['KIRIMDEV_API_KEY','TRIPAY_API_KEY','TRIPAY_PRIVATE_KEY','XENDIT_SECRET_KEY','XENDIT_CALLBACK_TOKEN'];
const STUB=name=>`#!/usr/bin/env python3
# aqeelOS: payments are made by aqeelOS itself (create_payment in a customer chat), with keys this folder no longer holds.
import sys
print('${name} is retired: payments are made only by create_payment inside a customer chat (aqeelOS holds the payment keys).', file=sys.stderr)
sys.exit(2)
`;
const exists=f=>stat(f).then(()=>true,()=>false);
export async function migrate({DATA,WORK,HERMES,apply=false,only=null,log=console.log}){const steps=[],say=(a,t)=>{steps.push([a,t]);log((apply?'DONE  ':'WOULD ')+a+': '+t)};
 const conf=JSON.parse(await readFile(path.join(DATA,'kirimdev.json'),'utf8').catch(()=>'{"lines":{}}')),agents=Object.keys(conf.lines||{}).filter(a=>!only||a===only);
 if(!agents.length){log('No agent with a Kirimdev line'+(only?' called '+only:'')+'.');return {steps,left:0}}
 const appKey=(/^KIRIMDEV_API_KEY=["']?([^"'\s]+)/m.exec(await readFile(path.join(HERMES,'secrets','kirimdev.env'),'utf8').catch(()=>''))||[])[1]||'';
 let confChanged=false;
 for(const a of agents){const W=path.join(WORK,a),S=path.join(W,'.secrets'),T=path.join(W,'.tools'),K=path.join(DATA,'agent-keys',a);
  // 1. the keys
  for(const n of MOVED){const src=path.join(S,n),v=(await readFile(src,'utf8').catch(()=>'')).trim();if(!v)continue;
   if(n==='KIRIMDEV_API_KEY'){if(!appKey){log('STOP  '+a+': the app has no Kirimdev key of its own (HERMES_HOME/secrets/kirimdev.env); save it on the Kirimdev page first. Nothing was changed for this key.');continue}
    say(a,'delete .secrets/'+n+(v===appKey?' (same as the app\'s own)':' (DIFFERS from the app\'s own key: the app\'s is the one in use)'));if(apply)await unlink(src);continue}
   say(a,'move .secrets/'+n+' to the app\'s key folder');
   if(apply){await mkdir(K,{recursive:true,mode:0o700});await chmod(K,0o700).catch(()=>{});const dst=path.join(K,n),t=dst+'.tmp';await writeFile(t,v+'\n',{mode:0o600});await rename(t,dst);
    if((await readFile(dst,'utf8')).trim()!==v)throw Error(a+': the copy of '+n+' does not read back; nothing was deleted');await unlink(src)}}
  // 2. the profile .env
  {const f=path.join(HERMES,'profiles',a,'.env'),t=await readFile(f,'utf8').catch(()=>null);
   if(t!=null){const keep=t.split('\n').filter(l=>!/^\s*(export\s+)?(KIRIMDEV_API_KEY|KIRIMDEV_LOGIN_PASSWORD|TRIPAY_[A-Z_]+|XENDIT_[A-Z_]+)\s*=/.test(l)),n=t.split('\n').length-keep.length;
    if(n){say(a,'remove '+n+' key line(s) from its profile .env (backup kept)');if(apply){const b=f+'.before-keys-moved';await copyFile(f,b);await chmod(b,0o600);const tmp=f+'.tmp';await writeFile(tmp,keep.join('\n'),{mode:0o600});await rename(tmp,f)}}}}
  // 3. payment scripts become stubs; the merchant code is kept for the app's own provider setting
  let merchant='';
  for(const name of ['qris','pay','card']){const f=path.join(T,name),t=await readFile(f,'utf8').catch(()=>null);if(t==null||t.includes('payments are made by aqeelOS itself'))continue;
   merchant||=(/\bMC\s*=\s*['"](T\d{4,6})['"]/.exec(t)||/\(\s*['"](T\d{4,6})['"]\s*\+\s*ref/.exec(t)||[])[1]||'';
   if(!/\.secrets/.test(t))continue;say(a,'retire .tools/'+name+' (it reads a payment key); kept as '+name+'.before-keys-moved');
   if(apply){await rename(f,f+'.before-keys-moved');await chmod(f+'.before-keys-moved',0o600).catch(()=>{});await writeFile(f,STUB('.tools/'+name));await chmod(f,0o775)}}
  // 4. old copies of key-reading scripts
  for(const f of await readdir(T).catch(()=>[])){if(!/^(kirim|kirim_cli\.py|label|qris|pay|card)\.bak[-.\w]*$/.test(f))continue;const t=await readFile(path.join(T,f),'utf8').catch(()=>'');
   if(/\.secrets|API_KEY|SECRET_KEY/.test(t)){say(a,'delete the old copy .tools/'+f);if(apply)await unlink(path.join(T,f))}}
  if(await exists(path.join(T,'kirim_cli.py'))&&/\.secrets/.test(await readFile(path.join(T,'kirim_cli.py'),'utf8').catch(()=>'')))say(a,'.tools/kirim, kirim_cli.py and label are rewritten by the app at its next start (they will call /agent-ops)');
  // 5. the app makes the payments
  const line=conf.lines[a],pay=line.payment||={};
  if(!pay.provider&&(await exists(path.join(K,'TRIPAY_API_KEY'))||await exists(path.join(S,'TRIPAY_API_KEY')))){
   if(!merchant)log('NOTE  '+a+': the Tripay merchant code was not found in its scripts; set lines.'+a+'.payment.provider.tripay.merchantCode in kirimdev.json by hand.');
   else{say(a,'set payment.provider in kirimdev.json (Tripay merchant '+merchant+(await exists(path.join(K,'XENDIT_SECRET_KEY'))||await exists(path.join(S,'XENDIT_SECRET_KEY'))?', Xendit card':'')+') and drop payment.helper');
    if(apply){pay.provider={tripay:{merchantCode:merchant,refPrefix:'BM'},...(await exists(path.join(K,'XENDIT_SECRET_KEY'))?{xendit:{}}:{})};delete pay.helper;delete pay.card;confChanged=true}}}}
 if(apply&&confChanged){const f=path.join(DATA,'kirimdev.json'),b=f+'.before-keys-moved';await copyFile(f,b);const t=f+'.tmp';await writeFile(t,JSON.stringify(conf,null,1),{mode:0o644});await rename(t,f);log('kirimdev.json saved (the old one is kirimdev.json.before-keys-moved)')}
 let left=0;for(const a of agents)for(const n of MOVED)if(await exists(path.join(WORK,a,'.secrets',n)))left++;
 log(steps.length?(apply?'Done: '+steps.length+' step(s). ':'Dry run: '+steps.length+' step(s) would be done; nothing was changed. Run again with --apply. ')+(apply?left+' moved key(s) still in a workspace.'+(left?'':' Restart the app, then run this again without --apply.'):''):'Nothing left to move: no support agent\'s folder holds a Kirimdev, Tripay or Xendit key.');
 return {steps,left}}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){const arg=n=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:null};
 migrate({DATA:arg('--data')||process.env.AQEELOS_DATA||path.join(homedir(),'apps','hermes-ui-data'),WORK:arg('--work')||path.join(homedir(),'workspaces'),HERMES:arg('--hermes')||process.env.HERMES_HOME||path.join(homedir(),'.hermes'),apply:process.argv.includes('--apply'),only:arg('--agent')})
  .catch(e=>{console.error('migrate-agent-keys: '+e.message);process.exit(1)})}
