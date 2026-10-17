// Pause / resume check: a connected channel is paused (stays linked, nobody answers), shows as paused, then
// resumes on the same agent and connects again without a new QR. Run on the box against a test copy:
//   node scripts/pause-check.mjs [agent] [platform] [base] [password file]
import {readFileSync} from 'node:fs';
const AG=process.argv[2]||'husband-mode',PF=process.argv[3]||'whatsapp';
const BASE=process.argv[4]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[5]||'/tmp/ppl/pw','utf8').trim();
let ck;const out=[];const step=async(n,fn)=>{try{const x=await fn();out.push(['PASS',n,x||''])}catch(e){out.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}
 const sc=r.headers.get('set-cookie');if(sc)ck=sc.split(';')[0];return {s:r.status,j}}
const row=async()=>(await call('/ui/channels')).j.channels.find(c=>c.agent===AG&&c.id===PF);
await step('Owner signs in',async()=>{const r=await call('/auth/login',{method:'POST',body:{password:PW}});must(r.s===200,'status '+r.s)});
await step('Starts connected',async()=>{const c=await row();must(c?.state==='connected','state '+c?.state);return c.account?.phone||c.account?.username});
await step('Pause',async()=>{const r=await call('/ui/channels/pause',{method:'POST',body:{agent:AG,platform:PF,on:false}});must(r.s===200,JSON.stringify(r.j));return r.j.restarting?'engine restart':'live'});
await step('Shows as paused, still linked',async()=>{await sleep(6000);const c=await row();must(c?.paused&&c.state==='paused','row '+JSON.stringify(c));must(c.account,'account gone');return c.account.phone||c.account.username});
await step('Check says paused',async()=>{const r=await call('/ui/channels/check',{method:'POST',body:{agent:AG,platform:PF}});must(r.j.paused,'not paused: '+r.j.text);return r.j.text});
await step('Not in the attention list',async()=>{const r=await call('/ui/channels/attention?fresh=1');must(!(r.j.items||[]).some(x=>x.agent===AG&&x.id===PF),'listed');});
await step('Resume on the same agent',async()=>{const r=await call('/ui/channels/pause',{method:'POST',body:{agent:AG,platform:PF,on:true}});must(r.s===200,JSON.stringify(r.j))});
await step('Connected again, no QR',async()=>{for(let i=0;i<30;i++){await sleep(3000);const r=await call('/ui/channels/check',{method:'POST',body:{agent:AG,platform:PF}});if(r.j.connected)return 'after '+((i+1)*3)+' s: '+r.j.text}throw new Error('not connected after 90 s')});
for(const [a,b,c] of out)console.log(a,'|',b,'|',String(c).slice(0,200));console.log(out.filter(x=>x[0]==='PASS').length+'/'+out.length+' passed');
