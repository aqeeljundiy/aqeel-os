// The bell's list (1 Nov 2026): history and news, things that happened or got done and need nobody (a schedule
// finished, a tool server works again, the agents restarted for a moment). What needs someone is in Bottlenecks only,
// never here. Kept on the server so it is the same on every device; each person has their own read and cleared marks.
// Who sees an item: 'admins' (what aqeelOS itself noticed) or 'u:<id>' (one person's own, sent by their app).
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

// each list has its own cap (1 Nov 2026, review: one person's app could push the admins' history out); a person's app may
// add 60 new items in 10 minutes (a new device may bring up to 50 engine restarts), more are refused
export const CAPS={admins:300,person:150},RATE={n:60,ms:10*60e3},DAYS=30;
// keep: the newest of every audience up to its cap, nothing older than DAYS
export function trim(items,now=Date.now()){const seen={};return items.filter(x=>{if(now-x.t>DAYS*864e5)return false;const cap=x.aud==='admins'?CAPS.admins:CAPS.person;seen[x.aud]=(seen[x.aud]||0)+1;return seen[x.aud]<=cap})}
export function createNews({DATA}){const sent=new Map();   // aud -> times of recent adds from a person's app
 const FILE=path.join(DATA,'news.json');let db=null,saving=Promise.resolve();
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.items||=[]}return db};
 const save=()=>saving=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db));await rename(FILE+'.tmp',FILE)}).catch(e=>console.warn('news: saving',e.message));
 const clip=(s,n)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
 const pub=({aud,read,gone,...x})=>x;
 const sees=(x,u,admin)=>x.aud==='u:'+u.id||(x.aud==='admins'&&admin);
 // key: the same thing told twice (two devices, a check that runs again) lands once for whoever sees it
 async function add({aud='admins',key,icon,kind,title,text,go,label}){await load();title=clip(title,140);if(!title)return null;key=key?clip(key,160):'';
  const had=key&&db.items.find(x=>x.key===key&&x.aud===aud);if(had)return pub(had);
  const it={id:'n'+randomBytes(6).toString('hex'),t:Date.now(),aud,key,icon:clip(icon||'clock',24),kind:['blue','ok','warn'].includes(kind)?kind:'blue',title,text:clip(text,240),go:/^\/[\w\/.-]{0,120}$/.test(go||'')?go:'',label:clip(label||'Open',24),read:[],gone:[]};
  db.items=trim([it,...db.items]);await save();return pub(it)}
 // from a person's own app (POST /ui/news): their list only, and not too many
 // only a new item counts towards the limit: the same key sent again (another device, a check that runs again) is answered
 // with the item already there
 async function addOwn(u,b){const aud='u:'+u.id;await load();const key=b.key?clip(b.key,160):'',had=key&&db.items.find(x=>x.key===key&&x.aud===aud);if(had)return pub(had);
  const now=Date.now(),l=(sent.get(aud)||[]).filter(t=>now-t<RATE.ms);if(l.length>=RATE.n)throw Object.assign(Error('Too many notifications at once. Try again in a few minutes.'),{status:429});
  l.push(now);sent.set(aud,l);return add({key,icon:b.icon,kind:b.kind,title:b.title,text:b.text,go:b.go,label:b.label,aud})}
 // the list a browser kept before the bell moved here: once per person, at most 30 items, outside the limit; read ones stay read
 async function importOwn(u,items){await load();db.imported||={};if(db.imported[u.id])return 0;db.imported[u.id]=Date.now();const aud='u:'+u.id;let n=0;
  for(const b of (Array.isArray(items)?items:[]).slice(0,30)){const it=await add({key:b.key,icon:b.icon,kind:b.kind,title:b.title,text:b.text,go:b.go,label:b.label,aud});if(!it)continue;n++;
   if(b.read){const x=db.items.find(y=>y.id===it.id);if(x&&!x.read.includes(u.id))x.read.push(u.id)}}
  await save();return n}
 async function list(u,admin){await load();return db.items.filter(x=>sees(x,u,admin)&&!x.gone.includes(u.id)).slice(0,60).map(({aud,read,gone,...x})=>({...x,read:read.includes(u.id)}))}
 // ids: those; all: everything this person sees
 async function read(u,admin,{ids,all}){await load();const want=new Set(ids||[]);let n=0;for(const x of db.items)if(sees(x,u,admin)&&(all||want.has(x.id))&&!x.read.includes(u.id)){x.read.push(u.id);n++}if(n)await save();return n}
 // remove one, or clear: every read one goes from this person's list (others keep theirs)
 async function hide(u,admin,{id,read:onlyRead}){await load();let n=0;for(const x of db.items)if(sees(x,u,admin)&&(id?x.id===id:onlyRead&&x.read.includes(u.id))&&!x.gone.includes(u.id)){x.gone.push(u.id);n++}if(n)await save();return n}
 return {add,addOwn,importOwn,list,read,hide}}
