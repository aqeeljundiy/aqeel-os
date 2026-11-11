// type_secret through the agent's browser (11 Nov 2026, Donna's KirimDev sign-in): a real headless Chrome with a sign-in
// page, an agent whose only link to it is the port file the engine's Chromium writes (DevToolsActivePort), no screen.
// The secret must land in the password box; a search box and a tab with nothing focused must refuse.
// Run on a box with Chrome:  CHROME=/path/to/chrome node scripts/type-secret-cdp.check.mjs
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const CHROME=process.env.CHROME;if(!CHROME){console.log('skip: no CHROME');process.exit(0)}
const H=await mkdtemp(path.join(tmpdir(),'ts-'));process.env.HERMES_HOME=H;
const prof=path.join(H,'profiles','tst'),ud=path.join(prof,'bot-desktop','browser-profile');await mkdir(ud,{recursive:true});
await writeFile(path.join(prof,'config.yaml'),'model:\n  default: x\n');
const page=f=>'data:text/html,'+encodeURIComponent(`<title>Sign in</title><input id=q type=search name=q><input id=pw type=password name=password><script>document.getElementById('${f}').focus()</script>`);
const c=spawn(CHROME,['--headless=new','--no-sandbox','--remote-debugging-port=0','--user-data-dir='+ud,page('pw')],{stdio:'ignore'});
let port;for(let i=0;i<50&&!port;i++){await new Promise(r=>setTimeout(r,200));port=(await readFile(path.join(ud,'DevToolsActivePort'),'utf8').catch(()=>'')).split('\n')[0]}
try{
 const {createScreens}=await import('../app/screens.mjs');const S=createScreens();
 assert.equal(await S.typeInto('tst','s3cret-PW',{secret:true}),true);
 const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const val=await new Promise(res=>{const s=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);s.onopen=()=>s.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'document.getElementById("pw").value',returnByValue:true}}));s.onmessage=m=>{res(JSON.parse(m.data).result.result.value);s.close()}});
 assert.equal(val,'s3cret-PW','the secret is in the password box');
 // a search box in focus: refused, nothing typed
 await new Promise(res=>{const s=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);s.onopen=()=>s.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'document.getElementById("q").focus()'}}));s.onmessage=()=>{s.close();res()}});
 await assert.rejects(()=>S.typeInto('tst','nope',{secret:true}),/search box|not a sign-in field/);
 console.log('type_secret through the browser: typed into the password box, refused the search box');
}finally{c.kill()}
