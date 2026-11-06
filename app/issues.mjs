// Issues and the fixer (6 Nov 2026, "the team should never need to message the main agent"): when an agent hits a
// problem outside its own files (sending code, a tool, the engine, aqeelOS), it files an issue with evidence and a
// proposed fix (report_bottleneck with system true). aqeelOS then:
//   1. decides whether it may be fixed at once or needs the owner's OK (decide() below, from the team policy, a
//      setting in DATA/team-policy.json, shown on System › Health): a change that only touches the agents of the team
//      the person who asked belongs to goes ahead; anything touching other agents, keys or secrets, permissions or
//      sharing, spending money or deleting data waits for the owner, who gets ONE message with Approve / Decline;
//   2. runs the fixer: a headless coding run on this server (the engine of the agent named in the policy, `fixer.agent`,
//      started as a program, not a chat with anyone) that backs files up, fixes, tests, and says what it proved;
//   3. answers in the chat/topic where the problem was reported, and tells the owner only when a fix failed.
// Everything is listed on System › Health › Issues. Nothing here names a person, group or agent: that is all policy.
import {readFile,writeFile,mkdir,rename,open,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const clip=(s,n)=>String(s??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').slice(0,n);
// what always needs the owner, whoever asks (owner's rule, 6 Nov 2026)
export const OWNER_ONLY=[['keys','keys, tokens or secrets',/\b(api[ _-]?keys?|secrets?|tokens?|passwords?|credentials?|\.env\b|private key)/i],
 ['permissions','permissions or sharing levels',/\b(permissions?|sharing level|access level|allow ?list|sudo|chmod|setfacl|trusted people|admin rights?)/i],
 ['money','spending money',/\b(pay(ing|ment)? for|subscri(be|ption)|buy|purchase|top ?up|billing|upgrade (the )?plan)\b/i],
 ['delete','deleting data',/\b(delete|remove|drop|wipe|purge|truncate)\b.{0,40}\b(data|rows?|records?|chats?|messages?|files?|database|table|sheet|customers?)/i]];
// the team policy: {owner:{telegram:[ids]}, teams:[{name, agents:[...], members:[{name, telegram}]}], fixer:{agent, on, cap}}
export function teamOf(policy,agent){return (policy?.teams||[]).find(t=>(t.agents||[]).includes(agent))||null}
export function personOf(policy,platform,uid){uid=String(uid||'');if(!uid)return null;
 if([].concat(policy?.owner?.[platform]||[]).map(String).includes(uid))return {owner:true,name:policy.owner.name||'Owner'};
 for(const t of policy?.teams||[])for(const m of t.members||[])if([].concat(m[platform]||[]).map(String).includes(uid))return {owner:false,name:m.name,team:t,full:[].concat(m.full_authority||[]).map(String)};
 return null}
// may this issue be fixed without the owner? issue: {agent, affects:[agents], needs:[...], text}; by: {platform, uid}
export function decide(policy,issue,by){const p=personOf(policy,by?.platform,by?.uid);
 const flagged=OWNER_ONLY.filter(([k,,re])=>(issue.needs||[]).includes(k)||re.test(String(issue.proposed_fix||''))).map(([k,l])=>({k,l}));
 if(p?.owner)return {auto:true,why:'asked by the owner'};
 // a team member the owner gave full authority over some agents (team policy: members[].full_authority) decides for
 // changes that only touch those agents, like the owner would
 {const aff=[...new Set([issue.agent,...(issue.affects||[])])].filter(a=>a!=='aqeelos');
  if(p?.full?.length&&aff.length&&aff.every(a=>p.full.includes(a)))return {auto:true,why:p.name+' has full authority over '+aff.join(', ')}}
 if(flagged.length)return {auto:false,why:'it touches '+flagged.map(x=>x.l).join(' and ')+', which only the owner decides'};
 const team=teamOf(policy,issue.agent),affects=[...new Set([issue.agent,...(issue.affects||[])])];
 if(!team)return {auto:false,why:'this agent is in no team in the policy'};
 const outside=affects.filter(a=>a!=='aqeelos'&&!(team.agents||[]).includes(a));
 if(outside.length)return {auto:false,why:'it would change '+outside.join(', ')+', outside the '+team.name+' team'};
 // a change asked by a member of this team that only touches the team's own agents goes ahead; one that came from
 // anyone else (a customer chat, an unknown person) waits for the owner, so nobody outside steers the fixer
 if(!p)return {auto:false,why:'it did not come from the owner or a team member'};
 if(p.team!==team)return {auto:false,why:p.name+' is not in the '+team.name+' team'};
 return {auto:true,why:'asked by '+p.name+'; it only touches the '+team.name+' team'}}
// the fixer's last line: RESULT: {"status":"fixed|failed|needs_owner","summary":"…","proof":"…","restart_ui":false}
// Telegram inline buttons for an issue (callback_data max 64 bytes: "aqi:a:"+9+1+16 = 32)
export const issueButtons=(id,sig)=>({inline_keyboard:[[{text:'Approve',callback_data:'aqi:a:'+id+':'+sig},{text:'Decline',callback_data:'aqi:d:'+id+':'+sig}]]});
export function parseResult(out){const m=[...String(out||'').matchAll(/RESULT:\s*(\{[^\n]*\})/g)].pop();if(!m)return null;try{const j=JSON.parse(m[1]);
 if(!['fixed','failed','needs_owner'].includes(j.status))return null;return {status:j.status,summary:clip(j.summary,1500),proof:clip(j.proof,1500),restart_ui:j.restart_ui===true}}catch{return null}}

export function fixerPrompt(i,{rules=''}={}){return [
 'You are the aqeelOS fixer: a headless coding run on this server. Nobody is chatting with you. Fix ONE issue an agent filed, then stop.',
 '','ISSUE '+i.id+' (filed by agent '+i.agent+(i.byName?', asked by '+i.byName:'')+')',
 'What it was doing: '+(i.what||'-'),'Problem: '+i.missing,'Evidence: '+(i.evidence||'-'),'Proposed fix: '+(i.proposed_fix||i.fix||'-'),
 'Agents it may affect: '+[i.agent,...(i.affects||[])].join(', '),
 '','RULES',
 '- Find the real cause on this server first (files, logs, the agent\'s state.db). Fix the cause, not the symptom; no hard-coded ids, names or paths in shared code (settings instead).',
 '- Only change what this issue needs, and only for the agents listed above. Never touch keys/secrets, permissions or sharing levels, never spend money, never delete data. If the fix needs one of those, stop with status needs_owner.',
 '- Back up every file before you change it (copy to <file>.bak-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+i.id+').',
 '- Test it: run the existing tests for what you changed (scripts/*.test.mjs in the web app, the engine\'s tests) and one real check that the problem is gone. Paste the commands and their output in proof.',
 '- Never run "gateway restart" or kill processes. Engine or agent settings take effect through the agents\' normal reload: say so. If you changed the web app\'s code, set restart_ui true and aqeelOS restarts it safely after you finish.',
 '- WhatsApp agents stay in their current mode (test mode stays test mode).',
 rules?'- '+rules:null,
 '','End with exactly one line: RESULT: {"status":"fixed|failed|needs_owner","summary":"one or two plain sentences for the team","proof":"what you ran and saw","restart_ui":false}'].filter(x=>x!==null).join('\n')}

export function createIssues({DATA,home,bin,fixerHome,now=()=>Date.now(),reply=async()=>false,tellOwner=async()=>{},askOwner=null,approvalLink=id=>'',restartSelf=()=>{},nameOf=a=>a,quiet=()=>null,log=m=>console.log(m),
 launch=null,alive=null}){
 const FILE=path.join(DATA,'issues.json'),POL=path.join(DATA,'team-policy.json'),DIR=path.join(DATA,'issues');let db=null,chain=Promise.resolve();
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.items||=[];db.runs||={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';await writeFile(t,JSON.stringify(db,null,1));await rename(t,FILE)};
 const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const policy=async()=>{try{return JSON.parse(await readFile(POL,'utf8'))}catch{return {teams:[],fixer:{on:false}}}};
 const view=i=>({...i,agentName:nameOf(i.agent),sig:undefined});
 // the owner's question: Approve / Decline buttons on Telegram (askOwner); the signed link only when buttons cannot be sent
 // test agents and a restart hold (alert-quiet.mjs): nothing goes to the owner, it is logged instead
 const muted=(agent,text)=>{const q=quiet(agent||null);if(q)log('issues: not sent to the owner ('+(q==='test'?'test agent':'restart hold')+'): '+String(text).slice(0,200));return !!q};
 const toOwner=async(agent,text)=>{if(!muted(agent,text))await tellOwner(text)};
 const ask=async(i,text)=>{if(muted(i.agent,text))return;if(askOwner){try{if(await askOwner(text,{id:i.id,sig:i.sig}))return}catch(e){log('issues: buttons not sent, using the link: '+e.message)}}
  await tellOwner(text+'\n\nApprove or decline: '+approvalLink(i.id,i.sig))};
 // an agent files an issue: o = {agent, what, missing, evidence, proposed_fix, affects, needs, origin:{platform, uid, who, chat, thread}}
 const file=o=>queue(async()=>{await load();const pol=await policy();const m=clip(o.missing,500).trim();if(!m)throw Error('Say what is broken (missing).');
  const key=o.agent+'|'+m.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,100);
  let i=db.items.find(x=>x.key===key&&['open','waiting','approved','fixing'].includes(x.state));
  if(i){i.count++;i.updated=now();if(o.evidence)i.evidence=clip(o.evidence,2000);await save();return {issue:view(i),again:true}}
  const by=o.origin||{},p=personOf(pol,by.platform,by.uid);
  i={id:'i'+randomBytes(4).toString('hex'),key,agent:o.agent,what:clip(o.what,400),missing:m,evidence:clip(o.evidence,2000),proposed_fix:clip(o.proposed_fix,1000),
   affects:[].concat(o.affects||[]).map(x=>clip(x,64)).filter(Boolean),needs:[].concat(o.needs||[]).map(String),created:now(),updated:now(),count:1,
   by:{platform:by.platform||null,uid:by.uid||null,chat:by.chat||null,thread:by.thread||null},byName:p?.name||by.who||null,sig:randomBytes(12).toString('base64url'),attempts:0};
  const d=decide(pol,i,by);i.decision=d.why;
  if(pol.fixer?.on===false){i.state='open';i.decision='the fixer is switched off in the team policy'}
  else if(d.auto)i.state='approved';
  else{i.state='waiting';const t=nameOf(i.agent)+' needs your OK for a fix\n\nProblem: '+i.missing+(i.byName?'\nAsked by: '+i.byName:'')+'\nProposed fix: '+(i.proposed_fix||'-')+'\nWhy it waits for you: '+d.why;
   ask(i,t).then(()=>queue(async()=>{i.asked=now();await save()}),e=>log('issues: the owner could not be asked: '+e.message))}
  db.items.unshift(i);db.items=db.items.slice(0,300);await save();log('issue '+i.id+' filed by '+i.agent+': '+i.state+' ('+d.why+')');return {issue:view(i)}});
 const decideOwner=(id,sig,ok,by='owner')=>queue(async()=>{await load();const i=db.items.find(x=>x.id===id);if(!i||!sig||i.sig!==sig)return null;
  if(i.state!=='waiting')return view(i);i.state=ok?'approved':'declined';i.decidedBy=by;i.decided=now();await save();
  if(!ok)reply(i,'The owner declined this change, so it is not made: '+i.missing).catch(()=>{});return view(i)});
 // a press on a Telegram button: data "aqi:a|d:<id>:<sig>", from = the presser's Telegram user id; only the owner(s) in the policy
 const press=async(data,from)=>{const m=/^aqi:([ad]):(i[0-9a-f]{8}):([\w-]{10,40})$/.exec(String(data||''));if(!m)return {ok:false,toast:'Unknown button.'};
  const pol=await policy();if(!personOf(pol,'telegram',from)?.owner)return {ok:false,toast:'Not allowed: only the owner can decide this.'};
  const i=await decideOwner(m[2],m[3],m[1]==='a','owner (Telegram)');if(!i)return {ok:false,toast:'This button is no longer valid.'};
  const word=i.state==='approved'?'Approved':i.state==='declined'?'Declined':'Already '+i.state;
  return {ok:true,toast:word,text:word+' by the owner: '+i.agentName+' — '+i.missing+(i.state==='approved'?'\nThe fixer runs within a minute and answers in the chat where it was reported.':i.state==='declined'?'\nNothing is changed.':'')}};
 const forAgent=async a=>{await load();return db.items.filter(i=>i.agent===a).slice(0,10).map(view)};
 const list=async()=>{await load();return {items:db.items.slice(0,60).map(view),policy:await policy()}};

 // the fixer: one run at a time, the oldest approved issue first; two tries per issue; a daily cap (policy fixer.cap, 10)
 const DEF=String.raw;let running=null;
 async function tick(){if(running)return;await load();const pol=await policy();if(pol.fixer?.on===false)return;
  const cur=Object.values(db.runs).find(r=>!r.done);if(cur){running=true;try{await check(cur)}finally{running=null}return}
  const today=new Date(now()).toISOString().slice(0,10),n=Object.values(db.runs).filter(r=>r.day===today).length;if(n>=(pol.fixer?.cap||10))return;
  const i=[...db.items].reverse().find(x=>x.state==='approved'&&x.attempts<2);if(!i)return;running=true;try{await start(i,pol,today)}finally{running=null}}
 async function start(i,pol,day){const id=i.id+'-'+(i.attempts+1),dir=path.join(DIR,id);await mkdir(dir,{recursive:true,mode:0o700});
  await writeFile(path.join(dir,'prompt.txt'),fixerPrompt(i,{rules:pol.fixer?.rules||''}),{mode:0o600});i.attempts++;i.state='fixing';i.run=id;
  const r={id,issue:i.id,day,at:now(),agent:pol.fixer?.agent||'default'};db.runs[id]=r;await save();
  try{r.pid=await (launch||spawnRun)({dir,agent:r.agent,minutes:Math.min(40,pol.fixer?.minutes||25)})}catch(e){r.done=now();r.exit=-1;i.state='approved';await save();log('issues: fixer could not start: '+e.message);return}
  await save();log('issues: fixer started for '+i.id+' ('+id+')')}
 async function spawnRun({dir,agent,minutes}){const out=await open(path.join(dir,'out.txt'),'w',0o600);
  try{const script='timeout -k 20 '+minutes*60+' "$1" -p "$2" chat --query-file "$3/prompt.txt" -Q --source tool </dev/null; printf %s "$?" > "$3/exit"';
   const p=spawn('bash',['-c',script,'aqeelos-fixer',bin,agent,dir],{detached:true,cwd:fixerHome,env:{HOME:fixerHome,USER:process.env.USER||'claude',PATH:path.join(fixerHome,'.local','bin')+':/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',TERM:'dumb',AQEELOS_FIXER:'1'},stdio:['ignore',out.fd,out.fd]});
   await new Promise((res,rej)=>{p.once('spawn',res);p.once('error',rej)});p.unref();return p.pid}finally{await out.close().catch(()=>{})}}
 async function check(r){const dir=path.join(DIR,r.id);const ex=await readFile(path.join(dir,'exit'),'utf8').catch(()=>null);
  const up=r.pid&&(alive?await alive(r):(()=>{try{process.kill(r.pid,0);return true}catch{return false}})());
  if(ex===null&&up)return;const out=await readFile(path.join(dir,'out.txt'),'utf8').catch(()=>'');r.done=now();r.exit=ex===null?null:Number(ex);
  const i=db.items.find(x=>x.id===r.issue);const res=parseResult(out)||{status:'failed',summary:'The fixer ended without a result'+(r.exit!=null?' (exit '+r.exit+')':' (stopped)')+'.',proof:clip(out.slice(-800),800)};r.result=res;
  if(i){i.result=res;i.updated=now();
   if(res.status==='fixed'){i.state='fixed';i.fixed=now();await reply(i,'Fixed by aqeelOS: '+res.summary).catch(()=>{})}
   else if(res.status==='needs_owner'||i.attempts>=2){i.state=res.status==='needs_owner'?'waiting':'failed';
    {const t=nameOf(i.agent)+': a fix '+(res.status==='needs_owner'?'needs your OK':'failed')+'\n\nProblem: '+i.missing+'\nFixer: '+res.summary;await (res.status==='needs_owner'?ask(i,t):toOwner(i.agent,t)).catch(()=>{})}
    await reply(i,res.status==='needs_owner'?'This needs the owner\'s OK before it can be changed; they have been asked. Not fixed yet.':'aqeelOS could not fix this by itself yet; the owner has been told. Not fixed yet: '+res.summary).catch(()=>{})}
   else i.state='approved'}
  await save();log('issues: fixer '+r.id+' ended: '+res.status);if(res.status==='fixed'&&res.restart_ui)setTimeout(()=>restartSelf('fixer '+r.id),3000)}
 return {file,decideOwner,press,forAgent,list,tick,policy,_db:async()=>{await load();return db}}}
