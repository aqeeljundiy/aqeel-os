// Tests for agents' Google files as a hard lock (app/google-files.mjs). Run: node --test scripts/google-files.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGoogleFiles} from '../app/google-files.mjs';

async function make(levels={}){const H=await mkdtemp(path.join(tmpdir(),'gf-')),W=path.join(H,'ws');
 await mkdir(path.join(W,'bot','.tools'),{recursive:true});await mkdir(path.join(W,'bot','.hermes'),{recursive:true});
 await writeFile(path.join(H,'aqeelos-accounts.json'),JSON.stringify({google:{'me@example.com':{agents:{bot:['read','edit']}}},google_files:{'me@example.com':{bot:['OWN']}}}));
 const calls=[];const fetchImpl=async(u,o)=>{calls.push({u,o});return {ok:true,status:200,json:async()=>({ok:1,u})}};
 const f=createGoogleFiles({HERMES_HOME:H,WORK:W,PORT:1,sig:a=>'S'+a,levelOf:async(e,a)=>levels[a]||'edit',token:async()=>'TOK',fetchImpl,log:()=>{}});
 return {f,H,W,calls}}

test('own file works, with the key added by aqeelOS only',async()=>{const {f,calls}=await make();
 const r=await f.call('bot',{service:'sheets',method:'spreadsheets.values.get',params:{spreadsheetId:'OWN',range:'A!A1:B2',valueRenderOption:'FORMULA'}});
 assert.equal(r.status,200);assert.match(calls[0].u,/spreadsheets\/OWN\/values\/A!A1%3AB2\?valueRenderOption=FORMULA$/);assert.equal(calls[0].o.headers.authorization,'Bearer TOK')});

test('another file, an unknown method and an unlisted agent are refused without calling Google',async()=>{const {f,calls}=await make();
 assert.equal((await f.call('bot',{service:'sheets',method:'spreadsheets.get',params:{spreadsheetId:'OTHER'}})).status,403);
 assert.equal((await f.call('bot',{service:'drive',method:'files.list',params:{}})).status,400);
 assert.equal((await f.call('bot',{service:'drive',method:'files.copy',params:{fileId:'OWN'}})).status,400);
 assert.equal((await f.call('stranger',{service:'sheets',method:'spreadsheets.get',params:{spreadsheetId:'OWN'}})).status,403);
 assert.equal((await f.call('bot',{service:'sheets',method:'spreadsheets.get',params:{spreadsheetId:'OWN'},account:'other@example.com'})).status,403);
 assert.equal(calls.length,0)});

test('read level may not change the file',async()=>{const {f,calls}=await make({bot:'read'});
 assert.equal((await f.call('bot',{service:'sheets',method:'spreadsheets.values.update',params:{spreadsheetId:'OWN',range:'A1'},body:{values:[[1]]}})).status,403);
 assert.equal((await f.call('bot',{service:'sheets',method:'spreadsheets.get',params:{spreadsheetId:'OWN'}})).status,200);assert.equal(calls.length,1)});

test('the helper written to the workspace holds no key, and synced managed keys are removed',async()=>{const {f,W}=await make();
 await writeFile(path.join(W,'bot','.hermes','google_token.json'),JSON.stringify({aqeelos_managed:true,token:'AT'}));
 await writeFile(path.join(W,'bot','.hermes','google_token_own.json'),JSON.stringify({refresh_token:'mine'}));
 await f.ensureClients();const h=await readFile(path.join(W,'bot','.tools','sheet'),'utf8');
 assert.match(h,/\/google-files\/bot\/Sbot/);assert.ok(!/TOK|token"/.test(h));
 assert.deepEqual((await readdir(path.join(W,'bot','.hermes'))).sort(),['google_token_own.json']);
 assert.equal(await f.locked('bot'),true);assert.equal(await f.locked('bot--copy'),true);assert.equal(await f.locked('other'),false)});
