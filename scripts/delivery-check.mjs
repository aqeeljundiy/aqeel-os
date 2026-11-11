#!/usr/bin/env node
// Delivery check (11 Nov 2026, if734729a): does a Kirimdev line's picture reach a real phone? aqeelOS sends a marked picture
// from the line to the main agent's own WhatsApp, whose bridge records whether it downloaded (app/kirimdev.mjs deliveryCheck,
// engine/patches/2026-11-11-delivery-probe.patch). This asks the running app for one and waits for the answer, so the
// fixer can prove a picture fix by itself instead of asking a person to look at a phone.
//   node scripts/delivery-check.mjs <agent> [--link https://…] | --document    prints the result as JSON; exit 0 only when the picture (or, with --document, the PDF sent through the app's own one-purpose file link) arrived
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

const args=process.argv.slice(2),agent=args.find(a=>!a.startsWith('--')),li=args.indexOf('--link'),link=li>=0?args[li+1]:undefined,document=args.includes('--document');
if(!agent||!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(agent)){console.error('usage: node scripts/delivery-check.mjs <agent> [--link https://…|--document]');process.exit(2)}
const DATA=path.resolve(process.env.UI_DATA_DIR||path.join(homedir(),'apps','hermes-ui-data')),D=path.join(DATA,'delivery-checks');
const id=Date.now()+'-'+randomUUID().slice(0,8),res=path.join(D,id+'.result.json');
await mkdir(D,{recursive:true});await writeFile(path.join(D,id+'.req.json'),JSON.stringify({agent,...(link?{link}:{}),...(document?{document:true}:{}),at:new Date().toISOString()}));
// the app picks a request up within 30 s; a check takes up to about 5 minutes
for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,5000));const t=await readFile(res,'utf8').catch(()=>null);
 if(t){await unlink(res).catch(()=>{});const r=JSON.parse(t);console.log(JSON.stringify(r,null,1));process.exit(r.picture||r.document?0:1)}}
await unlink(path.join(D,id+'.req.json')).catch(()=>{});
console.log(JSON.stringify({agent,picture:false,why:'The app did not answer within 7 minutes (is aqeelOS running?).'}));process.exit(1);
