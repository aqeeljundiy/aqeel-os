// Backup models (30 Oct 2026). Claude's connection kept dropping in the middle of answers ("API Error: Connection dropped
// (ECONNRESET)"): 2 to 75 failed replies a day, 328 on 29 Oct, and every agent ran on Claude alone, so after 3 tries the
// person got the engine's own error ("... add a backup provider with `hermes fallback add`"). Three things here:
//   - backup models: every agent's fallback_providers (the engine's own backup list, per agent, read again before each new
//     turn, no restart needed) is written from the Models page order: the accounts below the agent's current one that this
//     agent is signed in to and that work (not signed out, key not rejected, not out of credit), each with the model picked
//     on the Models page or else that provider's strongest model, and only models the agent owner's role allows. The engine
//     tries them in order after 3 failed tries on the current one, for that one reply, and starts on the agent's own model
//     again next turn. Kept in sync every 5 minutes, at start and after every change on the Models page. A list someone
//     made by hand (hermes fallback add) is left alone.
//   - the outage switch: the agents' engine logs are read every minute. 3 failed replies (every try used) within 10 min, or
//     8 dropped connections within 10 min, on one provider: the agents on it move to their first backup through the same
//     switch auto-switch uses (the Models page shows "Claude kept dropping"), so people stop waiting through 3 tries for
//     each message. The provider is then asked a one-word question through the engine every 5 min; it counts as working
//     again after 2 good answers (these, or other agents' turns on it) and 15 min with no failed reply and at most one
//     dropped connection, and never sooner than 20 min after the move (40 or 60 min when it already happened in the 2 hours
//     before), so agents do not flip back and forth. While it is out, auto-switch does not move anyone back up to it. An
//     agent someone moved by hand stays where they put it.
//   - one bell and one WhatsApp message when a switch starts and one when it ends; a line on System › Health › Automations.
// The engine's own words for "every model failed" and the note under a reply a backup gave are in
// scripts/apply-skill-patches.mjs (13). The parts that only decide are exported and tested in scripts/backup-models.test.mjs.
import {readFile,writeFile,mkdir,rename,stat,open} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

export const PLUGIN='claude-subscription-directsdk-experimental';
export const RULES={window:10*60e3,fails:3,drops:8,clean:15*60e3,oks:2,hold:20*60e3,probeEvery:5*60e3,again:2*3600e3};

/* ---------- the parts that only decide (tested) ---------- */
// the name people know: Claude, GPT, Gemini (the model first: Google AI Pro also runs Claude models)
export function brandOf(provider,model){const m=String(model||''),p=String(provider||'');
 if(/claude|opus|sonnet|haiku|fable/i.test(m))return 'Claude';if(/gpt|codex/i.test(m))return 'GPT';if(/gemini/i.test(m))return 'Gemini';
 if(/claude|anthropic/i.test(p))return 'Claude';if(/openai|codex/i.test(p))return 'GPT';if(/gemini|antigravity|google|vertex/i.test(p))return 'Gemini';return p||'another model'}
// "Claude", "Claude and GPT", "Claude, GPT and Gemini"
export const names=l=>{l=[...new Set(l)];return l.length<3?l.join(' and '):l.slice(0,-1).join(', ')+' and '+l.at(-1)};
// a provider's strongest everyday model from the list the engine offers (its order, best first): no small or cheap tiers
// (mini, flash, luna, haiku, low), no long-context copies (-900k); Claude's Opus; on Google AI Pro a Gemini model (a backup
// for Claude should not be Claude again); the "high" version when there is one
const SMALL=/(?:^|[-_.])(?:mini|nano|lite|flash|luna|haiku)(?:$|[-_.[])|-low$/i,LONG=/-\d+k$/i;   // whole words: "gemini" is not "mini"
export function bestModel(slug,models){const l=(models||[]).map(m=>typeof m==='string'?m:m?.id).filter(Boolean);if(!l.length)return '';
 let c=l.filter(m=>!SMALL.test(m)&&!LONG.test(m));if(!c.length)c=l;
 if(/claude/i.test(slug)){const o=c.find(m=>/opus/i.test(m));if(o)return o}
 else{const other=c.filter(m=>!/claude|opus|sonnet|haiku|fable/i.test(m));if(other.length)c=other}
 return c.find(m=>/-high$/i.test(m))||c[0]}
// an agent's backup list: the priority entries below its current one (all others when it is on none of them), each one
// this agent can use (usable(entry) → {provider, models} or null), one per provider and never its own provider (the engine
// would skip it), at most 3, with a model its owner may use. held(key): a provider in an outage is left out.
export function backupList({priority=[],cur,curProvider,usable,modelOk=()=>true,held=()=>false,max=3}){
 const at=priority.findIndex(e=>e.key===cur),below=at>=0?priority.slice(at+1):priority.filter(e=>e.key!==cur),out=[];
 for(const e of below){if(held(e.key))continue;const u=usable(e);if(!u?.provider||u.provider===curProvider||out.some(x=>x.provider===u.provider))continue;
  const ok=(u.models||[]).filter(m=>modelOk(u.provider,m));
  const model=e.model&&modelOk(u.provider,e.model)&&(!u.models?.length||u.models.includes(e.model))?e.model:bestModel(u.provider,ok);
  if(!model)continue;out.push({provider:u.provider,model});if(out.length>=max)break}
 return out}
// the same list (order, provider and model), whatever else an entry carries
export const sameList=(a,b)=>JSON.stringify((a||[]).map(e=>[e.provider,e.model]))===JSON.stringify((b||[]).map(e=>[e.provider,e.model]));
export const listOf=v=>(Array.isArray(v)?v:v&&typeof v==='object'?[v]:[]).filter(e=>e&&e.provider&&e.model).map(e=>({provider:String(e.provider),model:String(e.model)}));

// one engine log line (UTC time) as what it says about a provider: a failed reply (every try used), a dropped connection
// (one try failed, the engine tries again), or a call that worked. Only the provider's own trouble counts: limits, credit
// and sign-in problems are the usage switch's and the sign-in banner's, not an outage.
const TS=/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:,(\d{1,3}))?\s/;
const TRANSIENT=/connection|ECONNRESET|broken ?pipe|incomplete upstream|timed? ?out|timeout|overloaded|server error|\b50[0-9]\b|\b52[0-9]\b|EOF|reset by peer|network|terminated/i;
const NOT_OUTAGE=/rate.?limit|\b429\b|usage limit|billing|credit|quota|\b40[0-9]\b|status 4\d\d|unauthori[sz]ed|sign.?in|admission|improperly formatted/i;
export function parseLine(l){const m=TS.exec(l||'');if(!m)return null;const t=Date.parse(m[1]+'T'+m[2]+'.'+(m[3]||'0').padEnd(3,'0')+'Z');
 const provider=(/\bprovider=([\w.-]+)/.exec(l)||[])[1]||'';if(!provider)return null;const model=(/\bmodel=(\S+)/.exec(l)||[])[1]||'',sid=(/^\S+ \S+ \w+ \[([^\]]+)\]/.exec(l)||[])[1]||'';
 const bad=why=>NOT_OUTAGE.test(why)||!TRANSIENT.test(why);let x;
 if(x=/API call failed \(attempt (\d+)\/(\d+)\)/.exec(l)){if(bad((/summary=(.*)$/.exec(l)||[])[1]||l))return null;return {t,sid,provider,model,kind:+x[1]>=+x[2]?'fail':'drop'}}
 if(/API call failed after \d+ retries/.test(l)){if(bad(l.split('API call failed after')[1].split('| provider=')[0]))return null;return {t,sid,provider,model,kind:'fail'}}
 if(/API call #\d+: model=\S+ provider=/.test(l))return {t,sid,provider,model,kind:'ok'};
 return null}
// one event into a provider's record: one failed reply per turn (the last try's line and the "failed after" line are one
// reply), the last 2 hours kept
export function note(rec,ev){rec.ev||=[];if(ev.kind==='fail'&&ev.sid&&rec.ev.some(e=>e.kind==='fail'&&e.sid===ev.sid&&Math.abs(ev.t-e.t)<180e3))return rec;
 rec.ev.push({t:ev.t,kind:ev.kind,sid:ev.sid||''});const cut=ev.t-2*3600e3;if(rec.ev[0]?.t<cut)rec.ev=rec.ev.filter(e=>e.t>=cut);return rec}
// how long agents stay moved at least: 20 min, longer when the provider already had an outage in the 2 hours before
export const holdOf=(rec,R=RULES)=>R.hold*Math.min(3,1+(rec.ends||[]).filter(t=>(rec.since||0)-t<R.again).length);
// what to do about one provider now: 'start' an outage, 'end' it, or nothing
export function judge(rec,now,R=RULES){const ev=rec?.ev||[],n=(k,ms,from=0)=>ev.filter(e=>e.kind===k&&now-e.t<ms&&e.t>=from).length;
 // only what happened after the last outage ended counts toward a new one
 if(!rec?.on){const after=(rec?.ends||[]).at(-1)||0;return n('fail',R.window,after)>=R.fails||n('drop',R.window,after)>=R.drops?'start':null}
 if(now-rec.since<holdOf(rec,R))return null;
 return n('fail',R.clean)===0&&n('drop',R.clean)<=1&&n('ok',R.clean,rec.since)>=R.oks?'end':null}

/* ---------- keeping the lists and the switch ---------- */
const FIRST=1e6;   // the first look at a log reads its last 1 MB
export function createBackupModels({DATA,HERMES_HOME,live=false,agents,acc,readConfig,setKey,modelOk=()=>true,tell=async()=>{},nameOf=a=>a,clock=ms=>new Date(ms).toISOString().slice(11,16),probe=async()=>false,ready=async()=>{},R=RULES}){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const FILE=path.join(DATA,'backup-models.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}for(const k of ['offsets','p','wrote','lists','told'])db[k]||={};db.history||=[]}return db};
 let saving=Promise.resolve();const save=()=>saving=saving.then(async()=>{await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(db,null,1));await rename(t,FILE)}).catch(e=>console.warn('backup models: saving',e.message));
 // a provider in an outage: its priority entries are no one's backup and no one's way back up (auto-switch)
 const providerOf=k=>k.startsWith('claude:')?PLUGIN:k.slice(2);
 const held=k=>!!db?.p?.[providerOf(k)]?.on;
 const byHand=(d,profile,after=0)=>{const e=(d.events||[]).find(x=>x.profile===profile);return e?.why==='Chosen by hand'&&e.t>=after};

 /* the list one agent should have now; null when its gateway did not answer (nothing is known then) */
 // the engine sometimes answers with a shorter model list for a provider (the WhatsApp copies flipped between two Gemini
 // backups every few minutes, 31 Oct 2026): what a provider offered an agent in the last day is remembered and added in
 const seen=new Map();
 const fuller=(profile,slug,models)=>{const k=profile+'|'+slug,id=m=>typeof m==='string'?m:m?.id,now=Date.now(),was=seen.get(k);
  const keep=was&&now-was.at<24*3600e3?was.models.filter(m=>!models.some(x=>id(x)===id(m))):[];const all=[...models,...keep];
  if(models.length>=(was?.models.length||0)||!was||now-was.at>=24*3600e3)seen.set(k,{models:all,at:now});return all};
 async function wanted(profile,d,det){const opts=await acc.options(profile).catch(()=>null);if(!opts)return null;
  const provs=(opts.providers||[]).filter(p=>p.authenticated).map(p=>({...p,models:fuller(profile,p.slug,p.models||[])})),r=await acc.agentRoute(profile),cur=await acc.entryOf(d,profile),assigned=d.assign?.[profile]||'main';
  const ks=acc.keyStatus()||{},so=d.signedOut||{};
  // a Claude entry can only be this agent's own Claude account (the engine's Claude sign-in is one per agent)
  const usable=e=>{if(so[e.key]||/^(rejected|credit)$/.test(ks[e.key]?.state||''))return null;
   if(e.key.startsWith('claude:')){if(e.key.slice(7)!==assigned||!det[assigned]?.signedIn)return null;const p=provs.find(x=>x.slug===PLUGIN);return p?{provider:PLUGIN,models:p.models||[]}:null}
   const p=provs.find(x=>x.slug===e.key.slice(2));return p&&(p.models||[]).length?{provider:p.slug,models:p.models}:null};
  return {cur,route:r,list:backupList({priority:d.priority||[],cur,curProvider:r.provider,usable,modelOk:(p,m)=>modelOk(profile,p,m),held})}}
 let syncing=null,again=false;
 // every agent's list written when it differs (one at a time per agent, through the engine's own config set)
 function sync(why=''){if(syncing){again=true;return syncing}syncing=(async()=>{let r;try{do{again=false;r=await syncAll(why)}while(again);return r}finally{syncing=null}})();return syncing}
 async function syncAll(why){await load();await ready();const d=await acc.load(),det=Object.fromEntries(await Promise.all(acc.all(d).map(async a=>[a.id,await acc.details(a).catch(()=>null)])));const out=[];
  for(const profile of await agents()){try{const w=await wanted(profile,d,det);if(!w){out.push({profile,skip:'its gateway did not answer'});continue}
    const c=await readConfig(profile);if(!c){out.push({profile,skip:'its settings could not be read'});continue}
    const have=listOf(c.fallback_providers),mine=db.wrote[profile];
    // made by hand (hermes fallback add, or someone's own edit): theirs, left alone
    if(have.length&&!(mine&&sameList(have,mine))){db.lists[profile]={list:have,byHand:true,at:Date.now()};out.push({profile,byHand:true,list:have});continue}
    db.lists[profile]={list:w.list,at:Date.now()};
    if(sameList(have,w.list)){if(have.length)db.wrote[profile]=w.list;out.push({profile,list:w.list});continue}
    if(!live){out.push({profile,list:w.list,would:true});continue}
    const r=await setKey(profile,'fallback_providers',w.list);if(!r?.ok){out.push({profile,error:String(r?.err||'the engine did not accept it').slice(0,200)});continue}
    db.wrote[profile]=w.list;out.push({profile,list:w.list,wrote:true});console.log('backup models:',profile,'→',w.list.map(e=>e.provider+'/'+e.model).join(', ')||'none',why?'('+why+')':'')}
   catch(e){out.push({profile,error:e.message})}}
  db.syncAt=Date.now();await save();return out}
 let soonT=null;const soon=why=>{clearTimeout(soonT);soonT=setTimeout(()=>sync(why).catch(e=>console.warn('backup models',e.message)),3000);soonT.unref?.()};

 /* ---------- the engine logs ---------- */
 async function readRange(f,from,to){const h=await open(f,'r').catch(()=>null);if(!h)return Buffer.alloc(0);try{const n=Math.max(0,Math.min(to-from,8e6)),b=Buffer.alloc(n);await h.read(b,0,n,from);return b}finally{await h.close()}}
 // the lines written since the last look (a rotated log: the rest of agent.log.1 first); a line still being written waits
 async function readNew(f){const st=await stat(f).catch(()=>null);if(!st)return '';const o=db.offsets[f];let pre=Buffer.alloc(0),from;
  if(!o)from=Math.max(0,st.size-FIRST);
  else if(o.ino!==st.ino||st.size<o.pos){const old=await stat(f+'.1').catch(()=>null);if(old&&old.ino===o.ino&&old.size>o.pos){pre=await readRange(f+'.1',o.pos,old.size);pre=pre.subarray(0,pre.lastIndexOf(10)+1)}from=0}
  else from=o.pos;
  let b=await readRange(f,from,st.size);if(!o&&from>0){const i=b.indexOf(10)+1;b=b.subarray(i);from+=i}
  const cut=b.lastIndexOf(10)+1;db.offsets[f]={ino:st.ino,pos:from+cut};return pre.toString('utf8')+b.subarray(0,cut).toString('utf8')}
 const rec=slug=>db.p[slug]||={ev:[],on:false,ends:[]};
 async function scan(){for(const a of [...new Set(await agents())]){const text=await readNew(path.join(homeOf(a),'logs','agent.log'));if(!text)continue;
   for(const l of text.split('\n')){if(!/API call/.test(l))continue;const ev=parseLine(l);if(!ev)continue;const r=note(rec(ev.provider),ev);if(ev.kind!=='ok'&&ev.model)r.lastModel=ev.model}}}

 /* ---------- the switch ---------- */
 async function start(slug,now){await ready();const d=await acc.load(),p=rec(slug);const fails=p.ev.filter(e=>e.kind==='fail'&&now-e.t<R.window).length,drops=p.ev.filter(e=>e.kind==='drop'&&now-e.t<R.window).length;
  Object.assign(p,{on:true,since:now,moved:{},lastProbe:now,why:fails>=R.fails?fails+' failed replies in 10 minutes':drops+' dropped connections in 10 minutes'});
  const det=Object.fromEntries(await Promise.all(acc.all(d).map(async a=>[a.id,await acc.details(a).catch(()=>null)])));let brand='';const to=[],pinned=[];
  for(const profile of await agents()){const r=await acc.agentRoute(profile);if(r.provider!==slug)continue;brand||=brandOf(slug,r.model);p.model||=r.model;p.home||=profile;
   if(byHand(d,profile)){pinned.push(profile);continue}
   const w=await wanted(profile,d,det);const first=w?.list?.[0];if(!first){console.warn('backup models:',profile,'has no backup to move to');continue}
   const key=first.provider===PLUGIN?'claude:'+(d.assign?.[profile]||'main'):'p:'+first.provider;
   if(!live){p.moved[profile]={from:w.cur,model:r.model,to:key,toModel:first.model,at:now,would:true};continue}
   try{await acc.useEntry(d,profile,{key,model:first.model},(brand||brandOf(slug))+' kept dropping');p.moved[profile]={from:w.cur,model:r.model,to:key,toModel:first.model,at:now};to.push(brandOf(first.provider,first.model))}
   catch(e){console.warn('backup models: moving',profile,e.message)}}
  p.model||=p.lastModel||'';p.brand=brand||brandOf(slug,p.model);p.pinned=pinned;await save();const moved=Object.keys(p.moved);
  console.log('backup models:',p.brand,'outage ('+p.why+'); moved',moved.join(', ')||'nobody');sync('outage').catch(()=>{});
  if(moved.length&&!db.told[slug+':'+now+':start']){db.told[slug+':'+now+':start']=Date.now();await save();
   await tell(p.brand+' kept dropping; agents moved to '+names(to.length?to:['their backup'])+' at '+clock(now),{topic:'outage|'+p.provider,detail:p.why[0].toUpperCase()+p.why.slice(1)+'. Moved: '+moved.map(nameOf).join(', ')+(pinned.length?'. Left where they were put by hand: '+pinned.map(nameOf).join(', '):'')+'. aqeelOS tries '+p.brand+' every 5 minutes and moves them back once it works again.',whatsapp:true}).catch(e=>console.warn('backup models: telling the owner',e.message))}}
 async function end(slug,now){const d=await acc.load(),p=rec(slug),back=[],stay=[];
  for(const [profile,m] of Object.entries(p.moved||{})){if(m.would)continue;const cur=await acc.entryOf(d,profile).catch(()=>null);
   // someone moved it since (by hand, or the usage switch): it stays where it is now
   if(cur!==m.to||byHand(d,profile,m.at+1)){stay.push(profile);continue}
   if(!live)continue;
   try{await acc.useEntry(d,profile,{key:m.from,model:m.model},p.brand+' works again');back.push(profile)}catch(e){stay.push(profile);console.warn('backup models: moving back',profile,e.message)}}
  const since=p.since;p.on=false;p.ends=[...(p.ends||[]),now].slice(-10);db.history=[{provider:slug,brand:p.brand,since,until:now,moved:Object.keys(p.moved||{}),why:p.why},...db.history].slice(0,20);p.moved={};p.model='';p.home='';await save();
  console.log('backup models:',p.brand,'works again; moved back',back.join(', ')||'nobody');sync('outage over').catch(()=>{});
  if((back.length||stay.length)&&!db.told[slug+':'+since+':end']){db.told[slug+':'+since+':end']=Date.now();await save();
   await tell(p.brand+' works again; agents are back on '+p.brand+' at '+clock(now),{info:true,resolve:'outage|'+p.provider,detail:'It was dropping from '+clock(since)+' to '+clock(now)+'.'+(back.length?' Moved back: '+back.map(nameOf).join(', ')+'.':'')+(stay.length?' Left where they are now (moved since): '+stay.map(nameOf).join(', ')+'.':''),whatsapp:true}).catch(e=>console.warn('backup models: telling the owner',e.message))}}
 // a one-word question to the provider through the engine; a good answer counts as a call that worked, none as a failed reply
 async function tryIt(slug,now){const p=rec(slug);p.lastProbe=now;const ok=await probe({provider:slug,model:p.model||'',home:homeOf(p.home||'default')}).catch(()=>false);
  note(p,{t:Date.now(),kind:ok?'ok':'fail',sid:'probe-'+now});p.probes=[{t:now,ok},...(p.probes||[])].slice(0,12);console.log('backup models: tried',p.brand||slug,ok?'(it answered)':'(no answer)')}
 let ticking=null;
 function tick(now=Date.now()){if(ticking)return ticking;ticking=(async()=>{await load();await scan();
   for(const [slug,p] of Object.entries(db.p)){const v=judge(p,now,R);if(v==='start')await start(slug,now);else if(v==='end')await end(slug,now);else if(p.on&&now-(p.lastProbe||0)>=R.probeEvery)await tryIt(slug,now)}
   db.at=now;await save()})().finally(()=>{ticking=null});return ticking}
 if(live){setInterval(()=>tick().catch(e=>console.warn('backup models',e.message)),60e3).unref();setTimeout(()=>tick().catch(e=>console.warn('backup models',e.message)),30e3).unref();
  setInterval(()=>sync('every 5 min').catch(e=>console.warn('backup models',e.message)),5*60e3).unref();setTimeout(()=>sync('start').catch(e=>console.warn('backup models',e.message)),60e3).unref()}

 // for System › Health: each agent's backups, a switch going on now, the last ones
 async function status(){await load();const out=[];
  for(const [profile,x] of Object.entries(db.lists))out.push({agent:profile,name:nameOf(profile),backups:x.list.map(e=>brandOf(e.provider,e.model)),models:x.list.map(e=>e.model),byHand:!!x.byHand});
  const now=Object.entries(db.p).filter(([,p])=>p.on).map(([slug,p])=>({provider:slug,brand:p.brand||brandOf(slug),since:p.since,why:p.why||'',moved:Object.keys(p.moved||{}).map(nameOf),to:[...new Set(Object.values(p.moved||{}).map(m=>brandOf(providerOf(m.to),m.toModel)))],lastProbe:p.probes?.[0]||null}));
  return {at:db.syncAt||null,agents:out,outages:now,history:db.history.slice(0,3).map(h=>({...h,moved:h.moved.map(nameOf)}))}}
 return {sync,soon,tick,status,held,_db:async()=>load()}}

// The probe: one short, tool-free question through the engine's own provider code (scripts/probe-model.py), with the
// agent's engine home so it uses that agent's sign-in. True when anything came back.
export function engineProbe({python,root,engine}){return async({provider,model,home})=>{const py=await python();if(!py)return false;
 return new Promise(res=>{const c=execFile(py,[path.join(root,'scripts','probe-model.py'),engine,JSON.stringify({provider,model})],{timeout:120000,maxBuffer:1e6,cwd:home,env:{...process.env,HERMES_HOME:home}},(e,o)=>res(!e&&/\S/.test(String(o||''))));
  c.stdin.end()})}}
