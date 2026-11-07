// Agents keep their own work working (7 Nov 2026, audit step 1). Three checks, each turned into notices the agent reads in
// its next message (agent-live.mjs) and in my_health until fixed, so the agent fixes its own work instead of the owner:
//   1) Old setup: an agent's own instructions, skills, schedules and scripts that still use something aqeelOS retired
//      (on 7 Nov the test-chat watchdog still said "Donna needs to restart the bridge", gone since 5 Nov).
//   2) Checks after a change: when keys, settings or the engine change (and every 30 minutes), every schedule's script
//      and the files its command names must exist, and every key in the agent's workspace .secrets must be readable by
//      the agent's own user (moving the payment keys back on 7 Nov left them unreadable and the watchdog crashing).
//   4) Keys (a register without values: names, where they are, a keyed fingerprint): a key that went missing, a key whose
//      .env and .secrets copies differ, and one key copied into several agents (whatsapp-2/3 held all 29 of Donna's keys).
//   3) Script-only schedules: a schedule whose whole prompt is "run exactly this command, reply with its output or
//      [SILENT]" ran a full model turn every few minutes for nothing. It becomes a script-only schedule (no model, no
//      tokens). The engine runs schedule scripts as the box's own user, so the script aqeelOS writes runs the agent's
//      command as the agent's own user (ssh to 127.0.0.1 with aqeelOS's agent key), never with more rights than before.
import {readFile,writeFile,readdir,stat,mkdir,chmod} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHash,createHmac} from 'node:crypto';
import path from 'node:path';

export const RETIRED=[
 {id:'wa-bridge',re:/\bbridge\.py\b|wa-agent\/bridge|\b(?:re)?start(?:s|ing)? (?:the )?(?:test |whatsapp |wa |kirimdev )?bridge\b|\bbridge (?:is|looks|seems) (?:down|dead|broken)|\btest bridge\b/i,
  now:'Kirimdev lines (the team\'s WhatsApp CRM) run inside aqeelOS through the Kirimdev API key and webhooks (Channels > Kirimdev); there is no bridge to start, restart or check'}];
const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};
// the command a schedule's prompt only runs, or null: "Run exactly this terminal command[ and nothing else]: <cmd>" whose
// reply is the command's output unchanged or [SILENT]
export function scriptOnlyCommand(prompt){const p=String(prompt||'');const m=/^Run exactly this terminal command(?: and nothing else)?:\s*(.+?)\s*$/m.exec(p);
 if(!m||m.index!==0||!/\[SILENT\]/.test(p)||!/(exactly|unchanged)/i.test(p.slice(m[0].length)))return null;const cmd=m[1].replace(/^`|`$/g,'').trim();
 if(!cmd||cmd.length>500||/[\n\r]/.test(cmd))return null;
 // anything beyond running it and passing its output on (sending, deciding, editing) needs the model
 const rest=p.slice(m[0].length).replace(/never send whatsapp messages\.?|do nothing else:?/gi,'');if(/\b(then|also|summari[sz]e|translate|send (it|a|the)|post|reply to|decide|if .* (fails?|errors?) .* (fix|try))\b/i.test(rest))return null;return cmd}
export function wrapperScript({agent,user,key,cwd,cmd}){const b64=Buffer.from(cmd).toString('base64');
 return `#!/bin/bash
# Made by aqeelOS (agent-care.mjs) for ${agent}'s script-only schedule: runs its own command as its own user, no model.
# The command: ${cmd.replace(/\n/g,' ')}
exec ssh -i '${key}' -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 '${user}@127.0.0.1' "cd '${cwd}' && echo ${b64} | base64 -d | bash"
`}
// files a command names by absolute path (python3 /x/y.py, bash /x/y.sh, /x/tool)
export function namedFiles(cmd){return [...String(cmd||'').matchAll(/(?:^|\s|[(`'"])(\/[\w.-]+(?:\/[^\s'";|&<>`]+)+)/g)].map(m=>m[1].replace(/[),.;:\]}]+$/,'')).filter(f=>!/[*?$]/.test(f))}

export function createAgentCare({HERMES_HOME,WORK,DATA=null,fpKey=async()=>'',teamOf=async()=>null,homes,readConfig,pick,jobs,updateJob,record=async()=>{},notices,extraRetired=async()=>[],
 sshKey=path.join(HERMES_HOME,'agent-ssh','id_ed25519'),run=defaultRun,log=m=>console.log(m),now=()=>Date.now()}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const base=a=>String(a).split('--')[0];
 const own=async a=>{const c=await readConfig(a).catch(()=>null)||{};return {user:pick(c,'terminal.backend')==='ssh'?String(pick(c,'terminal.ssh_user')||''):'',cwd:String(pick(c,'terminal.cwd')||path.join(WORK,base(a)))}};
 // ---- 1) old setup ----
 async function filesOf(a){const out=[];const add=async(f,label)=>{const st=await stat(f).catch(()=>null);if(st?.isFile()&&st.size<400e3&&!/\.(bak|orig|replaced)|bak-|\.replaced-by/.test(f))out.push({f,label})};
  await add(path.join(home(a),'SOUL.md'),'your instructions (SOUL.md)');
  for(const cat of await readdir(path.join(home(a),'skills'),{withFileTypes:true}).catch(()=>[]))if(cat.isDirectory()&&!cat.name.startsWith('.')){
   const p=path.join(home(a),'skills',cat.name);await add(path.join(p,'SKILL.md'),'skill '+cat.name);
   for(const s of await readdir(p,{withFileTypes:true}).catch(()=>[]))if(s.isDirectory())await add(path.join(p,s.name,'SKILL.md'),'skill '+cat.name+'/'+s.name)}
  if(a===base(a)){const w=path.join(WORK,a);for(const d of [w,path.join(w,'.tools')])for(const e of await readdir(d,{withFileTypes:true}).catch(()=>[]))
   if(e.isFile()&&/\.(py|sh|mjs|js|md|txt)$|^[^.]+$/.test(e.name))await add(path.join(d,e.name),path.relative(w,path.join(d,e.name)))}
  return out}
 async function oldSetup(a){const rules=[...RETIRED,...(await extraRetired().catch(()=>[])).map(r=>({...r,re:new RegExp(r.pattern,'i')}))];const found=[];
  const check=(text,label)=>{for(const r of rules){const m=r.re.exec(text);if(m)found.push({key:r.id+'|'+label,text:label+' still says "'+clip(m[0],60)+'" (old setup). Now: '+r.now+'. Update it.'})}};
  for(const {f,label} of await filesOf(a))check(await readFile(f,'utf8').catch(()=>''),label);
  for(const j of await jobs(a).catch(()=>[]))if(j.enabled!==false)check(String(j.prompt||''),'schedule "'+j.name+'" ('+j.id+')');
  return found}
 // ---- 2) checks after a change ----
 async function asAgent(a,script){const {user}=await own(a);if(!/^ag-[\w-]+$/.test(user))return null;
  const r=await run('ssh',['-i',sshKey,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=15',user+'@127.0.0.1',script],30000);return r}
 async function checks(a){const found=[];const {cwd}=await own(a);
  for(const j of await jobs(a).catch(()=>[])){if(j.enabled===false||j.state==='paused')continue;
   if(j.script){const sp=path.isAbsolute(j.script)?j.script:path.join(home(a),'scripts',j.script);if(!await stat(sp).catch(()=>null))found.push({key:'script|'+j.id,text:'schedule "'+j.name+'" ('+j.id+') runs script '+j.script+', which is missing. Put it back or fix the schedule (my_schedules).'})}
   for(const f of namedFiles(j.prompt))if(f.startsWith(WORK+path.sep)&&!await stat(f).catch(()=>null))found.push({key:'file|'+j.id+'|'+f,text:'schedule "'+j.name+'" ('+j.id+') runs '+f+', which is missing. Put it back or fix the schedule (my_schedules).'})}
  if(a===base(a)){const sec=path.join(WORK,a,'.secrets');const names=(await readdir(sec).catch(()=>[])).filter(n=>!n.startsWith('.'));
   if(names.length){const r=await asAgent(a,"cd '"+sec+"' 2>/dev/null && for f in *; do [ -f \"$f\" ] && { [ -r \"$f\" ] || echo \"$f\"; }; done");
    if(r&&r.ok)for(const n of r.out.split('\n').map(x=>x.trim()).filter(Boolean))found.push({key:'secret|'+n,text:'your key '+n+' in .secrets cannot be read by you, so whatever uses it fails. Report it with report_bottleneck system true (aqeelOS fixes file rights).',fix:{secret:path.join(sec,n)}})}}
  return found}
 // file rights aqeelOS may fix by itself: a key file in an agent's own .secrets the agent's user cannot read (group rights back)
 async function fixRights(a,found){let fixed=0;for(const x of found.filter(x=>x.fix?.secret)){try{const st=await stat(x.fix.secret);await chmod(x.fix.secret,(st.mode&0o777)|0o060);fixed++}catch{}}return fixed}
 // ---- 3) script-only schedules ----
 async function scriptOnly(a){const done=[];const {user,cwd}=await own(a);if(!/^ag-[\w-]+$/.test(user))return done;
  for(const j of await jobs(a).catch(()=>[])){if(j.no_agent||j.script)continue;const cmd=scriptOnlyCommand(j.prompt);if(!cmd)continue;
   const name='aq-job-'+String(j.id).replace(/[^\w-]/g,'')+'.sh';const dir=path.join(home(a),'scripts');await mkdir(dir,{recursive:true});
   await writeFile(path.join(dir,name),wrapperScript({agent:a,user,key:sshKey,cwd,cmd}),{mode:0o700});
   try{await updateJob(a,j.id,{no_agent:true,script:name});done.push(j.id);
    await record(base(a),{kind:'schedule',what:'"'+j.name+'" now runs its command without a model turn (script '+name+'); same output, no tokens',why:'aqeelOS: the prompt only ran one command',before:{prompt:j.prompt},after:{script:name,no_agent:true}});
    log('agent-care: '+a+' schedule '+j.id+' is script-only now')}catch(e){log('agent-care: '+a+' schedule '+j.id+' not converted: '+e.message)}}
  return done}
 // ---- 4) keys ----
 const SECRETISH=/(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASSPHRASE|_PAT|_SID|_DSN)$/;
 async function keysOf(a){const k=await fpKey();const fp=v=>createHmac('sha256',k||'aqeelos').update(String(v)).digest('hex').slice(0,16);const out={};
  for(const l of (await readFile(path.join(home(a),'.env'),'utf8').catch(()=>'')).split('\n')){const m=/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(l);if(!m||!SECRETISH.test(m[1]))continue;
   const v=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');if(v.length<8)continue;(out[m[1]]||(out[m[1]]={}))['.env']=fp(v)}
  if(a===base(a))for(const n of await readdir(path.join(WORK,a,'.secrets')).catch(()=>[])){if(n.startsWith('.')||!/^[A-Z][A-Z0-9_]*$/.test(n))continue;
   const v=(await readFile(path.join(WORK,a,'.secrets',n),'utf8').catch(()=>null));if(v==null||v.trim().length<8)continue;(out[n]||(out[n]={}))['.secrets']=fp(v.trim())}
  return out}
 const regFile=DATA?path.join(DATA,'agent-live','keys.json'):null;
 async function keysTick(){if(!regFile)return {};const old=JSON.parse(await readFile(regFile,'utf8').catch(()=>'{}')||'{}');const reg={},per={};const t=now();
  for(const a of await homes()){const k=await keysOf(a).catch(()=>({}));reg[a]={};const notes=[];
   for(const [n,w] of Object.entries(k)){reg[a][n]={...w,seen:t};if(w['.env']&&w['.secrets']&&w['.env']!==w['.secrets'])notes.push({key:'differ|'+n,text:'your key '+n+' has one value in .env and another in .secrets, so programs disagree. Keep the right one in both (ask the owner for a lockbox link if unsure).'})}
   for(const [n,w] of Object.entries(old[a]||{}))if(!k[n]){const gone=w.gone||t;if(t-gone<14*86400e3){reg[a][n]={...w,gone};notes.push({key:'gone|'+n,text:'your key '+n+' is gone from '+Object.keys(w).filter(x=>x.startsWith('.')).join(' and ')+' since '+new Date(gone).toISOString().slice(0,16).replace('T',' ')+' UTC. If you did not remove it on purpose, ask the owner for a lockbox link to put it back.'})}}
   per[a]=notes}
  // one key in several agents: told to the owner's agent. An agent and its own copies count as one; a key of another
  // agent in a copy (a bot token) is still flagged. Model and search providers' keys are shared on purpose and left out.
  const byFp={};for(const [a,ks] of Object.entries(reg))for(const [n,w] of Object.entries(ks))if(!w.gone)for(const f of new Set(Object.entries(w).filter(([x])=>x.startsWith('.')).map(([,v])=>v)))(byFp[f]||(byFp[f]=new Set())).add(a+':'+n);
  // the engine's own keys (one per box by design) and keys shared inside one team (Randy and Gilang use one Kirimdev account)
  const SYSTEM=/^(API_SERVER_KEY|TERMINAL_SSH_KEY|HERMES_[A-Z_]+)$/;
  // keys the owner decided to share (DATA/keys-shared-ok.json: ["N8N_MCP_TOKEN", …])
  const okNames=new Set(DATA?JSON.parse(await readFile(path.join(DATA,'keys-shared-ok.json'),'utf8').catch(()=>'[]')||'[]').map(String):[]);
  const SHARED_OK=/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|OPENROUTER|XAI|GROQ|DEEPSEEK|MISTRAL|ELEVENLABS|FIRECRAWL|EXA|TAVILY|BRAVE|PERPLEXITY|FAL|REPLICATE|HF)_/;
  const dup=[];for(const set0 of Object.values(byFp)){const set=new Set([...set0].filter(x=>!SHARED_OK.test(x.split(':')[1])&&!SYSTEM.test(x.split(':')[1])&&!okNames.has(x.split(':')[1])));const agents=new Set([...set].map(x=>base(x.split(':')[0])));if(agents.size<2)continue;   // an agent's own copies (name--x) are the same agent: Donna's WhatsApp copies use her Slack app secrets (7 Nov 2026)
   const teams=new Set();for(const a of agents)teams.add(await teamOf(a).catch(()=>null)||'-'+a);if(teams.size===1&&![...teams][0].startsWith('-'))continue;dup.push([...set].sort())}
  for(const [a,notes] of Object.entries(per))await notices.setNotices(base(a),'keys'+(a===base(a)?'':':'+a),notes);
  await notices.setNotices('default','keys-shared',dup.slice(0,20).map(l=>({key:'dup|'+l.join(','),text:'one key value is copied into several agents: '+l.join(', ')+'. Each agent should have its own key (a bot token belongs to one agent); remove the copies that should not have it.'})));
  await mkdir(path.dirname(regFile),{recursive:true});await writeFile(regFile+'.tmp',JSON.stringify(reg),{mode:0o600});await (await import('node:fs/promises')).rename(regFile+'.tmp',regFile);
  return {shared:dup.length}}
 // ---- the tick: every 30 minutes, and at once when an agent's keys, settings or the engine changed ----
 const marks=new Map();
 async function mark(a){const parts=[];for(const f of [path.join(home(a),'.env'),path.join(home(a),'config.yaml'),path.join(home(a),'cron','jobs.json'),path.join(HERMES_HOME,'hermes-agent','VERSION')]){const st=await stat(f).catch(()=>null);parts.push(st?st.mtimeMs:0)}
  const sec=path.join(WORK,base(a),'.secrets');for(const n of (await readdir(sec).catch(()=>[])).sort()){const st=await stat(path.join(sec,n)).catch(()=>null);parts.push(n+':'+(st?st.mode+':'+st.mtimeMs:0))}
  return createHash('sha1').update(parts.join('|')).digest('hex')}
 let keysAt=0;
 async function tick({force=false}={}){const out={};if(force||now()-keysAt>30*60e3){keysAt=now();try{const k=await keysTick();if(k.shared)out._keys=k}catch(e){log('agent-care keys: '+e.message)}}for(const a of await homes()){try{const m=await mark(a);const due=force||marks.get(a)?.m!==m||now()-(marks.get(a)?.at||0)>30*60e3;if(!due)continue;
   const conv=await scriptOnly(a);let c=await checks(a);const fixed=await fixRights(a,c);if(fixed){log('agent-care: '+a+': gave '+fixed+' key file(s) back their group read right');c=await checks(a)}
   const o=await oldSetup(a);const n1=await notices.setNotices(base(a),'checks'+(a===base(a)?'':':'+a),c)||{};const n2=await notices.setNotices(base(a),'old-setup'+(a===base(a)?'':':'+a),o)||{};
   // only what changed is reported (the log said the same every 2 minutes)
   const news=[...(n1.added||[]),...(n2.added||[])],solved=[...(n1.gone||[]),...(n2.gone||[])];
   marks.set(a,{m:await mark(a),at:now()});if(conv.length||fixed||news.length||solved.length)out[a]={scriptOnly:conv,fixed,new:news,solved}}catch(e){log('agent-care '+a+': '+e.message)}}
  return out}
 return {tick,oldSetup,checks,scriptOnly,keysTick}}

function defaultRun(cmd,args,timeout){return new Promise(res=>execFile(cmd,args,{timeout,encoding:'utf8',maxBuffer:4e6},(e,out,err)=>res({ok:!e,out:out||'',err:err||''})))}
