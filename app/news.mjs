// The bell's list (1 Nov 2026): history and news, things that happened or got done and need nobody (a schedule
// finished, a tool server works again, the agents restarted for a moment). What needs someone is in Bottlenecks only,
// never here. Kept on the server so it is the same on every device; each person has their own read and cleared marks.
// Who sees an item: 'admins' (what aqeelOS itself noticed) or 'u:<id>' (one person's own, sent by their app).
//
// 7 Nov 2026 (owner approved, 213 items in a week): the bell shows only two things. "Needs you" is the Bottlenecks
// person items (server.mjs, one list in two places). "You started it, it finished" is an item added with started:true
// (a run, deploy or export the person asked for). Everything else is Activity: a quiet log (System › Activity, no
// badge, no ping) of agents' own runs, silent fixes, restarts, model switches, setting changes.
// One row per problem, not per occurrence: an item with a group key updates the open row of that group in place
// ("since 14:02, 3 times") instead of adding one; resolve(group) closes it. Bell items expire after 7 days and acting
// on one clears it. Items from before this (no cls) are Activity, and repeats of one problem fold into one row at load.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

// each list has its own cap (1 Nov 2026, review: one person's app could push the admins' history out); a person's app may
// add 60 new items in 10 minutes (a new device may bring up to 50 engine restarts), more are refused
export const CAPS={admins:300,person:150},RATE={n:60,ms:10*60e3},DAYS=30,BELL_DAYS=7;
// the group of an item from before groups existed: the same problem told again (numbers and times aside)
export const legacyGroup=x=>{const t=String(x.title||'');if(/^The AI box is low on RAM/.test(t))return 'sys:memory';if(/^Agents restarted for a moment/.test(t))return 'sys:restart';
 return String(x.key||'').split(/[|:@]/)[0]+'|'+t.replace(/\(.*?\)|[0-9]+/g,'#').replace(/\s+/g,' ').trim().slice(0,100)};
// fold repeats of one problem into its newest row, counting them (Activity reads "3 times")
export function fold(items){const by=new Map(),out=[];for(const x of items){if(x.cls==='started'){out.push(x);continue}const g=x.group||legacyGroup(x);const have=by.get(x.aud+'|'+g);
  if(have){have.count=(have.count||1)+(x.count||1);have.since=Math.min(have.since||have.t,x.since||x.t);continue}const y={...x,group:g};by.set(x.aud+'|'+g,y);out.push(y)}return out}
// keep: the newest of every audience up to its cap, nothing older than DAYS
export function trim(items,now=Date.now()){const seen={};return items.filter(x=>{if(now-x.t>DAYS*864e5)return false;const cap=x.aud==='admins'?CAPS.admins:CAPS.person;seen[x.aud]=(seen[x.aud]||0)+1;return seen[x.aud]<=cap})}
export function eveningLine(fixed,needs){const f=fixed===1?'1 thing fixed itself today':fixed+' things fixed themselves today';return f+', '+(needs?needs+(needs===1?' thing needs':' things need')+' you':'nothing needs you')}
export function createNews({DATA}){const sent=new Map();   // aud -> times of recent adds from a person's app
 const FILE=path.join(DATA,'news.json');let db=null,saving=Promise.resolve();
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.items||=[];if(!db.v2){db.items=fold(db.items);db.v2=Date.now();await save()}}return db};
 const save=()=>saving=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db));await rename(FILE+'.tmp',FILE)}).catch(e=>console.warn('news: saving',e.message));
 const clip=(s,n)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
 const pub=({aud,read,gone,...x})=>x;
 const sees=(x,u,admin)=>x.aud==='u:'+u.id||(x.aud==='admins'&&admin);
 // key: the same thing told twice (two devices, a check that runs again) lands once for whoever sees it
 async function add({aud='admins',key,icon,kind,title,text,go,label,started=false,group}){await load();title=clip(title,140);if(!title)return null;key=key?clip(key,160):'';
  const had=key&&db.items.find(x=>x.key===key&&x.aud===aud);if(had)return pub(had);
  // the same problem again: its open row is updated in place and moves to the top
  group=group?clip(group,120):'';const now=Date.now();
  const open=group&&!started&&db.items.find(x=>x.group===group&&x.aud===aud&&!x.resolved&&now-x.t<BELL_DAYS*864e5);
  if(open){Object.assign(open,{t:now,since:open.since||open.t,count:(open.count||1)+1,title,text:clip(text,240),read:[]});db.items=[open,...db.items.filter(x=>x!==open)];await save();return pub(open)}
  const it={id:'n'+randomBytes(6).toString('hex'),t:now,aud,key,icon:clip(icon||'clock',24),kind:['blue','ok','warn'].includes(kind)?kind:'blue',title,text:clip(text,240),go:/^\/[\w\/.-]{0,120}$/.test(go||'')?go:'',label:clip(label||'Open',24),
   cls:started?'started':'activity',...(group?{group}:{}),read:[],gone:[]};
  db.items=trim([it,...db.items]);await save();return pub(it)}
 // the problem is over: its row says so and stops collecting repeats
 async function resolve(group,aud){await load();let n=0;for(const x of db.items)if(x.group===group&&(!aud||x.aud===aud)&&!x.resolved){x.resolved=Date.now();n++}if(n)await save();return n}
 // from a person's own app (POST /ui/news): their list only, and not too many
 // only a new item counts towards the limit: the same key sent again (another device, a check that runs again) is answered
 // with the item already there
 async function addOwn(u,b){const aud='u:'+u.id;await load();const key=b.key?clip(b.key,160):'',had=key&&db.items.find(x=>x.key===key&&x.aud===aud);if(had)return pub(had);
  const now=Date.now(),l=(sent.get(aud)||[]).filter(t=>now-t<RATE.ms);if(l.length>=RATE.n)throw Object.assign(Error('Too many notifications at once. Try again in a few minutes.'),{status:429});
  l.push(now);sent.set(aud,l);return add({key,icon:b.icon,kind:b.kind,title:b.title,text:b.text,go:b.go,label:b.label,aud,started:b.started===true,group:b.group})}
 // the list a browser kept before the bell moved here: once per person, at most 30 items, outside the limit; read ones stay read
 async function importOwn(u,items){await load();db.imported||={};if(db.imported[u.id])return 0;db.imported[u.id]=Date.now();const aud='u:'+u.id;let n=0;
  for(const b of (Array.isArray(items)?items:[]).slice(0,30)){const it=await add({key:b.key,icon:b.icon,kind:b.kind,title:b.title,text:b.text,go:b.go,label:b.label,aud});if(!it)continue;n++;
   if(b.read){const x=db.items.find(y=>y.id===it.id);if(x&&!x.read.includes(u.id))x.read.push(u.id)}}
  await save();return n}
 // the bell: what this person started that finished, last 7 days, not cleared
 async function list(u,admin){await load();const now=Date.now();return db.items.filter(x=>x.cls==='started'&&sees(x,u,admin)&&!x.gone.includes(u.id)&&now-x.t<BELL_DAYS*864e5).slice(0,60).map(({aud,read,gone,...x})=>({...x,read:read.includes(u.id)}))}
 // Activity: everything else, newest first, one row per problem
 async function activity(u,admin,{limit=200}={}){await load();return db.items.filter(x=>x.cls!=='started'&&sees(x,u,admin)).slice(0,limit).map(({aud,read,gone,...x})=>x)}
 // the evening line: how many things happened by themselves since a time (Activity rows, counting repeats)
 async function countSince(t,admin=true){await load();return db.items.filter(x=>x.cls!=='started'&&x.t>=t&&(admin?x.aud==='admins':true)).reduce((n,x)=>n+1,0)}
 // ids: those; all: everything this person sees
 async function read(u,admin,{ids,all}){await load();const want=new Set(ids||[]);let n=0;for(const x of db.items)if(sees(x,u,admin)&&(all||want.has(x.id))&&!x.read.includes(u.id)){x.read.push(u.id);n++}if(n)await save();return n}
 // remove one, or clear: every read one goes from this person's list (others keep theirs)
 async function hide(u,admin,{id,read:onlyRead}){await load();let n=0;for(const x of db.items)if(sees(x,u,admin)&&(id?x.id===id:onlyRead&&x.read.includes(u.id))&&!x.gone.includes(u.id)){x.gone.push(u.id);n++}if(n)await save();return n}
 return {add,addOwn,importOwn,list,activity,resolve,countSince,read,hide}}
