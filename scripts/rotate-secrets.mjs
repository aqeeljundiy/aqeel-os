#!/usr/bin/env node
// Changes the keys aqeelOS signs with (security audit H-9, 12 Nov 2026). Run on the server, as the app's user, by a person.
//
//   node scripts/rotate-secrets.mjs relay            a new key for the agents' signed tool addresses (nobody is signed out)
//   node scripts/rotate-secrets.mjs ui               a new cookie key (everyone signs in again; agents are not touched)
//   node scripts/rotate-secrets.mjs both             both, in the right order
//   options: --grace-minutes N   how long the old agent signatures are still accepted (default 30; 0 = cut off at once)
//            --env-file PATH     the app's env file when UI_SECRET is set there (default ~/apps/hermes-ui.env)
//            --data PATH         the app's data folder (default: UI_DATA_DIR, else ../hermes-ui-data next to the app)
//            --dry-run           say what would be done, change nothing
//
// It only writes key files. It never prints a key and restarts nothing. After it:
//   1. restart the aqeelOS app (the usual way of this server). At start it re-issues every agent's tool addresses: the
//      old signatures in each agent's settings and in the scripts aqeelOS wrote are replaced by new ones.
//   2. reload the agents' engine once nothing is running (System > Health > Restart agents), so every agent reads its new
//      settings.
// "relay" needs the cookie key that was in use to find the old signatures: it reads it from the same place the app does.
import {readFileSync,writeFileSync,renameSync,chmodSync,existsSync,copyFileSync} from 'node:fs';import {randomBytes} from 'node:crypto';import {homedir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {rotateRelay,relayKeys} from '../app/relay-keys.mjs';

export function rotate(what,{DATA,envFile,graceMinutes=30,dry=false,now=Date.now()}){const did=[];
 if(!['relay','ui','both'].includes(what))throw Error('Say what to change: relay, ui or both.');
 // the cookie key as the app reads it: UI_SECRET in the env file, else <DATA>/ui-secret
 let envText='';try{envText=readFileSync(envFile,'utf8')}catch{}const m=/^UI_SECRET=(.*)$/m.exec(envText),inEnv=!!m&&m[1].trim().length>0;
 let ui=inEnv?m[1].trim().replace(/^["']|["']$/g,''):'';if(!ui){try{ui=readFileSync(path.join(DATA,'ui-secret'),'utf8').trim()}catch{}}
 if(!ui)throw Error('Could not find the cookie key (UI_SECRET in '+envFile+' or '+path.join(DATA,'ui-secret')+'). Is this the right data folder?');
 if(what==='relay'||what==='both'){const old=relayKeys(DATA,ui,now).cur;if(!dry)rotateRelay(DATA,old,{graceMinutes,now});
  did.push('agent signatures: a new key in '+path.join(DATA,'relay-secret')+'; the old ones are accepted for '+graceMinutes+' more minute'+(graceMinutes===1?'':'s')+' after this moment');}
 if(what==='ui'||what==='both'){
  // the agents' key must not follow the cookie key: pin it first when it still does
  if(what==='ui'&&!relayKeys(DATA,ui,now).own){if(!dry){writeFileSync(path.join(DATA,'relay-secret.tmp'),ui+'\n',{mode:0o600});renameSync(path.join(DATA,'relay-secret.tmp'),path.join(DATA,'relay-secret'))}did.push('agent signatures: kept as they are (their key is now its own file)')}
  const key=randomBytes(32).toString('hex');
  if(inEnv){if(!dry){copyFileSync(envFile,envFile+'.bak-rotate-'+now);chmodSync(envFile+'.bak-rotate-'+now,0o600);writeFileSync(envFile+'.tmp',envText.replace(/^UI_SECRET=.*$/m,()=>'UI_SECRET='+key),{mode:0o600});renameSync(envFile+'.tmp',envFile)}did.push('cookie key: a new UI_SECRET in '+envFile+' (the old file is kept beside it as .bak-rotate-'+now+'; delete it once the app is up)')}
  else{if(!dry){const f=path.join(DATA,'ui-secret');writeFileSync(f+'.tmp',key+'\n',{mode:0o600});renameSync(f+'.tmp',f);chmodSync(f,0o600)}did.push('cookie key: a new one in '+path.join(DATA,'ui-secret'))}
  did.push('everyone signs in again after the restart')}
 return did}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const a=process.argv.slice(2),opt=n=>{const i=a.indexOf(n);return i>=0?a[i+1]:undefined};
 const here=path.dirname(fileURLToPath(import.meta.url)),DATA=path.resolve(opt('--data')||process.env.UI_DATA_DIR||path.join(here,'..','..','hermes-ui-data')),envFile=opt('--env-file')||path.join(homedir(),'apps','hermes-ui.env'),dry=a.includes('--dry-run');
 try{if(!existsSync(DATA))throw Error('No data folder at '+DATA+' (give --data).');const g=opt('--grace-minutes');
  const did=rotate(a.find(x=>!x.startsWith('--')&&x!==opt('--data')&&x!==opt('--env-file')&&x!==g)||'',{DATA,envFile,graceMinutes:g===undefined?30:Math.max(0,Math.min(1440,Number(g)||0)),dry});
  console.log((dry?'Would do:':'Done:')+'\n- '+did.join('\n- ')+'\n\nNext: restart the aqeelOS app, then reload the agents once nothing is running (System > Health > Restart agents).')}
 catch(e){console.error(e.message);process.exit(1)}}
