// Main controls check: every page, in the "All agents" view and the one-agent view, as the owner and as a team member,
// must still have the buttons and tabs it had when the baseline was saved (Add server, Catalog, New schedule, Browse…).
// A page that loads but lost its main controls (21 Oct 2026: Connected apps without Catalog or Add server for two days)
// fails here. New controls are fine; missing ones fail. Runs on the box against the test copy:
//   node scripts/controls-check.mjs            check against scripts/controls-baseline.json
//   node scripts/controls-check.mjs --save     write the baseline from what the pages show now
// Env: BASE (default the test copy on :4402), PWFILE. The team member is made for the check and removed after.
import {spawn} from 'node:child_process';import {readdirSync,readFileSync,writeFileSync} from 'node:fs';import {homedir} from 'node:os';import path from 'node:path';
const BASE=process.env.BASE||'http://127.0.0.1:4402',PW=readFileSync(process.env.PWFILE||'/tmp/ppl/pw','utf8').trim(),SAVE=process.argv.includes('--save');
const FILE=path.join(path.dirname(new URL(import.meta.url).pathname),'controls-baseline.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function signIn(body){const r=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('sign-in '+r.status);return (r.headers.get('set-cookie')||'').split(';')[0]}
const api=(ck,p,o={})=>fetch(BASE+p,{...o,headers:{'x-hui':'1',cookie:ck,'content-type':'application/json',...(o.headers||{})}}).then(async r=>({s:r.status,j:await r.json().catch(()=>({}))}));
// a throwaway team member with the usual team rights (the creator preset) on the test copy's own data (never the live one)
async function makeMember(owner){const inv=await api(owner,'/ui/people/invite',{method:'POST',body:JSON.stringify({name:'Controls Check',role:'member',caps:['create','skills','mcp','schedules','models','tools','usage']})});if(!inv.j.code)throw new Error('invite: '+JSON.stringify(inv.j));
 const pw='cc-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2),username='controls-check-'+Date.now().toString(36);
 const r=await fetch(BASE+'/auth/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:inv.j.code,name:'Controls Check',password:pw,username})});if(!r.ok)throw new Error('accept '+r.status);
 const ck=(r.headers.get('set-cookie')||'').split(';')[0];const me=await api(ck,'/ui/me');return {ck,id:me.j.id||me.j.user?.id}}
async function browse(ck){const tools=homedir()+'/.hermes/tools',dir=readdirSync(tools).find(d=>d.startsWith('chromium'));const port=9500+Math.floor(Math.random()*300);
 const chrome=spawn(`${tools}/${dir}/chrome-linux64/chrome`,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port='+port,'--window-size=1440,900','about:blank'],{stdio:'ignore'});
 try{let tgt;for(let i=0;i<120&&!tgt;i++){await sleep(250);try{tgt=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page')}catch{}}
  const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const wait=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id)}};
  const cdp=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
  const ev=async js=>(await cdp('Runtime.evaluate',{expression:js,awaitPromise:true,returnByValue:true})).result?.result?.value;
  const [cn,cv]=ck.split('=');await cdp('Network.enable');await cdp('Network.setCookie',{name:cn,value:cv,domain:new URL(BASE).hostname,path:'/'});
  await cdp('Page.navigate',{url:BASE+'/#/chat'});await sleep(4000);
  const routes=await ev(`(()=>{const out=[];for(const s of SECTIONS)for(const p of s.pages||[])out.push('/'+s.id+'/'+p.id);return out})()`)||[];const seen={};
  for(const view of ['all','one'])for(const r of routes){
   await ev(`S.viewAll=${view==='all'};S.viewAgent=null;location.hash='#${r}'`);
   for(let i=0;i<80;i++){await sleep(100);if(await ev(`!!document.querySelector('.page,.chat')&&![...document.querySelectorAll('#pg .skel,.page .skel')].some(n=>n.tagName!=='I')`))break}await sleep(900);
   // the page's own buttons (top right) and its tabs; drawers, menus and the Showing picker don't count. A page that asks
   // slow agents draws its buttons late: read until two reads 700 ms apart agree (up to about 8 s), so timing isn't a miss
   const read=()=>ev(`(()=>{const t=x=>(x.innerText||x.getAttribute('aria-label')||x.title||'').replace(/\\s+/g,' ').trim();const out=new Set();
    for(const b of document.querySelectorAll('.head-actions button,.head-actions a'))if(!b.closest('.view-pick')&&t(b))out.add('button: '+t(b));
    for(const b of document.querySelectorAll('#pg [data-tabs] [data-tab],.page [data-tabs] [data-tab]'))if(!b.closest('.drawer,dialog'))out.add('tab: '+b.dataset.tab);return [...out].sort()})()`).then(x=>x||[]);
   let cur=await read();for(let i=0;i<11;i++){await sleep(700);const nx=await read();if(JSON.stringify(nx)===JSON.stringify(cur)&&nx.length)break;cur=nx}seen[view+' '+r]=cur}
  return seen}finally{chrome.kill('SIGKILL')}}
const owner=await signIn({password:PW});const result={owner:await browse(owner)};let member=null;
try{member=await makeMember(owner);result.member=await browse(member.ck)}finally{if(member?.id)await api(owner,'/ui/people/'+encodeURIComponent(member.id),{method:'DELETE'}).catch(()=>{})}
if(SAVE){writeFileSync(FILE,JSON.stringify(result,null,1)+'\n');const n=Object.values(result).reduce((a,v)=>a+Object.values(v).flat().length,0);console.log('saved '+n+' controls on '+Object.keys(result.owner).length+' page views to '+path.basename(FILE));process.exit(0)}
let base;try{base=JSON.parse(readFileSync(FILE,'utf8'))}catch{console.log(JSON.stringify({checked:0,missing:['no baseline: run node scripts/controls-check.mjs --save on the test copy and commit scripts/controls-baseline.json']}));process.exit(1)}const missing=[];
for(const who of Object.keys(base))for(const [k,want] of Object.entries(base[who])){const have=new Set(result[who]?.[k]||[]);for(const c of want)if(!have.has(c))missing.push(who+' · '+k+' · '+c)}
console.log(JSON.stringify({checked:Object.keys(base.owner||{}).length,missing}));process.exit(missing.length?1:0);
