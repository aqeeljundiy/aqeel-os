// Permission check for People: owner signs in, invites a member, the member joins, and every allow/deny
// rule is exercised. Run on the box against a test copy: node scripts/people-check.mjs [base] [password file]
import {readFileSync} from 'node:fs';
import {homedir as __hd} from 'node:os';const H=__hd();
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const AGENT='pc-'+Date.now().toString(36).slice(-5);   // a throwaway agent, made and removed by this check
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};
async function call(ck,path,{method='GET',body,raw,type}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined){h['content-type']='application/json'}if(type)h['content-type']=type;
 const r=await fetch(BASE+path,{method,headers:h,body:raw??(body!==undefined?JSON.stringify(body):undefined),redirect:'manual'});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,ck:(r.headers.get('set-cookie')||'').split(';')[0]}}
let owner,member,code,sid,uid,home;
await step('Owner signs in with password only',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{password:PW}});must(r.s===200&&r.ck,'status '+r.s);owner=r.ck});
await step('Throwaway agent to share',async()=>{const r=await call(owner,'/hapi/profiles',{method:'POST',body:{name:AGENT,clone_from_default:false,no_skills:true}});must(r.s<300,'status '+r.s);await new Promise(x=>setTimeout(x,8000))});
await step('Owner is owner',async()=>{const r=await call(owner,'/ui/me');must(r.j.role==='owner'&&r.j.admin,JSON.stringify(r.j))});
await step('Wrong password refused',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{password:'nope'}});must(r.s===401,'status '+r.s)});
await step('Invite a member with one agent',async()=>{const r=await call(owner,'/ui/people/invite',{method:'POST',body:{name:'Test Member',role:'member',agents:{[AGENT]:'chat'}}});must(r.s===200&&r.j.code,JSON.stringify(r.j));code=r.j.code});
await step('Invite link shows the name',async()=>{const r=await call(null,'/auth/invite?code='+code);must(r.s===200&&r.j.name==='Test Member',JSON.stringify(r.j))});
await step('Short password refused',async()=>{const r=await call(null,'/auth/accept',{method:'POST',body:{code,name:'Test Member',password:'short'}});must(r.s===400,'status '+r.s)});
await step('Member joins',async()=>{const r=await call(null,'/auth/accept',{method:'POST',body:{code,name:'Test Member',password:'family-pass-123'}});must(r.s===200&&r.ck,JSON.stringify(r.j));member=r.ck});
await step('Invite link works only once',async()=>{const r=await call(null,'/auth/accept',{method:'POST',body:{code,name:'Other',password:'family-pass-123'}});must(r.s===400,'status '+r.s)});
await step('Member signs in with name + password',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{name:'test member',password:'family-pass-123'}});must(r.s===200,'status '+r.s)});
await step('Member is member',async()=>{const r=await call(member,'/ui/me');must(r.j.role==='member'&&!r.j.admin&&r.j.agents[AGENT]==='chat',JSON.stringify(r.j));uid=r.j.id;home=r.j.home});
// every person also gets their own lead agent (workstream F), made in the background when they join
// only the live app makes lead agents (app/server.mjs users.hooks.onJoin, 7 Nov 2026): a test copy shares the live engine, so
// there the check is that NO lead is made (13 Nov 2026: this step waited 2 minutes for one and then failed four more steps)
const LIVE=!!(await call(owner,'/ui/install')).j?.live?.on;
let lead=null;if(!LIVE)await step('Member gets no lead agent on a test copy (only the live app makes them)',async()=>{await new Promise(x=>setTimeout(x,4000));const l=((await call(owner,'/ui/people')).j.users||[]).find(x=>x.name==='Test Member')?.lead||null;must(!l,'a test copy made a real agent: '+l)});
else await step('Member gets a lead agent',async()=>{for(let i=0;i<40&&!lead;i++){await new Promise(x=>setTimeout(x,3000));lead=((await call(owner,'/ui/people')).j.users||[]).find(x=>x.username===(member&&'test.member')||x.name==='Test Member')?.lead||null}must(lead,'no lead');return lead});
await step('Member sees only the shared agent'+(lead?' and their lead':''),async()=>{const r=await call(member,'/hapi/profiles');const n=(r.j.profiles||[]).map(p=>p.name).sort();must(n.length===(lead?2:1)&&n.includes(AGENT)&&(!lead||n.includes(lead)),n.join(','))});
for(const [n,p] of [['config','/hapi/config'],['keys','/hapi/env'],['skills','/hapi/skills'],['cron','/hapi/cron/jobs'],['logs','/hapi/logs'],['accounts','/ui/accounts'],['people','/ui/people'],['main agent chat models','/gapi/api/model/options'],['other agent via profile','/hapi/sessions?profile=default']])
 await step('Member blocked: '+n,async()=>{const r=await call(member,p);must(r.s===403,'status '+r.s)});
await step('Member blocked: backlog board',async()=>{const r=await call(member,'/backlog');must(r.s===302,'status '+r.s)});
await step('Member can load models of shared agent',async()=>{const r=await call(member,'/gapi/p/'+AGENT+'/api/model/options');must(r.s===200,'status '+r.s)});
await step('Member starts a chat',async()=>{const r=await call(member,'/gapi/p/'+AGENT+'/api/sessions',{method:'POST',body:{title:'people-check'}});sid=r.j.id||r.j.session?.id||r.j.session_id;must(r.s<300&&sid,JSON.stringify(r.j).slice(0,160))});
await step('Member sees own chat',async()=>{const r=await call(member,'/hapi/sessions?profile='+AGENT+'&limit=50');must((r.j.sessions||[]).some(s=>s.id===sid),'not listed')});
/* Chats (the owner's rule of 9-10 Nov 2026; 13 Nov: Team view off also closes the owner's direct opening): a member sees only
   their own; an admin reads members' chats, marked and read-only, never another admin's; the owner reads as an admin does,
   and with Team view on everyone's. Nobody but the person who started a chat can write in it, rename it or delete it.
   (Until 13 Nov this step expected the owner never to see a member's chat, the rule of 16 Oct, and "Member cannot open
   owner chat" tried the first chat of the owner's list, which with Team view on was the member's own.) */
const teamView=!!(await call(owner,'/ui/install')).j?.supervision?.on;const setTV=on=>call(owner,'/ui/install/supervision',{method:'POST',body:{on}});
let osid,admin,aid,asid;
await step('Owner starts a chat of their own',async()=>{const r=await call(owner,'/gapi/p/'+AGENT+'/api/sessions',{method:'POST',body:{title:'people-check owner'}});osid=r.j.id||r.j.session?.id||r.j.session_id;must(r.s<300&&osid,JSON.stringify(r.j).slice(0,160))});
await step("Member cannot open the owner's chat",async()=>{const r=await call(member,'/hapi/sessions/'+encodeURIComponent(osid)+'?profile='+AGENT);must(r.s===403,'status '+r.s)});
await step("Member does not list the owner's chat",async()=>{const r=await call(member,'/hapi/sessions?profile='+AGENT+'&limit=200');must(!(r.j.sessions||[]).some(s=>s.id===osid),'listed')});
await step('An admin joins and starts a chat',async()=>{const i=await call(owner,'/ui/people/invite',{method:'POST',body:{name:'Test Admin',role:'admin'}});const a=await call(null,'/auth/accept',{method:'POST',body:{code:i.j.code,name:'Test Admin',password:'admin-pass-1234'}});must(a.s===200&&a.ck,JSON.stringify(a.j).slice(0,120));admin=a.ck;aid=(await call(admin,'/ui/me')).j.id;
 const r=await call(admin,'/gapi/p/'+AGENT+'/api/sessions',{method:'POST',body:{title:'people-check admin'}});asid=r.j.id||r.j.session?.id||r.j.session_id;must(r.s<300&&asid,JSON.stringify(r.j).slice(0,160))});
await step("Admin reads the member's chat, marked, but cannot change it",async()=>{const l=await call(admin,'/hapi/sessions?profile='+AGENT+'&limit=200');const x=(l.j.sessions||[]).find(s=>s.id===sid);must(x&&x.person==='Test Member',JSON.stringify(x||'not listed'));
 must((await call(admin,'/hapi/sessions/'+encodeURIComponent(sid)+'?profile='+AGENT)).s===200,'cannot open');const d=await call(admin,'/gapi/p/'+AGENT+'/api/sessions/'+encodeURIComponent(sid),{method:'DELETE'});must(d.s===403,'delete answered '+d.s)});
await step("Admin cannot open or list the owner's chat",async()=>{must((await call(admin,'/hapi/sessions/'+encodeURIComponent(osid)+'?profile='+AGENT)).s===403,'opened');must(!((await call(admin,'/hapi/sessions?profile='+AGENT+'&limit=200')).j.sessions||[]).some(s=>s.id===osid),'listed')});
await step("Team view off: the owner cannot open or list an admin's chat",async()=>{await setTV(false);const g=await call(owner,'/hapi/sessions/'+encodeURIComponent(asid)+'?profile='+AGENT);must(g.s===403,'opened, status '+g.s);must(!((await call(owner,'/hapi/sessions?profile='+AGENT+'&limit=200')).j.sessions||[]).some(s=>s.id===asid),'listed')});
await step("Team view off: the owner reads the member's chat as an admin does, and cannot change it",async()=>{const l=await call(owner,'/hapi/sessions?profile='+AGENT+'&limit=200');must((l.j.sessions||[]).find(s=>s.id===sid)?.person==='Test Member','not listed, marked');const d=await call(owner,'/gapi/p/'+AGENT+'/api/sessions/'+encodeURIComponent(sid),{method:'DELETE'});must(d.s===403,'delete answered '+d.s)});
await step("Team view on: the owner reads the admin's chat, and cannot change it",async()=>{await setTV(true);must((await call(owner,'/hapi/sessions/'+encodeURIComponent(asid)+'?profile='+AGENT)).s===200,'cannot open');const d=await call(owner,'/gapi/p/'+AGENT+'/api/sessions/'+encodeURIComponent(asid),{method:'DELETE'});must(d.s===403,'delete answered '+d.s);await setTV(teamView)});
await step('Member still sees their own chat',async()=>{const r=await call(member,'/hapi/sessions?profile='+AGENT+'&limit=50');must((r.j.sessions||[]).some(s=>s.id===sid),'not listed')});
await step('Member files: own folder ok',async()=>{const r=await call(member,'/hapi/files?path='+encodeURIComponent(home));must(r.s===200,'status '+r.s+' '+JSON.stringify(r.j).slice(0,100))});
await step('Member files: box home blocked',async()=>{const r=await call(member,`/hapi/files?path=${H}`);must(r.s===403,'status '+r.s)});
await step('Member files: sneaky ../ blocked',async()=>{const r=await call(member,'/hapi/files/read?path='+encodeURIComponent(home+'/../../.hermes/.env'));must(r.s===403,'status '+r.s)});
await step('Member files: mkdir outside blocked',async()=>{const r=await call(member,'/hapi/files/mkdir',{method:'POST',body:{path:`${H}/evil`}});must(r.s===403,'status '+r.s)});
await step('Member files: upload inside works',async()=>{const fd=new FormData();fd.append('path',home+'/hello.txt');fd.append('overwrite','true');fd.append('file',new Blob([Buffer.from([0,1,2,255,254])]),'hello.txt');
 const r=await fetch(BASE+'/hapi/files/upload-stream',{method:'POST',headers:{'x-hui':'1',cookie:member},body:fd});must(r.ok,'status '+r.status)});
await step('Member files: upload outside blocked',async()=>{const fd=new FormData();fd.append('path',`${H}/evil.txt`);fd.append('file',new Blob(['x']),'evil.txt');
 const r=await fetch(BASE+'/hapi/files/upload-stream',{method:'POST',headers:{'x-hui':'1',cookie:member},body:fd});must(r.status===403,'status '+r.status)});
await step('Member cannot edit chat-only agent',async()=>{const r=await call(member,'/hapi/profiles/'+AGENT+'/soul',{method:'PUT',body:{content:'x'}});must(r.s===403,'status '+r.s)});
await step('Owner sees member on People',async()=>{const r=await call(owner,'/ui/people');must((r.j.users||[]).some(u=>u.id===uid),'missing')});
// clean up
// the test chat is deleted where it was made (the gateway)
await step('Clean up: delete test chat',async()=>{const r=await call(member,'/gapi/p/'+AGENT+'/api/sessions/'+encodeURIComponent(sid),{method:'DELETE'});must(r.s<300,'status '+r.s+' '+JSON.stringify(r.j).slice(0,200))});
await step('Clean up: delete test file',async()=>{const r=await call(owner,'/hapi/files',{method:'DELETE',body:{path:home,recursive:true}});must(r.s<300,'status '+r.s)});
await step("Clean up: the owner's and the admin's test chats",async()=>{await setTV(teamView);const a=await call(owner,'/gapi/p/'+AGENT+'/api/sessions/'+encodeURIComponent(osid),{method:'DELETE'});const b=asid?await call(admin,'/gapi/p/'+AGENT+'/api/sessions/'+encodeURIComponent(asid),{method:'DELETE'}):{s:200};must(a.s<300&&b.s<300,'status '+a.s+' '+b.s)});
await step('Clean up: remove the test admin',async()=>{if(!aid)return 'none';let r=await call(owner,'/ui/people/'+aid,{method:'DELETE'});if(r.s===409)r=await call(owner,'/ui/people/'+aid+'?agents=take',{method:'DELETE'});must(r.s===200,'status '+r.s)});
if(lead){await step('Clean up: remove member (their lead stays private until taken over)',async()=>{const r=await call(owner,'/ui/people/'+uid,{method:'DELETE'});must(r.s===409&&r.j.agents?.includes(lead),'status '+r.s);const t=await call(owner,'/ui/people/'+uid+'?agents=take',{method:'DELETE'});must(t.s===200,'status '+t.s)});
 await step('Clean up: remove their lead agent',async()=>{const r=await call(owner,'/hapi/profiles/'+lead,{method:'DELETE'});must(r.s<300,'status '+r.s)})}
else await step('Clean up: remove member',async()=>{const r=await call(owner,'/ui/people/'+uid,{method:'DELETE'});must(r.s===200,'status '+r.s+' '+JSON.stringify(r.j).slice(0,120))});
await step('Removed member is signed out',async()=>{const r=await call(member,'/ui/me');must(r.s===401,'status '+r.s+' '+JSON.stringify(r.j).slice(0,200))});
await step('Clean up: remove throwaway agent',async()=>{const r=await call(owner,'/hapi/profiles/'+AGENT,{method:'DELETE'});must(r.s<300,'status '+r.s)});
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
