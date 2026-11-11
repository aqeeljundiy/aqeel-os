// "Use my browser" check, end to end with a stand-in extension: pairing, the agent asking choose_browser, the
// person answering "My browser", and the agent's browser_navigate arriving in that browser. Run on the box against
// a test copy: node scripts/mybrowser-check.mjs [base] [password file]
import {readFileSync,writeFileSync,appendFileSync,existsSync,readdirSync} from 'node:fs';import {homedir} from 'node:os';import {execFile} from 'node:child_process';
import {NAME,nameFor,stale,withoutNames} from './mybrowser-leftovers.mjs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const PROFILES=homedir()+'/.hermes/profiles',MARKS=homedir()+'/.hermes/.aqeelos-test-agents',AG=nameFor(),HOME=PROFILES+'/'+AG;
// marked as a test agent before it exists (7 Nov 2026: mb-z4b1u was left behind unmarked, so the live app set it up,
// restarted the engine for it and filed health issues about it); the mark stays until a later run finds the agent gone
// for over an hour, so a leftover is never treated as real
try{appendFileSync(MARKS,AG+'\n')}catch{}
let ck;const out=[];const step=async(n,fn)=>{try{const x=await fn();out.push(['PASS',n,x||''])}catch(e){out.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}
 const sc=r.headers.get('set-cookie');if(sc)ck=sc.split(';')[0];return {s:r.status,j,t}}
let token,ext,sid,made=false;const got=[];
// OPS-16 (11 Nov 2026): Elkiya had 8 of these agents left and P&P 1. The app's delete had run, but the agent's turn was
// still finishing and wrote its folder again (an empty state.db, browser-harness folders): a folder the engine no longer
// lists and the app's ghost sweep does not take. A run cut off before its clean-up (the deploy's ssh dropping, SIGHUP;
// a create that answered an error after making the agent) left more. Now the agent is removed whatever happens, checked
// for 30 s after the delete, and what came back goes through the engine's own delete (it stops the agent's gateway first).
const engineDelete=n=>new Promise(res=>{const own=homedir()+'/.local/bin/hermes';execFile(existsSync(own)?own:'hermes',['profile','delete','-y',n],{timeout:90000},e=>res(!e))});
async function remove(n){await call('/hapi/profiles/'+encodeURIComponent(n),{method:'DELETE'}).catch(()=>{});
 for(let i=0;i<3;i++){await sleep(10000);if(existsSync(PROFILES+'/'+n))await engineDelete(n)}
 return !existsSync(PROFILES+'/'+n)}
let cleaning=null;   // one clean-up, whichever of the end, the time limit or a signal comes first (the others wait for it)
const gone=()=>cleaning||=(async()=>{try{ext?.close()}catch{}return made?remove(AG):true})();
for(const sig of ['SIGTERM','SIGINT','SIGHUP'])process.on(sig,()=>gone().finally(()=>process.exit(1)));
// under box-check.sh's 480 s limit with room for the clean-up
setTimeout(async()=>{console.log('FAIL | took over 400 s');await gone();process.exit(1)},400000).unref();
await step('Owner signs in',async()=>{const r=await call('/auth/login',{method:'POST',body:{password:PW}});must(r.s===200,'status '+r.s)});
// leftovers of earlier runs, over an hour old by their name, go first, and their marks once their folder is gone (on stderr:
// box-check.sh reads the last line)
try{const marked=existsSync(MARKS)?readFileSync(MARKS,'utf8').split('\n').map(l=>l.trim()):[];
 const old=stale([...readdirSync(PROFILES).filter(n=>NAME.test(n)),...marked.filter(n=>NAME.test(n))],Date.now(),3600e3,AG);
 for(const n of old)if(existsSync(PROFILES+'/'+n))console.error('leftover check agent',n,await remove(n)?'removed':'still there');
 const done=old.filter(n=>!existsSync(PROFILES+'/'+n));if(done.length)writeFileSync(MARKS,withoutNames(readFileSync(MARKS,'utf8'),done))}
catch(e){console.error('leftover check agents:',e.message)}
try{
await step('The extension pairs',async()=>{const r=await call('/ui/local-browser/pair',{method:'POST',body:{}});must(r.s===200&&r.j.token,JSON.stringify(r.j));token=r.j.token});
await step('The extension connects',async()=>{ext=new WebSocket(BASE.replace(/^http/,'ws')+'/ui/local-browser/ws?t='+encodeURIComponent(token));
 await new Promise((ok,no)=>{ext.onopen=ok;ext.onerror=()=>no(new Error('no connection'))});ext.send(JSON.stringify({type:'hello',version:'check'}));
 ext.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.type!=='command')return;got.push(m.action);
  const result=m.action==='browser_navigate'?{success:true,url:'https://example.com/',title:'Example Domain (from my browser)',snapshot:'Page: Example Domain (from my browser)\n- heading "Example Domain"\n- link "More information" [ref=e1]',element_count:1}:{success:true,snapshot:'- heading "Example Domain"',element_count:1};
  ext.send(JSON.stringify({type:'result',id:m.id,ok:true,result}))};
 await sleep(300);const s=await call('/ui/local-browser/status');must(s.j.connected,'status says not connected')});
await step('Throwaway agent with the aqeelOS tool',async()=>{made=true;const r=await call('/hapi/profiles',{method:'POST',body:{name:AG,clone_from_default:false,no_skills:true}});must(r.s<300,'status '+r.s);
 for(let i=0;i<60;i++){await sleep(2000);const y=existsSync(HOME+'/config.yaml')?readFileSync(HOME+'/config.yaml','utf8'):'';if(/127\.0\.0\.1:4402\/mcp\/notify/.test(y))return 'after '+((i+1)*2)+' s'}throw new Error('no notify tool')});
await step('A chat on it',async()=>{for(let i=0;i<90;i++){const l=existsSync(HOME+'/logs/agent.log')?readFileSync(HOME+'/logs/agent.log','utf8'):'';if(l.includes('aqeelos_notify__choose_browser'))break;await sleep(2000)}let r;for(let i=0;i<60;i++){r=await call('/gapi/p/'+AG+'/api/sessions',{method:'POST',body:{}});if(r.s<500)break;await sleep(2000)}   // the live app may be restarting the engine for the new agent: wait it out (up to 2 min)
 sid=r.j.id||r.j.session?.id||r.j.session_id;must(sid,r.t.slice(0,120))});
let reply='';
await step('The agent asks, the person picks My browser, the page opens there',async()=>{
 const chat=call('/gapi/p/'+AG+'/api/sessions/'+sid+'/chat/stream',{method:'POST',body:{message:'This is a browser test. Use the browser tools (browser_navigate), not web_extract or other readers: open https://example.com and tell me the exact page title the browser reports. Before your first browser step, call choose_browser with suggest "yours".'}});
 let picked=false;for(let i=0;i<90&&!picked;i++){await sleep(2000);const p=await call('/ui/secrets/pending?agent='+AG);const x=(p.j.items||[]).find(x=>x.kind==='browser');
  if(x){must(x.connected,'card says the browser is not connected');const r=await call('/ui/browser-choice/'+x.id,{method:'POST',body:{where:'yours',session:sid}});must(r.s===200,JSON.stringify(r.j));picked=true}}
 const r=await chat;if(!picked)throw new Error('the agent never asked choose_browser. Its reply: '+r.t.split('\n').filter(l=>/assistant.completed|tool.started|run.failed/.test(l)||l.includes('tool_name')).slice(-6).join(' | ').slice(0,700));
 // what the app sends for the person after the choice: the browser tools load with this turn
 const r2=await call('/gapi/p/'+AG+'/api/sessions/'+sid+'/chat/stream',{method:'POST',body:{message:'Go ahead in my browser.'}});
 let ev='';for(const l of r2.t.split('\n')){if(l.startsWith('event:'))ev=l.slice(6).trim();else if(l.startsWith('data:')&&ev==='assistant.completed'){try{reply=JSON.parse(l.slice(5)).content||''}catch{}}}
 must(got.includes('browser_navigate'),'navigate never reached the browser (got: '+got.join(',')+')');must(/from my browser/i.test(reply),'reply did not use it: '+String(reply).slice(0,160));return 'browser got: '+got.join(', ')+' · reply: '+String(reply).slice(0,100)});
}finally{await step('Clean up',async()=>{must(await gone(),'the agent is still there after the app\'s and the engine\'s delete')})}
for(const [a,b,c] of out)console.log(a,'|',b,'|',String(c).slice(0,240));console.log(out.filter(x=>x[0]==='PASS').length+'/'+out.length+' passed');process.exit(0);
