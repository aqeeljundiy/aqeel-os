// Tests for shared Google logins as limited keys (app/google-shares.mjs). Run: node --test scripts/google-shares.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,readdir,stat,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGoogleShares,scopesFor} from '../app/google-shares.mjs';

const G='https://www.googleapis.com/auth/';
const OWNER_SCOPES=['calendar','documents','spreadsheets','gmail.send','contacts.readonly','drive','gmail.modify','gmail.readonly'].map(s=>G+s);
async function make(levels={}){const H=await mkdtemp(path.join(tmpdir(),'gs-')),DATA=path.join(H,'data');
 await mkdir(path.join(H,'profiles','cove-threads'),{recursive:true});await mkdir(path.join(H,'profiles','pine-agent'),{recursive:true});
 await writeFile(path.join(H,'google_token.json'),JSON.stringify({account:'me@gmail.com',client_id:'cid',client_secret:'csec',refresh_token:'RT-OWNER',token:'x',scopes:OWNER_SCOPES,token_uri:'https://oauth2.googleapis.com/token'}));
 let t=1e12;const asked=[];
 const fetchImpl=async(url,o)=>{const b=new URLSearchParams(o.body);asked.push(b.get('scope'));assert.equal(b.get('refresh_token'),'RT-OWNER');return {ok:true,json:async()=>({access_token:'AT'+asked.length,expires_in:3599,scope:b.get('scope')})}};
 const s=createGoogleShares({HERMES_HOME:H,DATA,WORK:path.join(H,'work'),agents:async()=>['default','cove-threads','pine-agent'],levelOf:async(e,a)=>levels[a]||'edit',fetchImpl,now:()=>t,log:()=>{}});
 return {s,H,asked,tick:ms=>{t+=ms}}}
const read=async(H,a,f='google_token.json')=>JSON.parse(await readFile(path.join(H,'profiles',a,f),'utf8'));

test('levels ask Google only for scopes the owner has; full is all of them',()=>{
 assert.deepEqual(scopesFor('edit',OWNER_SCOPES).map(s=>s.replace(G,'')).sort(),['contacts.readonly','documents','gmail.readonly','spreadsheets']);
 assert.deepEqual(scopesFor('read',OWNER_SCOPES).map(s=>s.replace(G,'')).sort(),['contacts.readonly','gmail.readonly']);
 assert.equal(scopesFor('full',OWNER_SCOPES).length,8);assert.ok(!scopesFor('draft',OWNER_SCOPES).includes(G+'gmail.send'))});

test('a share is a limited key with no refresh token, and the owner\'s sign-in never leaves',async()=>{const {s,H,asked}=await make();
 assert.deepEqual(await s.share('ME@gmail.com','cove-threads'),{file:'google_token.json',changed:true});
 const k=await read(H,'cove-threads');assert.equal(k.aqeelos_managed,true);assert.equal(k.refresh_token,'');assert.equal(k.client_secret,'');assert.equal(k.token,'AT1');assert.equal(k.aqeelos_level,'edit');
 assert.ok(!k.scopes.includes(G+'gmail.send'));assert.ok(k.scopes.includes(G+'spreadsheets'));assert.match(k.expiry,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000000Z$/);
 assert.equal(JSON.stringify(k).includes('RT-OWNER'),false);assert.equal(asked.length,1);
 assert.equal((await s.share('me@gmail.com','cove-threads')).changed,false)});

test('renewed before it runs out and when the level changes; removed when the owner sign-in is gone or unshared',async()=>{const levels={};const {s,H,asked,tick}=await make(levels);
 await s.share('me@gmail.com','cove-threads');assert.deepEqual(await s.renew(),{renewed:0,removed:0});
 tick(25*60e3);assert.deepEqual(await s.renew(),{renewed:1,removed:0});assert.equal((await read(H,'cove-threads')).token,'AT2');
 levels['cove-threads']='read';assert.deepEqual(await s.renew(),{renewed:1,removed:0});assert.equal((await read(H,'cove-threads')).aqeelos_level,'read');
 assert.equal(await s.unshare('me@gmail.com','cove-threads'),1);assert.deepEqual((await readdir(path.join(H,'profiles','cove-threads'))).filter(f=>f.startsWith('google')),[])});

test('an agent\'s own full copy is backed up and replaced; a share never writes over a copy that is not managed',async()=>{const {s,H}=await make();
 await writeFile(path.join(H,'profiles','pine-agent','google_token.json'),JSON.stringify({account:'me@gmail.com',refresh_token:'RT-OWNER',token:'old'}));
 await assert.rejects(s.share('me@gmail.com','pine-agent'),/own copy/);
 const r=await s.migrate('pine-agent','google_token.json');assert.equal(r.changed,true);const k=await read(H,'pine-agent');assert.equal(k.aqeelos_managed,true);assert.equal(k.refresh_token,'');
 const bk=await readdir(path.join(H,'data','google-copies-backup'));assert.equal(bk.length,1);assert.match(bk[0],/^pine-agent__google_token\.json\./);
 assert.equal((await s.migrate('pine-agent','google_token.json')).changed,false)});

test('hand-placed copies in the workspace (.tools, .hermes) become keys the agent\'s user can read, renewed and unshared with the rest',async()=>{const {s,H,tick}=await make();
 const W=path.join(H,'work','cove-threads');await mkdir(path.join(W,'.tools'),{recursive:true});await mkdir(path.join(W,'.hermes'),{recursive:true});
 await writeFile(path.join(W,'.tools','google_token.json'),JSON.stringify({account:'me@gmail.com',refresh_token:'RT-OWNER'}));
 await writeFile(path.join(W,'.hermes','google_token_elmora.json'),JSON.stringify({account:'me@gmail.com',refresh_token:'RT-OWNER'}),{mode:0o600});await chmod(path.join(W,'.hermes','google_token_elmora.json'),0o000);
 await assert.rejects(s.migrate('cove-threads','../x/google_token.json'),/file is/);
 const r=await s.migrate('cove-threads','.tools/google_token.json');assert.equal(r.changed,true);
 const k=JSON.parse(await readFile(path.join(W,'.tools','google_token.json'),'utf8'));assert.equal(k.aqeelos_managed,true);assert.equal(k.refresh_token,'');
 assert.equal((await stat(path.join(W,'.tools','google_token.json'))).mode&0o777,0o660);
 // an unreadable copy needs its email, and is moved whole into the backup
 await assert.rejects(s.migrate('cove-threads','.hermes/google_token_elmora.json'),/unreadable/);
 assert.equal((await s.migrate('cove-threads','.hermes/google_token_elmora.json','me@gmail.com')).changed,true);
 assert.equal((await readdir(path.join(H,'data','google-copies-backup'))).length,2);
 // the profile share sits beside them; all three are listed, renewed and removed together
 await s.share('me@gmail.com','cove-threads');assert.deepEqual((await s.list()).map(k=>k.file).sort(),['.hermes/google_token_elmora.json','.tools/google_token.json','google_token.json']);
 tick(25*60e3);assert.deepEqual(await s.renew(),{renewed:3,removed:0});
 assert.equal(await s.unshare('me@gmail.com','cove-threads'),3);assert.deepEqual(await s.list(),[])});

test('a workspace .hermes file the engine copies in from the profile (credential_files) is left to the engine',async()=>{const {s,H}=await make();
 const W=path.join(H,'work','cove-threads','.hermes');await mkdir(W,{recursive:true});await s.share('me@gmail.com','cove-threads');
 await writeFile(path.join(H,'profiles','cove-threads','config.yaml'),'terminal:\n  backend: ssh\n  credential_files:\n    - google_token.json\ntools:\n  x: 1\n');
 await writeFile(path.join(W,'google_token.json'),await readFile(path.join(H,'profiles','cove-threads','google_token.json')));
 assert.deepEqual((await s.list()).map(k=>k.file),['google_token.json'])});

test('every renewal locks the owner\'s own sign-in files to the owner again',async()=>{const {s,H}=await make();await chmod(path.join(H,'google_token.json'),0o664);
 await s.renew();assert.equal((await stat(path.join(H,'google_token.json'))).mode&0o777,0o600)});
