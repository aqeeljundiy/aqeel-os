// Exercises the actions behind the board's "partial" features through the aqeelOS server, as the owner.
// Everything it creates it removes again; nothing destructive runs on real data.
// Run on the box against a test copy: node scripts/actions-check.mjs [base] [owner password file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const res=[];const step=async(id,n,fn)=>{try{const x=await fn();res.push(['PASS',id,n,x||''])}catch(e){res.push(['FAIL',id,n,e.message.slice(0,200)])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ck;
async function call(path,{method='GET',body}={}){const h={'x-hui':'1',cookie:ck};if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}if(r.status>=300)throw new Error(r.status+' '+String(t).slice(0,160));return j}
const H=(p,o)=>call('/hapi'+p+(p.includes('profile=')?'':(p.includes('?')?'&':'?')+'profile=default'),o);
async function follow(name){for(let i=0;i<80;i++){const s=await H('/actions/'+encodeURIComponent(name)+'/status?lines=50');if(!s.running)return s;await sleep(1500)}throw new Error('still running')}
{const r=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:PW})});ck=(r.headers.get('set-cookie')||'').split(';')[0]}

let sid;
await step('HIST-04','Start a chat to work with',async()=>{const r=await call('/gapi/api/sessions',{method:'POST',body:{title:'actions-check'}});sid=r.id||r.session?.id||r.session_id;must(sid,JSON.stringify(r).slice(0,100))});
await step('HIST-04','Rename a chat',async()=>{await H('/sessions/'+sid,{method:'PATCH',body:{title:'actions-check renamed'}});const l=await H('/sessions?limit=50');must((l.sessions||[]).some(s=>s.id===sid&&s.title==='actions-check renamed'),'title not changed')});
let exported;
await step('HIST-04','Export a chat as JSON',async()=>{const r=await fetch(BASE+'/hapi/sessions/'+sid+'/export?profile=default',{headers:{cookie:ck}});must(r.ok,'status '+r.status);exported=await r.json();must(exported&&typeof exported==='object','not JSON')});
await step('HIST-06','History stats',async()=>{const s=await H('/sessions/stats');must(s&&typeof s==='object','no stats');return Object.keys(s).slice(0,5).join(',')});
await step('HIST-03','Search inside chats',async()=>{const s=await H('/sessions/search?q=renamed&limit=5');must(Array.isArray(s.results),'no results array')});
await step('HIST-05','Count empty chats',async()=>{const s=await H('/sessions/empty/count');must(s&&('count' in s||'empty' in s||typeof s==='object'),'no count');return JSON.stringify(s).slice(0,60)});
await step('HIST-05','Prune (older than 10 years: removes nothing real)',async()=>{const r=await H('/sessions/prune',{method:'POST',body:{older_than_days:3650,profile:'default'}});return 'removed '+(r.removed??'?')});
let imported=[];
await step('HIST-07','Import the exported chat',async()=>{const sessions=Array.isArray(exported)?exported:exported.sessions||[exported];const before=new Set(((await H('/sessions?limit=100')).sessions||[]).map(s=>s.id));
 const r=await H('/sessions/import',{method:'POST',body:{sessions}});imported=((await H('/sessions?limit=100')).sessions||[]).filter(s=>!before.has(s.id)).map(s=>s.id);return 'imported '+(r.imported??'?')});
await step('HIST-04','Delete chats',async()=>{for(const id of [sid,...imported])await H('/sessions/'+id,{method:'DELETE'})});
await step('AUTO-04','Create and delete a webhook',async()=>{await H('/webhooks',{method:'POST',body:{name:'actions-check',description:'',events:['push'],deliver_only:false,prompt:'x'}});await H('/webhooks/actions-check',{method:'DELETE'})});
await step('AUTO-04','Public webhook address answers',async()=>{const r=await fetch(BASE+'/webhooks/does-not-exist',{method:'POST'});must(r.status===404||r.status===401||r.status===403,'status '+r.status)});
await step('AUTO-07','Pairing list',async()=>{const p=await H('/pairing');must(p&&typeof p==='object','no data')});
await step('AUTO-06','Channel list and a channel test',async()=>{const p=await H('/messaging/platforms');const list=p.platforms||p;must(Array.isArray(list)&&list.length,'no platforms');const tg=list.find(x=>(x.id||x.platform)==='telegram')||list[0];const r=await H('/messaging/platforms/'+(tg.id||tg.platform)+'/test',{method:'POST'}).catch(e=>({err:e.message}));return (tg.id||tg.platform)+': '+JSON.stringify(r).slice(0,80)});
await step('ABIL-03','Skill hub search',async()=>{const r=await H('/skills/hub/search?q=seo&source=all&limit=5');must(Array.isArray(r.results),'no results');return r.results.length+' results'});
await step('ABIL-04','Plugins list and rescan',async()=>{const p=await H('/dashboard/plugins');must(p,'none');await H('/dashboard/plugins/rescan')});
await step('ABIL-06','MCP catalog',async()=>{const c=await H('/mcp/catalog');must(Array.isArray(c.entries)&&c.entries.length,'empty');return c.entries.length+' servers'});
await step('MODEL-02','Provider sign-ins',async()=>{const o=await H('/providers/oauth');must(Array.isArray(o.providers),'none');return o.providers.length+' providers'});
await step('MODEL-05','Credential pool: add and remove a key',async()=>{await H('/credentials/pool',{method:'POST',body:{provider:'deepseek',api_key:'sk-actions-check-not-real',label:'actions-check'}});
 const p=await H('/credentials/pool');const prov=(p.providers||[]).find(x=>(x.provider||x.name)==='deepseek');const list=prov?.entries||prov?.credentials||[];const i=list.findIndex(e=>(e.label||'')==='actions-check');must(i>=0,'not added: '+JSON.stringify(prov).slice(0,120));
 const id=list[i].index??list[i].id??i;await H('/credentials/pool/deepseek/'+id,{method:'DELETE'})});
await step('MODEL-03','Reasoning settings readable',async()=>{const c=await H('/config');must(c.agent&&'reasoning_effort' in c.agent,'no agent.reasoning_effort');return 'default '+c.agent.reasoning_effort});
await step('SYS-08','Checkpoints',async()=>{const c=await H('/ops/checkpoints');must(c,'none');return JSON.stringify(c).slice(0,60)});
await step('SYS-09','Shell hooks list',async()=>{const h=await H('/ops/hooks');must(Array.isArray(h.hooks),'no hooks array')});
await step('SYS-10','Curator: pause, resume',async()=>{const c=await H('/curator');const was=!!c.paused;await H('/curator/paused',{method:'PUT',body:{paused:!was}});await H('/curator/paused',{method:'PUT',body:{paused:was}})});
await step('SYS-13','Gateway migration plan',async()=>{const p=await H('/gateway/migrate/plan');must(p,'none');return JSON.stringify(p).slice(0,80)});

for(const [id,u] of [['SYS-07','/ops/doctor'],['SYS-07','/ops/security-audit'],['SYS-07','/ops/prompt-size']])
 await step(id,'Run '+u,async()=>{const r=await H(u,{method:'POST'});if(!r?.name)return 'done at once';const s=await follow(r.name);must((s.lines||[]).length,'no output');return 'finished, exit '+s.exit_code+' (1 = it found things to report)'});
await step('SYS-06','Gateway status',async()=>{const s=await H('/status');must('gateway_running' in s,'no gateway_running');return 'running '+s.gateway_running});
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
