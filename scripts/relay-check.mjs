// Shared-channel check: a throwaway agent is allowed to send through the main agent's Telegram, then sends
// (1) from the Channels page, (2) with its "notify me" tool, (3) from a schedule. Sends 3 real messages to the
// first approved Telegram person. Run on the box: node scripts/relay-check.mjs [base] [pw file] [platform]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim(),PL=process.argv[4]||'telegram';
const DATA=process.env.UI_DATA_DIR||'/tmp/ppl/data';
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));const T=Date.now().toString(36).slice(-5);const A='rl-'+T;
let ck;async function call(path,{method='GET',body}={}){const h={'x-hui':'1',cookie:ck};if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,t}}
const q=a=>'?profile='+a;let to,mcpUrl,job;
await step('Throwaway sender agent',async()=>{ck=(await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:PW})})).headers.get('set-cookie').split(';')[0];
 const r=await call('/hapi/profiles',{method:'POST',body:{name:A,clone_from_default:true}});must(r.s<300,r.t)});
await step('Recipients come from Pairing',async()=>{const r=await call('/ui/channels/recipients?owner=default&platform='+PL);must(r.s===200,r.t);to=r.j.recipients?.[0];must(to,'nobody approved on '+PL);return to.name});
await step('Allow the agent to send',async()=>{const r=await call('/ui/channels/shares',{method:'PUT',body:{owner:'default',platform:PL,senders:[A],chat:to.id}});must(r.s===200&&r.j.share?.senders?.[0]===A,r.t)});
await step('Agent got the notify tool',async()=>{for(let i=0;i<40;i++){const r=await call('/hapi/mcp/servers'+q(A));const s=(r.j.servers||r.j||[]).find?.(x=>x.name==='aqeelos-notify');if(s){mcpUrl=s.url;return s.url.replace(/[^/]+$/,'…')}await sleep(1500)}throw new Error('not added')});
await step('Lists the shared channel for the agent',async()=>{const r=await call('/ui/channels/for?agent='+A);must((r.j.channels||r.j).some?.(c=>c.owner==='default'&&c.platform===PL),r.t)});
await step('Another agent may not send',async()=>{const r=await call('/ui/channels/send',{method:'POST',body:{from:'nobody-'+T,owner:'default',platform:PL,text:'should not send'}});must(r.s>=400,'was allowed: '+r.t)});
await step('1/3 send from the Channels page',async()=>{const r=await call('/ui/channels/send',{method:'POST',body:{from:A,owner:'default',platform:PL,text:'aqeelOS check 1/3: sending through a shared channel works.'}});must(r.s===200,r.t)});
await step('2/3 send with the notify tool',async()=>{const rpc=async(method,params,id)=>(await fetch(mcpUrl,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',method,params,id})})).json().catch(()=>null);
 must((await rpc('initialize',{protocolVersion:'2025-06-18'},1))?.result?.serverInfo,'no initialize');const l=await rpc('tools/list',{},2);must(l?.result?.tools?.[0]?.name==='send_to_person','no tool');
 const c=await rpc('tools/call',{name:'send_to_person',arguments:{text:'aqeelOS check 2/3: the notify-me tool works.'}},3);must(c?.result&&!c.result.isError,JSON.stringify(c));
 const bad=await fetch(mcpUrl.replace(/[^/]+$/,'x'.repeat(32)),{method:'POST',headers:{'content-type':'application/json'},body:'{"jsonrpc":"2.0","method":"tools/list","id":1}'});must(bad.status===403,'bad token accepted')});
await step('Schedule can deliver via the shared channel',async()=>{const r=await call('/hapi/cron/jobs'+q(A),{method:'POST',body:{name:'Relay check',schedule:'0 3 1 1 *',prompt:'Reply with exactly this sentence and nothing else: aqeelOS check 3/3: a schedule delivered through a shared channel.',deliver:'relay:default|'+PL}});
 must(r.s<300,r.t);job=r.j.job||r.j;must(job.id,'no job id');const rl=await call('/ui/channels/job-relays');must((rl.j.jobs||rl.j)[A+'|'+job.id]?.owner==='default','relay not recorded: '+rl.t);
 const l=await call('/hapi/cron/jobs'+q(A));const j=(l.j.jobs||l.j).find(x=>x.id===job.id);must(j?.deliver==='local','engine deliver is '+j?.deliver)});
await step('3/3 schedule result is relayed',async()=>{must(job?.id,'no job');const r=await call('/hapi/cron/jobs/'+job.id+'/trigger'+q(A),{method:'POST',body:{}});must(r.s<300,r.t);
 const LOG=process.env.UI_LOG||'/tmp/ppl/log';const k=A+'|'+job.id;for(let i=0;i<80;i++){await sleep(3000);let l='';try{l=readFileSync(LOG,'utf8')}catch{}
  if(l.includes('relay sent '+k))return 'relayed after ~'+(i*3)+'s';const bad=l.split(String.fromCharCode(10)).find(x=>x.includes('relay tick '+k));if(bad)throw new Error(bad)}
 const l=await call('/hapi/cron/jobs'+q(A));const j=(l.j.jobs||l.j).find(x=>x.id===job.id);const r2=await call('/hapi/cron/jobs/'+job.id+'/runs'+q(A));
 throw new Error('not relayed in 4 min · job '+JSON.stringify({last_run_at:j?.last_run_at,last_status:j?.last_status})+' · runs '+r2.t.slice(0,300))});
await step('Clean up',async()=>{if(job?.id)await call('/hapi/cron/jobs/'+job.id+q(A),{method:'DELETE'});await call('/ui/channels/shares',{method:'PUT',body:{owner:'default',platform:PL,senders:[],chat:''}});
 await sleep(8000);const r=await call('/hapi/profiles/'+A,{method:'DELETE'});must(r.s<300,r.t)});
for(const [s,n,x] of res)console.log(s==='PASS'?'✓':'✗',n,x?'· '+x:'');console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length);
