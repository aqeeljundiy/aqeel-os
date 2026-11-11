// Better design by default (12 Nov 2026). Owner's reason: his team builds automations by asking the agents, and the agents built the
// first thing asked, an AI on a timer ("run this script every 5 minutes and repeat what it prints": 376 model starts a day, 95% silent),
// where he, not a technical person, saw the right design at once ("it should fire when the payment is paid"). The agents must bring that
// judgement themselves. Five parts, all without a model:
//  1. The rule (RULE_LINES, in every agent's context): say what starts the work and choose, in this order, an event the system already
//     sees, a script on a timer with no AI, a check before the AI, the AI on a timer. One sentence to the person on the choice.
//  2. The means: my_schedules and manage_agent's schedule part take `script` (a command in the agent's own folder that IS the job),
//     `checks` (the standard no-model checks of run-check.mjs) or `check_script` (the agent's own check) in front of the AI, and
//     `on_event` from EVENTS, the one published list of events this install really emits. Inputs are checked strictly: a command is plain
//     words inside the agent's folder (event-hooks.mjs commandOf), a file must exist there, check flags come from a fixed list.
//  3. The review at creation and on change (classify): "run X and repeat the output" becomes script-only (or is refused with the exact call
//     when its lines are filtered), "step 0: run X, stop if nothing" is refused with the call that puts X in front as the check, faster than
//     every 30 minutes with no check and no event is asked to add one. The reason is in the tool's answer, so the agent tells the person.
//     The engine's own cronjob tool asks the same review through the aqeelos-live plugin (engineCall).
//  4. The feedback loop (review, needs, decide): from the engine's run records (<home>/cron/usage_audit.jsonl, one line per model run with
//     response_silent), a schedule with 12 or more runs in 7 days of which 80% or more said nothing is one Health item per agent, with the
//     better design and a button that applies it where that is mechanical (convert).
//  5. "Why this trigger" is kept per schedule (DATA/design-guard.json) and shown on its card (triggers).
import {readFile,writeFile,rename,mkdir,stat,chmod,realpath,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {commandOf,cleanHook,fallbackScript} from './event-hooks.mjs';
import {GATE_PREFIX,CHECK_PREFIX,MIN_CADENCE,cadenceOf,suggestCheck,checkBody} from './run-gates.mjs';

// The events this install emits (server.mjs emitEvent: both an event hook, a script with no model, and an event-started run can start
// from each). Only what the code really sees: paid-labels.mjs (payments), kirimdev.mjs (the WhatsApp line), tebar.mjs (the webhook).
export const EVENTS=[
 {id:'payment.paid',from:'payments',what:'a payment on your line was confirmed paid (Tripay, Xendit)'},
 {id:'order.posted',from:'payments',what:'a paid order was posted to your Orders topic'},
 {id:'whatsapp.received',from:'kirimdev',what:'a customer wrote to your Kirimdev WhatsApp line'},
 {id:'whatsapp.unanswered',from:'kirimdev',what:'a handoff on your Kirimdev line got no answer from the team for 30 minutes'},
 {id:'comment.created',from:'tebar',what:'a new comment on a social account connected through Tebar'},
 {id:'comment.replied',from:'tebar',what:'a comment was answered (Tebar)'},
 {id:'message.received',from:'tebar',what:'a new Instagram DM (Tebar)'},
 {id:'post.published',from:'tebar',what:'a Tebar post went out'},
 {id:'post.failed',from:'tebar',what:'a Tebar post failed'}];
export const EVENT_IDS=EVENTS.map(e=>e.id);
export const eventHelp=()=>EVENTS.map(e=>e.id+' ('+e.what+')').join('; ');

// the rule, in every agent's context (server.mjs writeAgentContext): short, every word is paid on every turn
export const RULE_LINES=['','## Automations: choose the trigger first','',
 'Before you build anything that runs by itself, say what starts the work and take the first that fits: 1) an event aqeelOS already sees, such as a payment paid or a message or comment arriving (my_schedules on_event); 2) a script on a timer with no AI, when the job is to run a command and pass on what it prints (my_schedules script); 3) a no-AI check in front of the AI, when there is only sometimes something to do (my_schedules checks or check_script); 4) the AI on a timer, only when every run needs judgement. Tell the person in one sentence which you chose and why. Never write a schedule whose job is "run this and repeat the output".'];
// what the two schedule tools add to their descriptions and schemas
export const TOOL_HELP=' Choose the trigger first: on_event starts it when something happens, script runs a command with no AI, checks or check_script decide without AI whether the AI starts; a plain prompt on a timer is for work that needs judgement every run. Say which you chose in why. Events: '+eventHelp()+'.';
export const TOOL_PROPS={
 script:{type:'string',description:'a command inside your own folder that IS the job, no AI: "python3 sales-recap/run.py". What it prints is delivered; nothing printed, nothing sent. Plain words only, no absolute path'},
 keep:{type:'string',description:'with script: only lines matching this pattern are delivered, like "-> OK|ERROR"'},
 drop:{type:'string',description:'with script: lines matching this pattern are left out'},
 prefix:{type:'string',description:'with script: put in front of each delivered line, like "Recap: "'},
 checks:{type:'string',description:'a standard no-AI check before each start; the AI starts only when there is something: --dms (unread DMs), --comments (unanswered Tebar comments), --posting (posting limits allow a post), --new-since file:<path in your folder> (the file changed), --max-idle <minutes> (a safety run)'},
 check_script:{type:'string',description:'your own no-AI check: a command inside your own folder; the AI starts only when it prints something, and gets what it printed'},
 on_event:{type:'array',items:{type:'string',enum:EVENT_IDS},description:'start when one of these happens instead of on the clock. With script: the script runs at once (no AI; schedule is then optional and only a slow safety run). With prompt: the schedule starts at once; its clock is the slow safety run (hourly or slower)'},
 accept_cost:{type:'boolean',description:'only when the person, told that it starts the AI every few minutes with nothing to check, still wants it'}};

const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};
const sha=s=>createHash('sha1').update(String(s)).digest('hex');
const base=a=>String(a).split('--')[0];
const b64=s=>Buffer.from(String(s)).toString('base64');
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const TARGET=/^[a-z_]{2,30}:-?[\w.-]{1,80}(:\d{1,12})?$/;
export const TRIGGER_LABEL={event:'Starts on an event',script:'A script on a timer, no AI',check:'A check first, then the AI',model:'The AI on a timer'};

// ---- reading a schedule -------------------------------------------------------------------------------------------------
// minutes between two starts, from the words an agent gives ("every 5m", "30m", "*/10 * * * *") or the engine's schedule object
export function cadenceOfText(s){if(s&&typeof s==='object')return cadenceOf(s);const t=String(s||'').trim().toLowerCase();
 const m=/^(?:every\s+)?(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/.exec(t);if(m)return +m[1]*(m[2][0]==='m'?1:m[2][0]==='h'?60:1440);
 return t.split(/\s+/).length===5?cadenceOf({kind:'cron',expr:t}):null}

const HEAD=/(?:\bin (?:the|your) terminal,?\s+)?\b(?:run|execute)\b(?:\s+in (?:the|your) terminal)?(?:\s+exactly)?(?:\s+(?:this|the following))?(?:\s+(?:terminal|shell))?(?:\s+(?:command|script))?(?:\s+exactly)?(?:\s+and nothing else)?\s*:\s*(.+?)\s*$/im;
const COMMANDISH=/^(?:(?:python3?|bash|sh|node|cd)\s+\S|(?:\.{0,2}|~)?\/?[\w.-]+\/[\w.\/-]+|[\w.-]+\.(?:py|sh|mjs|js)\b)/;
const PASS_ON=/\[SILENT\]|\bverbatim\b|\bunchanged\b|\b(?:final|entire|whole)\b[^.\n]{0,40}\b(?:response|answer|reply)\b[^.\n]{0,30}\bexactly\b|\breply with only\b/i;
const NEGATED=/(?:^|[.;,:!(\n])\s*(?:never|do not|don't|do nothing else|no)\b[^.;,\n)]*/gi;
const JUDGEMENT=/\b(then|also|summari[sz]e|translate|decide|analy[sz]e|draft|explain|compare|choose|research|investigate|send (?:it|a|an|the|them|him|her)|post\b|reply to|message (?:the|a|him|her)|if\b[^.\n]*\b(?:fails?|errors?)\b[^.\n]*\b(?:fix|try|repair))\b/i;
const Q='(?:\'[^\'\\n]{1,40}\'|"[^"\\n]{1,40}")',QLIST=Q+'(?:\\s*(?:,|or|and)\\s*'+Q+')*';
const quoted=s=>[...String(s||'').matchAll(new RegExp(Q,'g'))].map(m=>m[0].slice(1,-1));
// the fixed line rule of an echo prompt ("skip lines containing 'skip:'", "if any line contains '-> OK' or 'ERROR' reply with only those", "rewritten as 'Recap: <...>'")
export function filterOf(text){const t=String(text||'');
 const drop=quoted(new RegExp('\\b(?:skip|ignore|drop|leave out)\\s+(?:the\\s+|any\\s+)?lines?\\s+(?:containing|that contain|with)\\s+('+QLIST+')','i').exec(t)?.[1]);
 const keep=quoted(new RegExp('\\b(?:if any line contains|(?:keep|reply with|pass on|send)\\s+only\\s+(?:the\\s+)?lines?\\s+(?:containing|that contain|with)|only\\s+(?:the\\s+)?lines?\\s+(?:containing|that contain|with))\\s+('+QLIST+')','i').exec(t)?.[1]);
 const prefix=/\b(?:rewritten|written|prefixed|formatted) (?:as|with):?\s*['"]([^'"<\n]{1,40})/i.exec(t)?.[1]||'';
 return keep.length||drop.length||prefix?{keep:keep.map(esc).join('|'),drop:drop.map(esc).join('|'),prefix}:null}
// {cmd, filter} when a prompt's whole job is to run one command and pass on what it prints (a fixed line filter is not judgement), else null
export function echoOf(prompt){const p=String(prompt||''),m=HEAD.exec(p);if(!m||m.index>160)return null;
 const before=p.slice(0,m.index).trim();if(before&&(!/[.!:]$/.test(before)||before.length>100||/\b(check|read|open|look|search|find|load|query|fetch|compare)\b/i.test(before)))return null;
 const cmd=m[1].replace(/^`+|`+\.?$/g,'').trim();if(!cmd||cmd.length>500||!COMMANDISH.test(cmd))return null;
 const rest=p.slice(m.index+m[0].length);if(!PASS_ON.test(rest))return null;
 // anything beyond running it and passing its output on (sending, deciding, editing) needs the model
 if(JUDGEMENT.test(rest.replace(NEGATED,' ')))return null;return {cmd,filter:filterOf(rest)}}
// the command of "STEP 0: run `X`. If it prints nothing, reply [SILENT] and stop", when the prompt goes on with real work after it
const STEP0=/\b(?:step\s*0|step zero|first(?: of all)?|before anything else|before you start)\b[^\n`]{0,60}?\brun\b[^\n`]{0,40}?`([^`\n]{3,300})`[\s\S]{0,20}?\bif it (?:prints|returns|outputs|shows) nothing\b[^\n]{0,100}?(?:\[SILENT\]|\bstop\b)/i;
export function step0Of(prompt){const p=String(prompt||''),m=STEP0.exec(p.slice(0,900));if(!m||!COMMANDISH.test(m[1].trim()))return null;
 return p.length-(m.index+m[0].length)>80?m[1].trim():null}

// The review of one schedule, from its prompt and cadence alone:
//  echo  = it runs one command and repeats the output: no AI needed (cmd, filter)
//  step0 = its first step is a script that decides whether to go on: that script is the check (cmd)
//  fast  = it starts the AI more often than every 30 minutes with no check and no event (every, suggest)
//  ok    = nothing to say (trigger: script | event | check | model; quiet: the prompt has a [SILENT] way out a check could take over)
export function classify({prompt='',schedule=null,no_agent=false,hasCheck=false,hasEvent=false}={}){
 if(no_agent)return {kind:'ok',trigger:'script'};
 const e=echoOf(prompt);if(e)return {kind:'echo',...e};
 const s=hasCheck?null:step0Of(prompt);if(s)return {kind:'step0',cmd:s};
 const c=cadenceOfText(schedule);
 if(c!=null&&c<MIN_CADENCE&&!hasCheck&&!hasEvent)return {kind:'fast',every:c,suggest:suggestCheck(prompt)};
 return {kind:'ok',trigger:hasEvent?'event':hasCheck?'check':'model',quiet:!hasCheck&&!hasEvent&&/\[SILENT\]/.test(prompt)}}

// ---- inputs ---------------------------------------------------------------------------------------------------------------
// a prompt's command with the agent's own folder taken off ("python3 -I /w/a/x/run.py" -> "python3 -I x/run.py"), when what is left is plain words inside it
export function relCommand(cmd,cwd){const c=String(cmd||'').trim().split(String(cwd).replace(/\/+$/,'')+'/').join('');return commandOf(c)?c:null}
// the file a command runs: the first word that is not the interpreter or a flag
export const fileOf=run=>{const c=commandOf(run);if(!c)return null;const t=String(run).trim().split(/\s+/);return /^(python3?|bash|sh|node)$/.test(t[0])?t.slice(1).find(x=>!x.startsWith('-'))||null:t[0]};
// a command an agent gave: plain words inside its own folder, and its file is there (a link out of the folder does not count). Throws the reason.
export async function checkedCommand(run,dir,what='script'){const f=/[\n\r\0]/.test(String(run))?null:fileOf(run);
 if(!f)throw Error(what+' must be a command of plain words inside your own folder, like "python3 reports/run.py" (no absolute path, no "..", no quotes, pipes or ;).');
 const p=path.resolve(dir,f),root=await realpath(dir).catch(()=>null),real=await realpath(p).catch(()=>null);
 if(!root||!real||!(real+path.sep).startsWith(root+path.sep)||!(await stat(real).catch(()=>null))?.isFile())throw Error(what+': the file '+f+' is not in your own folder. Write it there first, then call this again.');
 return String(run).trim().split(/\s+/).join(' ')}
// the flags of scripts/run-check.mjs an agent may ask for; a file path is one inside its own folder. Throws the reason.
export function cleanChecks(text,dir){const t=String(text||'').trim().split(/\s+/).filter(Boolean),out=[];let work=false;const root=String(dir).replace(/\\/g,'/').replace(/\/+$/,'');
 if(!/^[\w.\/:-]+$/.test(root))throw Error('checks cannot be used for this folder.');
 for(let i=0;i<t.length;i++){const f=t[i],v=t[i+1]||'';
  if(f==='--dms'||f==='--comments'||f==='--posting'){out.push(f);work=true;continue}
  if(f==='--new-since'){const m=/^file:([\w.\/-]+)$/.exec(v);if(!m||m[1].startsWith('/')||m[1].split('/').includes('..'))throw Error('--new-since takes file:<a path inside your own folder>, like file:feed/payments.jsonl.');out.push(f,'file:'+root+'/'+m[1].replace(/^\.\//,''));work=true;i++;continue}
  if(f==='--max-idle'||f==='--retries'){if(!/^\d{1,4}$/.test(v))throw Error(f+' takes a number.');out.push(f,v);i++;continue}
  if(f==='--dm-mode'){if(!/^(both|title|inbox)$/.test(v))throw Error('--dm-mode is both, title or inbox.');out.push(f,v);i++;continue}
  if(f==='--platform'||f==='--account'){if(!/^[\w-]{1,40}$/.test(v))throw Error(f+' takes one plain word.');out.push(f,v);i++;continue}
  throw Error('Unknown check "'+clip(f,30)+'". The standard checks: --dms, --comments, --posting, --new-since file:<path>, --max-idle <minutes>. For anything else write a small script and pass it as check_script.')}
 if(!work)throw Error('checks needs at least one of --dms, --comments, --posting or --new-since file:<path>.');
 if(out.includes('--dms')&&!out.includes('--max-idle'))out.push('--max-idle','60');return out.join(' ')}
const pattern=(v,what)=>{const s=String(v??'');if(!s)return '';if(s.length>120||/[\n\r\0]/.test(s))throw Error(what+' is one short line.');try{new RegExp(s)}catch{throw Error(what+' is not a valid pattern.')}return s};

// ---- the scripts aqeelOS writes --------------------------------------------------------------------------------------------
// The engine runs a schedule's script as the box's own user, so the agent's command runs as the agent's own user (ssh to 127.0.0.1 with
// aqeelOS's agent key, as agent-care.mjs does): never with more rights than the agent has. Everything an agent gave travels as base64.
const sshRun=({user,key,cwd,cmd})=>{if(!/^ag-[\w-]+$/.test(user)||/'/.test(key+cwd))throw Error('this agent has no own Linux user');
 return `ssh -i '${key}' -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 '${user}@127.0.0.1' "cd '${cwd}' && echo ${b64(cmd)} | base64 -d | bash"`};
// a script-only schedule: the command's lines, filtered by keep and drop, each with the prefix; nothing printed when nothing is left
export function jobScript({agent,user,key,cwd,cmd,keep='',drop='',prefix=''}){return ['#!/bin/bash',
 '# Made by aqeelOS (design-guard.mjs) for '+agent+'\'s script-only schedule: runs its own command as its own user, no model.',
 '# The command: '+String(cmd).replace(/\s+/g,' '),
 'out=$('+sshRun({user,key,cwd,cmd})+'); rc=$?',
 ...(keep?['K=$(echo '+b64(keep)+' | base64 -d); out=$(printf \'%s\\n\' "$out" | grep -E -- "$K")']:[]),
 ...(drop?['X=$(echo '+b64(drop)+' | base64 -d); out=$(printf \'%s\\n\' "$out" | grep -Ev -- "$X")']:[]),
 ...(prefix?['P=$(echo '+b64(prefix)+' | base64 -d)']:['P=""']),
 '[ -n "$out" ] && printf \'%s\\n\' "$out" | while IFS= read -r l; do [ -n "$l" ] && printf \'%s%s\\n\' "$P" "$l"; done',
 'exit $rc',''].join('\n')}
// a schedule's own check: the run gate runs it before the AI (run-gates.mjs gateBody). Nothing printed = nothing to do. What it prints is
// handed to the run, so the prompt need not run it again. A check that fails never stops a run.
export function ownCheckScript({agent,user,key,cwd,cmd}){return ['#!/bin/bash',
 '# Written by aqeelOS (design-guard.mjs): '+agent+'\'s own check for this schedule, run as its own user before the AI starts.',
 '# The command: '+String(cmd).replace(/\s+/g,' '),
 'out=$('+sshRun({user,key,cwd,cmd})+' 2>/dev/null); rc=$?',
 'if [ "$rc" = 0 ] && [ -z "$(printf \'%s\' "$out" | tr -d \'[:space:]\')" ]; then echo \'{"anythingToDo": false}\'; exit 0; fi',
 'printf \'%s\\n\' "$out"','echo \'{"anythingToDo": true}\'',''].join('\n')}
export const STEP0_NOTE='aqeelOS: the check of this schedule (its step 0 script) has already run before you started, and what it printed is given to you with this run. Do not run it again; go on from its output.';

export function createDesignGuard({HERMES_HOME,DATA,WORK,PORT=4400,sig=()=>'',ownOf,jobs,updateJob,eventRules={get:async()=>[],set:async()=>{}},record=async()=>{},homes=async()=>[],names=a=>a,skipAgent=async()=>false,
 sshKey=path.join(HERMES_HOME,'agent-ssh','id_ed25519'),now=()=>Date.now(),log=m=>console.log(m),minRuns=12,minSilent=.8,days=7}){
 const FILE=path.join(DATA,'design-guard.json'),HOOKS=path.join(DATA,'event-hooks.json');
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const key=(a,id)=>a+'/'+id;
 let db=null,cache=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.triggers||={};db.kept||={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const exists=f=>stat(f).then(()=>true,()=>false);
 const put=async(a,name,body)=>{const f=path.join(home(a),'scripts',name);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,body,{mode:0o700});await chmod(f,0o700).catch(()=>{});return name};
 const own=async a=>{const o=await Promise.resolve(ownOf(a)).catch(()=>null)||{};return {user:/^ag-[\w-]+$/.test(String(o.user||''))?o.user:'',cwd:String(o.cwd||path.join(WORK,base(a)))}};
 // a schedule's script that is only aqeelOS's run gate with nothing of the person's behind it counts as no script (run-gates.mjs gives every
 // AI schedule one within 10 minutes; the echo converter then skipped every gated job)
 async function ownScript(a,script){const s=String(script||'').trim();if(!s.startsWith(GATE_PREFIX))return s;
  const t=await readFile(path.join(home(a),'scripts',s),'utf8').catch(()=>'');return (/^# aqeelos-run-gate original=(.*)$/m.exec(t)?.[1]||'').trim()}
 const hasCheck=(a,id)=>exists(path.join(home(a),'scripts',CHECK_PREFIX+id+'.sh'));
 const rulesOf=async a=>(await Promise.resolve(eventRules.get(a)).catch(()=>[]))||[];
 const eventsOf=async(a,id)=>(await rulesOf(a)).filter(r=>r&&r.job===id).flatMap(r=>[].concat(r.event||[]));
 const setTrigger=async(a,id,t)=>{await load();db.triggers[key(a,id)]={...t,why:clip(t.why||'',300),at:now()};await save()};
 // ---- event hooks (DATA/event-hooks.json, the file event-hooks.mjs reads) ----
 const readHooks=async()=>{let d={};try{d=JSON.parse(await readFile(HOOKS,'utf8'))}catch{}return {d,hooks:d&&typeof d.hooks==='object'&&!Array.isArray(d.hooks)?d.hooks:d}};
 const writeHooks=async({d,hooks})=>{await mkdir(DATA,{recursive:true});await writeFile(HOOKS+'.tmp',JSON.stringify(d.hooks===hooks?d:hooks,null,1),{mode:0o600});await rename(HOOKS+'.tmp',HOOKS)};
 async function hooksOf(a){const {hooks}=await readHooks();return (Array.isArray(hooks[a])?hooks[a]:[]).map(cleanHook).filter(Boolean)}
 async function putHook(a,h){const c=cleanHook(h);if(!c)throw Error('That event hook is not valid.');const x=await readHooks();
  x.hooks[a]=[...(Array.isArray(x.hooks[a])?x.hooks[a]:[]).filter(o=>o.id!==c.id),{id:c.id,on:c.on,run:c.run,...(c.deliver?{deliver:c.deliver}:{}),minGapSec:c.gap,...(c.keep?{keep:c.keep}:{}),...(c.prefix?{prefix:c.prefix}:{}),by:'agent'}];await writeHooks(x);return c}
 async function removeHook(a,id){const x=await readHooks(),l=Array.isArray(x.hooks[a])?x.hooks[a]:[];const rest=l.filter(o=>o.id!==id);if(rest.length===l.length)return false;
  if(rest.length)x.hooks[a]=rest;else delete x.hooks[a];await writeHooks(x);await load();delete db.triggers[key(a,'hook:'+id)];await save();return true}

 // the exact call an agent should make instead, in the words of the tool it used
 const callText=(tool,f,target)=>tool==='manage_agent'?'manage_agent '+JSON.stringify({agent:target,part:'schedule',op:f.action==='create'?'create':'update',...(f.id?{job_id:f.id}:{}),...(f.name?{title:f.name}:{}),...Object.fromEntries(Object.entries(f).filter(([k])=>!['action','id','name'].includes(k)))})
  :'my_schedules '+JSON.stringify(f);
 const TELL=' Tell the person in one sentence what starts it now and why.';

 // The review before a schedule is created or changed through an aqeelOS tool. args: the tool's own (action create|edit, id, name, prompt,
 // schedule, deliver, script, keep, drop, prefix, checks, check_script, on_event, accept_cost, why); cur: the job as it is (edit).
 // Answers {refuse} (nothing was made; the text says what to call instead), {done} (made here, no schedule needed) or
 // {body, after}: body = fields to add to the engine call, after(job) = what is written once the job exists; it returns the lines for the agent.
 async function before(a,args={},cur=null,{tool='my_schedules',by=''}={}){await load();
  const act=args.action==='create'?'create':'edit',has=k=>args[k]!=null&&String(args[k]).trim()!=='',o=await own(a),dir=path.join(WORK,base(a));
  const why=String(args.why||'').replace(/\s+/g,' ').trim(),fields={action:act,...(cur?{id:cur.id}:{}),...Object.fromEntries(['name','schedule','deliver'].filter(has).map(k=>[k,String(args[k])]))};
  try{
   const events=has('on_event')?[...new Set([].concat(args.on_event).flatMap(x=>String(x).split(',')).map(s=>s.trim()).filter(Boolean))]:[];
   const bad=events.filter(e=>!EVENT_IDS.includes(e));if(bad.length)throw Error('Unknown event '+bad.map(e=>'"'+clip(e,40)+'"').join(', ')+'. The events this aqeelOS emits: '+eventHelp()+'. If none fits, use checks or check_script.');
   const script=has('script')?await checkedCommand(args.script,dir,'script'):null,checkCmd=has('check_script')?await checkedCommand(args.check_script,dir,'check_script'):null;
   const checks=has('checks')?cleanChecks(args.checks,dir):null,keep=pattern(args.keep,'keep'),drop=pattern(args.drop,'drop'),prefix=String(args.prefix??'').slice(0,40);
   if(/[\n\r\0]/.test(prefix))throw Error('prefix is one short line.');
   if((keep||drop||prefix)&&!script)throw Error('keep, drop and prefix go with script.');
   if(script&&(checks||checkCmd))throw Error('A script-only schedule starts no AI, so it has nothing to check first: give script alone, or prompt with checks or check_script.');
   if((script||checkCmd)&&!o.user)throw Error('This agent has no Linux user of its own on this server, so aqeelOS cannot run a script for it. Report it with report_bottleneck system true.');
   if(act==='create'&&why.length<10)throw Error('Not made yet: say in why, in one sentence, what starts this work and why you chose that (an event, a script with no AI, a check before the AI, or the AI on a timer). The person sees it on the schedule.');
   // an event hook: the script runs when the event happens, no model, no schedule needed
   if(script&&events.length){const id=(cur?'job-'+cur.id:'h-'+sha(a+'|'+script).slice(0,10)),deliver=has('deliver')&&TARGET.test(String(args.deliver))?String(args.deliver):cur?.deliver&&TARGET.test(String(cur.deliver))?cur.deliver:null;
    const made=async()=>{const h=await putHook(a,{id,on:events,run:script,deliver:deliver||undefined,keep:keep||undefined,prefix});await setTrigger(a,'hook:'+h.id,{kind:'event',events,cmd:script,why,by});return h};
    const said='"'+script+'" runs with no AI as soon as '+events.join(' or ')+' happens'+(deliver?', and what it prints goes to '+deliver:'. What it prints is not sent anywhere (no deliver like telegram:<chat>:<topic> was given), so the script must send its own result')+'.';
    if(!cur&&!has('schedule')){const h=await made();log('design guard: '+a+' event hook '+h.id+' on '+events.join(','));return {done:'Made the event hook '+h.id+': '+said+' No schedule was made: nothing runs on a clock. my_schedules list shows it; remove it with my_schedules remove id "hook:'+h.id+'".'+TELL}}
    // with a schedule: the clock is only the slow safety run of the same hook (same lock, same delivery, same health)
    const name='aqeelos-hook-'+id+'.sh';
    return {body:{no_agent:true,script:name,...(has('prompt')?{}:{prompt:'Script-only: the slow safety run of the event hook '+id+' ('+script+'). No AI.'})},
     after:async j=>{await made();await put(a,name,fallbackScript({agent:a,id,port:PORT,sig:sig(a)}));if(j&&(!j.no_agent||j.script!==name))await updateJob(a,j.id,{no_agent:true,script:name});await setTrigger(a,j.id,{kind:'event',events,cmd:script,why,by});
      return [said+' The clock ('+(args.schedule||cur?.schedule?.display||'')+') is only its slow safety run.'+TELL]}}}
   // a script-only schedule
   if(script){if(!has('schedule')&&!cur)throw Error('script needs a schedule (when it runs), or on_event (what starts it).');
    const name='aq-script-'+sha([a,script,keep,drop,prefix].join('|')).slice(0,12)+'.sh';await put(a,name,jobScript({agent:a,user:o.user,key:sshKey,cwd:o.cwd,cmd:script,keep,drop,prefix}));
    return {body:{no_agent:true,script:name,...(has('prompt')?{}:{prompt:'Script-only: runs "'+script+'" in the agent\'s own folder and delivers what it prints. No AI.'})},
     after:async j=>{if(j&&(!j.no_agent||j.script!==name))await updateJob(a,j.id,{no_agent:true,script:name});await setTrigger(a,j.id,{kind:'script',cmd:script,why,by});
      return ['It is a script-only schedule: "'+script+'" runs with no AI and what it prints is delivered (nothing printed, nothing sent).'+TELL]}}}
   // the rest starts the AI: review the prompt and cadence it will have
   const touched=act==='create'||has('prompt')||has('schedule')||checks||checkCmd||events.length;if(!touched)return {body:{},after:async()=>[]};
   if(act==='create'&&!has('prompt'))throw Error('create needs a prompt (what the AI does each run), or script (a command that is the whole job).');
   const prompt=has('prompt')?String(args.prompt):String(cur?.prompt||''),schedule=has('schedule')?String(args.schedule):cur?.schedule||null;
   if(events.length&&!cur&&!has('schedule'))throw Error('on_event with a prompt needs a schedule too: the clock is its slow safety run, hourly or slower (for example "17 * * * *").');
   const checked=!!(checks||checkCmd)||(cur?await hasCheck(a,cur.id)||!!(await ownScript(a,cur.script)):false),evented=events.length>0||(cur?(await eventsOf(a,cur.id)).length>0:false);
   let c=classify({prompt,schedule,no_agent:!!cur?.no_agent&&!has('prompt'),hasCheck:checked,hasEvent:evented});
   // an agent with no user of its own cannot have a script run for it: the echo or step 0 stays an AI run, and the 30-minute question still stands
   const plain=()=>{const every=cadenceOfText(schedule);return every!=null&&every<MIN_CADENCE&&!checked&&!evented?{kind:'fast',every,suggest:suggestCheck(prompt)}:{kind:'ok',trigger:evented?'event':checked?'check':'model'}};
   if((c.kind==='echo'||c.kind==='step0')&&!o.user)c=plain();
   // a change is reviewed for what it changes: a new prompt for its wording, a new time for its cadence. Renaming a schedule, or fixing a line of
   // the prompt of one the owner decided to keep, is never held up by what was already there.
   if(cur&&(c.kind==='echo'||c.kind==='step0')&&!has('prompt'))c=plain();if(cur&&c.kind==='fast'&&!has('schedule'))c={kind:'ok',trigger:'model'};
   if(c.kind==='echo'){const rel=relCommand(c.cmd,o.cwd);
    if(c.filter)return {refuse:'Not saved: this prompt only runs one command and passes on some of its lines by a fixed rule. That needs no AI, and an AI start every time costs a full run. Make it a script-only schedule: '+
      callText(tool,{...fields,script:rel||'<the command, as a path inside your own folder>',...(c.filter.keep?{keep:c.filter.keep}:{}),...(c.filter.drop?{drop:c.filter.drop}:{}),...(c.filter.prefix?{prefix:c.filter.prefix}:{}),why:'<what starts it and why>'},a)+
      '. If the work can start from an event instead of the clock (a payment paid, a message arriving), add on_event.'+TELL};
    const name='aq-script-'+sha([a,c.cmd].join('|')).slice(0,12)+'.sh';await put(a,name,jobScript({agent:a,user:o.user,key:sshKey,cwd:o.cwd,cmd:c.cmd}));
    return {body:{no_agent:true,script:name},after:async j=>{if(j&&(!j.no_agent||j.script!==name))await updateJob(a,j.id,{no_agent:true,script:name});
     await setTrigger(a,j.id,{kind:'script',cmd:c.cmd,why:why||'aqeelOS: the prompt only ran one command and repeated what it printed',by:by||'aqeelOS'});
     return ['aqeelOS made it a script-only schedule: the prompt only ran "'+clip(c.cmd,120)+'" and repeated what it printed, so the command now runs with no AI (same output, no tokens). If it can start from an event instead of the clock (a payment paid, a message arriving), change it with on_event.'+TELL]}}}
   if(c.kind==='step0'){const rel=relCommand(c.cmd,o.cwd);
    return {refuse:'Not saved: step 0 of this prompt runs a script and stops when it prints nothing, so the AI starts every time only to learn there is nothing to do. Put that script in front as the check, and take step 0 out of the prompt (what the check prints is given to the run): '+
     callText(tool,{...fields,check_script:rel||'<that script, as a path inside your own folder>',prompt:'<the prompt without step 0>',why:'<what starts it and why>'},a)+'.'+TELL}}
   if(c.kind==='fast'&&args.accept_cost!==true)return {refuse:'Not saved: this would start the AI every '+c.every+' minutes with nothing that says whether there is anything to do. Choose one: start it from an event (on_event: '+EVENT_IDS.join(', ')+'); '+
    (c.suggest?'add the check that fits (checks "'+c.suggest.checks+'": '+c.suggest.what+')':'add a check (checks, or check_script with a small script of yours that prints only when there is work)')+'; or run it every '+MIN_CADENCE+' minutes or slower. Only if the person still wants it after hearing this, pass accept_cost true.'+TELL};
   const kind=events.length?'event':checks||checkCmd?'check':c.trigger||'model';
   return {body:{},after:async j=>{const out=[];if(!j?.id)return out;
    if(checkCmd){await put(a,CHECK_PREFIX+j.id+'.sh',ownCheckScript({agent:a,user:o.user,key:sshKey,cwd:o.cwd,cmd:checkCmd}));out.push('Its check "'+checkCmd+'" runs before each start with no AI: the AI starts only when it prints something, and gets what it printed (do not run it again in the prompt).')}
    else if(checks){await put(a,CHECK_PREFIX+j.id+'.sh',checkBody({agent:a,home:home(a),data:DATA,job:j.id,checks}));out.push('Its check ('+checks+') runs before each start with no AI: the AI starts only when there is something to do.')}
    if(events.length){const l=(await rulesOf(a)).filter(r=>r.job!==j.id);l.push({event:events,job:j.id});await eventRules.set(a,l);out.push('It starts at once when '+events.join(' or ')+' happens; its clock is only the slow safety run.')}
    if(c.kind==='fast')out.push('It starts the AI every '+c.every+' minutes with no check, so aqeelOS lets it start at most once every '+MIN_CADENCE+' minutes until the owner keeps it as it is in Health.');
    else if(c.quiet&&act==='create')out.push('This prompt ends in [SILENT] when there is nothing to do. If a test with no AI can tell that (a file, a count, a status cell), put it in front with checks or check_script, so the AI does not start for nothing.');
    if(act==='create'||checks||checkCmd||events.length||why)await setTrigger(a,j.id,{kind,...(events.length?{events}:{}),...(checks?{checks}:{}),...(checkCmd?{cmd:checkCmd}:{}),why:why||db.triggers[key(a,j.id)]?.why||'',by});
    if(out.length)out[out.length-1]+=TELL;return out}}
  }catch(e){return {refuse:e.message}}}

 // the same review for the engine's own schedule tool (cronjob), asked by the aqeelos-live plugin before the call runs: the text that
 // blocks it, or null. It only points to my_schedules, which can make the better design.
 async function engineCall(a,args={}){try{const act=String(args.action||'').toLowerCase();if(!['create','update','edit'].includes(act))return null;
   if(args.no_agent===true||String(args.no_agent)==='true')return null;const id=String(args.job_id||args.id||'');
   const cur=act==='create'?null:(await Promise.resolve(jobs(a)).catch(()=>[])).find(j=>j.id===id)||null;if(act!=='create'&&(!cur||(args.prompt==null&&args.schedule==null)))return null;
   const prompt=String(args.prompt??cur?.prompt??''),schedule=args.schedule??cur?.schedule??null,o=await own(a);if(cur?.no_agent&&args.prompt==null)return null;
   const checked=!!String(args.script||'').trim()||(cur?await hasCheck(a,cur.id)||!!(await ownScript(a,cur.script)):false),evented=cur?(await eventsOf(a,cur.id)).length>0:false;let c=classify({prompt,schedule,hasCheck:checked,hasEvent:evented});
   if(cur&&(c.kind==='echo'||c.kind==='step0')&&args.prompt==null){const every=cadenceOfText(schedule);c=every!=null&&every<MIN_CADENCE&&!checked&&!evented?{kind:'fast',every,suggest:suggestCheck(prompt)}:{kind:'ok'}}
   if(cur&&c.kind==='fast'&&args.schedule==null)return null;
   const f={action:act==='create'?'create':'edit',...(cur?{id:cur.id}:{}),...(args.name?{name:String(args.name)}:{}),...(args.schedule?{schedule:String(args.schedule)}:{}),...(args.deliver?{deliver:String(args.deliver)}:{})};
   if(c.kind==='echo'&&o.user)return 'Not saved: this schedule only runs one command and repeats what it prints, so it needs no AI (each AI start costs a full run). Make it with my_schedules (from aqeelos-notify) instead: '+
    callText('my_schedules',{...f,script:relCommand(c.cmd,o.cwd)||'<the command, as a path inside your own folder>',...(c.filter?.keep?{keep:c.filter.keep}:{}),...(c.filter?.drop?{drop:c.filter.drop}:{}),...(c.filter?.prefix?{prefix:c.filter.prefix}:{}),why:'<what starts it and why>'})+'. If it can start from an event instead of the clock, add on_event.'+TELL;
   if(c.kind==='step0'&&o.user)return 'Not saved: step 0 of this prompt runs a script and stops when it prints nothing, so the AI starts every time only to learn there is nothing to do. Make it with my_schedules (from aqeelos-notify) instead, with that script as the check and step 0 taken out of the prompt: '+
    callText('my_schedules',{...f,check_script:relCommand(c.cmd,o.cwd)||'<that script, as a path inside your own folder>',prompt:'<the prompt without step 0>',why:'<what starts it and why>'})+'.'+TELL;
   if(c.kind==='fast')return 'Not saved: this would start the AI every '+c.every+' minutes with nothing that says whether there is anything to do. Make it with my_schedules (from aqeelos-notify) and choose one: on_event ('+EVENT_IDS.join(', ')+'); '+
    (c.suggest?'checks "'+c.suggest.checks+'" ('+c.suggest.what+')':'checks or check_script')+'; or every '+MIN_CADENCE+' minutes or slower. Only if the person still wants it after hearing this: my_schedules with accept_cost true.'+TELL;
   return null}catch(e){log('design guard: engine call review for '+a+': '+e.message);return null}}

 // ---- existing schedules: what a schedule would better be, and the conversion where it is mechanical ----
 async function adviceFor(a,j){const o=await own(a),checked=await hasCheck(a,j.id),ev=(await eventsOf(a,j.id)).length>0,c=classify({prompt:j.prompt,schedule:null,no_agent:!!j.no_agent,hasCheck:false,hasEvent:false});
  if(j.no_agent)return null;
  if(c.kind==='echo'&&!(await ownScript(a,j.script)))return {how:'script',mechanical:!!o.user,label:'Make it script-only',cmd:c.cmd,filter:c.filter,text:'it only runs one command and repeats what it prints'+(c.filter?' (by a fixed line rule)':'')+': that runs as a script with no AI'+(o.user?'':' (this agent has no own user yet, so aqeelOS cannot convert it)')};
  if(c.kind==='step0'&&!checked)return {how:'step0',mechanical:!!o.user,label:'Move its check in front',cmd:c.cmd,text:'its first step runs a script and stops when that prints nothing: the script becomes the check, so the AI starts only when it prints something'};
  const s=suggestCheck((j.name||'')+' '+(j.prompt||''));
  if(s&&!checked)return {how:'check',mechanical:true,label:'Add a check',checks:s.checks+(/--dms/.test(s.checks)?' --max-idle 60':''),text:'a check with no AI ('+s.what+') can decide whether the AI starts'};
  return {how:'ask',mechanical:false,text:checked||ev?'it has a check or an event already, and most runs still find nothing: ask '+names(a)+' for a sharper check':'ask '+names(a)+' to start it from an event, or to write a small check script that prints only when there is work'}}
 // apply the mechanical conversion of one schedule (the Health button, and agent-care for a clean echo). Returns what was done.
 async function convert(a,jobId,{by='aqeelOS'}={}){await load();const j=(await jobs(a)).find(x=>x.id===jobId);if(!j)throw Error('That schedule is gone.');
  if(!/^[\w-]{1,64}$/.test(String(jobId)))throw Error('Unknown schedule');const adv=await adviceFor(a,j);if(!adv?.mechanical)throw Error('Nothing here can be changed by a button. Ask the agent for the better design.');const o=await own(a);
  if(adv.how==='script'){const name='aq-job-'+jobId+'.sh',f=adv.filter||{};await put(a,name,jobScript({agent:a,user:o.user,key:sshKey,cwd:o.cwd,cmd:adv.cmd,keep:f.keep,drop:f.drop,prefix:f.prefix}));
   await updateJob(a,jobId,{no_agent:true,script:name});await setTrigger(a,jobId,{kind:'script',cmd:adv.cmd,why:'aqeelOS: the prompt only ran one command and repeated what it printed',by});
   await record(a,{kind:'schedule',what:'"'+j.name+'" now runs its command without a model turn (script '+name+'); same output, no tokens',why:'aqeelOS: the prompt only ran one command',before:{prompt:j.prompt,script:j.script||null,no_agent:false},after:{script:name,no_agent:true}}).catch(()=>{});
   log('design guard: '+a+' schedule '+jobId+' is script-only now');cache=null;return {ok:true,how:'script',script:name}}
  if(adv.how==='step0'){await put(a,CHECK_PREFIX+jobId+'.sh',ownCheckScript({agent:a,user:o.user,key:sshKey,cwd:o.cwd,cmd:adv.cmd}));
   if(!String(j.prompt||'').startsWith(STEP0_NOTE))await updateJob(a,jobId,{prompt:STEP0_NOTE+'\n\n'+j.prompt});await setTrigger(a,jobId,{kind:'check',cmd:adv.cmd,why:'aqeelOS: step 0 of the prompt was a script that decides whether there is anything to do',by});
   await record(a,{kind:'schedule',what:'"'+j.name+'" runs its step 0 script as a check before the AI starts; the AI starts only when it prints something',why:'aqeelOS: most runs said nothing',before:{prompt:j.prompt},after:{check:CHECK_PREFIX+jobId+'.sh'}}).catch(()=>{});
   log('design guard: '+a+' schedule '+jobId+' has its step 0 as the check now');cache=null;return {ok:true,how:'check',check:adv.cmd}}
  await put(a,CHECK_PREFIX+jobId+'.sh',checkBody({agent:a,home:home(a),data:DATA,job:jobId,checks:adv.checks}));await setTrigger(a,jobId,{kind:'check',checks:adv.checks,why:'aqeelOS: most runs said nothing; '+adv.text,by});
  log('design guard: '+a+' schedule '+jobId+' has the check '+adv.checks+' now');cache=null;return {ok:true,how:'check',checks:adv.checks}}

 // ---- the feedback loop: the engine's run records, 7 days ----
 const TAIL=8*1024*1024;
 async function runsOf(a,since){const out={};let text='';
  try{const h=await open(path.join(home(a),'cron','usage_audit.jsonl'),'r');try{const {size}=await h.stat(),n=Math.min(size,TAIL),b=Buffer.alloc(n);await h.read(b,0,n,size-n);text=b.toString('utf8')}finally{await h.close()}}catch{return out}
  for(const l of text.split('\n')){if(l[0]!=='{')continue;let r;try{r=JSON.parse(l)}catch{continue}const t=Date.parse(r.ts);if(!(t>=since)||!r.job_id)continue;
   const x=out[r.job_id]||={runs:0,silent:0,tokens:0};x.runs++;if(r.response_silent===true)x.silent++;x.tokens+=+r.total_tokens||0}
  return out}
 // every agent's schedules that mostly woke the AI for nothing. Kept for an hour (Health asks often); force reads again.
 async function review({force=false}={}){await load();if(!force&&cache&&now()-cache.at<3600e3)return cache.v;const since=now()-days*86400e3,v=[];
  for(const a of await homes()){if(await Promise.resolve(skipAgent(a)).catch(()=>false))continue;const runs=await runsOf(a,since);if(!Object.keys(runs).length)continue;
   const list=await Promise.resolve(jobs(a)).catch(()=>[]),found=[];
   for(const j of list){const r=runs[j.id];if(!r||j.no_agent||j.enabled===false||j.state==='paused'||j.state==='completed'||r.runs<minRuns||r.silent/r.runs<minSilent||db.kept[key(a,j.id)])continue;
    const adv=await adviceFor(a,j);if(!adv)continue;found.push({job:j.id,name:j.name||j.id,runs:r.runs,silent:r.silent,tokens:r.tokens,how:adv.how,mechanical:adv.mechanical,label:adv.label||'',better:adv.text})}
   if(found.length)v.push({agent:a,jobs:found.sort((x,y)=>y.silent-x.silent)})}
  cache={at:now(),v};return v}
 const big=n=>n>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':n>=1e3?Math.round(n/1e3)+'k':String(n);
 // one Health item per agent
 async function needs(admin=true,opt={}){if(!admin)return [];
  return (await review(opt)).map(({agent:a,jobs:l})=>{const n=l.length,wasted=l.reduce((s,j)=>s+j.silent,0);return {id:'design|'+a,kind:'design',agent:a,agentName:names(a),
   title:names(a)+': '+(n===1?'a schedule':n+' schedules')+' woke the AI '+wasted+' times this week for nothing',
   text:l.map(j=>'“'+j.name+'” started the AI '+j.runs+' times in '+days+' days and '+j.silent+' of them said nothing ('+big(j.tokens)+' tokens). Better: '+j.better+'.').join(' '),jobs:l,created:cache?.at||now()}})}
 // the Health buttons: "apply" the conversion, or "keep" the schedule as it is (stored, never asked again)
 async function decide(a,jobId,choice){await load();if(!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(String(a))||!/^[\w-]{1,64}$/.test(String(jobId)))throw Error('Unknown schedule');
  if(choice==='keep'){db.kept[key(a,jobId)]={at:now()};await save();cache=null;return {ok:true,kept:true}}
  if(choice!=='apply')throw Error('Unknown choice');return convert(a,jobId,{by:'the owner (Health)'})}

 // ---- "why this trigger" for the schedule cards: {"<agent>|<job id>": {kind, label, detail, why}} ----
 async function triggers(list){await load();const out={},rules={};
  for(const j of list||[]){const a=j.profile||'default',t=db.triggers[key(a,j.id)]||{};rules[a]||=await rulesOf(a);const ev=rules[a].filter(r=>r&&r.job===j.id).flatMap(r=>[].concat(r.event||[]));
   const hook=String(j.script||'').startsWith('aqeelos-hook-'),kind=ev.length||hook?'event':j.no_agent?'script':await hasCheck(a,j.id)||await ownScript(a,j.script)?'check':'model';
   const events=ev.length?ev:hook?t.events||[]:[];
   out[a+'|'+j.id]={kind,label:TRIGGER_LABEL[kind],detail:kind==='event'?events.join(', '):kind==='check'?(t.checks||t.cmd||''):kind==='script'?(t.cmd||''):'',why:t.kind===kind?t.why||'':''}}
  return out}
 // what my_schedules list adds: the agent's event hooks
 async function listLines(a){const l=await hooksOf(a);return l.length?['','Event hooks (a script that runs with no AI when something happens):',...l.map(h=>'- hook:'+h.id+' · on '+h.on.join(', ')+' · runs '+h.run+(h.deliver?' · to '+h.deliver:''))]:[]}
 return {before,engineCall,classifyJob:async(a,j)=>classify({prompt:j.prompt,schedule:j.schedule,no_agent:!!j.no_agent,hasCheck:await hasCheck(a,j.id)||!!(await ownScript(a,j.script)),hasEvent:(await eventsOf(a,j.id)).length>0}),
  ownScript,adviceFor,convert,review,needs,decide,triggers,hooksOf,removeHook,listLines,setTrigger}}
