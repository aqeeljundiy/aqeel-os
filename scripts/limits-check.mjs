// Models-per-person and daily-limit check, with one tiny real chat on Haiku. Uses a test copy.
// Run on the box: node scripts/limits-check.mjs [base] [owner password file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};
async function call(ck,path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,t,ck:(r.headers.get('set-cookie')||'').split(';')[0]}}
let owner,m,mid,sid,haiku,opus;
await step('Owner + member with the main agent shared',async()=>{owner=(await call(null,'/auth/login',{method:'POST',body:{password:PW}})).ck;
 const i=await call(owner,'/ui/people/invite',{method:'POST',body:{name:'Limit Test',role:'member',agents:{default:'chat'}}});const r=await call(null,'/auth/accept',{method:'POST',body:{code:i.j.code,name:'Limit Test',password:'family-pass-123'}});m=r.ck;mid=(await call(m,'/ui/me')).j.id;
 const o=await call(owner,'/gapi/api/model/options');const pv=o.j.providers.find(p=>/claude-subscription/.test(p.slug));haiku=pv.slug+'|'+pv.models.find(x=>/haiku/.test(x));opus=pv.models.find(x=>/opus/.test(x));must(haiku&&opus,'models not found')});
await step('Allow only Haiku',async()=>{const r=await call(owner,'/ui/people/'+mid,{method:'PATCH',body:{models:[haiku]}});must(r.s===200,r.t)});
await step('Member sees only Haiku',async()=>{const o=await call(m,'/gapi/api/model/options');const all=o.j.providers.flatMap(p=>p.models);must(all.length===1&&/haiku/.test(all[0]),all.join(','))});
await step('Member starts a chat',async()=>{const r=await call(m,'/gapi/api/sessions',{method:'POST',body:{}});sid=r.j.id||r.j.session?.id;must(sid,r.t)});
await step('Asking for Opus is refused',async()=>{const r=await call(m,'/gapi/api/sessions/'+sid+'/chat/stream',{method:'POST',body:{message:'hi',model:opus,provider:'claude-subscription-directsdk-experimental'}});must(r.s===403,'status '+r.s)});
await step('No model given: runs on Haiku',async()=>{const r=await fetch(BASE+'/gapi/api/sessions/'+sid+'/chat/stream',{method:'POST',headers:{'x-hui':'1',cookie:m,'content-type':'application/json'},body:JSON.stringify({message:'Reply with just: ok'})});const t=await r.text();
 must(r.ok,'status '+r.status);const s=await call(owner,'/hapi/sessions?limit=50');await new Promise(r=>setTimeout(r,1500));const me=await call(m,'/hapi/sessions?limit=50');const row=(me.j.sessions||[]).find(x=>x.id===sid);must(row&&/haiku/.test(row.model||''),'model was '+(row?.model||'?'))});
await step('Set a 1-token daily limit',async()=>{const r=await call(owner,'/ui/people/'+mid,{method:'PATCH',body:{limit:{tokens:1}}});must(r.s===200,r.t)});
await step('Next message is blocked',async()=>{await new Promise(r=>setTimeout(r,61000));const r=await call(m,'/gapi/api/sessions/'+sid+'/chat/stream',{method:'POST',body:{message:'again'}});must(r.s===429,'status '+r.s+' '+r.t.slice(0,80))});
await step('Usage shows the member',async()=>{const r=await call(owner,'/ui/usage?days=1');must(r.j.byPerson?.[mid]?.chats>=1,JSON.stringify(r.j.byPerson||{}).slice(0,120))});
await step('Member sees only their own usage',async()=>{const r=await call(m,'/ui/usage?days=1');must(Object.keys(r.j.byPerson||{}).length===1&&r.j.today,JSON.stringify(r.j).slice(0,120))});
await step('Clean up',async()=>{await call(m,'/hapi/sessions/'+sid+'?profile=default',{method:'DELETE'});await call(owner,'/ui/people/'+mid,{method:'DELETE'})});
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
