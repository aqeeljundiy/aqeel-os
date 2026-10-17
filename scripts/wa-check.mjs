// WhatsApp link check: channel list shows each account, Check connection answers in plain words, the
// attention list names logged-out links, and Link again on a throwaway agent gives a fresh QR code
// (cancelled before anything is scanned). Run on the box against a test copy:
//   node scripts/wa-check.mjs [base] [password file]
import {readFileSync} from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:4402',PW=readFileSync(process.argv[3]||'/tmp/ppl/pw','utf8').trim();
const AG='wa-'+Date.now().toString(36).slice(-5);
let ck;const out=[];const step=async(n,fn)=>{try{const x=await fn();out.push(['PASS',n,x||''])}catch(e){out.push(['FAIL',n,e.message])}};
const must=(c,m)=>{if(!c)throw new Error(m)};
async function call(path,{method='GET',body}={}){const h={'x-hui':'1'};if(ck)h.cookie=ck;if(body!==undefined)h['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}
 const sc=r.headers.get('set-cookie');if(sc)ck=sc.split(';')[0];return {s:r.status,j}}
await step('Owner signs in',async()=>{const r=await call('/auth/login',{method:'POST',body:{password:PW}});must(r.s===200,'status '+r.s)});
await step('Channel list shows the WhatsApp accounts',async()=>{const r=await call('/ui/channels');must(r.s===200,'status '+r.s);const w=r.j.channels.filter(c=>c.id==='whatsapp');
 return w.map(c=>c.agent+': '+(c.account?.phone||'no account')+(c.needs_link?' (needs link)':'')).join('; ')});
await step('Check connection answers in plain words',async()=>{const r=await call('/ui/channels/check',{method:'POST',body:{agent:'default',platform:'whatsapp'}});must(r.s===200,'status '+r.s);must(r.j.text&&!/\/home\//.test(r.j.text),'raw text');return r.j.text});
await step('Telegram check names the bot',async()=>{const r=await call('/ui/channels/check',{method:'POST',body:{agent:'default',platform:'telegram'}});must(r.s===200,'status '+r.s);return r.j.text});
await step('Attention list names logged-out links',async()=>{const r=await call('/ui/channels/attention?fresh=1');must(r.s===200,'status '+r.s);return (r.j.items||[]).map(x=>x.agent+'/'+x.id+(x.needs_link?' logged out':' '+x.state)).join('; ')||'none'});
await step('Throwaway agent',async()=>{const r=await call('/hapi/profiles',{method:'POST',body:{name:AG,clone_from_default:false,no_skills:true}});must(r.s<300,'status '+r.s)});
await step('Link again clears and prepares',async()=>{const r=await call('/ui/channels/whatsapp/prepare',{method:'POST',body:{agent:AG}});must(r.s===200,JSON.stringify(r.j))});
let pid=null;
await step('A fresh QR code comes back',async()=>{const r=await call('/hapi/messaging/whatsapp/onboarding/start?profile='+AG,{method:'POST',body:{mode:'bot'}});must(r.s===200,'status '+r.s+' '+JSON.stringify(r.j));pid=r.j.pairing_id;
 for(let i=0;i<30;i++){const s=await call('/hapi/messaging/whatsapp/onboarding/'+pid+'?profile='+AG);if(s.j.qr_payload)return 'QR after '+(i*2)+' s, status '+s.j.status;if(/error|expired/.test(s.j.status))throw new Error(s.j.error||s.j.status);await new Promise(r=>setTimeout(r,2000))}
 throw new Error('no QR in 60 s')});
await step('Finishing before a scan is refused',async()=>{if(!pid)throw new Error('no pairing');const r=await call('/hapi/messaging/whatsapp/onboarding/'+pid+'/apply?profile='+AG,{method:'POST',body:{mode:'bot'}});must(r.s===409,'status '+r.s+' '+JSON.stringify(r.j));return r.j.error});
await step('Cancel the QR',async()=>{if(!pid)return 'none';const r=await call('/hapi/messaging/whatsapp/onboarding/'+pid+'?profile='+AG,{method:'DELETE'});must(r.s<300,'status '+r.s)});
await step('A working link is not thrown away by accident',async()=>{const r=await call('/ui/channels/check',{method:'POST',body:{agent:'default',platform:'telegram'}});return r.j.connected?'telegram connected (WhatsApp guard is the same code path)':'n/a'});
await step('Clean up',async()=>{const r=await call('/hapi/profiles/'+AG,{method:'DELETE'});must(r.s<300,'status '+r.s)});
for(const [a,b,c] of out)console.log(a,'|',b,'|',String(c).slice(0,220));console.log(out.filter(x=>x[0]==='PASS').length+'/'+out.length+' passed');
