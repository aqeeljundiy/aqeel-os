// Issues and the fixer: a closed loop (owner's rules of 7 Nov 2026: "agents fix themselves, without asking Donna or me";
// "people are messaged only when a fix needs a human").
// Every issue goes to the fixer by itself, whoever filed it: an agent (report_bottleneck with system true), Health
// (agent-health.mjs), a rollback check (agent-versions.mjs), the owner or a team member. Nobody approves anything.
// The loop, one step at a time, never two runs at once:
//   1. fix run: a headless coding run on this server (the engine of the policy's fixer.agent, started as a program). It
//      backs up every file first, changes what is needed, runs the tests, and lists each file with its backup. It may
//      also find that nothing needs changing; that still has to be proven.
//   2. apply: once /healthz says nothing is busy (busy 0), aqeelOS reloads what the change needs with its own safe path
//      (engine: restartGateway; web app: restartSelf). Never a raw "gateway restart" or kill.
//   3. proof run: a fresh run reruns the original failing check end to end (a WhatsApp reply problem: the line's test
//      number gets a real reply). Only "proven" marks the issue fixed, with the proof saved.
//   4. not proven: the files are put back from their backups (code, not the model), reloaded again, and the next try
//      uses a different approach. After 3 tries the issue is "stuck".
//   "needs a human" (a new key nobody has, a payment, a person adding a bot to a group) and "stuck" are the only
//   messages: one, to whoever asked, else the team member the policy names for that agent, else the owner.
// Hard rules, in the prompt and in code: back up before any change and roll back when the check fails; never spend
// money; never delete customer data (a deleted file is put back); use only keys that already exist on the box (a new
// value in an .env must already be in another .env). Everything shows on System › Health › Issues.
import {readFile,writeFile,mkdir,rename,open,stat,copyFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const clip=(s,n)=>String(s??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').slice(0,n);
export const TRIES=3;
export const OPEN=['queued','fixing','applying','verify','verifying','rollback','reloaded-back'];
// the team policy: {owner:{name, telegram:[ids]}, teams:[{name, agents:[...], members:[{name, telegram}], contact}], fixer:{agent, on, cap, minutes}}
export function teamOf(policy,agent){return (policy?.teams||[]).find(t=>(t.agents||[]).includes(agent))||null}
export function personOf(policy,platform,uid){uid=String(uid||'');if(!uid)return null;
 if([].concat(policy?.owner?.[platform]||[]).map(String).includes(uid))return {owner:true,name:policy.owner.name||'Owner'};
 for(const t of policy?.teams||[])for(const m of t.members||[])if([].concat(m[platform]||[]).map(String).includes(uid))return {owner:false,name:m.name,team:t,full:[].concat(m.full_authority||[]).map(String)};
 return null}
// 7 Nov 2026: no issue waits for anyone. Kept so older callers get the same shape.
export function decide(policy,issue,by){const p=personOf(policy,by?.platform,by?.uid);
 return {auto:true,why:p?'asked by '+p.name:issue?.source==='health'?'found by Health':'filed by '+(issue?.agent||'an agent')}}
// who gets a "needs a human" or "stuck" message: the person who asked (owner or a team member, in the chat they asked
// in), else the team member the policy names for that agent (team.contact, else its first member), else the owner
export function whoToTell(policy,issue){const p=personOf(policy,issue?.by?.platform,issue?.by?.uid);
 if(p?.owner)return {kind:'owner',name:p.name};
 if(p&&issue.by?.chat)return {kind:'asker',name:p.name};
 const t=teamOf(policy,issue?.agent),m=t&&((t.members||[]).find(x=>x.name===t.contact)||(t.members||[])[0]);
 if(m)return {kind:'team',name:m.name,member:m,team:t.name};
 return {kind:'owner',name:policy?.owner?.name||'Owner'}}

// the fix run's last line:   RESULT: {"status":"changed|no_change|needs_human|failed","apply":"none|engine|ui","changes":[{"file","backup"}],"check":"…","summary":"…","proof":"…","need":"…"}
// the proof run's last line: RESULT: {"status":"proven|not_proven","proof":"…","need":"…"}
const FIX=['changed','no_change','needs_human','failed'],PROOF=['proven','not_proven'];
export function parseResult(out,kind='fix'){const m=[...String(out||'').matchAll(/RESULT:\s*(\{[^\n]*\})/g)].pop();if(!m)return null;let j;try{j=JSON.parse(m[1])}catch{return null}
 // older wording from a run that was going when this was deployed
 if(j.status==='fixed')j.status=kind==='proof'?'proven':'changed';if(j.status==='needs_owner')j.status='needs_human';
 if(!(kind==='proof'?PROOF:FIX).includes(j.status))return null;
 const apply=['engine','ui'].includes(j.apply)?j.apply:j.restart_ui===true?'ui':'none';
 const changes=(Array.isArray(j.changes)?j.changes:[]).filter(c=>c&&typeof c.file==='string'&&c.file.startsWith('/')).slice(0,40).map(c=>({file:clip(c.file,400),backup:typeof c.backup==='string'&&c.backup.startsWith('/')?clip(c.backup,400):null}));
 return {status:j.status,summary:clip(j.summary,1500),proof:clip(j.proof,3000),need:clip(j.need,600),check:clip(j.check,1000),apply,changes}}
// a run that never reached the model (the engine was restarting or draining) is not a try
export const notStarted=out=>/couldn'?t start the model connection|Gateway draining|not_ready|Connection refused.*gateway/i.test(String(out||'').slice(-3000));

// the values set in an .env text: {KEY: value}
export function envValues(t){const o={};for(const l of String(t||'').split('\n')){const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);if(m)o[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2')}return o}
// keys rule: every value an .env gained or changed must already be somewhere on the box (in the other .env texts)
export function newSecrets(before,after,known=[]){const b=envValues(before),a=envValues(after),pool=new Set(known.flatMap(t=>Object.values(envValues(t))));
 return Object.entries(a).filter(([k,v])=>v&&v.length>=8&&b[k]!==v&&!pool.has(v)).map(([k])=>k)}

export function fixerPrompt(i,{rules='',day=new Date().toISOString().slice(0,10).replace(/-/g,''),attempt=1,tries=TRIES}={}){
 const past=(i.history||[]).filter(h=>h.kind==='fix').map((h,n)=>'Try '+(n+1)+': '+(h.summary||'-')+(h.outcome?' → '+h.outcome:'')+(h.proof?' (proof run: '+clip(h.proof,400)+')':'')).join('\n');
 return [
 'You are the aqeelOS fixer: a headless coding run on this server. Nobody is chatting with you and nobody approves anything: fix ONE issue by yourself, then stop.',
 '','ISSUE '+i.id+' (agent '+i.agent+(i.source==='health'?', found by the Health check':'')+(i.byName?', asked by '+i.byName:'')+'). This is try '+attempt+' of '+tries+'.',
 'What it was doing: '+(i.what||'-'),'Problem: '+i.missing,'Evidence: '+(i.evidence||'-'),'Proposed fix: '+(i.proposed_fix||i.fix||'-'),
 'Agents it may affect: '+[i.agent,...(i.affects||[])].join(', '),
 past?'\nEARLIER TRIES (they did not prove the problem gone and were rolled back). Use a different approach:\n'+past:null,
 '','HARD RULES (the code checks these too)',
 '- Back up every file before you change it: cp -p <file> <file>.bak-'+day+'-'+i.id+'-'+attempt+'. List every changed file with its backup in "changes". A changed file without a backup is put back and the try fails.',
 '- Never spend money (no purchases, plan upgrades, top-ups, paid sign-ups).',
 '- Never delete customer data (chats, contacts, orders, sheets, state.db rows, logs of customers). Never delete a file you list; deleted files are put back.',
 '- Use only keys that already exist on this box (an .env value you add must already be in another .env here). Never invent or request a new key yourself.',
 '- Never run "gateway restart", "systemctl", kill processes or restart anything. Say what the change needs in "apply": "none" (read on the next message or run), "engine" (the agents\' engine must reload: config.yaml, .env, plugins, engine code) or "ui" (the aqeelOS web app code in ~/apps/hermes-ui). aqeelOS reloads it safely when nothing is busy, then a second run proves it.',
 '- Kirimdev lines stay in their current mode (Test stays Test). Never message customers.',
 '- A Kirimdev API, key or webhook problem (Health kind kirimdev) is usually on Kirimdev\'s side or the network: check it, and if nothing on this box can fix it, use needs_human with what Kirimdev or a person must do.',
 '','HOW',
 '- Find the real cause on this server first (files, logs, the agent\'s state.db, ~/apps/hermes-ui-data). Fix the cause, not the symptom; no hard-coded ids, names or paths in shared code (settings instead).',
 '- Only change what this issue needs, and only for the agents listed above.',
 '- Run the existing tests for what you changed (node scripts/<name>.test.mjs in ~/apps/hermes-ui, the engine\'s tests). Paste commands and output in "proof".',
 '- Write in "check" exactly how to rerun the ORIGINAL failing check end to end after the reload (the real thing that failed, not a unit test). For a WhatsApp reply problem: a message from the line\'s test number (e.g. the team\'s 3124 number) must get a real reply delivered.',
 '- If you find nothing to change (it already works), use status "no_change": a proof run still has to show it works.',
 '- needs_human only when a person must act and no tool or key on this box can do it: a new key nobody has, a payment, someone adding a bot to a Telegram group, a sign-in only a person can do. Put in "need" exactly what they must do, in one or two plain sentences.',
 rules?'- '+rules:null,
 '','End with exactly one line (JSON on one line):',
 'RESULT: {"status":"changed|no_change|needs_human|failed","apply":"none|engine|ui","changes":[{"file":"/abs/path","backup":"/abs/path.bak-…"}],"check":"how to rerun the original check","summary":"one or two plain sentences","proof":"what you ran and saw","need":"only for needs_human or failed: what a person must do"}'].filter(x=>x!==null).join('\n')}

export function proofPrompt(i,fix,{reloaded=null}={}){return [
 'You are the aqeelOS fixer\'s proof run: a headless run on this server. Nobody is chatting with you. Do NOT change any file. Only prove whether ONE problem is gone.',
 '','ISSUE '+i.id+' (agent '+i.agent+(i.source==='health'?', found by the Health check':'')+')',
 'Problem: '+i.missing,'Evidence when it was filed: '+(i.evidence||'-'),
 'What the fix run did: '+(fix?.summary||'-'),fix?.changes?.length?'Files changed: '+fix.changes.map(c=>c.file).join(', '):'No files were changed.',
 reloaded?'aqeelOS reloaded '+(reloaded==='engine'?'the agents\' engine':'the web app')+' after the change.':null,
 'How to rerun the original check: '+(fix?.check||'rerun what failed in the evidence above, end to end'),
 '','RULES',
 '- Rerun the ORIGINAL failing check end to end, for real, now. A unit test or reading a file is not proof. For a WhatsApp reply problem the line\'s test number (e.g. the team\'s 3124 number) must get a real reply delivered; check the delivery. For a Health problem, Health (~/apps/hermes-ui-data/bottlenecks.json) must no longer list it after its check ran again.',
 '- Never spend money, never delete anything, never message customers, never restart anything.',
 '- proven only if you saw it work after the change. Otherwise not_proven, and say in "need" what a person could do if nothing on this box can fix it.',
 '','End with exactly one line (JSON on one line):',
 'RESULT: {"status":"proven|not_proven","proof":"the commands you ran and what you saw, with times","need":""}'].filter(x=>x!==null).join('\n')}

export function createIssues({DATA,home,bin,fixerHome,now=()=>Date.now(),reply=async()=>false,tellOwner=async()=>{},toTeam=async()=>false,busy=async()=>0,ready=async()=>true,
 apply=async()=>({ok:true}),nameOf=a=>a,quiet=()=>null,log=m=>console.log(m),launch=null,alive=null,envFiles=async()=>[],
 // kept for older callers (the Approve/Decline flow is gone)
 askOwner=null,approvalLink=null,restartSelf=null}){
 const FILE=path.join(DATA,'issues.json'),POL=path.join(DATA,'team-policy.json'),DIR=path.join(DATA,'issues');let db=null,chain=Promise.resolve();
 // older states: approved and waiting (the old owner's OK) are queued; a failed one gets its tries again once
 const migrate=()=>{for(const i of db.items){if(i.state==='approved'||i.state==='waiting'){i.state='queued';i.decision='every issue goes to the fixer (owner, 7 Nov 2026)'}
   if(i.state==='failed'&&!i.migrated){i.state='queued';i.tries=0;i.migrated=1;i.decision='tried again with the new fixer loop'}
   if(i.tries==null)i.tries=OPEN.includes(i.state)?0:(i.attempts||0);i.history||=[]}};
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.items||=[];db.runs||={};migrate()}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';await writeFile(t,JSON.stringify(db,null,1));await rename(t,FILE)};
 const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const policy=async()=>{try{return JSON.parse(await readFile(POL,'utf8'))}catch{return {teams:[],fixer:{on:true}}}};
 const view=i=>({...i,agentName:nameOf(i.agent),sig:undefined});
 // the one message for a person: whoever asked, else the agent's team contact, else the owner. Test agents and a
 // restart hold (alert-quiet.mjs): logged only.
 async function tell(i,text){const pol=await policy(),w=whoToTell(pol,i);const q=quiet(i.agent||null);
  if(q){log('issues: not sent ('+(q==='test'?'test agent':'restart hold')+'): '+String(text).slice(0,200));return 'logged'}
  try{if(w.kind==='asker'&&await reply(i,text))return w.name;
   if(w.kind==='team'&&await toTeam(i.agent,w.member,text))return w.name}catch(e){log('issues: could not reach '+w.name+': '+e.message)}
  await tellOwner(text);return pol.owner?.name||'the owner'}
 // an issue: o = {agent, what, missing, evidence, proposed_fix, affects, needs, source, healthKey, origin:{platform, uid, who, chat, thread}}
 const file=o=>queue(async()=>{await load();const pol=await policy();const m=clip(o.missing,500).trim();if(!m)throw Error('Say what is broken (missing).');
  const key=o.healthKey?'health|'+o.healthKey:o.agent+'|'+m.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,100);
  let i=db.items.find(x=>x.key===key&&(OPEN.includes(x.state)||x.state==='needs_human'));
  // filed again while it waited for a person: they may have done it, so the fixer tries again
  if(i){i.count++;i.updated=now();if(o.evidence)i.evidence=clip(o.evidence,2000);if(i.state==='needs_human'){i.state='queued';i.tries=0}await save();return {issue:view(i),again:true}}
  const by=o.origin||{},p=personOf(pol,by.platform,by.uid);
  i={id:'i'+randomBytes(4).toString('hex'),key,agent:o.agent,source:o.source||(p?'person':'agent'),what:clip(o.what,400),missing:m,evidence:clip(o.evidence,2000),proposed_fix:clip(o.proposed_fix,1000),
   affects:[].concat(o.affects||[]).map(x=>clip(x,64)).filter(Boolean),needs:[].concat(o.needs||[]).map(String),created:now(),updated:now(),count:1,
   by:{platform:by.platform||null,uid:by.uid||null,chat:by.chat||null,thread:by.thread||null},byName:p?.name||by.who||null,tries:0,history:[],...(o.healthKey?{healthKey:String(o.healthKey)}:{})};
  i.decision=decide(pol,i,by).why;i.state=pol.fixer?.on===false?'open':'queued';if(i.state==='open')i.decision='the fixer is switched off in the team policy';
  db.items.unshift(i);db.items=db.items.slice(0,300);await save();log('issue '+i.id+' filed by '+(i.source==='health'?'Health':i.agent)+': '+i.state);return {issue:view(i)}});
 // Health saw the problem go away before the fixer started: closed, nobody told
 const healthGone=keys=>queue(async()=>{await load();const cur=new Set(keys);let n=0;
  for(const i of db.items)if(i.healthKey&&i.state==='queued'&&!cur.has(i.healthKey)){i.state='gone';i.updated=now();i.result={summary:'Health no longer sees it; it went away before the fixer started.'};n++}
  if(n)await save();return n});
 const forAgent=async a=>{await load();return db.items.filter(i=>i.agent===a).slice(0,10).map(view)};
 const list=async()=>{await load();return {items:db.items.slice(0,60).map(view),policy:await policy()}};
 // kept so old Telegram buttons and links answer something sensible
 const decideOwner=async(id)=>{await load();const i=db.items.find(x=>x.id===id);return i?view(i):null};
 const press=async()=>({ok:false,toast:'Nothing to approve any more: the fixer handles every issue by itself.'});

 // ---- the loop
 let running=null;
 const today=()=>new Date(now()).toISOString().slice(0,10);
 const fixRunsToday=()=>Object.values(db.runs).filter(r=>r.day===today()&&r.kind!=='proof'&&!r.notStarted).length;
 async function tick(){if(running)return;running=true;try{await load();const pol=await policy();if(pol.fixer?.on===false)return;
  const cur=Object.values(db.runs).find(r=>!r.done);if(cur)return await check(cur,pol);
  // a change waiting to be reloaded or rolled back comes first
  {const b=db.items.find(i=>i.state==='reloaded-back');if(b)return await afterTry(b)}
  const ap=db.items.find(i=>i.state==='applying'||i.state==='rollback');if(ap)return await reload(ap);
  if(!await ready().catch(()=>false))return;
  const v=[...db.items].reverse().find(i=>i.state==='verify');if(v)return await start(v,pol,'proof');
  if(fixRunsToday()>=(pol.fixer?.cap||20))return;
  const q=[...db.items].reverse().find(i=>i.state==='queued'&&!(i.notBefore>now()));if(q)return await start(q,pol,'fix')}finally{running=null}}
 async function start(i,pol,kind){const n=kind==='fix'?i.tries+1:i.tries,id=i.id+'-'+n+(kind==='proof'?'p':''),dir=path.join(DIR,id);await mkdir(dir,{recursive:true,mode:0o700});
  const last=i.history.filter(h=>h.kind==='fix').at(-1);
  await writeFile(path.join(dir,'prompt.txt'),kind==='fix'?fixerPrompt(i,{rules:pol.fixer?.rules||'',attempt:n}):proofPrompt(i,last,{reloaded:i.applied||null}),{mode:0o600});
  if(kind==='fix'){i.tries=n;i.state='fixing'}else i.state='verifying';i.run=id;i.updated=now();
  const r={id,issue:i.id,kind,day:today(),at:now(),agent:pol.fixer?.agent||'default'};db.runs[id]=r;await save();
  const minutes=kind==='fix'?Math.min(40,pol.fixer?.minutes||25):Math.min(30,pol.fixer?.proof_minutes||15);
  try{r.pid=await (launch||spawnRun)({dir,agent:r.agent,minutes})}catch(e){r.done=now();r.exit=-1;r.notStarted=true;if(kind==='fix')i.tries--;i.state=kind==='fix'?'queued':'verify';await save();log('issues: fixer could not start: '+e.message);return}
  await save();log('issues: '+kind+' run started for '+i.id+' ('+id+')')}
 async function spawnRun({dir,agent,minutes}){const out=await open(path.join(dir,'out.txt'),'w',0o600);
  try{const script='timeout -k 20 '+minutes*60+' "$1" -p "$2" chat --query-file "$3/prompt.txt" -Q --source tool </dev/null; printf %s "$?" > "$3/exit"';
   const p=spawn('bash',['-c',script,'aqeelos-fixer',bin,agent,dir],{detached:true,cwd:fixerHome,env:{HOME:fixerHome,USER:process.env.USER||'claude',PATH:path.join(fixerHome,'.local','bin')+':/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',TERM:'dumb',AQEELOS_FIXER:'1'},stdio:['ignore',out.fd,out.fd]});
   await new Promise((res,rej)=>{p.once('spawn',res);p.once('error',rej)});p.unref();return p.pid}finally{await out.close().catch(()=>{})}}
 const exists=f=>stat(f).then(()=>true,()=>false);
 // the code side of the hard rules, after a fix run: every changed file has a backup that exists, no listed file was
 // deleted, no .env gained a value that is not already on the box. Returns the reasons it is not safe.
 async function guard(res){const bad=[];const known=await envFiles().catch(()=>[]);
  for(const c of res.changes){if(!c.backup||!await exists(c.backup)){bad.push('no backup of '+c.file);continue}
   if(!await exists(c.file)){bad.push(c.file+' was deleted');continue}
   if(/(^|\/)\.env$/.test(c.file)){const [b,a]=await Promise.all([readFile(c.backup,'utf8').catch(()=>''),readFile(c.file,'utf8').catch(()=>'')]);
    const others=[];for(const f of known)if(path.resolve(f)!==path.resolve(c.file))others.push(await readFile(f,'utf8').catch(()=>''));
    const nw=newSecrets(b,a,[b,...others]);if(nw.length)bad.push(c.file+' got a key that is nowhere else on the box ('+nw.join(', ')+')')}}
  return bad}
 // put every listed file back from its backup (copy, so the backup stays)
 async function rollBack(changes){const done=[];for(const c of changes||[])if(c.backup&&await exists(c.backup)){await copyFile(c.backup,c.file);done.push(c.file)}return done}
 async function check(r,pol){const dir=path.join(DIR,r.id);const ex=await readFile(path.join(dir,'exit'),'utf8').catch(()=>null);
  const up=r.pid&&(alive?await alive(r):(()=>{try{process.kill(r.pid,0);return true}catch{return false}})());
  if(ex===null&&up)return;const out=await readFile(path.join(dir,'out.txt'),'utf8').catch(()=>'');r.done=now();r.exit=ex===null?null:Number(ex);
  const i=db.items.find(x=>x.id===r.issue);const kind=r.kind||'fix';const res=parseResult(out,kind);
  if(!i){await save();return}i.updated=now();
  // never reached the model: not a try; again in 5 minutes
  if(!res&&notStarted(out)){r.notStarted=true;if(kind==='fix')i.tries--;i.state=kind==='fix'?'queued':'verify';i.notBefore=now()+5*60e3;await save();log('issues: '+r.id+' did not reach the model; again in 5 minutes');return}
  if(kind==='fix'){const fr=res||{status:'failed',summary:'The fixer ended without a result'+(r.exit!=null?' (exit '+r.exit+')':' (stopped)')+'.',proof:clip(out.slice(-800),800),changes:[],apply:'none'};r.result=fr;
   const h={kind:'fix',run:r.id,at:now(),status:fr.status,summary:fr.summary,proof:fr.proof,need:fr.need,check:fr.check,apply:fr.apply,changes:fr.changes};i.history.push(h);i.result=fr;
   if(fr.status==='needs_human'){await rollBack(fr.changes);i.state='needs_human';i.need=fr.need||fr.summary;await save();
    const to=await tell(i,nameOf(i.agent)+' needs a person for a fix\n\nProblem: '+i.missing+'\nWhat is needed: '+(i.need||'-')+'\n\naqeelOS fixes the rest by itself once this is done (issue '+i.id+' on System › Health).');i.told=to;await save();log('issues: '+i.id+' needs a human, told '+to);return}
   // put back before it was ever reloaded: nothing to reload
   if(fr.status==='failed'){await rollBack(fr.changes);h.outcome='failed, rolled back';return await nextTry(i,null)}
   const bad=await guard(fr);
   if(bad.length){const back=await rollBack(fr.changes);h.outcome='unsafe ('+bad.join('; ')+'), '+(back.length?'put back':'nothing to put back');log('issues: '+i.id+' try '+i.tries+' broke a rule: '+bad.join('; '));return await nextTry(i,null)}
   i.applied=null;
   if(fr.apply!=='none'&&fr.changes.length){i.state='applying';i.applyKind=fr.apply;i.waitingSince=now()}else i.state='verify';
   await save();log('issues: '+r.id+' '+fr.status+' → '+i.state);return}
  // the proof run
  const pr=res||{status:'not_proven',proof:'The proof run ended without a result'+(r.exit!=null?' (exit '+r.exit+')':' (stopped)')+'. '+clip(out.slice(-600),600),need:''};r.result=pr;
  const last=i.history.filter(h=>h.kind==='fix').at(-1);i.history.push({kind:'proof',run:r.id,at:now(),status:pr.status,proof:pr.proof,need:pr.need});
  if(pr.status==='proven'){i.state='fixed';i.fixed=now();i.proof=pr.proof;i.result={...(i.result||{}),status:'fixed',proof:pr.proof};if(last)last.outcome='proven';await save();log('issues: '+i.id+' fixed and proven');return}
  if(last){last.outcome='not proven';last.proofNeed=pr.need}
  const back=await rollBack(last?.changes);if(last&&back.length)last.outcome+=', rolled back';i.lastNeed=pr.need||i.lastNeed;
  return await nextTry(i,back.length&&last?.apply!=='none'?last.apply:null)}
 // after a failed try: reload what was put back (if anything), then queued again, or stuck after the last try
 async function nextTry(i,reloadKind){if(reloadKind){i.state='rollback';i.applyKind=reloadKind;i.waitingSince=now();await save();return}return await afterTry(i)}
 async function afterTry(i){if(i.tries<TRIES){i.state='queued';i.notBefore=now()+60e3;await save();return}
  i.state='stuck';await save();
  const tried=i.history.filter(h=>h.kind==='fix').map((h,n)=>(n+1)+') '+clip(h.summary,200)+(h.outcome?' ('+h.outcome+')':'')).join('\n');
  const need=i.lastNeed||i.history.filter(h=>h.need).at(-1)?.need||'Look at issue '+i.id+' on System › Health and say what to try.';
  const to=await tell(i,nameOf(i.agent)+': aqeelOS tried '+TRIES+' times and could not fix this by itself\n\nProblem: '+i.missing+'\nTried:\n'+tried+'\n\nWhat is needed from you: '+need);i.told=to;i.need=need;await save();log('issues: '+i.id+' stuck, told '+to)}
 // reload safely once nothing is busy (/healthz busy 0); a restart hold or a busy box just waits for the next tick
 async function reload(i){const n=await busy().catch(()=>1);if(n>0)return;
  const kind=i.applyKind||'engine',back=i.state==='rollback';
  if(kind==='ui'){i.applied='ui';i.state=back?'reloaded-back':'verify';await save()}   // the web app restarts now: the next start continues
  const r=await apply(kind,'fixer '+i.id+(back?' (rollback)':'')).catch(e=>({ok:false,why:e.message}));
  if(!r?.ok){if(kind==='ui'){i.state=back?'rollback':'applying';await save()}log('issues: '+i.id+' reload waits: '+(r?.why||'not done'));return}
  i.applied=kind;i.waitingSince=null;if(back)return await afterTry(i);i.state='verify';await save();log('issues: '+i.id+' reloaded ('+kind+')')}
 // "Try again" on Health (after a person did what was needed, or for a stuck one): a fresh set of tries
 const retry=id=>queue(async()=>{await load();const i=db.items.find(x=>x.id===id);if(!i||OPEN.includes(i.state))return i?view(i):null;i.state='queued';i.tries=0;i.notBefore=0;i.updated=now();await save();return view(i)});
 return {file,healthGone,retry,decideOwner,press,forAgent,list,tick,policy,_db:async()=>{await load();return db}}}
