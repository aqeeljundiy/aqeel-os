// scripts/delivery-check.mjs never ends in silence (12 Nov 2026: `timeout 200` killed the first PDF check without a word).
// A stand-in for the app answers through the same files the real one uses (DATA/delivery-checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT=path.join(path.dirname(fileURLToPath(import.meta.url)),'delivery-check.mjs');
// 12 Nov 2026 (flaky full parallel runs): the tests waited fixed times (2.5 s for the script to have read a step, at most 5 s for it to
// start); now they wait for what they need: the step in the script's own output (saw), the request file (reqOf, up to 60 s on a busy box)
function run(DATA,args,env={}){const c=spawn(process.execPath,[SCRIPT,...args],{env:{...process.env,UI_DATA_DIR:DATA,...env}});let out='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>out+=d);
 const saw=async re=>{for(let i=0;i<1200;i++){if(re.test(out))return;await new Promise(r=>setTimeout(r,50))}throw Error('never printed '+re+': '+out)};
 return {c,saw,done:new Promise(r=>c.on('close',code=>r({code,out})))}}
const reqOf=async D=>{for(let i=0;i<1200;i++){const f=(await readdir(D).catch(()=>[])).find(x=>x.endsWith('.req.json'));if(f)return {f:f.replace('.req.json',''),req:JSON.parse(await readFile(path.join(D,f),'utf8'))};await new Promise(r=>setTimeout(r,50))}throw Error('no request')};

test('prints each step the app reports, then the result; exit 0 when the PDF arrived',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'dc-')),D=path.join(DATA,'delivery-checks'),p=run(DATA,['cove-support','--document']);
 const {f,req}=await reqOf(D);assert.equal(req.document,true);assert.equal(req.agent,'cove-support');
 await rm(path.join(D,f+'.req.json'));await writeFile(path.join(D,f+'.steps.log'),'10:00:01 The app picked up the request.\n10:00:02 Kirimdev took the PDF; waiting.\n');
 await p.saw(/Kirimdev took the PDF/);await writeFile(path.join(D,f+'.result.json'),JSON.stringify({agent:'cove-support',sent:true,arrived:true,document:true,bytes:640}));
 const r=await p.done;assert.equal(r.code,0);assert.match(r.out,/Asked the app for a PDF check/);assert.match(r.out,/Kirimdev took the PDF/);assert.match(r.out,/Arrived\./);assert.match(r.out,/"bytes": 640/);
 assert.deepEqual(await readdir(D),[],'it cleans up after itself');await rm(DATA,{recursive:true})});

test('a check that did not arrive says why and exits 1',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'dc-')),D=path.join(DATA,'delivery-checks'),p=run(DATA,['cove-support']);
 const {f}=await reqOf(D);await rm(path.join(D,f+'.req.json'));await writeFile(path.join(D,f+'.result.json'),JSON.stringify({agent:'cove-support',picture:false,why:'Sent, but nothing reached the main WhatsApp within 3 minutes.'}));
 const r=await p.done;assert.equal(r.code,1);assert.match(r.out,/Did not arrive: Sent, but nothing reached/);await rm(DATA,{recursive:true})});

test('an app that never picks the request up: a clear reason, exit 3, request withdrawn',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'dc-')),D=path.join(DATA,'delivery-checks'),p=run(DATA,['cove-support','--document'],{DELIVERY_CHECK_PICKUP_S:'3'});
 const r=await p.done;assert.equal(r.code,3);assert.match(r.out,/did not pick the request up within 3 seconds/);assert.match(r.out,/Last step: the request was written/);assert.deepEqual(await readdir(D),[]);await rm(DATA,{recursive:true})});

test('an app that picks it up but never answers: ends by itself at --timeout and names the last step',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'dc-')),D=path.join(DATA,'delivery-checks'),p=run(DATA,['cove-support','--timeout','4'],{DELIVERY_CHECK_LIMIT_MIN_S:'4'});
 const {f}=await reqOf(D);await rm(path.join(D,f+'.req.json'));await writeFile(path.join(D,f+'.steps.log'),'10:00:01 Kirimdev took the picture; waiting up to 3 minutes.\n');
 const r=await p.done;assert.equal(r.code,3);assert.match(r.out,/No answer from the app within 4 seconds/);assert.match(r.out,/Last step: Kirimdev took the picture/);await rm(DATA,{recursive:true})});

test('stopped from outside, it still says where it was',{skip:process.platform==='win32'},async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'dc-')),D=path.join(DATA,'delivery-checks'),p=run(DATA,['cove-support']);
 const {f}=await reqOf(D);await rm(path.join(D,f+'.req.json'));await writeFile(path.join(D,f+'.steps.log'),'10:00:01 Kirimdev took the PDF; waiting.\n');await p.saw(/Kirimdev took the PDF/);
 p.c.kill('SIGTERM');const r=await p.done;assert.equal(r.code,130);assert.match(r.out,/stopped from outside after \d+ seconds \(SIGTERM\)/);assert.match(r.out,/Last step: Kirimdev took the PDF/);await rm(DATA,{recursive:true})});
