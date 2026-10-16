// Permission check for People: owner signs in, invites a member, the member joins, and every allow/deny
// rule is exercised. Run on the box against a test copy: node scripts/people-check.mjs [base] [password file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const AGENT='facebook-manager';
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};
async function call(ck,path,{method='GET',body,raw,type}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined){h['content-type']='application/json'}if(type)h['content-type']=type;
 const r=await fetch(BASE+path,{method,headers:h,body:raw??(body!==undefined?JSON.stringify(body):undefined),redirect:'manual'});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,ck:(r.headers.get('set-cookie')||'').split(';')[0]}}
let owner,member,code,sid,uid,home;
await step('Owner signs in with password only',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{password:PW}});must(r.s===200&&r.ck,'status '+r.s);owner=r.ck});
await step('Owner is owner',async()=>{const r=await call(owner,'/ui/me');must(r.j.role==='owner'&&r.j.admin,JSON.stringify(r.j))});
await step('Wrong password refused',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{password:'nope'}});must(r.s===401,'status '+r.s)});
await step('Invite a member with one agent',async()=>{const r=await call(owner,'/ui/people/invite',{method:'POST',body:{name:'Test Member',role:'member',agents:{[AGENT]:'chat'}}});must(r.s===200&&r.j.code,JSON.stringify(r.j));code=r.j.code});
await step('Invite link shows the name',async()=>{const r=await call(null,'/auth/invite?code='+code);must(r.s===200&&r.j.name==='Test Member',JSON.stringify(r.j))});
await step('Short password refused',async()=>{const r=await call(null,'/auth/accept',{method:'POST',body:{code,name:'Test Member',password:'short'}});must(r.s===400,'status '+r.s)});
await step('Member joins',async()=>{const r=await call(null,'/auth/accept',{method:'POST',body:{code,name:'Test Member',password:'family-pass-123'}});must(r.s===200&&r.ck,JSON.stringify(r.j));member=r.ck});
await step('Invite link works only once',async()=>{const r=await call(null,'/auth/accept',{method:'POST',body:{code,name:'Other',password:'family-pass-123'}});must(r.s===400,'status '+r.s)});
await step('Member signs in with name + password',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{name:'test member',password:'family-pass-123'}});must(r.s===200,'status '+r.s)});
await step('Member is member',async()=>{const r=await call(member,'/ui/me');must(r.j.role==='member'&&!r.j.admin&&r.j.agents[AGENT]==='chat',JSON.stringify(r.j));uid=r.j.id;home=r.j.home});
await step('Member sees only the shared agent',async()=>{const r=await call(member,'/hapi/profiles');const n=(r.j.profiles||[]).map(p=>p.name);must(n.length===1&&n[0]===AGENT,n.join(','))});
for(const [n,p] of [['config','/hapi/config'],['keys','/hapi/env'],['skills','/hapi/skills'],['cron','/hapi/cron/jobs'],['logs','/hapi/logs'],['accounts','/ui/accounts'],['people','/ui/people'],['main agent chat models','/gapi/api/model/options'],['other agent via profile','/hapi/sessions?profile=default']])
 await step('Member blocked: '+n,async()=>{const r=await call(member,p);must(r.s===403,'status '+r.s)});
await step('Member blocked: backlog board',async()=>{const r=await call(member,'/backlog');must(r.s===302,'status '+r.s)});
await step('Member can load models of shared agent',async()=>{const r=await call(member,'/gapi/p/'+AGENT+'/api/model/options');must(r.s===200,'status '+r.s)});
await step('Member starts a chat',async()=>{const r=await call(member,'/gapi/p/'+AGENT+'/api/sessions',{method:'POST',body:{title:'people-check'}});sid=r.j.id||r.j.session?.id||r.j.session_id;must(r.s<300&&sid,JSON.stringify(r.j).slice(0,160))});
await step('Member sees own chat',async()=>{const r=await call(member,'/hapi/sessions?profile='+AGENT+'&limit=50');must((r.j.sessions||[]).some(s=>s.id===sid),'not listed')});
await step('Owner does not see member chat',async()=>{const r=await call(owner,'/hapi/sessions?profile='+AGENT+'&limit=200');must(!(r.j.sessions||[]).some(s=>s.id===sid),'owner sees it');return (r.j.sessions||[]).length+' owner chats listed'});
await step('Member cannot open owner chat',async()=>{const o=await call(owner,'/hapi/sessions?profile='+AGENT+'&limit=5');const other=(o.j.sessions||[])[0];if(!other)return 'no owner chat to try';const r=await call(member,'/hapi/sessions/'+encodeURIComponent(other.id)+'?profile='+AGENT);must(r.s===403,'status '+r.s)});
await step('Member files: own folder ok',async()=>{const r=await call(member,'/hapi/files?path='+encodeURIComponent(home));must(r.s===200,'status '+r.s+' '+JSON.stringify(r.j).slice(0,100))});
await step('Member files: box home blocked',async()=>{const r=await call(member,'/hapi/files?path=/home/claude');must(r.s===403,'status '+r.s)});
await step('Member files: sneaky ../ blocked',async()=>{const r=await call(member,'/hapi/files/read?path='+encodeURIComponent(home+'/../../.hermes/.env'));must(r.s===403,'status '+r.s)});
await step('Member files: mkdir outside blocked',async()=>{const r=await call(member,'/hapi/files/mkdir',{method:'POST',body:{path:'/home/claude/evil'}});must(r.s===403,'status '+r.s)});
await step('Member files: upload inside works',async()=>{const fd=new FormData();fd.append('path',home+'/hello.txt');fd.append('overwrite','true');fd.append('file',new Blob([Buffer.from([0,1,2,255,254])]),'hello.txt');
 const r=await fetch(BASE+'/hapi/files/upload-stream',{method:'POST',headers:{'x-hui':'1',cookie:member},body:fd});must(r.ok,'status '+r.status)});
await step('Member files: upload outside blocked',async()=>{const fd=new FormData();fd.append('path','/home/claude/evil.txt');fd.append('file',new Blob(['x']),'evil.txt');
 const r=await fetch(BASE+'/hapi/files/upload-stream',{method:'POST',headers:{'x-hui':'1',cookie:member},body:fd});must(r.status===403,'status '+r.status)});
await step('Member cannot edit chat-only agent',async()=>{const r=await call(member,'/hapi/profiles/'+AGENT+'/soul',{method:'PUT',body:{content:'x'}});must(r.s===403,'status '+r.s)});
await step('Owner sees member on People',async()=>{const r=await call(owner,'/ui/people');must((r.j.users||[]).some(u=>u.id===uid),'missing')});
// clean up
await step('Clean up: delete test chat',async()=>{const r=await call(member,'/hapi/sessions/'+encodeURIComponent(sid)+'?profile='+AGENT,{method:'DELETE'});must(r.s<300,'status '+r.s)});
await step('Clean up: delete test file',async()=>{const r=await call(owner,'/hapi/files',{method:'DELETE',body:{path:home,recursive:true}});must(r.s<300,'status '+r.s)});
await step('Clean up: remove member',async()=>{const r=await call(owner,'/ui/people/'+uid,{method:'DELETE'});must(r.s===200,'status '+r.s)});
await step('Removed member is signed out',async()=>{const r=await call(member,'/ui/me');must(r.s===401,'status '+r.s)});
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
