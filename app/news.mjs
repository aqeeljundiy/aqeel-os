// The bell's list (1 Nov 2026): history and news, things that happened or got done and need nobody (a schedule
// finished, a tool server works again, the agents restarted for a moment). What needs someone is in Bottlenecks only,
// never here. Kept on the server so it is the same on every device; each person has their own read and cleared marks.
// Who sees an item: 'admins' (what aqeelOS itself noticed) or 'u:<id>' (one person's own, sent by their app).
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const KEEP=300,DAYS=30;
export function createNews({DATA}){
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
  const old=Date.now()-DAYS*864e5;db.items=[it,...db.items.filter(x=>x.t>old)].slice(0,KEEP);await save();return pub(it)}
 async function list(u,admin){await load();return db.items.filter(x=>sees(x,u,admin)&&!x.gone.includes(u.id)).slice(0,60).map(({aud,read,gone,...x})=>({...x,read:read.includes(u.id)}))}
 // ids: those; all: everything this person sees
 async function read(u,admin,{ids,all}){await load();const want=new Set(ids||[]);let n=0;for(const x of db.items)if(sees(x,u,admin)&&(all||want.has(x.id))&&!x.read.includes(u.id)){x.read.push(u.id);n++}if(n)await save();return n}
 // remove one, or clear: every read one goes from this person's list (others keep theirs)
 async function hide(u,admin,{id,read:onlyRead}){await load();let n=0;for(const x of db.items)if(sees(x,u,admin)&&(id?x.id===id:onlyRead&&x.read.includes(u.id))&&!x.gone.includes(u.id)){x.gone.push(u.id);n++}if(n)await save();return n}
 return {add,list,read,hide}}
