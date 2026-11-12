#!/usr/bin/env node
// Delivery check (11 Nov 2026, if734729a): does a Kirimdev line's picture reach a real phone? aqeelOS sends a marked picture
// from the line to the main agent's own WhatsApp, whose bridge records whether it downloaded (app/kirimdev.mjs deliveryCheck,
// engine/patches/2026-11-11-delivery-probe.patch). This asks the running app for one and waits for the answer, so the
// fixer can prove a picture fix by itself instead of asking a person to look at a phone.
//   node scripts/delivery-check.mjs <agent> [--link https://…] | --document [--timeout <seconds>]
// Prints every step as it happens, then the result as JSON. Exit 0 only when the picture (or, with --document, the PDF sent
// through the app's own one-purpose file link) arrived; 1 when it did not (the "why" says why); 3 when the app never answered, or restarted
// while the check was waiting (nothing is known then: run it again).
// It always ends by itself within --timeout (default 330 s: a check takes up to about 5 minutes), and if something outside
// stops it first (timeout, Ctrl-C) it still says where it was. 12 Nov 2026: a bare `timeout 200` killed it in silence.
import {mkdir,writeFile,readFile,unlink,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

const args=process.argv.slice(2),agent=args.find((a,i)=>!a.startsWith('--')&&!['--link','--timeout'].includes(args[i-1]));
const li=args.indexOf('--link'),link=li>=0?args[li+1]:undefined,document=args.includes('--document');
const ti=args.indexOf('--timeout'),limit=Math.max(Number(process.env.DELIVERY_CHECK_LIMIT_MIN_S)||30,Math.min(900,Number(ti>=0?args[ti+1]:330)||330)),PICKUP=Number(process.env.DELIVERY_CHECK_PICKUP_S)||45;   // the two env values are for the tests
if(!agent||!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(agent)){console.error('usage: node scripts/delivery-check.mjs <agent> [--link https://…|--document] [--timeout <seconds>]');process.exit(2)}
const DATA=path.resolve(process.env.UI_DATA_DIR||path.join(homedir(),'apps','hermes-ui-data')),D=path.join(DATA,'delivery-checks');
const id=Date.now()+'-'+randomUUID().slice(0,8),res=path.join(D,id+'.result.json'),reqF=path.join(D,id+'.req.json'),stepsF=path.join(D,id+'.steps.log');
const t0=Date.now(),secs=()=>Math.round((Date.now()-t0)/1000),say=m=>console.log('['+String(secs()).padStart(3)+'s] '+m);
let lastStep='the request was written, nothing answered yet';
const cleanup=async()=>{for(const f of [reqF,res,stepsF])await unlink(f).catch(()=>{})};
const stop=async(why,code)=>{await cleanup();console.log(JSON.stringify({agent,picture:false,...(document?{document:false}:{}),why:why+' Last step: '+lastStep+'.'}));process.exit(code)};
for(const sig of ['SIGTERM','SIGINT','SIGHUP'])process.on(sig,()=>stop('The check was stopped from outside after '+secs()+' seconds ('+sig+'), before it finished.',130));

await mkdir(D,{recursive:true});await writeFile(reqF,JSON.stringify({agent,...(link?{link}:{}),...(document?{document:true}:{}),at:new Date().toISOString()}));
say('Asked the app for a '+(document?'PDF':'picture')+' check on '+agent+' (request '+id+'). The app takes the request within 30 s; the check then takes up to about 5 minutes; this script gives up after '+limit+' s.');
let shown=0,pickedUp=false;
for(;;){
 const t=await readFile(res,'utf8').catch(()=>null);
 if(t){const r=JSON.parse(t);const lines=(await readFile(stepsF,'utf8').catch(()=>'')).split('\n').filter(Boolean);for(const l of lines.slice(shown))say(l);await cleanup();
  if(r.inconclusive){say('No answer: '+(r.why||'the check was cut short')+'.');console.log(JSON.stringify({agent,...r},null,1));process.exit(3)}   // the app restarted during the wait (kirimdev.mjs orphans)
  say(r.picture||r.document?'Arrived.':'Did not arrive: '+(r.why||'no reason given')+'.');console.log(JSON.stringify(r,null,1));process.exit(r.picture||r.document?0:1)}
 const lines=(await readFile(stepsF,'utf8').catch(()=>'')).split('\n').filter(Boolean);
 for(const l of lines.slice(shown)){say(l);lastStep=l.replace(/^[\d:]+ /,'')}shown=lines.length;
 if(lines.length)pickedUp=true;
 const still=await access(reqF).then(()=>true,()=>false);
 if(!still)pickedUp=true;
 if(!pickedUp&&secs()>=PICKUP)await stop('The app did not pick the request up within '+PICKUP+' seconds. Is aqeelOS running, is another check still running (they go one at a time), or is the data folder '+DATA+' not the app\'s?',3);
 if(secs()>=limit)await stop('No answer from the app within '+limit+' seconds.',3);
 if(secs()%20<2&&shown)say('still waiting ('+lastStep+')');
 await new Promise(r=>setTimeout(r,2000))}
