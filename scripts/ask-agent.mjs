// Ask an agent one question on a running copy and print its answer (the chat is deleted afterwards).
// node ask.mjs "<question>" [agent]
import {readFileSync} from 'node:fs';
const B=process.env.BASE||'http://127.0.0.1:4402';const pw=readFileSync(process.env.PWFILE||'/tmp/ppl/pw','utf8').trim();const q=process.argv[2]||'Who are you?';const ag=process.argv[3]||'';
const l=await fetch(B+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw})});const ck=(l.headers.get('set-cookie')||'').split(';')[0];
const h={'x-hui':'1',cookie:ck,'content-type':'application/json'};const G=B+'/gapi'+(ag?'/p/'+ag:'');
const s=await (await fetch(G+'/api/sessions',{method:'POST',headers:h,body:'{}'})).json();const id=s.session?.id||s.id;
const r=await fetch(G+'/api/sessions/'+encodeURIComponent(id)+'/chat/stream',{method:'POST',headers:h,body:JSON.stringify({message:q})});
const dec=new TextDecoder();let buf='',text='';
for await(const c of r.body){buf+=dec.decode(c,{stream:true}).split('\r').join('');let i;while((i=buf.indexOf('\n\n'))>=0){const b=buf.slice(0,i);buf=buf.slice(i+2);const ev=(b.split('\n').find(x=>x.startsWith('event:'))||'').slice(6).trim();const d=b.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5)).join('');if(!d)continue;let e;try{e=JSON.parse(d)}catch{continue}const t=e.type||ev;if(t==='assistant.delta')text+=e.delta||'';if(t==='assistant.completed'&&typeof e.content==='string')text=e.content}}
console.log(text.trim());
await fetch(B+'/hapi/sessions/'+encodeURIComponent(id)+(ag?'?profile='+ag:''),{method:'DELETE',headers:h}).catch(()=>{});
