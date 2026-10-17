// Deep word check: every page, then each tab, each ⋯/menu button and the "new …" pop-ups on it; text, titles,
// placeholders, labels, options and the values inside form fields. Nothing is saved (pop-ups are closed with Escape).
import {spawn} from 'node:child_process';import {readdirSync,readFileSync} from 'node:fs';import {homedir} from 'node:os';
const pat=process.argv[2]||'hermes|nous research';const BASE=process.env.BASE||'http://127.0.0.1:4400';const pw=readFileSync(process.env.PWFILE||'/tmp/.ppw','utf8').trim();
const tools=homedir()+'/.hermes/tools',dir=readdirSync(tools).find(d=>d.startsWith('chromium'));const port=9500+Math.floor(Math.random()*300);
const chrome=spawn(`${tools}/${dir}/chrome-linux64/chrome`,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port='+port,'--window-size=1280,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const login=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw})});const ck=(login.headers.get('set-cookie')||'').split(';')[0];const [cn,cv]=ck.split('=');
 let tgt;for(let i=0;i<40&&!tgt;i++){await sleep(250);try{tgt=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page')}catch{}}
 const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const wait=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id)}};
 const cdp=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
 await cdp('Network.enable');await cdp('Network.setCookie',{name:cn,value:cv,domain:new URL(BASE).hostname,path:'/'});
 const ev=async js=>(await cdp('Runtime.evaluate',{expression:js,awaitPromise:true,returnByValue:true})).result?.result?.value;
 await cdp('Page.navigate',{url:BASE+'/#/chat'});await sleep(4000);
 const routes=await ev(`(()=>{const out=['/chat'];for(const s of SECTIONS)for(const p of s.pages||[])out.push('/'+s.id+'/'+p.id);return out})()`)||[];
 const scan=`(()=>{const re=new RegExp(${JSON.stringify(pat)},'i'),hits=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  for(let n;(n=w.nextNode());){const v=n.nodeValue;if(re.test(v)&&!n.parentElement.closest('pre,code,.thread'))hits.add(v.trim().slice(0,120))}
  document.querySelectorAll('[title],[placeholder],[aria-label],option').forEach(e=>{for(const k of ['title','placeholder','aria-label']){const v=e.getAttribute(k);if(v&&re.test(v))hits.add('['+k+'] '+v.slice(0,100))}if(e.tagName==='OPTION'&&re.test(e.textContent))hits.add('[option] '+e.textContent.slice(0,80))});
  document.querySelectorAll('input,textarea').forEach(e=>{if(e.type!=='password'&&re.test(e.value||''))hits.add('[field] '+String(e.value).slice(0,100))});return [...hits]})()`;
 const report={};const add=(where,h)=>{if(h?.length)report[where]=[...new Set([...(report[where]||[]),...h])]};
 const SAFE=['cron-new','key-add','wh-new','kb-new','moa-new','ssh-add','gacc-add','agent-new','profile-new','mcp-add','invite'];
 for(const r of routes){await cdp('Page.navigate',{url:BASE+'/#'+r});await sleep(3500);add(r,await ev(scan));
  // tabs on the page
  const nt=await ev(`document.querySelectorAll('.page .tabs [data-tab], .page [data-tabs] button').length`)||0;
  for(let i=0;i<nt;i++){await ev(`document.querySelectorAll('.page .tabs [data-tab], .page [data-tabs] button')[${i}]?.click()`);await sleep(2200);add(r+' (tab '+(i+1)+')',await ev(scan))}
  // menus: open each, read it, close it
  const nm=Math.min(12,await ev(`document.querySelectorAll('.page [data-menu]').length`)||0);
  for(let i=0;i<nm;i++){await ev(`document.querySelectorAll('.page [data-menu]')[${i}]?.click()`);await sleep(600);add(r+' (menu)',await ev(scan));await ev(`document.querySelectorAll('.menu').forEach(m=>m.remove())`)}
  // "new …" pop-ups: open, read, close
  for(const a of SAFE){const has=await ev(`!!document.querySelector('[data-act="${a}"]')`);if(!has)continue;await ev(`document.querySelector('[data-act="${a}"]').click()`);await sleep(1800);add(r+' (pop-up '+a+')',await ev(scan));await ev(`typeof closeLayers==='function'&&closeLayers(false)`);await sleep(300)}}
 console.log(JSON.stringify({pages:routes.length,hits:report},null,1));
}finally{chrome.kill('SIGKILL')}
