// Posting limits and live checks (5 Nov 2026, brief item 9). An agent that posts in public (Continue Threads' comments)
// used to keep its limits only in words inside prompts, run from hand-made loops it could not see, and comments that
// Threads hid were never noticed. Now, per agent, set on Schedules › Run rules:
//  - one run at a time: the engine runs that agent's schedules one after another (cron.max_parallel_jobs = 1), so two
//    runs never fight over its one browser; a schedule that is due waits for the one running;
//  - posting limits: a day, an hour, minutes between posts, lighter night hours, the share of hot leads and a pause
//    file. Before each posting run the engine asks aqeelOS (a small gate script in the agent's scripts folder): either
//    the run is skipped without starting the AI, or the agent is told how many it may post this time;
//  - live checks: after each post the agent calls record_post; aqeelOS opens the public page in a fresh, signed-out
//    browser and looks for the text, again about 30 minutes later. A post that is not visible is a failure: it shows
//    under Bottlenecks and is sent to the alert chat, and the agent slows down for a few hours.
import {readFile,writeFile,mkdir,rename,stat,mkdtemp,rm,chmod} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export const DEFAULTS={on:false,perDay:20,perHour:3,gapMin:10,perRun:2,quietFrom:1,quietTo:5,quietPerHour:1,hotShare:0,afterMissingPerHour:2,afterMissingHours:6,
 stopFile:'',checkUrl:'',alert:'',tz:'Asia/Jakarta',recheckMin:30};
const NUM={perDay:[1,500],perHour:[1,60],gapMin:[0,240],perRun:[1,20],quietFrom:[0,23],quietTo:[0,24],quietPerHour:[0,60],hotShare:[0,100],afterMissingPerHour:[0,60],afterMissingHours:[0,72],recheckMin:[5,240]};
export function clean(r){const o={...DEFAULTS};for(const [k,v] of Object.entries(r||{})){if(!(k in DEFAULTS))continue;
  if(k in NUM){const n=Math.round(Number(v));if(!Number.isFinite(n))throw Error(k+' must be a number');const [lo,hi]=NUM[k];o[k]=Math.min(hi,Math.max(lo,n))}
  else if(k==='on')o.on=!!v;
  else if(k==='stopFile'){const s=String(v||'').trim();if(s&&(s.startsWith('/')||s.split('/').includes('..')))throw Error('The pause file is a path inside the agent’s folder, like .tools/STOP_COMMENTS');o.stopFile=s.slice(0,200)}
  else if(k==='checkUrl'){const s=String(v||'').trim();if(s&&!/^https:\/\/[^\s]+$/.test(s))throw Error('The page to check is a full https:// address');o.checkUrl=s.slice(0,300)}
  else if(k==='alert'){const s=String(v||'').trim();if(s&&!/^telegram:-?\d+(:\d+)?$/.test(s))throw Error('Alerts go to telegram:<chat id> or telegram:<chat id>:<topic id>');o.alert=s}
  else if(k==='tz'){const s=String(v||'').trim();try{new Intl.DateTimeFormat('en',{timeZone:s})}catch{throw Error('Unknown time zone')}o.tz=s}}
 return o}

const fmt=new Map();
export function local(t,tz){if(!fmt.has(tz))fmt.set(tz,new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 const p=Object.fromEntries(fmt.get(tz).formatToParts(new Date(t)).map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)%24,clock:p.hour+':'+p.minute}}
const inQuiet=(h,a,b)=>a===b?false:a<b?h>=a&&h<b:h>=a||h<b;
const zoneName=tz=>tz==='Asia/Jakarta'?'WIB':tz.split('/').pop().replace(/_/g,' ');

// may this run post, and how many: the same numbers the person sees on the Run rules panel
export function decide(rules,entries,{now=Date.now(),stopped=false}={}){const r={...DEFAULTS,...rules},L=local(now,r.tz);
 const today=entries.filter(e=>local(e.at,r.tz).date===L.date),hour=entries.filter(e=>now-e.at<3600e3&&e.at<=now);
 const last=entries.reduce((m,e)=>Math.max(m,e.at),0),since=last?(now-last)/60e3:Infinity;
 const quiet=inQuiet(L.hour,r.quietFrom,r.quietTo),missing=entries.find(e=>e.status==='missing'&&now-(e.missingAt||e.at)<r.afterMissingHours*3600e3);
 let cap=r.perHour,why='';if(quiet&&r.quietPerHour<cap){cap=r.quietPerHour;why='night hours ('+String(r.quietFrom).padStart(2,'0')+':00 to '+String(r.quietTo).padStart(2,'0')+':00)'}
 if(missing&&r.afterMissingPerHour<cap){cap=r.afterMissingPerHour;why='a post was not visible on '+local(missing.missingAt||missing.at,r.tz).clock+', so slower for '+r.afterMissingHours+' hours'}
 const hot=today.filter(e=>e.lead==='hot').length,share=today.length?Math.round(hot/today.length*100):100;
 const base={today:today.length,perDay:r.perDay,hour:hour.length,cap,since:Number.isFinite(since)?Math.floor(since):null,share,quiet,slowed:!!missing,why,clock:L.clock+' '+zoneName(r.tz)};
 const no=reason=>({...base,allow:false,n:0,reason});
 if(stopped)return no('Paused: the pause file '+r.stopFile+' is there. Remove it to post again.');
 if(today.length>=r.perDay)return no('Done for today: '+today.length+' of '+r.perDay+' posted.');
 if(hour.length>=cap)return no(hour.length+' posted in the last hour, the limit is '+cap+(why?' ('+why+')':'')+'.');
 if(since<r.gapMin)return no('The last post was '+Math.floor(since)+' min ago; posts are at least '+r.gapMin+' min apart.');
 const n=Math.max(0,Math.min(r.perRun,cap-hour.length,r.perDay-today.length));
 return {...base,allow:n>0,n,reason:n>0?'':'No room left this hour.',needHot:r.hotShare>0&&share<r.hotShare}}

// the text the engine puts in front of the agent's instructions for a posting run
export function gateText(r,d){if(!d.allow)return 'aqeelOS posting limits ('+d.clock+'): no post this run. '+d.reason+'\n{"wakeAgent": false}';
 return ['aqeelOS posting limits, checked '+d.clock+' (these numbers count; they replace any count of your own):',
  '- Today: '+d.today+' of '+d.perDay+' posted'+(r.hotShare>0?', '+d.share+'% hot leads (target '+r.hotShare+'%)':'')+'.',
  '- Last hour: '+d.hour+' of '+d.cap+(d.why?' ('+d.why+')':'')+'. '+(d.since==null?'Nothing posted yet.':'Last post '+d.since+' min ago.'),
  '- This run: post at most '+d.n+(d.n>1?', at least '+r.gapMin+' min apart':'')+'.',
  ...(r.hotShare>0?[d.needHot?'- The hot share is below target: post only to HOT leads this run.':'- The hot share is on target: hot leads first; one warm lead is fine.']:[]),
  '- Right after EACH post, call record_post (aqeelos-notify) with the post link, the exact text you posted and the lead (hot or warm). It checks that the public can see it.',
  '- If record_post says it is NOT visible: stop posting this run, and start your final answer with the line [CRON_FAILURE], then one line on what happened.'].join('\n')}

// the words to look for on the public page: letters and digits only (Threads shortens links and shows emoji its own way)
export const squash=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function needle(text){const s=squash(String(text||'').split('\n').find(l=>squash(l).length>=12)||text);return s.slice(0,40)}
export const seen=(page,text)=>{const n=needle(text);return n.length>=6&&squash(page).includes(n)};

// a public page as someone signed out sees it: a fresh headless Chrome with an empty profile, closed after each look
export function headlessLook({chrome='/opt/aqeelos/chrome/chrome',wait=9000}={}){let chain=Promise.resolve();
 const once=async url=>{const dir=await mkdtemp(path.join(tmpdir(),'aq-look-'));let c;
  try{c=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+dir,'--window-size=1200,2400','about:blank'],{stdio:['ignore','ignore','pipe']});
   const wsUrl=await new Promise((res,rej)=>{let b='';const t=setTimeout(()=>rej(Error('the check browser did not start')),20000);c.on('error',e=>{clearTimeout(t);rej(e)});
    c.stderr.on('data',d=>{b+=d;const m=/DevTools listening on (ws:\S+)/.exec(b);if(m){clearTimeout(t);res(m[1])}})});
   const ws=new WebSocket(wsUrl);let i=0;const pend={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id]}};
   await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(Error('the check browser did not answer'))});
   const call=(method,params={},sessionId)=>new Promise(r=>{i++;pend[i]=r;ws.send(JSON.stringify({id:i,method,params,...(sessionId?{sessionId}:{})}))});
   const {result:{targetId}}=await call('Target.createTarget',{url:'about:blank'});const {result:{sessionId}}=await call('Target.attachToTarget',{targetId,flatten:true});
   await call('Page.navigate',{url},sessionId);await new Promise(r=>setTimeout(r,wait));
   await call('Runtime.evaluate',{expression:'window.scrollBy(0,2400)'},sessionId);await new Promise(r=>setTimeout(r,2500));
   const v=(await call('Runtime.evaluate',{expression:'document.body?document.body.innerText:""',returnByValue:true},sessionId)).result?.result?.value;ws.close();
   if(typeof v!=='string')throw Error('the page did not load');return v}
  finally{if(c&&c.exitCode==null){const gone=new Promise(r=>c.once('exit',r));c.kill('SIGKILL');await Promise.race([gone,new Promise(r=>setTimeout(r,5000))])}
   await rm(dir,{recursive:true,force:true}).catch(()=>{})}};
 // one look at a time on the box (each is a whole Chrome)
 return url=>{const p=chain.then(()=>Promise.race([once(url),new Promise((_,rej)=>setTimeout(()=>rej(Error('the check took too long')),60000))]));chain=p.catch(()=>{});return p}}

export function createPostingLimits({DATA,WORK,HERMES_HOME,PORT,live=true,reconnect=async()=>{},sig,setKey,readConfig,pick,look=headlessLook(),event=async()=>{},telegram=async()=>false,nameOf=a=>a,log=m=>console.log(m),now=()=>Date.now(),retryMs=40000}){
 const FILE=path.join(DATA,'posting-limits.json'),LOGS=path.join(DATA,'posting-log');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.agents||={};db.gates||={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const posts=new Map();
 const logFile=a=>path.join(LOGS,a+'.json');
 async function entries(a){if(!posts.has(a)){let l=[];try{l=JSON.parse(await readFile(logFile(a),'utf8'))}catch{}posts.set(a,l)}return posts.get(a)}
 async function keep(a){const l=(await entries(a)).filter(e=>now()-e.at<14*864e5);posts.set(a,l);await mkdir(LOGS,{recursive:true});await writeFile(logFile(a)+'.tmp',JSON.stringify(l));await rename(logFile(a)+'.tmp',logFile(a))}
 const rulesOf=async a=>{await load();return db.agents[a]?clean(db.agents[a]):null};
 const stopped=async(a,r)=>!!(r.stopFile&&await stat(path.join(WORK,a,r.stopFile)).catch(()=>null));
 const gateName='aqeelos-posting-gate.sh',gatePath=a=>path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'scripts',gateName);
 // the gate script the engine runs before a posting run (its last line says whether the AI starts at all)
 async function writeGate(a){if(!live)return gateName;const f=gatePath(a);await mkdir(path.dirname(f),{recursive:true});
  const body='#!/bin/bash\n# Written by aqeelOS (Schedules › Run rules › Posting limits). Asks aqeelOS whether this run may post.\n'
   +'curl -sf -m 20 "http://127.0.0.1:'+PORT+'/posting-gate/'+a+'/'+sig(a)+'" || printf \'aqeelOS did not answer, so no post this run.\\n{"wakeAgent": false}\\n\'\n';
  if((await readFile(f,'utf8').catch(()=>''))!==body){await writeFile(f,body,{mode:0o700});await chmod(f,0o700)}return gateName}
 async function gate(a){const r=await rulesOf(a);if(!r?.on)return 'aqeelOS posting limits are off for this agent: no post this run.\n{"wakeAgent": false}';
  const d=decide(r,await entries(a),{now:now(),stopped:await stopped(a,r)});await load();db.gates[a]={at:now(),allow:d.allow,n:d.n,reason:d.reason};await save();return gateText(r,d)}

 async function alert(a,r,e,how){const who=nameOf(a),short=String(e.text).replace(/\s+/g,' ').slice(0,140);
  const title=who+': a post is not visible on Threads';
  const detail=(how==='later'?'It was visible at first and was gone '+r.recheckMin+' min later. ':'It was not visible right after posting. ')+'Post: '+(e.post||'unknown')+'. Text: "'+short+'". '+who+' posts at most '+r.afterMissingPerHour+' an hour for the next '+r.afterMissingHours+' hours.';
  await event('comment',title,detail,{topic:'comment|'+e.id,agent:a}).catch(()=>{});
  const m=/^telegram:(-?\d+)(?::(\d+))?$/.exec(r.alert||'');let sent=false;if(m)sent=await telegram(a,m[1],m[2]||null,'⚠️ '+title+'\n'+detail).catch(()=>false);
  e.alerted=now();e.alertSent=!!sent;log('posting: '+a+' post '+e.id+' not visible ('+how+')'+(m&&!sent?', alert not delivered':''))}
 // look on the public page first, then on the post itself
 // 'unchecked' when no page could be opened at all (the check browser failed): that is not the post's fault
 async function check(a,r,e){let looked=false;for(const u of [r.checkUrl,e.post].filter(Boolean)){try{const p=await look(u);looked=true;if(seen(p,e.text))return 'visible'}catch{}}return looked?'missing':'unchecked'}

 // record_post: the agent says what it just posted; the answer says whether the public can see it
 async function record(a,{post_url,text,lead}){const r=await rulesOf(a);if(!r?.on)return {isError:true,text:'You have no posting limits in aqeelOS, so nothing to record.'};
  const t=String(text||'').trim();if(!t)return {isError:true,text:'Give the exact text you posted.'};
  const u=String(post_url||'').trim();if(u&&!/^https:\/\/\S+$/.test(u))return {isError:true,text:'post_url is the full https:// link of the post you replied to.'};
  const l=await entries(a),before=decide(r,l,{now:now(),stopped:await stopped(a,r)});
  const e={id:randomBytes(5).toString('hex'),at:now(),post:u,text:t.slice(0,2000),lead:lead==='warm'?'warm':'hot',status:'checking'};
  if(!before.allow){e.over=before.reason;await event('comment',nameOf(a)+' posted over its limits',before.reason+' Post: '+(u||'unknown')+'.',{topic:'comment-over',agent:a}).catch(()=>{})}
  l.push(e);await keep(a);
  let s=await check(a,r,e);if(s!=='visible'){await new Promise(x=>setTimeout(x,retryMs));s=await check(a,r,e)}
  e.checkedAt=now();if(s==='missing'){e.status='missing';e.missingAt=now();await alert(a,r,e,'now')}else e.status=s;await keep(a);
  const d=decide(r,l,{now:now(),stopped:await stopped(a,r)});const count='Today: '+d.today+' of '+d.perDay+(r.hotShare>0?', '+d.share+'% hot':'')+'.';
  const over=e.over?' Note: this post was over the limits ('+e.over+'). The owner sees that under Bottlenecks.':'';
  if(e.status==='visible')return {text:'Recorded and visible to the public on Threads (checked signed out). '+count+over};
  if(e.status==='unchecked')return {text:'Recorded. The visibility check could not run right now; aqeelOS checks it again within minutes. '+count+over};
  return {isError:true,text:'NOT visible: the post cannot be found on the public page or the post itself (checked signed out, twice). The owner has been told. Stop posting this run, and start your final answer with the line [CRON_FAILURE], then one line on what happened.'+over}}

 // every minute: checks that could not run, and the second look about 30 minutes after each post
 let busy=false;
 async function tick(){if(busy)return;busy=true;try{await load();for(const a of Object.keys(db.agents)){const r=await rulesOf(a);if(!r?.on)continue;const l=await entries(a);
   const e=l.find(x=>x.status==='unchecked'&&now()-x.at>60e3)||l.find(x=>x.status==='visible'&&!x.rechecked&&now()-x.at>=r.recheckMin*60e3&&now()-x.at<6*3600e3);if(!e)continue;
   const s=await check(a,r,e);if(s==='unchecked'){if(now()-e.at>3600e3){e.status='missing';e.missingAt=now();e.checkFailed=true;await alert(a,r,e,'now')}continue}
   if(e.status==='visible')e.rechecked=now();e.checkedAt=now();
   if(s==='missing'){const was=e.status;e.status='missing';e.missingAt=now();await alert(a,r,e,was==='visible'?'later':'now')}else e.status='visible';await keep(a)}}
  catch(x){log('posting check: '+x.message)}finally{busy=false}}

 // Run rules panel: the agent's one-at-a-time setting, its limits, today's numbers and its recent posts
 async function view(a){const c=await readConfig(a).catch(()=>null);const serial=Number(pick(c||{},'cron.max_parallel_jobs'))===1;const r=await rulesOf(a),l=await entries(a);await load();
  const d=r?decide(r,l,{now:now(),stopped:await stopped(a,r)}):null;
  return {agent:a,serial,rules:r||{...DEFAULTS},set:!!r,gateScript:gateName,status:d,stopped:r?await stopped(a,r):false,lastGate:db.gates[a]||null,
   recent:l.slice(-25).reverse().map(e=>({id:e.id,at:e.at,post:e.post,text:e.text.slice(0,240),lead:e.lead,status:e.status,rechecked:e.rechecked||null,over:e.over||null,alerted:e.alerted||null}))}}
 async function set(a,b){if(b.serial!==undefined){const r=await setKey(a,'cron.max_parallel_jobs',b.serial?'1':'0');if(r&&r.ok===false)throw Error('Could not change it: '+String(r.out||'').trim().slice(-200))}
  // turned on: its gate script, and its aqeelOS tool connection again so record_post is listed (the engine keeps the list it read first)
  if(b.rules){await load();const was=!!db.agents[a]?.on;const r=clean({...(db.agents[a]||{}),...b.rules});db.agents[a]=r;await save();if(r.on)await writeGate(a);if(r.on!==was&&live)await reconnect(a).catch(e=>log('posting: tool reconnect '+a+': '+e.message))}
  return view(a)}
 // gate scripts for every agent with limits on (a restored box, a new port)
 async function ensure(){await load();for(const a of Object.keys(db.agents))if(db.agents[a].on)await writeGate(a).catch(e=>log('posting gate '+a+': '+e.message))}
 const usesLimits=async a=>!!(await rulesOf(a))?.on;
 return {gate,record,tick,view,set,ensure,usesLimits,gateName}}
