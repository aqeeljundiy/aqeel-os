// Sending email from aqeelOS (sign-in codes, invites) with no extra packages.
// Two ways: "direct" talks to the recipient's mail server from this box (often lands in spam, and some
// providers refuse unknown senders), or "smtp" goes through a real mail account (Gmail app password,
// Resend, Brevo…), which is what makes mail arrive reliably. Settings live in DATA/mail.json.
// Direct mail must come from a domain whose SPF lists this box (MAIL_DOMAIN) and greet with the box's reverse
// name (MAIL_HELO): Gmail refuses senders with neither SPF nor DKIM. Defaults are neutral; set both in the app's env.
import {writeStore} from './store.mjs';
import net from 'node:net';
import tls from 'node:tls';
import {resolveMx} from 'node:dns/promises';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {hostname} from 'node:os';
import path from 'node:path';

export function createMail(DATA){
 const FILE=path.join(DATA,'mail.json');
 const DOM=process.env.MAIL_DOMAIN||'localhost',HELO=process.env.MAIL_HELO||hostname();
 const load=async()=>{let c;try{c=JSON.parse(await readFile(FILE,'utf8'))}catch{return {mode:'direct',from:'aqeelOS <no-reply@'+DOM+'>',helo:HELO}}
  // saved before the fix: the old sender address (no SPF) and no greeting name meant Gmail refused every mail
  const sub=process.env.MAIL_DOMAIN&&new RegExp('@[a-z0-9-]+\\.'+DOM.replace(/\./g,'\\.')+'>?$','i');
  if(c.mode!=='smtp'&&sub&&sub.test(c.from||'')){c.from=c.from.replace(/@[^>]+/,'@'+DOM);c.helo=c.helo||HELO}
  if(c.mode!=='smtp'&&!c.helo)c.helo=HELO;return c};
 const save=async c=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(c,null,1),{mode:0o600})};
 const addr=s=>(/<([^>]+)>/.exec(s)||[,s])[1].trim();

 // one SMTP conversation; resolves with the server's last reply
 function talk({host,port,secure,user,pass,from,to,data,helo,timeout=20000}){return new Promise((resolve,reject)=>{
  let sock=secure?tls.connect({host,port,servername:host}):net.connect({host,port});let buf='',waiting=null,done=false;
  const fail=e=>{if(done)return;done=true;try{sock.destroy()}catch{}reject(e instanceof Error?e:new Error(String(e)))};
  const timer=setTimeout(()=>fail(new Error('The mail server did not answer in time.')),timeout);
  const onData=d=>{buf+=d;const lines=buf.split('\r\n');if(lines.length<2)return;const last=lines[lines.length-2];if(/^\d{3} /.test(last)&&waiting){const r=buf;buf='';const w=waiting;waiting=null;w(r)}};
  const read=()=>new Promise(r=>{waiting=r;if(buf.includes('\r\n'))onData('')});
  const cmd=async(line,ok=/^[23]/)=>{if(line!==null)sock.write(line+'\r\n');const r=await read();const code=r.trim().split('\r\n').pop();if(!ok.test(code))throw new Error(code.slice(0,200));return r};
  sock.on('data',onData);sock.on('error',fail);sock.setEncoding('utf8');
  (async()=>{try{
   await cmd(null);helo=helo||hostname()||'aqeelos';let ehlo=await cmd('EHLO '+helo);
   if(!secure&&/STARTTLS/i.test(ehlo)){await cmd('STARTTLS');sock.removeListener('data',onData);sock=tls.connect({socket:sock,servername:host});sock.setEncoding('utf8');sock.on('data',onData);sock.on('error',fail);await new Promise((r,j)=>{sock.once('secureConnect',r);sock.once('error',j)});ehlo=await cmd('EHLO '+helo)}
   if(user){await cmd('AUTH LOGIN',/^3/);await cmd(Buffer.from(user).toString('base64'),/^3/);await cmd(Buffer.from(pass||'').toString('base64'))}
   await cmd('MAIL FROM:<'+addr(from)+'>');await cmd('RCPT TO:<'+to+'>');
   if(data===null){await cmd('RSET');}else{await cmd('DATA',/^3/);const last=await cmd(data.replace(/\r?\n/g,'\r\n').replace(/^\./gm,'..')+'\r\n.');done=true;clearTimeout(timer);sock.write('QUIT\r\n');sock.end();return resolve(last.trim())}
   done=true;clearTimeout(timer);sock.write('QUIT\r\n');sock.end();resolve('accepted')
  }catch(e){clearTimeout(timer);fail(e)}})();
 })}

 function message(from,to,subject,text){const bn=globalThis.AQ_BRAND;if(bn&&bn!=='aqeelOS'){const re=/aqeelOS/g;from=String(from).replace(re,bn);subject=String(subject).replace(re,bn);text=String(text).replace(re,bn)}const id='<'+randomBytes(12).toString('hex')+'@'+(addr(from).split('@')[1]||'aqeelos')+'>';
  return [`From: ${from}`,`To: <${to}>`,`Subject: ${subject}`,`Date: ${new Date().toUTCString()}`,`Message-ID: ${id}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: 8bit','',text].join('\r\n')}

 // data=null only checks that the server would take the message (no mail is sent)
 async function deliver(to,subject,text,{check=false}={}){
  const c=await load();if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to))throw new Error('That email address does not look right.');
  const data=check?null:message(c.from,to,subject,text);
  if(c.mode==='smtp'){if(!c.host)throw new Error('Email sending is not set up yet.');return talk({host:c.host,port:+c.port||587,secure:!!c.secure||+c.port===465,user:c.user,pass:c.pass,from:c.from,to,data})}
  const mx=(await resolveMx(to.split('@')[1]).catch(()=>[])).sort((a,b)=>a.priority-b.priority);if(!mx.length)throw new Error('That email domain has no mail server.');
  let last;for(const m of mx.slice(0,3)){try{return await talk({host:m.exchange,port:25,from:c.from,to,data,helo:c.helo})}catch(e){last=e}}
  throw new Error('The mail server refused it: '+(last?.message||'unknown error'))}

 return {
  load,deliver,
  settings:async()=>{const c=await load();return {mode:c.mode,from:c.from,host:c.host||'',port:c.port||'',secure:!!c.secure,user:c.user||'',hasPass:!!c.pass}},
  update:async b=>{const c=await load();c.mode=b.mode==='smtp'?'smtp':'direct';c.from=String(b.from||c.from).slice(0,200);for(const k of ['host','port','user'])if(k in b)c[k]=String(b[k]||'').slice(0,200);if('secure' in b)c.secure=!!b.secure;if(b.pass)c.pass=String(b.pass).slice(0,500);await save(c);return true},
 };
}
