// node --test scripts/proof-whatsapp.test.mjs
// WA-1, QR-1, QR-2 (12 Nov 2026), proven end to end without a customer and without a phone. The real modules (kirimdev.mjs, doc-links.mjs,
// protocol-pdf.mjs, customer-tools.mjs, scripts/delivery-check.mjs) run against ONE stand-in for the outside world that speaks real HTTP:
//   /kirimdev/v1/…   Kirimdev's API. A message it accepts is "delivered by WhatsApp": the stand-in phone of that number downloads the
//                    picture or the PDF from its link, as a real phone does, and keeps the bytes.
//   /public/doc/…    aqeelOS's own public address, served by the real one-purpose file links (the route of server.mjs).
//   /media/…         Kirimdev's media host (a line's product picture or QRIS).
//   /member/…        the member app the protocol PDF comes from.
// The main agent's WhatsApp bridge is the stand-in phone of the main number: it reports what it downloaded, as the bridge add-on does.
// Proven here: the bytes of a PDF and of a picture reach a phone and the check says so by itself (exit 0); a customer who asks for their
// protocol gets the PDF of their own member record; a check cut by a restart of aqeelOS says so instead of staying silent; a used-up AI
// provider holds the line until the reset (one start, not a loop) and the reason is in what a person reads.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,utimes} from 'node:fs/promises';import {readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {createHmac} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {createKirimdev,SAMPLE_PDF} from '../app/kirimdev.mjs';
import {createDocLinks} from '../app/doc-links.mjs';
import {createProtocolPdf,createProtocolSender} from '../app/protocol-pdf.mjs';
import {createCustomerTools} from '../app/customer-tools.mjs';
import {src as sourceOf} from './lib/source.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),SCRIPT=path.join(HERE,'delivery-check.mjs'),PNG=readFileSync(path.join(HERE,'fixtures','live-test-red.png'));
const AGENT='cove-support',SECRET='whsec_proof_456',MAIN='628990000001',CUSTOMER='6281234567890',PUBLIC='https://aqeelos.example';
const MEMBER_PDF=Buffer.from('%PDF-1.4\n% the protocol of one member\n'+'x'.repeat(900)+'\n%%EOF\n');
const sign=(raw,t)=>'t='+t+',v1='+createHmac('sha256',SECRET).update(t+'.'+raw).digest('hex');
const inbound=(from,text,id='wamid.'+Math.random(),conv='cnv_'+from)=>JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'111'},contacts:[{wa_id:from,profile:{name:'Test Person'}}],messages:[{from,id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text}}]}}]}],kirim:{conversation_id:conv}});

async function world({mode='live',agentSays='Halo kak',members=[{id:7,phone:'0812-3456-7890'}]}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'aq-wa-')),WORK=path.join(DATA,'work');await mkdir(path.join(WORK,AGENT,'media','staff'),{recursive:true});await mkdir(path.join(WORK,AGENT,'.tools'),{recursive:true});await mkdir(path.join(WORK,AGENT,'.secrets'),{recursive:true});
 await writeFile(path.join(WORK,AGENT,'media','staff','urls.txt'),'https://media.kirimdev.com/x/qris-sample.png\n');await writeFile(path.join(WORK,AGENT,'.tools','qris'),'x');await writeFile(path.join(WORK,AGENT,'.secrets','MEMBER_PW'),'member-password\n');
 const PDFCFG={baseUrl:'https://member.example',email:'admin@example.com',secret:'MEMBER_PW',lang:'id',filename:'Protokol.pdf',caption:'Ini protokolnya, kak.'};
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{[AGENT]:{phoneNumberId:'111',persona:'Rory',business:'Cove',mode,debounceSec:0,testers:[],language:'Indonesian',localPrefix:{country:'62',local:'0'},protocolPdf:PDFCFG}}}));
 await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify({[AGENT]:{id:'wbs_1',secrets:[SECRET]}}));
 const phones={},accepted=[],receipts={},probs=[],oks=[],asked=[],member=[];let srv,clock=Date.now(),down=false;
 const docLinks=createDocLinks({DATA,PUBLIC_URL:PUBLIC});
 // a phone gets a message: it downloads the file from the link, like WhatsApp does for the person holding it
 const local=u=>u.startsWith(PUBLIC+'/')?base()+'/public'+u.slice(PUBLIC.length):u.startsWith('https://media.kirimdev.com/')?base()+'/media/'+u.slice('https://media.kirimdev.com/'.length):null;
 const base=()=>'http://127.0.0.1:'+srv.address().port;
 const deliver=async(b,id)=>{const f=b.type==='document'?b.document:b.type==='image'?b.image:null,got={type:b.type,to:b.to,id,text:b.text?.body||'',caption:f?.caption||'',filename:f?.filename||''};
  if(f){const u=local(String(f.link||''));const r=u?await fetch(u).catch(()=>null):null;got.status=r?r.status:0;got.contentType=r?.headers.get('content-type')||'';got.bytes=r&&r.ok?Buffer.from(await r.arrayBuffer()):Buffer.alloc(0)}
  (phones[b.to]||=[]).push(got);receipts[id]='delivered'};
 srv=createServer((req,res)=>{const ch=[];req.on('data',c=>ch.push(c));req.on('end',async()=>{const u=new URL(req.url,'http://x'),p=u.pathname,body=Buffer.concat(ch).toString('utf8');const json=(o,code=200)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(o))};
  try{
   if(p.startsWith('/kirimdev/v1/')){const q=p.slice('/kirimdev/v1/'.length);if(req.headers.authorization!=='Bearer kdv_proof')return json({error:{code:'unauthorized'}},401);
    if(q==='accounts')return json({data:[{phone_number_id:'111',phone_number:'+62 811-1111-111',name:'Cove',status:'connected'}]});
    if(req.method==='POST'&&q==='111/messages'){const b=JSON.parse(body),id='msg_'+(accepted.length+1);accepted.push(b);receipts[id]='sent';json({data:{id,status:'queued'}});await deliver(b,id);return}
    const m=/^111\/messages\/(msg_\d+)$/.exec(q);if(m&&receipts[m[1]])return json({data:{id:m[1],status:receipts[m[1]]}});
    return json({data:[]})}
   const dm=/^\/public\/doc\/([\w-]{43})\/([^/]+)$/.exec(p);if(dm&&(req.method==='GET'||req.method==='HEAD'))return await docLinks.serve(req,res,dm[1],dm[2]);   // server.mjs: the /doc/<token>/<name> route
   if(p.startsWith('/media/')){res.writeHead(200,{'content-type':'image/png','content-length':PNG.length});return res.end(PNG)}
   if(p.startsWith('/member/')){const q=p.slice('/member'.length);member.push(req.method+' '+q+u.search);
    if(q==='/api/auth/verify-identity'){const b=JSON.parse(body);if(b.memberCode!=='member-password')return json({error:'no'},401);res.writeHead(200,{'content-type':'application/json','set-cookie':'sid=proof; Path=/; HttpOnly'});return res.end('{"ok":true}')}
    if(req.headers.cookie!=='sid=proof')return json({error:'sign in'},401);
    if(q==='/api/admin/customers')return json(members);if(/^\/api\/admin\/customers\/\d+$/.test(q))return json({protocols:[{name:'P'}]});
    if(q==='/api/protocols/export-all.pdf'){res.writeHead(200,{'content-type':'application/pdf'});return res.end(MEMBER_PDF)}}
   json({error:'not found'},404)}catch(e){json({error:e.message},500)}})});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 // the main agent's own WhatsApp: its number, and what its bridge saw arrive for a probe id (engine/patches/2026-11-11-delivery-probe.patch)
 const bridgeOn={v:true},bridge={self:async()=>MAIN,send:async()=>{},result:async id=>{if(!bridgeOn.v)return null;const m=(phones[MAIN]||[]).find(x=>x.caption.includes('aqeelos-probe:'+id));if(!m)return null;
  return m.type==='document'?{id,ok:m.status===200&&m.bytes.subarray(0,4).toString()==='%PDF',bytes:m.bytes.length,type:'document'}:{id,ok:m.status===200&&m.bytes.length>0,bytes:m.bytes.length,type:'image'}}};
 const viaWorld=(url,o)=>fetch(String(url).replace('https://api.kirimdev.com/v1/',base()+'/kirimdev/v1/').replace('https://member.example/',base()+'/member/'),o);
 const due=new Map();let tid=0;const setTimer=fn=>{const i=++tid;due.set(i,fn);return i},clearTimer=i=>{due.delete(i)};
 const ctx={};
 const mk=(extra={})=>createKirimdev({DATA,WORK,setTimer,clearTimer,apiKey:async()=>'kdv_proof',PUBLIC_URL:PUBLIC,fetchImpl:viaWorld,wait:async()=>{await new Promise(r=>setTimeout(r,5))},log:m=>process.env.KDLOG&&console.log(m),now:()=>clock,echoWait:0,bridge,docLinks,
  problem:async(...x)=>{probs.push(x)},solved:async(...x)=>{oks.push(x)},teamGroup:async()=>({chatId:-100,topics:{questions:3}}),telegram:async()=>4242,tell:async()=>{},
  receiptFinal:o=>{const l=o?.body?.document?.link;if(l)docLinks.revokeUrl(l).catch(()=>{})},   // as server.mjs wires it
  runAgent:async(a,q,c)=>{asked.push([a,q,c]);if(down)throw Error("the agent stopped (1): HTTP 429: You've hit your session limit · resets 10pm (UTC)");return typeof agentSays==='function'?agentSays(q,c,ctx):agentSays},...extra});
 const k=mk();ctx.k=k;
 const post=raw=>k.receive(AGENT,{'x-kirim-signature':sign(raw,Math.floor(clock/1000)),'x-kirim-event':'message.received'},Buffer.from(raw));
 const settle=async()=>{for(let n=0;n<20&&due.size;n++){const fns=[...due.values()];due.clear();await Promise.all(fns.map(f=>f()))}await new Promise(r=>setImmediate(r))};
 // the customer tools the agent has in a customer run, with the real protocol sender behind them
 const make=createProtocolPdf({WORK,fetchFn:viaWorld});
 const tools=createCustomerTools({WORK,DATA,pdfRules:async a=>a===AGENT?PDFCFG:null,sendProtocolPdf:createProtocolSender({make,docLinks,sendDocument:(a,to,o)=>ctx.k.sendDocument(a,to,o)}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',runAsAgent:async()=>({ok:true,out:''}),log:()=>{}});
 const check=(args,env={})=>new Promise(res=>{const c=spawn(process.execPath,[SCRIPT,AGENT,...args],{env:{...process.env,UI_DATA_DIR:DATA,...env}});let out='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>out+=d);c.on('close',code=>res({code,out}))});
 // the app's 30-second look at the request folder, until the script has its answer
 const whileChecking=async(p,app=()=>ctx.k)=>{let done=false;const r=p.then(x=>{done=true;return x});while(!done){await app()._tick().catch(()=>{});await new Promise(z=>setTimeout(z,150))}return r};
 return {DATA,WORK,k,mk,ctx,phones,accepted,probs,oks,asked,member,docLinks,tools,post,settle,check,whileChecking,bridgeOn,due,base,later:ms=>{clock+=ms},setDown:v=>{down=v},close:()=>srv.close()}}

test('PDF: the delivery check sends a real PDF through the app\'s own file link and a phone downloads those exact bytes; the script says "Arrived" and exits 0',async()=>{const w=await world();try{
 await w.post(inbound(MAIN,'aqeelOS delivery check, please ignore. aqeelos-probe:open000001w'));await w.settle();assert.equal(w.asked.length,0,'the main WhatsApp\'s own check message is never answered');   // it only opens the 24-hour window
 const r=await w.whileChecking(w.check(['--document','--timeout','60']));
 assert.equal(r.code,0,r.out);assert.match(r.out,/The app picked up the request\./);assert.match(r.out,/The file link is made; asking Kirimdev to send the PDF\./);assert.match(r.out,/Arrived\./);
 const res=JSON.parse(r.out.slice(r.out.lastIndexOf('\n{')));assert.deepEqual([res.sent,res.arrived,res.document,res.bytes],[true,true,true,SAMPLE_PDF.length]);assert.ok(!/doc\/[\w-]{43}\//.test(r.out),'the link\'s token is never printed');
 const got=w.phones[MAIN].at(-1);assert.equal(got.type,'document');assert.equal(got.status,200);assert.equal(got.contentType,'application/pdf');assert.ok(got.bytes.equals(SAMPLE_PDF),'the phone holds the very PDF that was sent');
 const link=w.accepted.at(-1).document.link;assert.match(link,/^https:\/\/aqeelos\.example\/doc\/[\w-]{43}\/aqeelOS%20delivery%20check\.pdf$/);
 assert.equal((await fetch(w.base()+'/public'+link.slice(PUBLIC.length))).status,404,'the link is gone once the check ended');assert.equal(w.docLinks.count(),0);
 assert.ok(w.oks.some(x=>x[1]==='delivery-pdf|'+AGENT),'Health hears it arrived');assert.deepEqual(await readdir(path.join(w.DATA,'delivery-checks')),[],'nothing is left in the request folder');
 }finally{w.close()}});

test('picture: the delivery check sends the line\'s own picture and a phone downloads it; exit 0. When the phone gets nothing, exit 1 with the reason and one Health line',async()=>{const w=await world();try{
 await w.post(inbound(MAIN,'aqeelos-probe:open000002w'));await w.settle();
 const r=await w.whileChecking(w.check(['--timeout','60']));assert.equal(r.code,0,r.out);
 const res=JSON.parse(r.out.slice(r.out.lastIndexOf('\n{')));assert.deepEqual([res.sent,res.arrived,res.picture,res.bytes],[true,true,true,PNG.length]);
 const got=w.phones[MAIN].at(-1);assert.equal(got.type,'image');assert.ok(got.bytes.equals(PNG));assert.match(got.caption,/aqeelos-probe:[0-9a-f]{12}$/,'one picture with its caption, the way that reaches a phone (QR-1)');
 assert.equal((await w.k._state()).probes[AGENT].picture,true,'kept for Health: "Pictures from this line: arrived"');
 // the main WhatsApp reports nothing (the bridge without the add-on, or WhatsApp dropped it)
 w.bridgeOn.v=false;const bad=await w.whileChecking(w.check(['--timeout','60']));assert.equal(bad.code,1,bad.out);assert.match(bad.out,/Did not arrive: Sent and accepted by Kirimdev, but nothing reached the main WhatsApp within 3 minutes/);
 assert.deepEqual(w.probs.map(x=>x[1]),['delivery|'+AGENT]);
 }finally{w.close()}});

test('a check that was waiting when aqeelOS restarted is answered "no answer, run it again" (exit 3), never silence and never "did not arrive"',async()=>{const w=await world();try{
 await w.post(inbound(MAIN,'aqeelos-probe:open000003w'));await w.settle();
 // the first app takes the request and waits for the phone; then it is gone (a deploy restarted it: Elkiya, 12 Nov 2026, 03:01 and 03:40 UTC)
 let hang;const first=w.mk({wait:()=>new Promise(r=>{hang=r})});
 const p=w.check(['--timeout','60']);
 for(let i=0;i<100&&!(await readdir(path.join(w.DATA,'delivery-checks')).catch(()=>[])).some(f=>f.endsWith('.req.json'));i++)await new Promise(z=>setTimeout(z,50));   // the script has asked
 for(let i=0;i<100&&!hang;i++){await first._tick().catch(()=>{});await new Promise(z=>setTimeout(z,100))}assert.ok(hang,'the first app was waiting for the phone');
 const left=await readdir(path.join(w.DATA,'delivery-checks'));assert.ok(left.some(f=>f.endsWith('.steps.log'))&&!left.some(f=>f.endsWith('.result.json')||f.endsWith('.req.json')),'in progress: steps, no request, no result: '+left);
 // an old leftover of a check nobody waits for any more
 const old=path.join(w.DATA,'delivery-checks','1700000000000-oldold00.steps.log');await writeFile(old,'x\n');await utimes(old,new Date(Date.now()-3*86400e3),new Date(Date.now()-3*86400e3));
 const second=w.mk();const r=await w.whileChecking(p,()=>second);
 assert.equal(r.code,3,r.out);assert.match(r.out,/No answer: aqeelOS restarted while this check was waiting/);assert.match(r.out,/"inconclusive": true/);assert.doesNotMatch(r.out,/Did not arrive/);
 assert.equal(w.probs.length,0,'no Health line: nothing is known about the picture');
 assert.ok(!(await readdir(path.join(w.DATA,'delivery-checks'))).some(f=>f.startsWith('1700000000000-')),'files of a check from days ago are removed');
 }finally{w.close()}});

test('the protocol PDF: a customer asks, the agent uses its tool, and that customer\'s phone gets the PDF of their own member record; the link goes once it is delivered',async()=>{
 const w=await world({agentSays:async(q,c,ctx)=>{const tok=ctx.tools.begin({agent:AGENT,line:'111',conversation:'cnv_'+CUSTOMER,phone:CUSTOMER,mode:'live'});
  const r=await ctx.tools.call(AGENT,tok,'send_protocol_pdf',{phone:'629999999999'});ctx.toolSaid=r;return 'Sudah saya kirim PDF protokolnya ya kak.'}});
 try{w.ctx.tools=w.tools;
 await w.post(inbound(CUSTOMER,'Boleh minta protokol saya dalam PDF?'));await w.settle();
 assert.equal(w.asked.length,1);assert.match(w.ctx.toolSaid.text,/was sent to the customer as a WhatsApp document/,JSON.stringify(w.ctx.toolSaid));
 const mine=w.phones[CUSTOMER]||[];const doc=mine.find(m=>m.type==='document');assert.ok(doc,'the customer\'s phone got a document: '+JSON.stringify(mine.map(m=>m.type)));
 assert.equal(doc.status,200);assert.ok(doc.bytes.equals(MEMBER_PDF),'the bytes on the phone are the member app\'s PDF');assert.deepEqual([doc.filename,doc.caption],['Protokol.pdf','Ini protokolnya, kak.']);
 assert.ok(mine.some(m=>m.type==='text'&&/Sudah saya kirim/.test(m.text)),'and the agent\'s words');
 assert.deepEqual(Object.keys(w.phones),[CUSTOMER],'nothing went to the number the model named, or to anyone else');
 assert.ok(w.member.some(x=>x.startsWith('GET /api/protocols/export-all.pdf?customerId=7')),'the PDF of the one member with this chat\'s number');
 // WhatsApp fetched it and Kirimdev says delivered: the next look drops the link
 assert.equal(w.docLinks.count(),1,'kept while the delivery is not known');await w.k._tick();await new Promise(r=>setTimeout(r,50));assert.equal(w.docLinks.count(),0);
 assert.equal((await fetch(w.base()+'/public'+w.accepted.find(b=>b.type==='document').document.link.slice(PUBLIC.length))).status,404);
 assert.match(sourceOf('app/server.mjs'),/receiptFinal:o=>\{const l=o\?\.body\?\.document\?\.link;if\(l\)docLinks\.revokeUrl\(l\)/,'server.mjs drops the link the same way');
 }finally{w.close()}});

test('two members share the customer\'s number: no PDF leaves, the agent is told to hand off',async()=>{
 const w=await world({members:[{id:7,phone:'0812-3456-7890'},{id:8,whatsappNumber:'+62 812 3456 7890'}],agentSays:async(q,c,ctx)=>{const tok=ctx.tools.begin({agent:AGENT,line:'111',conversation:'cnv_'+CUSTOMER,phone:CUSTOMER,mode:'live'});ctx.toolSaid=await ctx.tools.call(AGENT,tok,'send_protocol_pdf',{});return 'HANDOFF: protocol PDF, two members on this number'}});
 try{w.ctx.tools=w.tools;await w.post(inbound(CUSTOMER,'minta protokol PDF'));await w.settle();
 assert.match(w.ctx.toolSaid.text,/More than one member has this number[\s\S]*Nothing was sent/);assert.ok(!(w.phones[CUSTOMER]||[]).some(m=>m.type==='document'));assert.equal(w.docLinks.count(),0);
 }finally{w.close()}});

test('a used-up AI provider: the engine is started once, the line is held until the reset instead of looping, the reason is what a person reads, and the first good answer clears it',async()=>{const w=await world();try{
 w.setDown(true);await w.post(inbound(CUSTOMER,'tolong','m1'));await w.settle();
 assert.equal(w.asked.length,1);assert.equal((w.phones[CUSTOMER]||[]).length,0,'nothing half-made reaches the customer');
 // the minutes go by: the 30-second look runs again and again, another customer writes, the first one writes again
 for(let i=0;i<8;i++){w.later(60e3);await w.k._tick();if(i===2)await w.post(inbound('6285550000002','halo','m2'));if(i===4)await w.post(inbound(CUSTOMER,'halo?','m3'))}
 assert.equal(w.asked.length,1,'no new start while the provider is used up: '+w.asked.length);
 assert.equal(w.probs.length,1,'one line for the whole line, not one per chat or per minute');const [agent,topic,title,text]=w.probs[0];
 assert.deepEqual([agent,topic],[AGENT,'kirimdev|provider']);assert.match(title+' '+text,/AI provider|provider/i);assert.match(text,/session limit/);assert.match(text,/resets at \d\d:\d\d UTC/,'the reason and the reset time: '+text);
 const hold=(await w.k._state()).provider[AGENT];assert.ok(hold.until>Date.now(),'held until the reset');
 // the reset passes
 w.setDown(false);w.later(31*60e3);await w.settle();await w.k._tick();await w.settle();
 assert.ok(w.asked.length>=2);assert.ok((w.phones[CUSTOMER]||[]).some(m=>/Halo kak/.test(m.text)),'the customer who waited is answered');assert.deepEqual(w.oks.map(x=>x[1]),['kirimdev|provider']);assert.equal((await w.k._state()).provider?.[AGENT],undefined);
 }finally{w.close()}});
