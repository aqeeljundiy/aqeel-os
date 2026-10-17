// Real steer test against a running copy: start a reply that runs a 25 s command, steer it after 8 s, and check
// the agent read the steer (run.steered event or the steer word in its answer). Cleans up the chat afterwards.
import {readFileSync} from 'node:fs';
const B=process.env.BASE||'http://127.0.0.1:4402';const pw=readFileSync(process.env.PWFILE||'/tmp/ppl/pw','utf8').trim();
const l=await fetch(B+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw})});const ck=(l.headers.get('set-cookie')||'').split(';')[0];
const h={'x-hui':'1',cookie:ck,'content-type':'application/json'};
const s=await (await fetch(B+'/gapi/api/sessions',{method:'POST',headers:h,body:'{}'})).json();const id=s.session?.id||s.id;console.log('chat',id);
const r=await fetch(B+'/gapi/api/sessions/'+encodeURIComponent(id)+'/chat/stream',{method:'POST',headers:h,body:JSON.stringify({message:'Use the terminal to run exactly: sleep 25 && echo finished. Then reply with one short sentence.'})});
console.log('status',r.status,r.headers.get('content-type'));
let runId=null,text='',steered=false;const events=[];const t0=Date.now();const dec=new TextDecoder();let buf='',shown=false;
setTimeout(async()=>{if(!runId){console.log('no run id yet');return}const x=await fetch(B+'/gapi/v1/runs/'+runId+'/steer',{method:'POST',headers:h,body:JSON.stringify({text:'Also end your reply with the word BANANA.'})});console.log('steer sent',x.status,((Date.now()-t0)/1000).toFixed(1)+'s')},8000);
for await(const chunk of r.body){const piece=dec.decode(chunk,{stream:true}).split('\r').join('');if(!shown){shown=true;console.log('raw:',JSON.stringify(piece.slice(0,300)))}buf+=piece;let i;
 while((i=buf.indexOf('\n\n'))>=0){const block=buf.slice(0,i);buf=buf.slice(i+2);const d=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5)).join('');if(!d)continue;let e;try{e=JSON.parse(d)}catch{continue}const ev=(block.split('\n').find(x=>x.startsWith('event:'))||'').slice(6).trim();if(ev&&!e.type)e.type=ev;
  events.push(e.type);if(e.type==='run.started')runId=e.run_id;if(e.type==='run.steered')steered=true;if(e.type==='assistant.delta')text+=e.delta||'';if(e.type==='assistant.completed'&&e.content)text=typeof e.content==='string'?e.content:text}}
console.log('took',((Date.now()-t0)/1000).toFixed(1)+'s','steered event:',steered,'| reply:',text.slice(-200));
console.log('events:',[...new Set(events)].join(' '));
await fetch(B+'/hapi/sessions/'+encodeURIComponent(id),{method:'DELETE',headers:h}).catch(()=>{});
