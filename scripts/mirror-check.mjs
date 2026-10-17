// My browser view check, with a stand-in extension: the screen panel's picture of the agent's tab, Take over,
// and the side-panel framing rule. Run on the box against a test copy: node scripts/mirror-check.mjs [base] [password file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
let ck;const out=[];const step=async(n,fn)=>{try{const x=await fn();out.push(['PASS',n,x||''])}catch(e){out.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}
 const sc=r.headers.get('set-cookie');if(sc)ck=sc.split(';')[0];return {s:r.status,j,t,h:r.headers}}
const PIC='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';let ext,mode='none',focused=0;
await step('Owner signs in',async()=>{const r=await call('/auth/login',{method:'POST',body:{password:PW}});must(r.s===200,'status '+r.s)});
await step('Before the extension: the view says to set it up',async()=>{const r=await call('/ui/local-browser/frame');must(r.j.connected===false,JSON.stringify(r.j))});
await step('The stand-in extension connects',async()=>{const t=(await call('/ui/local-browser/pair',{method:'POST',body:{}})).j.token;ext=new WebSocket(BASE.replace(/^http/,'ws')+'/ui/local-browser/ws?t='+encodeURIComponent(t));
 await new Promise((ok,no)=>{ext.onopen=ok;ext.onerror=()=>no(new Error('no connection'))});
 ext.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.type==='frame')ext.send(JSON.stringify({type:'reply',id:m.id,...(mode==='none'?{none:true}:mode==='bg'?{inactive:true,url:'https://console.cloud.google.com/',title:'Google Cloud'}:{data:PIC,url:'https://console.cloud.google.com/',title:'Google Cloud'})}));
  if(m.type==='focus'){focused++;ext.send(JSON.stringify({type:'reply',id:m.id,ok:true}))}};await sleep(300)});
await step('No agent tab yet',async()=>{const r=await call('/ui/local-browser/frame');must(r.j.connected&&r.j.none,JSON.stringify(r.j))});
await step('The agent tab in the background',async()=>{mode='bg';const r=await call('/ui/local-browser/frame');must(r.j.inactive&&r.j.title==='Google Cloud',JSON.stringify(r.j))});
await step('A live picture of the agent tab',async()=>{mode='pic';const r=await call('/ui/local-browser/frame');must(r.j.data===PIC&&r.j.url,JSON.stringify(r.j).slice(0,120));return r.j.title+' · '+r.j.url});
await step('Take over brings it to the front',async()=>{const r=await call('/ui/local-browser/focus',{method:'POST',body:{}});must(r.j.ok&&focused===1,JSON.stringify(r.j))});
await step('Only the aqeelOS extension may show aqeelOS in its side panel',async()=>{const r=await call('/');const csp=r.h.get('content-security-policy')||'';must(/frame-ancestors 'self' chrome-extension:\/\/jdfbikbihabglfkcckkmmfbmfdpifbgf/.test(csp),'csp: '+csp.slice(0,200));must(!r.h.get('x-frame-options'),'old header still there');return 'frame-ancestors: self + the extension'});
ext?.close();for(const [a,b,c] of out)console.log(a,'|',b,'|',String(c).slice(0,200));console.log(out.filter(x=>x[0]==='PASS').length+'/'+out.length+' passed');process.exit(0);
