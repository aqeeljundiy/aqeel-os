// Permission check for the Creator level: a member allowed to build agents makes their own agent and
// works on it, but can't reach the main agent, unsafe tools or command-run MCP servers.
// Run on the box against a test copy: node scripts/creator-check.mjs [base] [owner password file]
import {readFileSync,existsSync} from 'node:fs';import {homedir} from 'node:os';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const env=Object.fromEntries(readFileSync(homedir()+'/.hermes/.env','utf8').split('\n').map(l=>l.split('=')).filter(x=>/^[A-Z_][A-Z0-9_]*$/.test(x[0]||'')&&x.length>1).map(([k,...v])=>[k.trim(),v.join('=').trim()]));
const DASH='http://127.0.0.1:9119/api',DT={'x-hermes-session-token':env.HERMES_DASHBOARD_SESSION_TOKEN};
const AG='creator-test-'+Date.now().toString(36);
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};
async function call(ck,path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,ck:(r.headers.get('set-cookie')||'').split(';')[0]}}
let owner,cr,mem,crId,memId,jobId;
await step('Owner signs in',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{password:PW}});must(r.s===200,'status '+r.s);owner=r.ck});
await step('Invite a creator and a chat-only member',async()=>{
 const p=await call(owner,'/ui/people');const caps=p.j.presets.creator;
 for(const [n,c,set] of [['Test Creator',caps,v=>cr=v],['Test Chatter',[],v=>mem=v]]){const i=await call(owner,'/ui/people/invite',{method:'POST',body:{name:n,role:'member',caps:c,agents:{}}});
  const a=await call(null,'/auth/accept',{method:'POST',body:{code:i.j.code,name:n,password:'family-pass-123'}});must(a.s===200,JSON.stringify(a.j));set(a.ck)}});
await step('Creator has the creator permissions',async()=>{const r=await call(cr,'/ui/me');crId=r.j.id;must(r.j.caps.includes('create')&&!r.j.caps.includes('unsafe'),JSON.stringify(r.j.caps))});
await step('Chat-only member cannot create agents',async()=>{const m=await call(mem,'/ui/me');memId=m.j.id;const r=await call(mem,'/hapi/profiles',{method:'POST',body:{name:'nope-'+AG}});must(r.s===403,'status '+r.s)});
await step('Creator makes an agent (asks for a copy of main)',async()=>{const r=await call(cr,'/hapi/profiles',{method:'POST',body:{name:AG,clone_from_default:true,clone_all:true}});must(r.s<300,'status '+r.s+' '+JSON.stringify(r.j).slice(0,120))});
await step('…but it starts fresh, not a copy of main',async()=>{const e=homedir()+'/.hermes/profiles/'+AG+'/.env';const t=existsSync(e)?readFileSync(e,'utf8'):'';const leaked=Object.keys(env).filter(k=>k!=='API_SERVER_KEY'&&new RegExp('^'+k+'=','m').test(t));must(!leaked.length,'copied keys: '+leaked.join(','))});
await step('Creator owns the new agent',async()=>{const r=await call(cr,'/ui/me');must(r.j.agents[AG]==='owner',JSON.stringify(r.j.agents))});
await step('New agent can chat (plugin + gateway key)',async()=>{const r=await call(cr,'/gapi/p/'+AG+'/api/model/options');must(r.s===200&&(r.j.providers||[]).some(p=>p.authenticated&&/claude-subscription/.test(p.slug)),'status '+r.s)});
await step('Unsafe tools are off on it',async()=>{const t=await (await fetch(DASH+'/tools/toolsets?profile='+AG,{headers:DT})).json();const on=t.filter(x=>['terminal','file','code_execution','computer_use'].includes(x.name)&&x.enabled).map(x=>x.name);must(!on.length,'still on: '+on.join(','))});
await step('Creator edits its personality',async()=>{const r=await call(cr,'/hapi/profiles/'+AG+'/soul?profile='+AG,{method:'PUT',body:{content:'# test'}});must(r.s<300,'status '+r.s)});
await step('Creator adds a skill',async()=>{const r=await call(cr,'/hapi/skills?profile='+AG,{method:'POST',body:{name:'creator-skill',content:'---\nname: creator-skill\ndescription: t\n---\nx'}});must(r.s<300,'status '+r.s)});
await step('Creator blocked: MCP that runs a command',async()=>{const r=await call(cr,'/hapi/mcp/servers?profile='+AG,{method:'POST',body:{name:'cmd',command:'echo',args:['hi'],env:{}}});must(r.s===403,'status '+r.s)});
await step('Creator adds an MCP server by URL',async()=>{const r=await call(cr,'/hapi/mcp/servers?profile='+AG,{method:'POST',body:{name:'urlmcp',url:'https://example.com/mcp'}});must(r.s<300,'status '+r.s+' '+JSON.stringify(r.j).slice(0,100))});
await step('Creator blocked: turning the terminal on',async()=>{const r=await call(cr,'/hapi/tools/toolsets/terminal?profile='+AG,{method:'PUT',body:{enabled:true}});must(r.s===403,'status '+r.s)});
await step('Creator toggles a safe tool',async()=>{const r=await call(cr,'/hapi/tools/toolsets/web?profile='+AG,{method:'PUT',body:{enabled:true}});must(r.s<300,'status '+r.s)});
await step('Creator makes a schedule on its agent',async()=>{const r=await call(cr,'/hapi/cron/jobs?profile='+AG,{method:'POST',body:{name:'t',prompt:'say hi',schedule:'0 3 1 1 *',deliver:'local'}});jobId=(r.j.job||r.j).id;must(r.s<300&&jobId,'status '+r.s)});
await step('Creator blocked: schedule on the main agent',async()=>{const r=await call(cr,'/hapi/cron/jobs?profile=default',{method:'POST',body:{name:'t',prompt:'x',schedule:'0 3 1 1 *'}});must(r.s===403,'status '+r.s)});
await step('Creator sees only its own schedules',async()=>{const r=await call(cr,'/hapi/cron/jobs?profile=all');const jobs=Array.isArray(r.j)?r.j:r.j.jobs||[];must(jobs.every(j=>j.profile===AG),'sees others')});
await step('Creator blocked: main agent memory',async()=>{const r=await call(cr,'/hapi/memory?profile=default');must(r.s===403,'status '+r.s)});
await step('Creator blocked: keys and settings',async()=>{for(const p of ['/hapi/env?profile='+AG,'/hapi/config/raw?profile='+AG,'/ui/people','/hapi/plugins'])if((await call(cr,p)).s!==403)throw new Error(p)});
await step('Creator sees account usage',async()=>{const r=await call(cr,'/ui/accounts');must(r.s===200,'status '+r.s)});
await step('Chat-only member cannot see that agent',async()=>{const r=await call(mem,'/hapi/profiles');must(!(r.j.profiles||[]).some(p=>p.name===AG),'visible')});
await step('Clean up: schedule',async()=>{const r=await call(cr,'/hapi/cron/jobs/'+jobId+'?profile='+AG,{method:'DELETE'});must(r.s<300,'status '+r.s)});
await step('Creator deletes its own agent',async()=>{const r=await call(cr,'/hapi/profiles/'+AG,{method:'DELETE'});must(r.s<300,'status '+r.s+' '+JSON.stringify(r.j).slice(0,100))});
await step('Clean up: people',async()=>{for(const id of [crId,memId])await call(owner,'/ui/people/'+id,{method:'DELETE'})});
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
