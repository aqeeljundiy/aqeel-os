// Secret field check: a throwaway agent calls ask_secret through its real aqeelos-notify address; the person's
// side fills the protected field. The tool reply never holds the value, "save" stores the key, "type" waits for a
// running screen, Not now cancels. Then typing into that agent's own screen. Run on the box against a test copy:
//   node scripts/secret-check.mjs [base] [password file]
import {readFileSync,existsSync} from 'node:fs';import {homedir} from 'node:os';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const AG='sc-'+Date.now().toString(36).slice(-5),HOME=homedir()+'/.hermes/profiles/'+AG,VALUE='s3cr3t-'+Math.random().toString(36).slice(2,10);
let ck;const out=[];const step=async(n,fn)=>{try{const x=await fn();out.push(['PASS',n,x||''])}catch(e){out.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}
 const sc=r.headers.get('set-cookie');if(sc)ck=sc.split(';')[0];return {s:r.status,j}}
let notify=null;
const tool=(args)=>fetch(notify,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ask_secret',arguments:args}})}).then(r=>r.json());
const pending=async()=>{for(let i=0;i<20;i++){const r=await call('/ui/secrets/pending?agent='+AG);if(r.j.items?.length)return r.j.items[0];await sleep(500)}throw new Error('no pending request')};
await step('Owner signs in',async()=>{const r=await call('/auth/login',{method:'POST',body:{password:PW}});must(r.s===200,'status '+r.s)});
await step('Throwaway agent with the aqeelOS tool',async()=>{const r=await call('/hapi/profiles',{method:'POST',body:{name:AG,clone_from_default:false,no_skills:true}});must(r.s<300,'status '+r.s);
 for(let i=0;i<60;i++){await sleep(2000);const y=existsSync(HOME+'/config.yaml')?readFileSync(HOME+'/config.yaml','utf8'):'';const m=/url:\s*['"]?(http:\/\/127\.0\.0\.1:4402\/mcp\/notify\/[^'"\s]+)/.exec(y);if(m){notify=m[1];return 'after '+((i+1)*2)+' s'}}throw new Error('no notify tool')});
await step('The tool is offered to the agent',async()=>{const r=await fetch(notify,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}).then(r=>r.json());must(r.result.tools.some(t=>t.name==='ask_secret'),'missing');});
await step('save: the value goes to the key, never to the agent',async()=>{const p=tool({label:'Test API key',mode:'save',name:'aq_test_key'});const x=await pending();must(x.mode==='save'&&x.name==='AQ_TEST_KEY','item '+JSON.stringify(x));
 const s=await call('/ui/secrets/'+x.id,{method:'POST',body:{value:VALUE}});must(s.s===200,JSON.stringify(s.j));const r=await p;const txt=JSON.stringify(r);
 must(!txt.includes(VALUE),'value leaked to the agent');must(readFileSync(HOME+'/.env','utf8').includes('AQ_TEST_KEY='+VALUE),'not in settings');must(readFileSync(homedir()+'/workspaces/'+AG+'/.secrets/AQ_TEST_KEY','utf8')===VALUE,'no key file');return r.result.content[0].text.slice(0,90)});
await step('type: waits for a running screen, then Not now cancels',async()=>{const p=tool({label:'Password',mode:'type'});const x=await pending();const s=await call('/ui/secrets/'+x.id,{method:'POST',body:{value:VALUE}});
 must(s.s===409,'expected the screen to be off: '+s.s+' '+JSON.stringify(s.j));const still=await call('/ui/secrets/pending?agent='+AG);must(still.j.items.length===1,'request closed on error');
 await call('/ui/secrets/'+x.id,{method:'POST',body:{cancel:true}});const r=await p;must(r.result.isError&&/chose not/.test(r.result.content[0].text),JSON.stringify(r));return s.j.error});
await step('The person sends one: what it is + locked value',async()=>{const r=await call('/ui/secrets/give',{method:'POST',body:{agent:AG,label:'Gmail password for test',name:'GMAIL_PASSWORD_TEST',value:VALUE+'-2'}});must(r.s===200,JSON.stringify(r.j));
 must(!JSON.stringify(r.j).includes(VALUE),'value in the message');must(readFileSync(homedir()+'/workspaces/'+AG+'/.secrets/'+r.j.name,'utf8')===VALUE+'-2','not saved');return r.j.name+': '+r.j.message.slice(0,80)});
await step('The agent sees the saved names, not the values',async()=>{const r=await fetch(notify,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}).then(r=>r.json());const t=r.result.tools.find(t=>t.name==='type_secret');
 must(t&&/GMAIL_PASSWORD_TEST/.test(t.description),'names missing');must(!JSON.stringify(r).includes(VALUE),'value leaked');return t.description.slice(0,120)});
await step('type_secret with the screen off says so',async()=>{const r=await fetch(notify,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'type_secret',arguments:{name:'GMAIL_PASSWORD_TEST'}}})}).then(r=>r.json());must(r.result.isError,'expected an error');must(!JSON.stringify(r).includes(VALUE),'value leaked');return r.result.content[0].text});
await step('Typing into the agent’s own screen',async()=>{const st=await call('/ui/screens/'+AG+'/start',{method:'POST'});if(st.s!==200)return 'screen could not start here: '+JSON.stringify(st.j).slice(0,120);
 const r=await call('/ui/screens/'+AG+'/type',{method:'POST',body:{text:'hello from aqeelOS'}});must(r.s===200,JSON.stringify(r.j));
 const t=await fetch(notify,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'type_secret',arguments:{name:'GMAIL_PASSWORD_TEST'}}})}).then(r=>r.json());must(!t.result.isError,'type_secret: '+t.result.content[0].text);must(!JSON.stringify(t).includes(VALUE),'value leaked');
 await call('/ui/screens/'+AG+'/stop',{method:'POST'});return 'typed '+r.j.chars+' characters, then type_secret: '+t.result.content[0].text.slice(0,60)});
await step('The value is in no log',async()=>{for(const f of ['/tmp/ppl/log','/tmp/ui.log',homedir()+'/.hermes/logs/agent.log'])must(!existsSync(f)||!readFileSync(f,'utf8').includes(VALUE),'found in '+f)});
await step('Clean up',async()=>{const r=await call('/hapi/profiles/'+AG,{method:'DELETE'});must(r.s<300,'status '+r.s)});
for(const [a,b,c] of out)console.log(a,'|',b,'|',String(c).slice(0,200));console.log(out.filter(x=>x[0]==='PASS').length+'/'+out.length+' passed');
