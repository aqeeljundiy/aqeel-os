// Email check: a fake mail server on 127.0.0.1:2526 catches every message, so codes can be read back.
// Covers: add + confirm an email, wrong code, two-step sign-in, invite by email. Uses a test copy.
// Run on the box: node scripts/email-check.mjs [base] [owner password file]
import net from 'node:net';import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const inbox=[];
const sink=net.createServer(s=>{let data=false,buf='';s.write('220 sink\r\n');s.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\r\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);
 if(data){if(line==='.'){data=false;s.write('250 ok\r\n')}else inbox[inbox.length-1].body+=line+'\n';continue}
 const c=line.slice(0,4).toUpperCase();if(c==='DATA'){data=true;inbox.push({body:''});s.write('354 go\r\n')}else if(c==='QUIT'){s.end('221 bye\r\n')}else if(c==='EHLO'||c==='HELO')s.write('250-sink\r\n250 OK\r\n');else s.write('250 ok\r\n')}})}).listen(2526,'127.0.0.1');
const res=[];const step=async(n,fn)=>{try{const x=await fn();res.push(['PASS',n,x||''])}catch(e){res.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};const lastCode=()=>(/\b(\d{6})\b/.exec(inbox[inbox.length-1]?.body||'')||[])[1];
async function call(ck,path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,ck:(r.headers.get('set-cookie')||'').split(';')[0]}}
let ck,key;
await step('Owner signs in',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{password:PW}});ck=r.ck;must(r.s===200,'status '+r.s)});
await step('Point email at the test mail server',async()=>{const r=await call(ck,'/ui/mail',{method:'PUT',body:{mode:'smtp',host:'127.0.0.1',port:'2526',user:'',from:'aqeelOS <no-reply@ai.elkiya.com>'}});must(r.s===200,JSON.stringify(r.j))});
await step('Add an email: a code is sent',async()=>{const r=await call(ck,'/ui/me/email',{method:'PUT',body:{email:'owner-test@example.com'}});key=r.j.key;must(r.s===200&&key,JSON.stringify(r.j));must(lastCode(),'no code in mail: '+(inbox.at(-1)?.body||'none').slice(0,80))});
await step('A wrong code is refused',async()=>{const r=await call(ck,'/ui/me/email/verify',{method:'POST',body:{key,code:'000000'}});must(r.s===400,'status '+r.s)});
await step('The right code confirms it',async()=>{const r=await call(ck,'/ui/me/email/verify',{method:'POST',body:{key,code:lastCode()}});must(r.s===200,JSON.stringify(r.j));const me=await call(ck,'/ui/me');must(me.j.emailVerified,'not confirmed')});
await step('Turn on two-step sign-in',async()=>{const r=await call(ck,'/ui/me/two-step',{method:'PUT',body:{on:true}});must(r.s===200,JSON.stringify(r.j))});
let ticket;
await step('Password alone no longer signs in',async()=>{const r=await call(null,'/auth/login',{method:'POST',body:{password:PW}});must(r.s===200&&r.j.needCode&&!r.ck,JSON.stringify(r.j));ticket=r.j.key});
await step('Wrong sign-in code refused',async()=>{const r=await call(null,'/auth/code',{method:'POST',body:{key:ticket,code:'111111'}});must(r.s===401,'status '+r.s)});
await step('Emailed code signs in',async()=>{const r=await call(null,'/auth/code',{method:'POST',body:{key:ticket,code:lastCode()}});must(r.s===200&&r.ck,JSON.stringify(r.j));ck=r.ck});
await step('Invite by email arrives with the link',async()=>{const i=await call(ck,'/ui/people/invite',{method:'POST',body:{name:'Mail Test',role:'member',agents:{}}});const link=BASE+'/#invite/'+i.j.code;
 const r=await call(ck,'/ui/people/invite/'+i.j.code+'/email',{method:'POST',body:{to:'friend@example.com',link}});must(r.s===200,JSON.stringify(r.j));must(inbox.at(-1).body.includes(link),'link missing');await call(ck,'/ui/people/invite/'+i.j.code,{method:'DELETE'})});
await step('Two-step off; the email can be changed but not removed (it is how you sign in)',async()=>{await call(ck,'/ui/me/two-step',{method:'PUT',body:{on:false}});const r=await call(ck,'/ui/me/email',{method:'PUT',body:{email:''}});must(r.s===400,'status '+r.s)});
await step('Email settings back to default',async()=>{await call(ck,'/ui/mail',{method:'PUT',body:{mode:'direct',host:'',port:'',user:''}})});
sink.close();for(const r of res)console.log(r.join(' | '));console.log(res.filter(r=>r[0]==='PASS').length+'/'+res.length+' passed');process.exit(0);
