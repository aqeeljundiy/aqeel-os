// Write-parity check: creates a throwaway agent "parity-test", runs every create/edit/delete action the
// aqeelOS UI uses against it, checks on disk where each write landed, then removes everything.
// Run on the box: node --env-file ~/.hermes/.env parity-write.mjs
import {existsSync,readFileSync} from 'node:fs';
const HOME=process.env.HOME,P='parity-test',PDIR=HOME+'/.hermes/profiles/'+P,DEF=HOME+'/.hermes';
const TOK=process.env.HERMES_DASHBOARD_SESSION_TOKEN,GK=process.env.API_SERVER_KEY;
const res=[];
async function call(base,hdr,path,{method='GET',body}={}){
 const o={method,headers:{...hdr}};
 if(body instanceof FormData)o.body=body;else if(body!==undefined){o.body=JSON.stringify(body);o.headers['content-type']='application/json'}
 const r=await fetch(base+path,o);const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}
 if(!r.ok)throw new Error(r.status+' '+String(t).slice(0,200));return j}
const H=(p,o)=>call('http://127.0.0.1:9119/api',{'X-Hermes-Session-Token':TOK},p+(p.includes('profile=')||p.startsWith('/profiles')?'':(p.includes('?')?'&':'?')+'profile='+P),o);
const HD=(p,o)=>call('http://127.0.0.1:9119/api',{'X-Hermes-Session-Token':TOK},p,o); // no profile
const G=(p,o)=>call('http://127.0.0.1:8642/p/'+P,{authorization:'Bearer '+GK},p,o);
async function step(name,fn){try{const note=await fn();res.push(['PASS',name,note||''])}catch(e){res.push(['FAIL',name,e.message])}}
const has=(f,s)=>existsSync(f)&&readFileSync(f,'utf8').includes(s);
const must=(c,m)=>{if(!c)throw new Error(m)};

await step('Create agent',async()=>{await HD('/profiles',{method:'POST',body:{name:P,description:'temporary parity test',clone_from_default:false,clone_all:false,no_skills:true}});must(existsSync(PDIR),'folder not created')});
await step('Auto-setup new agent (aqeelOS)',async()=>{const pw=readFileSync('/tmp/box-test.pw','utf8').trim();
 const l=await fetch('http://127.0.0.1:4401/auth/login',{method:'POST',headers:{'content-type':'application/json','x-hui':'1'},body:JSON.stringify({password:pw})});
 const ck=(l.headers.get('set-cookie')||'').split(';')[0];must(ck,'no cookie');
 const s=await fetch('http://127.0.0.1:4401/ui/accounts/setup-agent',{method:'POST',headers:{'content-type':'application/json','x-hui':'1',cookie:ck},body:JSON.stringify({name:P})});
 const j=await s.json();must(s.ok,JSON.stringify(j));return (j.done||[]).join(',')});
await step('Edit description',async()=>{await HD('/profiles/'+P+'/description',{method:'PUT',body:{description:'parity desc'}});const l=await HD('/profiles');const me=(l.profiles||l).find(x=>x.name===P);must(me&&JSON.stringify(me).includes('parity desc'),'not saved')});
await step('Edit SOUL',async()=>{await HD('/profiles/'+P+'/soul',{method:'PUT',body:{content:'# parity soul\nPARITY_SOUL_MARK'}});must(has(PDIR+'/SOUL.md','PARITY_SOUL_MARK'),'SOUL.md unchanged');must(!has(DEF+'/SOUL.md','PARITY_SOUL_MARK'),'leaked into main')});
await step('Set key',async()=>{await H('/env',{method:'PUT',body:{key:'PARITY_TEST_KEY',value:'abc123'}});must(has(PDIR+'/.env','PARITY_TEST_KEY'),'not in agent .env');must(!has(DEF+'/.env','PARITY_TEST_KEY'),'leaked into main .env')});
await step('Reveal key',async()=>{const r=await H('/env/reveal',{method:'POST',body:{key:'PARITY_TEST_KEY'}});must(JSON.stringify(r).includes('abc123'),'wrong value')});
await step('Delete key',async()=>{await H('/env',{method:'DELETE',body:{key:'PARITY_TEST_KEY'}});must(!has(PDIR+'/.env','PARITY_TEST_KEY'),'still there')});
await step('Edit settings (config)',async()=>{const c=await H('/config');c.agent=c.agent||{};c.agent.reasoning_effort='low';await H('/config',{method:'PUT',body:{config:c}});must(/reasoning_effort:\s*low/.test(readFileSync(PDIR+'/config.yaml','utf8')),'not in agent config')});
await step('Edit raw config',async()=>{const r=await H('/config/raw');const y=(r.yaml_text??r.yaml??r.content??r.raw);must(typeof y==='string','no raw yaml: '+Object.keys(r));must(/reasoning_effort:\s*low/.test(y),'raw yaml is not the agent config');const pr=await H('/config/raw',{method:'PUT',body:{yaml_text:y.replace(/reasoning_effort:\s*low/,'reasoning_effort: high')}});must(/reasoning_effort:\s*high/.test(readFileSync(PDIR+'/config.yaml','utf8')),'not saved: '+JSON.stringify(pr).slice(0,120))});
await step('Set model',async()=>{const r=await H('/model/set',{method:'POST',body:{scope:'main',provider:'claude-subscription-directsdk-experimental',model:'sonnet',confirm_expensive_model:true}});return JSON.stringify(r).slice(0,80)});
await step('Create skill',async()=>{await H('/skills',{method:'POST',body:{name:'parity-skill',content:'---\nname: parity-skill\ndescription: parity test\n---\nPARITY_SKILL'}});const l=await H('/skills');must(JSON.stringify(l).includes('parity-skill'),'not listed');must(!existsSync(DEF+'/skills/parity-skill'),'landed in main skills')});
await step('Edit skill',async()=>{await H('/skills/content',{method:'PUT',body:{name:'parity-skill',content:'---\nname: parity-skill\ndescription: parity test 2\n---\nPARITY_SKILL_2'}})});
await step('Toggle skill',async()=>{await H('/skills/toggle',{method:'PUT',body:{name:'parity-skill',enabled:false}});await H('/skills/toggle',{method:'PUT',body:{name:'parity-skill',enabled:true}})});
await step('Add MCP server',async()=>{await H('/mcp/servers',{method:'POST',body:{name:'parity-mcp',command:'echo',args:['hi'],env:{}}});must(has(PDIR+'/config.yaml','parity-mcp'),'not in agent config');must(!has(DEF+'/config.yaml','parity-mcp'),'leaked into main')});
await step('Toggle MCP server',async()=>{await H('/mcp/servers/parity-mcp/enabled',{method:'PUT',body:{enabled:false}})});
await step('Remove MCP server',async()=>{await H('/mcp/servers/parity-mcp',{method:'DELETE'});must(!has(PDIR+'/config.yaml','parity-mcp'),'still there')});
await step('Toggle toolset',async()=>{const t=await H('/tools/toolsets');const list=t.toolsets||t;const ts=list.find(x=>x.name==='web')||list[0];await H('/tools/toolsets/'+encodeURIComponent(ts.name),{method:'PUT',body:{enabled:!ts.enabled}});await H('/tools/toolsets/'+encodeURIComponent(ts.name),{method:'PUT',body:{enabled:ts.enabled}});return ts.name});
let job;
await step('Create schedule',async()=>{const r=await H('/cron/jobs?profile='+P,{method:'POST',body:{name:'parity job',prompt:'say hi',schedule:'0 3 1 1 *',deliver:'local'}});job=r.job||r;must(job.id,'no id');await H('/cron/jobs/'+job.id+'/pause?profile='+P,{method:'POST'})});
await step('Edit schedule',async()=>{await H('/cron/jobs/'+job.id+'?profile='+P,{method:'PUT',body:{updates:{name:'parity job 2'}}})});
await step('Resume/pause schedule',async()=>{await H('/cron/jobs/'+job.id+'/resume?profile='+P,{method:'POST'});await H('/cron/jobs/'+job.id+'/pause?profile='+P,{method:'POST'})});
await step('Delete schedule',async()=>{await H('/cron/jobs/'+job.id+'?profile='+P,{method:'DELETE'})});
await step('Create webhook',async()=>{await H('/webhooks',{method:'POST',body:{name:'parity-hook',description:'',events:['push'],deliver_only:false,prompt:'x'}});await H('/webhooks/parity-hook',{method:'DELETE'})});
await step('Files: folder, upload, delete',async()=>{const d=HOME+'/parity-test-dir';await H('/files/mkdir',{method:'POST',body:{path:d}});const fd=new FormData();fd.append('path',d+'/a.txt');fd.append('overwrite','true');fd.append('file',new Blob(['PARITY']),'a.txt');await H('/files/upload-stream',{method:'POST',body:fd});must(has(d+'/a.txt','PARITY'),'upload missing');await H('/files',{method:'DELETE',body:{path:d,recursive:true}});must(!existsSync(d),'not deleted')});
let sid;
await step('Chat: create session (agent route)',async()=>{const r=await G('/api/sessions',{method:'POST',body:{title:'parity'}});sid=r.id||r.session?.id||r.session_id;must(sid,'no id: '+JSON.stringify(r).slice(0,120))});
await step('Chat: delete session',async()=>{await H('/sessions/'+encodeURIComponent(sid),{method:'DELETE'})});
await step('Memory: reset agent memory',async()=>{await H('/memory/reset',{method:'POST',body:{target:'all'}})});
await step('Delete agent',async()=>{await HD('/profiles/'+P,{method:'DELETE'});must(!existsSync(PDIR),'folder still there')});
// safety: make sure nothing stayed in the main agent
for(const [f,s] of [[DEF+'/.env','PARITY_'],[DEF+'/config.yaml','parity-'],[DEF+'/config.yaml','PARITY_'],[DEF+'/SOUL.md','PARITY_']])if(has(f,s))res.push(['LEAK',f,s]);
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
