// Ownership check: a creator's agent is private to them, the owner sees it listed but locked, sharing
// opens it, and giving it away moves ownership. Run on the box: node scripts/owner-check.mjs [base] [pw file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const AG='owner-test-'+Date.now().toString(36);
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};
async function call(ck,path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,ck:(r.headers.get('set-cookie')||'').split(';')[0]}}
let owner,a,b,aId,bId;
await step('Set up owner + two creators',async()=>{owner=(await call(null,'/auth/login',{method:'POST',body:{password:PW}})).ck;const caps=(await call(owner,'/ui/people')).j.presets.creator;
 for(const n of ['Owner Test A','Owner Test B']){const i=await call(owner,'/ui/people/invite',{method:'POST',body:{name:n,role:'member',caps,agents:{}}});const r=await call(null,'/auth/accept',{method:'POST',body:{code:i.j.code,name:n,password:'family-pass-123'}});must(r.s===200,JSON.stringify(r.j));if(!a)a=r.ck;else b=r.ck}
 aId=(await call(a,'/ui/me')).j.id;bId=(await call(b,'/ui/me')).j.id});
await step('A creates an agent',async()=>{const r=await call(a,'/hapi/profiles',{method:'POST',body:{name:AG}});must(r.s<300,'status '+r.s)});
await step('A is shown as its owner',async()=>{const r=await call(a,'/ui/agents?names='+AG);must(r.j[AG]?.owner?.id===aId&&r.j[AG].access==='owner',JSON.stringify(r.j))});
await step('Owner of aqeelOS sees it listed',async()=>{const r=await call(owner,'/hapi/profiles');must((r.j.profiles||[]).some(p=>p.name===AG),'not listed')});
await step('…but it is locked for them',async()=>{const r=await call(owner,'/ui/agents?names='+AG);must(r.j[AG]?.private&&r.j[AG].access===null,JSON.stringify(r.j[AG]))});
await step('Owner of aqeelOS cannot chat with it',async()=>{const r=await call(owner,'/gapi/p/'+AG+'/api/model/options');must(r.s===403,'status '+r.s)});
await step('Owner of aqeelOS cannot edit it',async()=>{const r=await call(owner,'/hapi/profiles/'+AG+'/soul?profile='+AG,{method:'PUT',body:{content:'x'}});must(r.s===403,'status '+r.s)});
await step('B cannot see it',async()=>{const r=await call(b,'/hapi/profiles');must(!(r.j.profiles||[]).some(p=>p.name===AG),'visible')});
await step('B cannot share it',async()=>{const r=await call(b,'/ui/agents/'+AG+'/share',{method:'PUT',body:{user:bId,level:'owner'}});must(r.s===403,'status '+r.s)});
await step('A shares it with B (Can chat)',async()=>{const r=await call(a,'/ui/agents/'+AG+'/share',{method:'PUT',body:{user:bId,level:'chat'}});must(r.s===200,JSON.stringify(r.j))});
await step('B can now chat with it',async()=>{const r=await call(b,'/gapi/p/'+AG+'/api/model/options');must(r.s===200,'status '+r.s)});
await step('B still cannot edit it',async()=>{const r=await call(b,'/hapi/profiles/'+AG+'/soul?profile='+AG,{method:'PUT',body:{content:'x'}});must(r.s===403,'status '+r.s)});
await step('A gives it to B',async()=>{const r=await call(a,'/ui/agents/'+AG+'/owner',{method:'PUT',body:{user:bId}});must(r.s===200,JSON.stringify(r.j))});
await step('B is the owner now, A keeps Can edit',async()=>{const r=await call(b,'/ui/agents?names='+AG);must(r.j[AG].owner.id===bId&&r.j[AG].shared.some(s=>s.id===aId&&s.level==='edit'),JSON.stringify(r.j[AG]))});
await step('A can no longer delete it',async()=>{const r=await call(a,'/hapi/profiles/'+AG,{method:'DELETE'});must(r.s===403,'status '+r.s)});
await step('B deletes it',async()=>{const r=await call(b,'/hapi/profiles/'+AG,{method:'DELETE'});must(r.s<300,'status '+r.s)});
await step('Clean up people',async()=>{for(const id of [aId,bId])await call(owner,'/ui/people/'+id,{method:'DELETE'})});
for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');
