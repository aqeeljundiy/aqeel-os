// Security audit H-9 (12 Nov 2026): an agent's signed tool address never shows in a log an agent or person reads, and
// the key behind the signatures can be changed without breaking the agents (scripts/rotate-secrets.mjs).
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';import {existsSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {sigOf,LABELS,relayKeys,createRelayKeys,reissue,hideSigned} from '../app/relay-keys.mjs';
import {redactText} from '../app/agent-access.mjs';import {redactLog} from '../app/agent-versions.mjs';import {fireText} from '../app/cloud-fixer.mjs';
import {rotate} from './rotate-secrets.mjs';

const UI='u'.repeat(64),S=sigOf(UI,'relay:','shop');
test('the signature is 32 characters, and every redactor hides it in every signed address',()=>{assert.equal(S.length,32);
 const lines=['POST http://127.0.0.1:4400/mcp/notify/shop/'+S+' "HTTP/1.1 403"','MCP server \'aqeelos-notify\' (HTTP 403 from POST http://127.0.0.1:4400/mcp/notify/shop/'+S,'curl -sf -m 20 "http://127.0.0.1:4400/posting-gate/shop/'+S+'"','curl -s -X POST http://127.0.0.1:4400/event-hook/shop/h-1/'+S,
  'GET /run-gate/shop/job1/'+S+'?nothing=1','/posting-record/shop/'+S,'/posting-check/shop--whatsapp-2/'+S,'http://127.0.0.1:4400/mcp/self/shop/'+sigOf(UI,'self-runs:','shop'),'http://127.0.0.1:4400/mcp/code/shop/'+sigOf(UI,'code-bridge:','shop'),'/google-files/shop/'+sigOf(UI,'google-files:','shop')];
 for(const l of lines)for(const [n,f] of [['hideSigned',hideSigned],['redactText',redactText],['redactLog',redactLog]]){const out=f(l);for(const lab of LABELS)assert.equal(out.includes(sigOf(UI,lab,'shop')),false,n+': '+l);assert.match(out,/\(hidden\)/)}
 assert.equal(fireText({id:'i0123abcd',agent:'shop',missing:'x',evidence:lines.join('\n')}).includes(S),false,'evidence sent to the cloud routine');
 assert.equal(hideSigned('see /mcp/notify/shop for docs and /app/chat.js'),'see /mcp/notify/shop for docs and /app/chat.js','ordinary paths are left alone')});

test('until a key file exists the cookie key signs, exactly as before',async()=>{const D=await mkdtemp(path.join(tmpdir(),'rk-'));const k=createRelayKeys(D,UI);
 assert.equal(k.sign('relay:','shop'),S);assert.equal(k.ok(S,'relay:','shop'),true);assert.equal(k.ok(S,'relay:','other'),false);assert.equal(k.ok(S,'self-runs:','shop'),false);assert.equal(k.ok('x','relay:','shop'),false);assert.equal(k.old,null)});

test('rotation: new signatures, old ones accepted only for the grace time, every address and script re-issued, no key printed',async()=>{
 const T=await mkdtemp(path.join(tmpdir(),'rot-')),D=path.join(T,'data'),H=path.join(T,'.hermes'),envFile=path.join(T,'app.env');
 for(const d of [D,path.join(H,'scripts'),path.join(H,'profiles','shop','scripts'),path.join(H,'profiles','shop--whatsapp-2')])await mkdir(d,{recursive:true});
 await writeFile(envFile,'UI_PORT=4400\nUI_SECRET='+UI+'\nOTHER=1\n',{mode:0o600});
 const cfg=a=>'mcp_servers:\n  aqeelos-notify:\n    url: http://127.0.0.1:4400/mcp/notify/'+a+'/'+sigOf(UI,'relay:',a)+'\n  aqeelos-self:\n    url: http://127.0.0.1:4400/mcp/self/'+a+'/'+sigOf(UI,'self-runs:',a)+'\nother: keep\n';
 await writeFile(path.join(H,'config.yaml'),cfg('default'),{mode:0o600});await writeFile(path.join(H,'profiles','shop','config.yaml'),cfg('shop'),{mode:0o600});await writeFile(path.join(H,'profiles','shop--whatsapp-2','config.yaml'),cfg('shop--whatsapp-2'),{mode:0o600});
 await writeFile(path.join(H,'profiles','shop','scripts','aqeelos-posting-gate.sh'),'#!/bin/bash\ncurl -sf "http://127.0.0.1:4400/posting-gate/shop/'+S+'"\n',{mode:0o700});await writeFile(path.join(H,'scripts','aqeelos-gate-j1.sh'),'curl http://127.0.0.1:4400/run-gate/default/j1/'+sigOf(UI,'relay:','default')+'\n',{mode:0o700});
 const t0=Date.parse('2026-11-13T00:00:00Z');
 // a dry run changes nothing
 rotate('both',{DATA:D,envFile,dry:true,now:t0});assert.equal(existsSync(path.join(D,'relay-secret')),false);assert.match(await readFile(envFile,'utf8'),new RegExp('UI_SECRET='+UI));
 const did=rotate('both',{DATA:D,envFile,graceMinutes:30,now:t0});
 const env=await readFile(envFile,'utf8'),newUi=/^UI_SECRET=(.+)$/m.exec(env)[1],newRelay=(await readFile(path.join(D,'relay-secret'),'utf8')).trim();
 assert.notEqual(newUi,UI);assert.notEqual(newRelay,UI);assert.notEqual(newRelay,newUi);assert.match(env,/^OTHER=1$/m);assert.match(env,/^UI_PORT=4400$/m);
 for(const l of did)for(const k of [UI,newUi,newRelay])assert.equal(l.includes(k),false,'a key in the output');
 if(process.platform!=='win32')for(const f of [path.join(D,'relay-secret'),path.join(D,'relay-secret.prev'),envFile])assert.equal((await stat(f)).mode&0o077,0,f+' is closed to others');
 // the app after its restart, inside the grace time
 let now=t0+60e3;const k=createRelayKeys(D,newUi,()=>now),N=k.sign('relay:','shop');
 assert.notEqual(N,S);assert.equal(k.ok(N,'relay:','shop'),true);assert.equal(k.ok(S,'relay:','shop'),true,'an old signature inside the grace time');assert.equal(k.old,UI);
 const ch=await reissue({HERMES_HOME:H,agents:['default','shop','shop--whatsapp-2'],cur:k.cur,old:k.old});assert.equal(ch.length,5);k.done();
 for(const [f,a] of [[path.join(H,'config.yaml'),'default'],[path.join(H,'profiles','shop','config.yaml'),'shop'],[path.join(H,'profiles','shop--whatsapp-2','config.yaml'),'shop--whatsapp-2']]){const t=await readFile(f,'utf8');
  assert.ok(t.includes('/mcp/notify/'+a+'/'+k.sign('relay:',a)));assert.ok(t.includes('/mcp/self/'+a+'/'+k.sign('self-runs:',a)));assert.equal(t.includes(sigOf(UI,'relay:',a)),false);assert.match(t,/other: keep/)}
 assert.ok((await readFile(path.join(H,'profiles','shop','scripts','aqeelos-posting-gate.sh'),'utf8')).includes('/posting-gate/shop/'+N));assert.ok((await readFile(path.join(H,'scripts','aqeelos-gate-j1.sh'),'utf8')).includes(k.sign('relay:','default')));
 if(process.platform!=='win32')assert.equal((await stat(path.join(H,'profiles','shop','scripts','aqeelos-posting-gate.sh'))).mode&0o777,0o700,'a script keeps its rights');
 assert.equal(k.old,null,'re-issued once');assert.deepEqual(await reissue({HERMES_HOME:H,agents:['shop'],cur:k.cur,old:k.old}),[]);
 // after the grace time the old signature is dead, also after another restart
 now=t0+31*60e3;assert.equal(k.ok(S,'relay:','shop'),false);assert.equal(k.ok(N,'relay:','shop'),true);assert.equal(createRelayKeys(D,newUi,()=>now).ok(S,'relay:','shop'),false);
 // "ui" alone later: people sign in again, the agents' signatures stay
 rotate('ui',{DATA:D,envFile,now:now+1});const ui3=/^UI_SECRET=(.+)$/m.exec(await readFile(envFile,'utf8'))[1];assert.notEqual(ui3,newUi);assert.equal(createRelayKeys(D,ui3,()=>now+2).sign('relay:','shop'),N)});

test('rotating the cookie key alone on an install that never rotated keeps the agents working; no grace cuts the old key at once',async()=>{
 const T=await mkdtemp(path.join(tmpdir(),'rot2-')),D=path.join(T,'data');await mkdir(D);await writeFile(path.join(D,'ui-secret'),UI+'\n');
 rotate('ui',{DATA:D,envFile:path.join(T,'none.env'),now:1});const ui2=(await readFile(path.join(D,'ui-secret'),'utf8')).trim();assert.notEqual(ui2,UI);
 assert.equal(createRelayKeys(D,ui2).sign('relay:','shop'),S,'the agents\' signatures did not move');
 rotate('relay',{DATA:D,envFile:path.join(T,'none.env'),graceMinutes:0,now:1000});const k=createRelayKeys(D,ui2,()=>2000);assert.equal(k.ok(S,'relay:','shop'),false);assert.equal(k.old,UI,'still known for the re-issue');
 assert.throws(()=>rotate('relay',{DATA:path.join(T,'empty'),envFile:path.join(T,'none.env')}),/cookie key/);assert.throws(()=>rotate('x',{DATA:D,envFile:''}),/relay, ui or both/)});
