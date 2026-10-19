// Code: the aqeelOS Code desktop app (Code by Aqeel, running on a person's own computer) seen from aqeelOS.
// Pairing works like the browser extension: the person is signed in to aqeelOS, aqeelOS gives the desktop app its own
// key (no password ever typed into the app), and the app uses that key to reach the person's agents (abilities,
// channels, automations) and to fetch updates. Downloads are built here from the app's source on the box
// (~/apps/aqeel-code), with this install's address inside, plus a small installer for Windows and for Mac.
import {readFile,writeFile,mkdir,readdir,stat,rename} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';

const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return b=>{let c=0xFFFFFFFF;for(const x of b)c=t[(c^x)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}})();
// a zip (stored, no compression) of [name, Buffer, mode] entries; mode marks scripts executable on a Mac
function zip(files){const parts=[],central=[];let off=0;
 for(const [name,data,exec] of files){const nb=Buffer.from(name);const crc=CRC(data);const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(data.length,22);lh.writeUInt16LE(nb.length,26);
  parts.push(lh,nb,data);const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(0x0314,4);ch.writeUInt16LE(20,6);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(data.length,24);ch.writeUInt16LE(nb.length,28);
  ch.writeUInt32LE(((exec?0o100755:0o100644)<<16)>>>0,38);ch.writeUInt32LE(off,42);central.push(ch,nb);off+=30+nb.length+data.length}
 const cd=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);
 return Buffer.concat([...parts,cd,end])}
// what goes into the download: the app's source, never its data, dependencies, git history or old Windows launcher
const SKIP=/^(\.git|node_modules|data|outputs|projects|\.claude|launcher|.*\.exe|.*\.png|.*\.log)$/i;
async function walk(dir,base=''){const out=[];for(const f of await readdir(dir).catch(()=>[])){if(SKIP.test(f))continue;const p=path.join(dir,f),rel=base?base+'/'+f:f;const s=await stat(p).catch(()=>null);if(!s)continue;
 if(s.isDirectory())out.push(...await walk(p,rel));else if(s.size<5e6)out.push([rel,await readFile(p)])}return out}

export function createCode({DATA,SRC,PUBLIC_URL,ROOT}){
 const FILE=path.join(DATA,'code-devices.json');let db=null;
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.devices||={};return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1),{mode:0o600});await rename(FILE+'.tmp',FILE)};
 const hash=t=>createHash('sha256').update(String(t)).digest('hex');
 // a new key for one person's computer; only its hash is kept here
 async function pair(user,name){await load();const token='aqc_'+randomBytes(24).toString('base64url');db.devices[hash(token)]={user,name:String(name||'Computer').slice(0,60),created:Date.now(),last:0};await save();return token}
 async function who(token){await load();const d=db.devices[hash(token||'')];if(!d)return null;d.last=Date.now();save().catch(()=>{});return d}
 async function devices(user){await load();return Object.entries(db.devices).filter(([,d])=>d.user===user).map(([h,d])=>({id:h.slice(0,12),...d}))}
 async function unpair(user,id){await load();for(const [h,d] of Object.entries(db.devices))if(d.user===user&&h.startsWith(id))delete db.devices[h];await save()}
 const version=async()=>{try{return JSON.parse(await readFile(path.join(SRC,'package.json'),'utf8')).version||'0'}catch{return '0'}};
 // the download for one kind of computer
 async function download(os){const files=(await walk(SRC)).map(([n,b])=>['aqeelOS Code/'+n,b]);
  const cfg=JSON.stringify({aqeelos:{base:PUBLIC_URL,origins:[PUBLIC_URL]}},null,1);files.push(['aqeelOS Code/aqeelos.json',Buffer.from(cfg)]);
  const tpl=f=>readFile(path.join(ROOT,'code-installer',f));
  if(os==='windows'){files.push(['aqeelOS Code/Install aqeelOS Code.cmd',await tpl('install.cmd')],['aqeelOS Code/install.ps1',await tpl('install.ps1')])}
  else files.push(['aqeelOS Code/Install aqeelOS Code.command',await tpl('install.command'),true]);
  return zip(files.map(f=>f.length===3?f:[f[0],f[1],/\.(command|sh)$/.test(f[0])]))}
 return {pair,who,devices,unpair,version,download}}
