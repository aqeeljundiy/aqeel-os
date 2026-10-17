// Account switching check (Models › Accounts): a throwaway agent is moved from the Claude sign-in to ChatGPT and
// back through the same switch auto-switch uses, and answers a short message on each. Auto-switch itself is not
// turned on here: from a test copy it would move the real agents too. Run on the box against a test copy:
//   node scripts/switch-check.mjs [base] [password file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const AG='ms-'+Date.now().toString(36).slice(-5);
let ck;const out=[];const step=async(n,fn)=>{try{const x=await fn();out.push(['PASS',n,x||''])}catch(e){out.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}
 const sc=r.headers.get('set-cookie');if(sc)ck=sc.split(';')[0];return {s:r.status,j,t}}
// one short chat on the agent: which model ran it, and what it said
async function chat(){const s=await call('/gapi/p/'+AG+'/api/sessions',{method:'POST',body:{}});const sid=s.j.id||s.j.session?.id||s.j.session_id;must(sid,'no chat: '+s.t.slice(0,120));
 const r=await call('/gapi/p/'+AG+'/api/sessions/'+sid+'/chat/stream',{method:'POST',body:{message:'Reply with just the word: ok'}});must(r.s===200,'status '+r.s+' '+r.t.slice(0,160));
 let model='',provider='',text='',err='',ev='';for(const l of r.t.split('\n')){if(l.startsWith('event:')){ev=l.slice(6).trim();continue}if(!l.startsWith('data:'))continue;let e;try{e={...JSON.parse(l.slice(5)),type:ev}}catch{continue}
  if(e.type==='run.started'){model=e.runtime?.model||model;provider=e.runtime?.provider||provider}
  if(e.type==='assistant.delta')text+=e.delta||e.text||'';if(e.type==='assistant.completed'&&!text)text=typeof e.content==='string'?e.content:JSON.stringify(e.content||'');
  if(e.type==='run.failed')err=e.error?.message||String(e.error||'failed')}
 must(!err,'the reply failed: '+err);must(/ok/i.test(text),'reply was: '+text.slice(0,120));
 // the model that really answered, as the chat records it
 await sleep(1200);const row=((await call('/hapi/sessions?limit=50&profile='+AG)).j.sessions||[]).find(x=>x.id===sid);model=row?.model||model;provider=row?.billing_provider||row?.provider||provider;
 return {model,provider,text:text.trim().slice(0,40)}}
let acc,gpt,claude;
await step('Owner signs in',async()=>{const r=await call('/auth/login',{method:'POST',body:{password:PW}});must(r.s===200,'status '+r.s)});
await step('Throwaway agent, set up',async()=>{const r=await call('/hapi/profiles',{method:'POST',body:{name:AG,clone_from_default:false,no_skills:true}});must(r.s<300,'status '+r.s);
 for(let i=0;i<75;i++){await sleep(2000);const st=(await call('/ui/agent-setup')).j.agents?.[AG];if(st)return st.ok?'ready after '+((i+1)*2)+' s':'setup said: '+st.failed.join('; ')}throw new Error('setup did not finish')});
await step('Both sign-ins are there',async()=>{acc=(await call('/ui/accounts?fresh=1')).j;const p=(acc.providers||[]).find(x=>x.slug==='openai-codex');must(p,'ChatGPT is not signed in: '+(acc.providers||[]).map(x=>x.slug).join(','));
 gpt=(p.models||[]).map(m=>m.id||m).find(m=>/gpt/i.test(m))||(p.models||[])[0]?.id||(p.models||[])[0];must(gpt,'no ChatGPT model');
 const main=(acc.accounts||[]).find(a=>a.main);must(main?.signedIn,'Claude main account not signed in');claude=acc.route?.default?.model||'sonnet';
 return 'Claude ('+(main.email||'main')+') and ChatGPT ('+gpt+'); agent starts on '+acc.route?.[AG]?.provider+' / '+acc.route?.[AG]?.model});
await step('Answers on Claude first',async()=>{const c=await chat();return c.provider+' / '+c.model+': '+c.text});
await step('Switch to ChatGPT',async()=>{const r=await call('/ui/accounts/use',{method:'POST',body:{profile:AG,key:'p:openai-codex',model:gpt}});must(r.s===200,JSON.stringify(r.j));
 const a=(await call('/ui/accounts')).j.route?.[AG];must(a?.provider==='openai-codex'&&a.model===gpt,'route is '+JSON.stringify(a));return a.provider+' / '+a.model});
await step('Answers on ChatGPT',async()=>{const c=await chat();must(/openai|codex/i.test(c.provider)||/gpt/i.test(c.model),'ran on '+c.provider+' / '+c.model);return c.provider+' / '+c.model+': '+c.text});
await step('Switch back to Claude',async()=>{const r=await call('/ui/accounts/use',{method:'POST',body:{profile:AG,key:'claude:main',model:claude}});must(r.s===200,JSON.stringify(r.j));
 const a=(await call('/ui/accounts')).j.route?.[AG];must(/claude/.test(a?.provider||'')&&a.model===claude,'route is '+JSON.stringify(a));return a.provider+' / '+a.model});
await step('Answers on Claude again',async()=>{const c=await chat();must(/claude|anthropic/i.test(c.provider)||/claude|sonnet|opus|haiku|fable/i.test(c.model),'ran on '+c.provider+' / '+c.model);return c.provider+' / '+c.model+': '+c.text});
await step('Switches are in the history',async()=>{const ev=((await call('/ui/accounts')).j.events||[]).filter(e=>e.profile===AG);must(ev.length>=1,'no events');return ev.map(e=>e.to+' ('+(e.why||'')+')').join(', ')});
await step('Refuses a provider the agent is not signed in to',async()=>{const r=await call('/ui/accounts/use',{method:'POST',body:{profile:AG,key:'p:no-such-provider',model:'x'}});must(r.s===400,'status '+r.s);return r.j.error});
await step('Clean up',async()=>{const r=await call('/hapi/profiles/'+AG,{method:'DELETE'});must(r.s<300,'status '+r.s)});
for(const [a,b,c] of out)console.log(a,'|',b,'|',String(c).slice(0,220));console.log(out.filter(x=>x[0]==='PASS').length+'/'+out.length+' passed');
