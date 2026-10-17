// "Use my browser": the aqeelOS extension in a person's own Chrome connects here, and for a chat where they chose
// "My browser" this module registers that browser with the engine (its browser-extension control) and relays the
// agent's browser actions to it. Chats without that choice keep the AI box's own browser. If the browser goes
// offline mid-task, the agent is told so instead of being moved to another browser without asking.
import {readFile,writeFile,rename,mkdir,readdir,stat} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';

const CAPS=['browser_navigate','browser_snapshot','browser_click','browser_type','browser_press','browser_scroll','browser_back'];

// a small WebSocket server side (text frames, ping/pong, close), so no package is needed
function acceptWs(req,sock,head){const key=req.headers['sec-websocket-key'];if(!key){sock.destroy();return null}
 sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
 const ev={onmessage:null,onclose:null};let buf=head?.length?Buffer.from(head):Buffer.alloc(0),frag=[];
 const out=(data,op=1)=>{const p=Buffer.isBuffer(data)?data:Buffer.from(String(data));let h;
  if(p.length<126)h=Buffer.from([0x80|op,p.length]);else if(p.length<65536){h=Buffer.alloc(4);h[0]=0x80|op;h[1]=126;h.writeUInt16BE(p.length,2)}else{h=Buffer.alloc(10);h[0]=0x80|op;h[1]=127;h.writeBigUInt64BE(BigInt(p.length),2)}
  try{sock.write(Buffer.concat([h,p]))}catch{}};
 const read=()=>{for(;;){if(buf.length<2)return;const fin=buf[0]&128,op=buf[0]&15,masked=buf[1]&128;let len=buf[1]&127,off=2;
   if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);off=4}else if(len===127){if(buf.length<10)return;len=Number(buf.readBigUInt64BE(2));off=10}
   const mk=off;if(masked)off+=4;if(buf.length<off+len)return;let data=Buffer.from(buf.subarray(off,off+len));if(masked)for(let i=0;i<data.length;i++)data[i]^=buf[mk+(i&3)];buf=buf.subarray(off+len);
   if(op===8){out(Buffer.alloc(0),8);sock.end();return}if(op===9){out(data,10);continue}if(op===10)continue;
   if(op===1||op===0){frag.push(data);if(fin){const t=Buffer.concat(frag).toString('utf8');frag=[];ev.onmessage?.(t)}}}};
 sock.on('data',d=>{buf=Buffer.concat([buf,d]);read()});read();sock.on('close',()=>ev.onclose?.());sock.on('error',()=>{});
 return {send:t=>out(t),close:()=>{try{out(Buffer.alloc(0),8);sock.end()}catch{}},ev}}

// a zip of the extension folder (stored, no compression), for the Download button
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return b=>{let c=0xFFFFFFFF;for(const x of b)c=t[(c^x)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}})();
async function zipDir(dir,prefix){const files=[];for(const f of await readdir(dir))if((await stat(path.join(dir,f))).isFile())files.push([prefix+'/'+f,await readFile(path.join(dir,f))]);
 const parts=[],central=[];let off=0;
 for(const [name,data] of files){const nb=Buffer.from(name);const crc=CRC(data);const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(data.length,22);lh.writeUInt16LE(nb.length,26);
  parts.push(lh,nb,data);const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(data.length,24);ch.writeUInt16LE(nb.length,28);ch.writeUInt32LE(off,42);
  central.push(ch,nb);off+=30+nb.length+data.length}
 const cd=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);
 return Buffer.concat([...parts,cd,end])}

export function createLocalBrowser({DATA,GATE,API_KEY,EXT_DIR}){
 const FILE=path.join(DATA,'local-browsers.json');let db=null;
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.tokens||={};return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1),{mode:0o600});await rename(FILE+'.tmp',FILE)};
 const conns=new Map();     // person → their browser's connection
 const lanes=new Map();     // chat session → {ws (to the engine), user, agent}
 const pending=new Map();   // command id → lane
 const connected=user=>conns.has(user);

 async function pair(user){await load();const token=randomBytes(24).toString('base64url');db.tokens[token]={user,created:Date.now()};await save();return token}
 async function upgrade(req,sock,head){const t=new URL(req.url,'http://x').searchParams.get('t')||'';await load();const rec=db.tokens[t];
  if(!rec){const w=acceptWs(req,sock,head);w?.send('{"type":"unpaired"}');w?.close();return}
  const w=acceptWs(req,sock,head);if(!w)return;const old=conns.get(rec.user);if(old)old.close();conns.set(rec.user,w);rec.last=Date.now();save().catch(()=>{});
  console.log('my browser: connected for',rec.user);
  w.ev.onmessage=t=>{let m;try{m=JSON.parse(t)}catch{return}if(m.type!=='result')return;const lane=pending.get(m.id);if(!lane)return;pending.delete(m.id);
   try{lane.ws.send(JSON.stringify({method:'browser.controller.result',params:{command_id:m.id,ok:m.ok===true,...(m.ok?{result:m.result}:{error:String(m.error||'failed')})}}))}catch{}};
  w.ev.onclose=()=>{if(conns.get(rec.user)===w){conns.delete(rec.user);console.log('my browser: disconnected for',rec.user)}}}

 // the person chose "My browser" for this chat: register it with the engine for exactly this chat
 async function link(user,agent,session){if(!conns.has(user))throw new Error('Your browser is not connected. Open the aqeelOS extension in Chrome and press Connect.');
  unlink(session);const pre=agent&&agent!=='default'?'/p/'+encodeURIComponent(agent):'';
  const r=await fetch(GATE+pre+'/v1/browser-control/register',{method:'POST',headers:{authorization:'Bearer '+API_KEY,'content-type':'application/json'},
   body:JSON.stringify({protocol_version:1,session_id:session,controller_id:'aqeelos-'+user,browser_profile_id:'chrome-'+user,capabilities:CAPS})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error?.message||j.error||j.detail||('The engine did not accept it ('+r.status+').'));
  const ws=new WebSocket(GATE.replace(/^http/,'ws')+(j.ws_path||'/v1/browser-control/ws'),['hermes-browser-control-v1','hermes-browser-control-ticket.'+j.ticket]);
  const lane={ws,user,agent,session};lanes.set(session,lane);
  await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=()=>no(new Error('Could not open the browser link to the engine.'))});
  ws.onmessage=e=>{let f;try{f=JSON.parse(String(e.data))}catch{return}if(f.method!=='browser.controller.command')return;const p=f.params||{};
   const ext=conns.get(user);
   if(!ext){try{ws.send(JSON.stringify({method:'browser.controller.result',params:{command_id:p.command_id,ok:false,error:'The person’s browser is offline (the aqeelOS extension is not connected). Ask them to open Chrome, or to switch this chat back to the AI box screen.'}}))}catch{}return}
   pending.set(p.command_id,lane);ext.send(JSON.stringify({type:'command',id:p.command_id,action:p.action,arguments:p.arguments||{}}))};
  ws.onclose=()=>{if(lanes.get(session)===lane)lanes.delete(session)};
  console.log('my browser: chat',session,'on',agent,'now uses the browser of',user);return true}
 function unlink(session){const lane=lanes.get(session);if(!lane)return false;lanes.delete(session);
  try{lane.ws.send(JSON.stringify({method:'browser.controller.detach',params:{}}))}catch{}setTimeout(()=>{try{lane.ws.close()}catch{}},300);return true}
 const linked=session=>lanes.has(session);
 const zip=()=>zipDir(EXT_DIR,'aqeelos-browser');
 return {pair,upgrade,link,unlink,linked,connected,zip}}
