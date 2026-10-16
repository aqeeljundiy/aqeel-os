// Roles check: roles carry permissions, models, limits and an agent cap; changing a person's role changes
// what they can do at once. Run on the box against a test copy: node scripts/roles-check.mjs [base] [pw file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const T=Date.now().toString(36);
async function call(ck,path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,t,ck:(r.headers.get('set-cookie')||'').split(';')[0]}}
let owner,m,mid,roleId,haiku;const made=[];
await step('Owner sees the two starting roles',async()=>{owner=(await call(null,'/auth/login',{method:'POST',body:{password:PW}})).ck;const r=await call(owner,'/ui/people');must(r.j.roles?.member&&r.j.roles?.creator,JSON.stringify(Object.keys(r.j.roles||{})))});
await step('Create a role: chat only, Haiku only',async()=>{const o=await call(owner,'/gapi/api/model/options');const pv=o.j.providers.find(p=>/claude-subscription/.test(p.slug));haiku=pv.slug+'|'+pv.models.find(x=>/haiku/.test(x));
 const r=await call(owner,'/ui/roles',{method:'POST',body:{name:'Family '+T,caps:[],models:[haiku],maxAgents:0}});roleId=r.j.id;must(roleId,r.t)});
await step('Invite someone with that role',async()=>{const i=await call(owner,'/ui/people/invite',{method:'POST',body:{name:'Role Test',role:'member',roleId,agents:{default:'chat'}}});const a=await call(null,'/auth/accept',{method:'POST',body:{code:i.j.code,name:'Role Test',password:'family-pass-123'}});m=a.ck;mid=(await call(m,'/ui/me')).j.id;must(m,'no cookie')});
await step('They only see Haiku',async()=>{const o=await call(m,'/gapi/api/model/options');const all=o.j.providers.flatMap(p=>p.models);must(all.length===1&&/haiku/.test(all[0]),all.join(','))});
await step('They cannot create agents',async()=>{const r=await call(m,'/hapi/profiles',{method:'POST',body:{name:'role-'+T}});must(r.s===403,'status '+r.s)});
await step('Change their role to Creator',async()=>{const r=await call(owner,'/ui/people/'+mid,{method:'PATCH',body:{roleId:'creator'}});must(r.s===200,r.t);const me=await call(m,'/ui/me');must(me.j.caps.includes('create')&&me.j.role_name==='Creator',JSON.stringify(me.j.caps))});
await step('Now they see every model',async()=>{const o=await call(m,'/gapi/api/model/options');must(o.j.providers.flatMap(p=>p.models).length>1,'still limited')});
await step('Set Creator to at most 1 agent',async()=>{const r=await call(owner,'/ui/roles/creator',{method:'PUT',body:{maxAgents:1}});must(r.s===200,r.t)});
await step('First agent is allowed',async()=>{const n='role-a-'+T;const r=await call(m,'/hapi/profiles',{method:'POST',body:{name:n}});must(r.s<300,'status '+r.s);made.push(n)});
await step('Second agent is refused',async()=>{const r=await call(m,'/hapi/profiles',{method:'POST',body:{name:'role-b-'+T}});must(r.s===403&&/limit/.test(r.t),'status '+r.s+' '+r.t.slice(0,80))});
await step('A role in use cannot be deleted',async()=>{const r=await call(owner,'/ui/roles/creator',{method:'DELETE'});must(r.s===409,'status '+r.s)});
await step('An unused role can be deleted',async()=>{const r=await call(owner,'/ui/roles/'+roleId,{method:'DELETE'});must(r.s===200,r.t)});
await step('Clean up',async()=>{for(const n of made)await call(m,'/hapi/profiles/'+n,{method:'DELETE'});await call(owner,'/ui/roles/creator',{method:'PUT',body:{maxAgents:5}});await call(owner,'/ui/people/'+mid,{method:'DELETE'})});
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
