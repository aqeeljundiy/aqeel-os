// Conflicts (11 Nov 2026). Owner's rule: "If there is ANY conflict, the agent asks me: you said A and you said B, what
// should I do?", with two sides, three or more. The agent never picks silently. Two sources land here:
//  - what aqeelOS finds itself, without a model: a schedule's prompt that says one number (skip if a post went out in the
//    last 45 minutes, max 8 a day) while the agent's Run rules or the schedule itself say another. Grouped by agent and
//    topic, one question per topic with every side in it.
//  - what an agent files itself (file_conflict): instructions against saved decisions, two people asking for different
//    things, a request against a policy, a skill against its instructions... any number of sides.
// Until it is answered the strictest side applies (never more posts, a longer gap than any side allows). The answer is
// recorded in one place and every losing version is removed: Run rules (posting-limits) and the schedule prompts for
// timing and limits, the agent's decisions file for the rest (the agent is told once and removes the losers).
// This file imports nothing from the app, so it can be copied to a server and run read-only: node rule-conflicts.mjs
import {readFile,writeFile,mkdir,rename,readdir,stat,copyFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const TOPICS={gap:{what:'time between posts',unit:'minutes',strict:'max',rule:'gapMin'},perDay:{what:'posts a day',unit:'a day',strict:'min',rule:'perDay'},perHour:{what:'posts an hour',unit:'an hour',strict:'min',rule:'perHour'}};

const toMin=(n,u)=>/^h/i.test(u)?n*60:n;

// What a number is about. Threads, comments and DMs are different things with different limits: a number is only ever
// compared with numbers about the same subject. Taken from the nearest word in the same sentence; none = unknown.
export const SUBJECTS={thread:{noun:'threads',re:/\b(?:own[- ]posts?|own[- ]threads?|threads?(?!\.com))\b/gi},comment:{noun:'comments',re:/\b(?:comments?|repl(?:y|ies))\b/gi},dm:{noun:'DMs',re:/\b(?:dms?|direct messages?|messages?)\b/gi}};
export function subjectIn(text,start,end){const t=String(text||'');let a=start;while(a>0&&start-a<110&&!/[.!?\n]/.test(t[a-1]))a--;
 let b=end;while(b<t.length&&b-end<30&&!/[.!?\n]/.test(t[b]))b++;
 let best=null,bd=Infinity;const seg=t.slice(a,b);for(const [k,S] of Object.entries(SUBJECTS)){const re=new RegExp(S.re.source,'gi');let m;
  while((m=re.exec(seg))){const ms=a+m.index,me=ms+m[0].length;const d=me<=start?start-me:ms>=end?ms-end+0.5:0;if(d<bd){bd=d;best=k}}}
 return best}
// what a Run rules record governs: an explicit "subject" (thread|comment|dm), else read from its pause file and page to check
export function ruleSubject(r){if(!r)return null;if(SUBJECTS[r.subject])return r.subject;
 let page='';try{page=new URL(r.checkUrl).pathname}catch{}   // the page's own path, not the site's name (threads.com is a site, not a subject)
 const t=[r.stopFile,page].filter(Boolean).join(' ').replace(/[_\/.-]/g,' ');const hits=Object.keys(SUBJECTS).filter(k=>new RegExp(SUBJECTS[k].re.source,'i').test(t));
 return hits.length===1?hits[0]:null}

// numbers a prompt states about timing and limits: {topic,value,start,end (the number), uEnd (end of the unit), unit}
export function claimsIn(prompt){const t=String(prompt||''),out=[];
 // m.indices (the d flag) gives where the number and its unit sit, so a rewrite touches only those characters
 const push=(topic,m,ni,ui)=>{const [s,e]=m.indices[ni],unit=ui?m[ui]:null,uEnd=ui?m.indices[ui][1]:e;
  out.push({topic,subject:subjectIn(t,s,uEnd),value:topic==='gap'?toMin(+m[ni],unit||'min'):+m[ni],start:s,end:e,uEnd,unit,text:t.slice(s,uEnd)})};
 let m;
 // gap: "Skip only if a thread went out in the last 45 minutes", "at least 20 minutes apart"
 const g1=/\b(?:skip|wait|do not post|don.t post|no new post|no post)\b[^.\n]{0,90}?\b(\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?)\b/gid;
 while((m=g1.exec(t)))push('gap',m,1,2);
 const g2=/\bat least (\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?)\s*(?:apart|between|since|after)/gid;while((m=g2.exec(t)))push('gap',m,1,2);
 const g3=/\b(\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?)\s*(?:apart|between (?:posts|runs|threads|comments))/gid;while((m=g3.exec(t)))push('gap',m,1,2);
 // a day and an hour: "max 8/day", "at most 20 a day", "3 DMs/h", "5 per hour"
 const d=/\b(?:max(?:imum)?|at most|up to|no more than|limit(?: of)?)?\s*(\d+)\s*(?:[a-z]+\s*){0,2}?(?:\/\s*day|per day|a day|each day)\b/gid;
 while((m=d.exec(t)))push('perDay',m,1,0);
 const h=/\b(?:max(?:imum)?|at most|up to|no more than|limit(?: of)?)\s*(\d+)\s*(?:[a-z]+\s*){0,2}?(?:\/\s*h(?:our)?\b|per hour|an hour|a hour)/gid;
 while((m=h.exec(t)))push('perHour',m,1,0);
 return out.sort((a,b)=>a.start-b.start)}

// the minutes of the hour a cron schedule fires at (only a minute field with every other field "*"), else null
export function minutesOf(s){if(!s||s.kind!=='cron'||typeof s.expr!=='string')return null;const f=s.expr.trim().split(/\s+/);if(f.length!==5||f.slice(1).some(x=>x!=='*'))return null;
 const set=new Set();for(const part of f[0].split(',')){const m=/^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);if(!m)return null;
  const step=m[4]?+m[4]:1,lo=m[1]?0:+m[2],hi=m[1]?59:m[3]!=null?+m[3]:m[4]?59:+m[2];if(!(step>0)||lo>hi||hi>59)return null;for(let v=lo;v<=hi;v+=step)set.add(v)}
 return [...set].sort((x,y)=>x-y)}
// the smallest gap between two runs (minutes), null when it cannot be told from the schedule
export function cadenceMin(s){if(!s)return null;if(s.kind==='interval'&&s.minutes>0)return s.minutes;
 const a=minutesOf(s);if(!a||!a.length)return null;if(a.length===1)return 60;let best=60-a.at(-1)+a[0];for(let i=1;i<a.length;i++)best=Math.min(best,a[i]-a[i-1]);return best}

const shortMin=v=>v%60===0&&v>=60?(v/60===1?'1 hour':v/60+' hours'):v+' minutes';
const noun=s=>SUBJECTS[s]?.noun||'posts';
const label=(topic,v,s)=>topic==='gap'?shortMin(v):topic==='perDay'?v+' '+noun(s)+' a day':v+' '+noun(s)+' an hour';
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const jobsOf=d=>Array.isArray(d)?d:d?.jobs||[];

// The scan itself, no files: agents = [{agent, jobs}], limits = posting-limits.json's agents {a:{on,gapMin,perHour,perDay}}
export function scan({agents=[],limits={},names=a=>a}={}){const out=[];
 for(const {agent,jobs} of agents){const by={},unknown=[];   // subject|topic -> list of {value, kind, where, when, job}
  const rules=limits?.[agent]?.on?limits[agent]:null,rs=ruleSubject(rules);
  for(const j of jobs){if(!j||!j.id||j.enabled===false||j.state==='completed'||typeof j.prompt!=='string')continue;
   const seen=new Set();
   for(const c of claimsIn(j.prompt)){const e={value:c.value,kind:'prompt',where:'the prompt of the schedule "'+(j.name||j.id)+'"',when:j.created_at||null,job:j.id,quote:c.text};
    if(!c.subject){unknown.push({topic:c.topic,...e});continue}
    (by[c.subject+'|'+c.topic]||=[]).push(e);
    // a schedule's own cadence only meets a gap its own prompt states, about the same thing
    if(c.topic==='gap'&&!seen.has(c.subject)){seen.add(c.subject);const cad=cadenceMin(j.schedule);if(cad)by[c.subject+'|gap'].push({value:cad,kind:'schedule',where:'the time of the schedule "'+(j.name||j.id)+'" ('+(j.schedule.display||j.schedule.expr||'every '+j.schedule.minutes+' min')+')',when:null,job:j.id})}}}
  // Run rules count for their own subject (none when it cannot be told): they join only that subject's sides
  const rulesIn=[];if(rules&&rs)for(const [topic,T] of Object.entries(TOPICS))if(Number.isFinite(rules[T.rule]))rulesIn.push({subject:rs,topic,value:rules[T.rule],kind:'rules',where:'Run rules of '+names(agent)+' (posting limits)',when:null});
  // Run rules on their own, against a prompt that says nothing about the same subject, are never a conflict
  for(const [key,src0] of Object.entries(by)){const [subject,topic]=key.split('|'),T=TOPICS[topic],src=[...src0,...rulesIn.filter(r=>r.subject===subject&&r.topic===topic)];
   const vals=[...new Set(src.map(s=>s.value))].sort((a,b)=>a-b);if(vals.length<2)continue;
   const sides=vals.map((v,i)=>{const s=src.filter(x=>x.value===v);return {key:String.fromCharCode(97+i),value:v,label:label(topic,v,subject),sources:s.map(x=>({kind:x.kind,where:x.where,when:x.when,job:x.job||null})),
    text:label(topic,v,subject)+': '+s.map(x=>x.where).join(' and ')}});
   const strict=T.strict==='max'?Math.max(...vals):Math.min(...vals),gates=!!rs&&subject===rs&&src.some(x=>x.kind==='rules'),what=topic==='gap'?'time between '+noun(subject):noun(subject)+(topic==='perDay'?' a day':' an hour');
   const id='c'+createHash('sha1').update(agent+'|'+subject+'|'+topic+'|'+sides.map(s=>s.value+':'+s.sources.map(x=>x.kind+x.job).join(',')).join('|')).digest('hex').slice(0,10);
   out.push({cid:id,source:'scan',agent,topic,subject,gates,title:names(agent)+': '+what+' is set differently in '+sides.length+' places',question:'The '+what+' for '+names(agent)+' is not the same everywhere. Which one should count?',
    sides,strict:{[T.rule]:strict},strictText:gates?'Until you choose, the strictest applies: '+label(topic,strict,subject)+'.':'Until you choose, nothing is held back: this does not touch the Run rules.',
    notes:unknown.filter(u=>u.topic===topic).map(u=>'Also in '+u.where+': "'+u.quote+'" (not clear what it is about, so not counted)'),jobs:[...new Set(src.map(x=>x.job).filter(Boolean))]})}}
 return out}

// every home's schedules and Run rules, read only. Works on any box: HERMES_HOME = ~/.hermes, DATA = the app's data folder
export async function scanFiles({HERMES_HOME,DATA,names=a=>a}){const agents=[];const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const list=['default'];for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))if(d.isDirectory()&&/^[a-z0-9][a-z0-9_-]{0,80}$/.test(d.name))list.push(d.name);
 for(const a of list){try{agents.push({agent:a,jobs:jobsOf(JSON.parse(await readFile(path.join(home(a),'cron','jobs.json'),'utf8')))})}catch{}}
 let limits={};try{limits=JSON.parse(await readFile(path.join(DATA,'posting-limits.json'),'utf8')).agents||{}}catch{}
 return scan({agents,limits,names})}

// a prompt with every claim of one topic set to the chosen value (nothing else in the text changes)
export function rewritePrompt(prompt,topic,value,subject){let t=String(prompt);const cl=claimsIn(t).filter(c=>c.topic===topic&&(!subject||c.subject===subject)).sort((a,b)=>b.start-a.start);
 for(const c of cl){const to=topic==='gap'?(c.unit&&/^h/i.test(c.unit)&&value%60===0?(value/60)+' '+c.unit:value+' '+(/^h/i.test(c.unit||'')||!c.unit?'minutes':c.unit)):String(value);
  t=t.slice(0,c.start)+to+t.slice(c.uEnd)}return t}

// a cron expression with runs at least `value` minutes apart, only when it slows the schedule and tiles the hour
export function slowerCron(schedule,value){const cad=cadenceMin(schedule),a=minutesOf(schedule);if(cad==null||!a||!(value>cad)||value>60||60%value!==0)return null;
 const off=a[0]%value;if(value===60)return off+' * * * *';const m=[];for(let v=off;v<60;v+=value)m.push(v);return m.join(',')+' * * * *'}

export function createConflicts({DATA,HERMES_HOME,names=a=>a,lock=async(f,fn)=>fn(),setRules=async()=>{},now=()=>Date.now(),log=m=>console.log(m),dayOf=t=>new Date(t).toISOString().slice(0,10).replace(/-/g,'')}){
 const FILE=path.join(DATA,'conflicts.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.items||=[]}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);

 // look again at every schedule and Run rule: new conflicts open, ones that no longer exist close
 async function sync(){await load();const found=await scanFiles({HERMES_HOME,DATA,names});const ids=new Set(found.map(f=>f.cid));let dirty=false;
  for(const f of found){const have=db.items.find(x=>x.cid===f.cid);if(!have){db.items.unshift({...f,state:'open',created:now()});dirty=true}
   else if(have.state==='open'){Object.assign(have,{sides:f.sides,strict:f.strict,strictText:f.strictText,jobs:f.jobs,notes:f.notes,gates:f.gates,subject:f.subject,title:f.title,question:f.question});dirty=true}}
  for(const x of db.items)if(x.source==='scan'&&x.state==='open'&&!ids.has(x.cid)){x.state='gone';x.closed=now();dirty=true}
  db.items=db.items.filter(x=>x.state==='open'||x.state==='answered'&&now()-x.answered.at<30*864e5);db.items=db.items.slice(0,200);
  if(dirty)await save();return found.length}

 // an agent files a conflict it found: any number of sides; one open question per agent and topic
 async function file(agent,{topic,question,sides,people=false}){await load();const T=String(topic||'').trim().slice(0,120);if(!T)throw Error('Say what the conflict is about (topic).');
  const S=(Array.isArray(sides)?sides:[]).map(s=>({what:String(s?.what||'').trim().slice(0,300),where:String(s?.where||'').trim().slice(0,200),when:String(s?.when||'').trim().slice(0,80)})).filter(s=>s.what);
  if(S.length<2)throw Error('A conflict has at least two sides: say what each one says, where it was said and when.');
  let r=db.items.find(x=>x.source==='agent'&&x.state==='open'&&x.agent===agent&&norm(x.topic)===norm(T));
  if(r){for(const s of S)if(!r.sides.some(x=>norm(x.what)===norm(s.what)))r.sides.push({key:String.fromCharCode(97+r.sides.length),label:s.what.slice(0,80),...s});r.sides=r.sides.slice(0,8);r.count=(r.count||1)+1;r.updated=now();if(question)r.question=String(question).slice(0,300);if(people)r.people=true}
  else{r={cid:'c'+randomBytes(6).toString('hex'),source:'agent',agent,topic:T,title:names(agent)+': '+T,question:String(question||'You told '+names(agent)+' things that do not fit together. Which one counts?').slice(0,300),
   sides:S.slice(0,8).map((s,i)=>({key:String.fromCharCode(97+i),label:s.what.slice(0,80),...s,text:s.what+(s.where?' ('+s.where+(s.when?', '+s.when:'')+')':'')})),strictText:'Until you choose, '+names(agent)+' follows the strictest side.',people:!!people,state:'open',created:now(),updated:now(),count:1};db.items.unshift(r)}
  for(const s of r.sides)s.text=s.text||s.what;await save();return r}

 // open ones as Bottlenecks items (Health "Needs you")
 async function open(mayUse=()=>true,admin=true){await load();
  return db.items.filter(r=>r.state==='open'&&(admin||mayUse(r.agent)&&!r.people)).map(r=>({id:'conflict|'+r.cid,kind:'conflict',cid:r.cid,agent:r.agent,agentName:names(r.agent),title:r.title,
   text:r.question+' '+(r.strictText||''),sides:r.sides.map(s=>({key:s.key,label:s.label,text:s.text,value:s.value??null})),topic:r.topic,notes:r.notes||[],source:r.source,created:r.created,from:null}))}

 // the answer. choice: a side's key, or 'other' with text (and a number for timing and limits)
 async function decide(cid,{choice,value,text}={},by=''){await load();const r=db.items.find(x=>x.cid===cid&&x.state==='open');if(!r)throw Error('That one was already answered.');
  let side=null,applied=null;if(choice==='other'){if(!String(text||'').trim()&&!(value!=null&&value!==''))throw Error('Say what should count instead.')}
  else{side=r.sides.find(s=>s.key===choice);if(!side)throw Error('Pick one of the choices.')}
  if(r.source==='scan'){const v=choice==='other'?Math.round(Number(value??text)):side.value;if(!Number.isFinite(v)||v<0)throw Error('For this one, give a number.');
   if(TOPICS[r.topic].strict==='min'&&v<1)throw Error('Give a number of 1 or more.');applied=await applyTiming(r,v)}
  r.state='answered';r.answered={choice,text:String(choice==='other'?text||value:side.text||'').slice(0,400),value:applied?.value??null,by:String(by).slice(0,80),at:now(),applied};r.acked=r.source==='scan';
  await save();log('conflict '+cid+' answered by '+by+': '+r.answered.text);return r}

 // timing and limits: Run rules and the schedule prompts say the chosen number, nothing else says another
 async function applyTiming(r,value){const T=TOPICS[r.topic],a=r.agent,res={value,rules:false,prompts:[],schedule:null,backup:[]};
  if(r.sides.some(s=>s.sources.some(x=>x.kind==='rules'))){await setRules(a,{[T.rule]:value});res.rules=true}
  const file=path.join(home(a),'cron','jobs.json');
  await lock(path.join(home(a),'cron','.jobs.lock'),async()=>{const raw=await readFile(file,'utf8'),d=JSON.parse(raw);let did=false;
   for(const j of jobsOf(d)){if(!j||!(r.jobs||[]).includes(j.id))continue;
    if(typeof j.prompt==='string'){const p=rewritePrompt(j.prompt,r.topic,value,r.subject);if(p!==j.prompt){j.prompt=p;did=true;res.prompts.push(j.name||j.id)}}
    if(r.topic==='gap'){const c=slowerCron(j.schedule,value);if(c){j.schedule={...j.schedule,expr:c,display:c};j.schedule_display=c;did=true;res.schedule=(j.name||j.id)+' now '+c}}}
   if(did){const b=file+'.bak-'+dayOf(now())+'-conflict';if(!await stat(b).then(()=>true,()=>false))await copyFile(file,b);res.backup.push(b);
    const keep=await stat(file).then(s=>s.mode&0o777,()=>0o600);await writeFile(file+'.tmp',JSON.stringify(d,null,2)+'\n',{mode:keep});await rename(file+'.tmp',file)}});
  return res}

 // strictest values from the open scan conflicts of an agent that are about what its Run rules govern (never a threads number for comments), for the run gate: {gapMin, perDay, perHour}
 async function strict(agent){await load();const o={};for(const r of db.items)if(r.state==='open'&&r.source==='scan'&&r.agent===agent&&r.gates===true)for(const [k,v] of Object.entries(r.strict||{}))o[k]=k==='gapMin'?Math.max(o[k]??0,v):Math.min(o[k]??Infinity,v);return o}

 // what an agent has to do now: answered conflicts it filed and has not yet written down
 async function answersFor(agent){await load();return db.items.filter(r=>r.source==='agent'&&r.agent===agent&&r.state==='answered'&&!r.acked)}
 async function ack(agent,cid){await load();const r=db.items.find(x=>x.cid===cid&&x.agent===agent&&x.state==='answered');if(!r)throw Error('No such answered conflict.');r.acked=true;await save();return r}
 async function mine(agent){await load();return db.items.filter(r=>r.source==='agent'&&r.agent===agent).slice(0,20)}
 // the lines added to the agent's turn only when it has an answer to write down
 async function contextLines(agent){const l=await answersFor(agent).catch(()=>[]);if(!l.length)return [];
  return ['','## Conflict answers to record','',...l.map(r=>'- "'+r.topic+'": the owner chose "'+r.answered.text+'" (conflict '+r.cid+'). Write it in your decisions file, delete every other version of it from your instructions, decisions, sheets and schedules, then call conflict_done with '+r.cid+'.')]}
 return {sync,file,open,decide,strict,answersFor,ack,mine,contextLines,list:async()=>(await load()).items}}

// node rule-conflicts.mjs [HERMES_HOME] [DATA]: read-only scan of a box, printed as JSON
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const H=process.argv[2]||process.env.HERMES_HOME||path.join(process.env.HOME||'.','.hermes'),D=process.argv[3]||process.env.UI_DATA_DIR||path.join(process.env.HOME||'.','apps','hermes-ui-data');
 scanFiles({HERMES_HOME:H,DATA:D}).then(r=>console.log(JSON.stringify(r,null,1)))}
