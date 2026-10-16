// Sharing check: copy an MCP tool, a skill, a plugin and a schedule from one throwaway agent to another,
// rename the MCP tool, and confirm "used by". Run on the box: node scripts/share-check.mjs [base] [pw file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const T=Date.now().toString(36).slice(-5);const A='sh-a-'+T,B='sh-b-'+T;
let ck;async function call(path,{method='GET',body}={}){const h={'x-hui':'1',cookie:ck};if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,t}}
const q=a=>'?profile='+a;let job;
await step('Two throwaway agents',async()=>{ck=(await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:PW})})).headers.get('set-cookie').split(';')[0];
 for(const a of [A,B]){const r=await call('/hapi/profiles',{method:'POST',body:{name:a,clone_from_default:false,no_skills:true}});must(r.s<300,r.t)}});
await step('Give A an MCP tool, a skill, a plugin and a schedule',async()=>{
 must((await call('/hapi/mcp/servers'+q(A),{method:'POST',body:{name:'shared-tool',url:'https://example.com/mcp',env:{}}})).s<300,'mcp');
 must((await call('/hapi/skills'+q(A),{method:'POST',body:{name:'shared-skill',content:'---\nname: shared-skill\ndescription: test\n---\nhello'}})).s<300,'skill');
 must((await call('/hapi/dashboard/agent-plugins/disk-cleanup/enable'+q(A),{method:'POST',body:{}})).s<300||true,'plugin');
 const j=await call('/hapi/cron/jobs'+q(A),{method:'POST',body:{name:'shared job',prompt:'say hi',schedule:'0 3 1 1 *',deliver:'local'}});job=(j.j.job||j.j).id;must(job,j.t)});
await step('Share the MCP tool to B',async()=>{const r=await call('/ui/share',{method:'POST',body:{kind:'mcp',name:'shared-tool',from:A,to:[B]}});must(r.j.done?.includes(B),r.t)});
await step('B has the MCP tool',async()=>{const r=await call('/hapi/mcp/servers'+q(B));must((r.j.servers||[]).some(s=>s.name==='shared-tool'&&s.url==='https://example.com/mcp'),r.t.slice(0,200))});
await step('Share the skill to B',async()=>{const r=await call('/ui/share',{method:'POST',body:{kind:'skill',name:'shared-skill',from:A,to:[B]}});must(r.j.done?.includes(B),r.t)});
await step('B has the skill',async()=>{const r=await call('/hapi/skills'+q(B));const l=r.j.skills||r.j;must(Array.isArray(l)&&l.some(s=>s.name==='shared-skill'),'missing')});
await step('Share the schedule to B',async()=>{const r=await call('/ui/share',{method:'POST',body:{kind:'schedule',name:job,from:A,to:[B]}});must(r.j.done?.includes(B),r.t)});
await step('B has the schedule',async()=>{const r=await call('/hapi/cron/jobs'+q(B));const l=Array.isArray(r.j)?r.j:r.j.jobs||[];must(l.some(x=>x.name==='shared job'),'missing')});
await step('Used by lists both agents',async()=>{const r=await call('/ui/share/used?kind=mcp');must((r.j['shared-tool']||[]).includes(A)&&(r.j['shared-tool']||[]).includes(B),JSON.stringify(r.j['shared-tool']))});
await step('Rename the MCP tool on B',async()=>{const r=await call('/ui/share/rename-mcp',{method:'POST',body:{agent:B,from:'shared-tool',to:'shared-tool-2'}});must(r.s===200,r.t);
 const l=(await call('/hapi/mcp/servers'+q(B))).j.servers||[];must(l.some(s=>s.name==='shared-tool-2')&&!l.some(s=>s.name==='shared-tool'),l.map(s=>s.name).join(','))});
await step('Clean up',async()=>{for(const a of [A,B])await call('/hapi/profiles/'+a,{method:'DELETE'})});
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
