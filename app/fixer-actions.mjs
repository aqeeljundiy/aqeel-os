// What the fixer may DO to the box, and what it may LOOK at (security audit AUD-6, 13 Nov 2026).
//
// Reports that reach the fixer contain words written by outsiders (customers, web pages), so a fixer run is never trusted with a
// shell that can reach the box's keys. Every run (code fix, settings repair, proof) is a terminal of the fixer's own Linux user
// (fixer-sandbox.mjs): it cannot read or write anything of the owner's. What it needs from the box it ASKS the app for, over its
// signed routes (/fixer-ops/<issue>/<run>/<sig>/repair and /check), and the app does it itself after checking the arguments:
//   - REPAIRS: a short list of named actions, each with strict argument rules (an agent id from this issue's own list, a path part
//     that cannot climb out, a value from a fixed set). The app backs the file up first and writes a journal; the journal, not the
//     fixer's own word, is the list of files the run changed (issues.mjs puts them back if the proof fails).
//   - CHECKS: read-only looks (a log tail, a schedule's state, a skill's missing files, a test message as a tester, ...), secrets hidden.
// Anything else is not allowed: the run ends with "needs a person" and the exact command for the owner. Nothing here reads a key,
// writes a sign-in, changes a tool, app or permission of an agent, or runs a command the caller wrote.
import {readFile,writeFile,mkdir,lstat,realpath,readdir,copyFile,stat,chmod,appendFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {updateStore} from './store.mjs';

export const AGENT_ID=/^[a-z0-9][a-z0-9_-]{0,40}$/;
// one part of a path: starts with a letter or digit (so never "." ".." or a dot file), no slash, no control character
export const SEG=/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}$/;
const TEST_FILE=/^scripts\/[\w.-]+\.test\.mjs$/;
export const MAX_REPAIRS=25,MAX_CHECKS=250;
// words a repair text may not contain: commands, links, anything that looks like a key or a sign-in file. A rule an outsider talked the
// fixer into writing would otherwise live on in an agent's SOUL.md or a customer message.
export const BAD_TEXT=/\b(curl|wget|sudo|ssh|scp|netcat|chmod|chown|eval|exec|bash|powershell|python3?|node|npm|pip|rm -rf)\b|\|\s*(ba)?sh\b|https?:\/\/|www\.|\.env\b|id_ed25519|authorized_keys|-----BEGIN|\b(sk|pk|ghp|gho|xox[bp]|AKIA)[-_]?[A-Za-z0-9]{12,}|[A-Za-z0-9_-]{40,}|\+?\d[\d ()-]{8,}\d/i;
// file types a skill may be given back (never a key, a token or a sign-in)
const SKILL_EXT=/\.(md|txt|json|ya?ml|py|mjs|js|sh|png|jpe?g|webp|gif|svg|ttf|otf|woff2?|csv|html|css)$/i;
const SECRETISH=/(^|[\/._-])(env|key|keys|token|tokens|secret|secrets|password|credentials?|id_[a-z0-9]+|auth)([\/._-]|$)/i;

class Refused extends Error{constructor(m,status=400){super(m);this.status=status}}
const no=m=>{throw new Refused(m)};
const S=(v,d='')=>{v=v??d;if(typeof v!=='string')no('A text value was expected.');return v};
const text=(s,max,{empty=false}={})=>{s=S(s);if(!s.trim()&&!empty)no('The text is empty.');if(s.length>max)no('The text is longer than '+max+' characters.');
 if(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s))no('The text has a control character.');
 if(BAD_TEXT.test(s))no('The text holds something a repair may not write (a command, a link, a phone number or something that looks like a key).');return s};
const intIn=(v,lo,hi)=>{if(typeof v!=='number'&&typeof v!=='string')no('A number was expected.');if(typeof v==='string'&&!/^-?\d{1,6}$/.test(v))no('A whole number was expected.');const n=Number(v);if(!Number.isInteger(n)||n<lo||n>hi)no('The number must be a whole number from '+lo+' to '+hi+'.');return n};
const relPath=(f,{depth=4}={})=>{f=S(f);if(!f||f.length>300||f.includes('\\')||f.includes('\0'))no('Bad file path.');const p=f.split('/');
 if(p.length>depth||!p.every(x=>SEG.test(x)&&!x.includes('..')))no('Bad file path: parts must start with a letter or digit, no "..", at most '+depth+' deep.');return p.join('/')};
const skillName=s=>{const p=S(s).split('/');if(p.length<1||p.length>3||!p.every(x=>SEG.test(x)&&!x.includes('..')&&!x.includes(' ')))no('Bad skill name (like creative/some-skill).');return p.join('/')};

// ---- the config.yaml editors: line based, scalars at fixed places only, nothing else in the file is touched
const ind=l=>l.match(/^ */)[0].length,blank=l=>!l.trim()||/^\s*#/.test(l),esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function block(L,a){const p=L.findIndex(l=>new RegExp('^'+esc(a)+':\\s*(#.*)?$').test(l));if(p<0){if(L.some(l=>new RegExp('^'+esc(a)+':\\s*\\S').test(l)))no(a+' is written in one line in this file; a person must edit it.');return null}
 let e=L.length;for(let n=p+1;n<L.length;n++)if(!blank(L[n])&&ind(L[n])===0){e=n;break}
 let ci=2;for(let n=p+1;n<e;n++)if(!blank(L[n])){ci=ind(L[n]);break}
 let last=p;for(let n=p+1;n<e;n++)if(L[n].trim())last=n;return {p,e,ci,last}}
export function yamlSet(src,a,b,value){const L=String(src).split('\n'),B=block(L,a);
 if(!B){return String(src)+(String(src).endsWith('\n')||!src?'':'\n')+a+':\n  '+b+': '+value+'\n'}
 const rx=new RegExp('^ {'+B.ci+'}'+esc(b)+':(\\s.*)?$');
 for(let n=B.p+1;n<B.e;n++)if(rx.test(L[n])){const v=L[n].slice(L[n].indexOf(':')+1).replace(/\s+#.*$/,'').trim();if(!v&&n+1<B.e&&!blank(L[n+1])&&ind(L[n+1])>B.ci)no(a+'.'+b+' is not a single value here; a person must edit it.');
   L[n]=' '.repeat(B.ci)+b+': '+value;return L.join('\n')}
 L.splice(B.last+1,0,' '.repeat(B.ci)+b+': '+value);return L.join('\n')}
export function yamlRemoveFallback(src,model){const L=String(src).split('\n'),B=block(L,'fallback_providers');if(!B)no('This agent has no fallback_providers.');
 const items=[];let cur=null;for(let n=B.p+1;n<B.e;n++){if(/^\s*-\s/.test(L[n])&&(!cur||ind(L[n])<=cur.ind)){cur={from:n,to:n+1,ind:ind(L[n])};items.push(cur)}else if(cur&&(L[n].trim()?ind(L[n])>cur.ind:true))cur.to=n+1;else if(L[n].trim())break}
 const rx=new RegExp('^\\s*(-\\s+)?model:\\s*([\'"]?)'+esc(model)+'\\2\\s*(#.*)?$');
 const hit=items.find(it=>L.slice(it.from,it.to).some(l=>rx.test(l)));if(!hit)no('No fallback with that model.');
 const left=items.filter(x=>x!==hit);L.splice(hit.from,hit.to-hit.from);if(!left.length)L[B.p]='fallback_providers: []';return L.join('\n')}
export function yamlEnablePlugin(src,plugin){const L=String(src).split('\n'),B=block(L,'plugins');
 if(!B)return String(src)+(String(src).endsWith('\n')||!src?'':'\n')+'plugins:\n  enabled:\n    - '+plugin+'\n';
 const rx=new RegExp('^ {'+B.ci+'}enabled:(.*)$');let at=-1;for(let n=B.p+1;n<B.e;n++)if(rx.test(L[n])){at=n;break}
 if(at<0){L.splice(B.last+1,0,' '.repeat(B.ci)+'enabled:',' '.repeat(B.ci+2)+'- '+plugin);return L.join('\n')}
 const rest=L[at].replace(rx,'$1').replace(/\s+#.*$/,'').trim();
 if(rest==='[]'){L[at]=' '.repeat(B.ci)+'enabled:';L.splice(at+1,0,' '.repeat(B.ci+2)+'- '+plugin);return L.join('\n')}
 if(rest.startsWith('[')){const inner=rest.slice(1,-1).split(',').map(x=>x.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean);if(inner.includes(plugin))return String(src);L[at]=' '.repeat(B.ci)+'enabled: ['+[...inner,plugin].join(', ')+']';return L.join('\n')}
 if(rest)no('plugins.enabled is not a list here; a person must edit it.');
 let end=at,ii=B.ci+2;for(let n=at+1;n<B.e;n++){if(/^\s*-\s/.test(L[n])){end=n;ii=ind(L[n]);if(L[n].replace(/^\s*-\s+/,'').replace(/\s+#.*$/,'').trim().replace(/^['"]|['"]$/g,'')===plugin)return String(src)}else if(L[n].trim()&&ind(L[n])<=B.ci)break}
 L.splice(end+1,0,' '.repeat(ii)+'- '+plugin);return L.join('\n')}

const run=(cmd,args,{cwd,timeout=60000}={})=>new Promise(res=>execFile(cmd,args,{cwd,timeout,maxBuffer:4e6},(e,o,er)=>res({ok:!e,out:String(o||''),err:String(er||e?.message||'')})));
const isFile=async f=>{const s=await lstat(f).catch(()=>null);return !!s&&s.isFile()},isDir=async f=>{const s=await lstat(f).catch(()=>null);return !!s&&s.isDirectory()};
// a path under root with no link on the way (an agent owns its folders and could plant one)
async function under(root,rel){const parts=String(rel).split('/').filter(Boolean),full=path.join(root,...parts);let p=root;
 for(const x of parts){p=path.join(p,x);const s=await lstat(p).catch(()=>null);if(s?.isSymbolicLink())no('A link is in the way ('+x+').');if(!s)return {path:full,exists:false}}
 const r=await realpath(p).catch(()=>p),rr=await realpath(root).catch(()=>root);if(path.relative(rr,r).startsWith('..'))no('That path leaves its folder.');return {path:full,exists:true}}

export function createFixerActions({DATA,home,redactText=t=>String(t),run:runCmd=run,now=()=>Date.now(),appDir=path.join(home,'apps','hermes-ui'),log=()=>{}}){
 const hh=path.join(home,'.hermes'),UPLOADS=path.join(home,'uploads'),KIRIM=path.join(DATA,'kirimdev.json');
 const dirOf=a=>a==='default'?hh:path.join(hh,'profiles',a);
 // the agent must be one this issue is about (its own and "affects"), a plain id, and really exist
 async function agentDir(ctx,a){a=S(a);if(a!=='default'&&!AGENT_ID.test(a))no('Not an agent id.');if(!(ctx.agents||[]).includes(a))no('Agent "'+a+'" is not part of this issue (its agents: '+(ctx.agents||[]).join(', ')+').');
  const d=dirOf(a);if(!await isFile(path.join(d,'config.yaml')))no('No such agent.');return d}
 // where a skill folder lives: shared, an agent's profile, or an agent's own workspace
 async function skillRoot(ctx,loc,{write=false}={}){loc=S(loc);if(loc==='shared')return path.join(hh,'skills');
  const m=/^(workspace:)?([a-z0-9][a-z0-9_-]{0,40}|default)$/.exec(loc);if(!m)no('Location is "shared", an agent id or "workspace:<agent>".');
  if(write&&!(ctx.agents||[]).includes(m[2]))no('Agent "'+m[2]+'" is not part of this issue.');
  if(m[1])return path.join(home,'workspaces',m[2],'.hermes','skills');if(m[2]==='default')return path.join(hh,'skills');
  if(!await isDir(dirOf(m[2])))no('No such agent.');return path.join(dirOf(m[2]),'skills')}
 // ---- the journal: every file a repair changed, with the copy the app took first
 const jfile=run=>path.join(DATA,'issues',String(run),'actions.jsonl');
 async function entries(run){return (await readFile(jfile(run),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)}
 async function note(ctx,e){await mkdir(path.dirname(jfile(ctx.run)),{recursive:true,mode:0o700});await appendFile(jfile(ctx.run),JSON.stringify({at:now(),...e})+'\n',{mode:0o600})}
 async function backup(ctx,file){const dir=path.join(DATA,'issues',String(ctx.run));await mkdir(dir,{recursive:true,mode:0o700});const n=(await entries(ctx.run)).length+1;
  const b=path.join(dir,'bak-'+n+'-'+path.basename(file).replace(/[^\w.-]/g,'_'));await copyFile(file,b);return b}
 // change a text file in place (so its owner and its access list stay), after a copy
 async function edit(ctx,file,fn){const before=await readFile(file,'utf8'),after=fn(before);if(after===before)return {ok:true,changed:false,note:'Nothing to change: it is already so.'};
  const b=await backup(ctx,file);await writeFile(file,after);await note(ctx,{kind:'edit',file,backup:b});return {ok:true,changed:true,note:'Changed '+path.basename(file)+'; a copy was kept.'}}
 // what a run changed, as the issue module reads it: [{file, backup}] with the FIRST copy of each file (the original)
 async function journal(run){const seen=new Map();for(const e of await entries(run))if(e.kind==='edit'&&!seen.has(e.file))seen.set(e.file,{file:e.file,backup:e.backup});return [...seen.values()]}
 const added=async run=>(await entries(run)).filter(e=>e.kind==='add'||e.kind==='acl'||e.kind==='mode').map(e=>({kind:e.kind,file:e.file,...(e.agent?{agent:e.agent}:{})}));

 // ---- the repairs. Each: args → the app does it; throws Refused (plain words) when it may not.
 const REPAIRS={
  config_set:{args:'agent, key, value',does:'Set one value in an agent\'s config.yaml: agent.restart_drain_timeout (0-3600), agent.reasoning_effort (low|medium|high), model.default (a model name already used by another agent here).',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),key=S(a.key),v=typeof a.value==='number'?String(a.value):S(a.value);let val;
    if(key==='agent.restart_drain_timeout')val=String(intIn(v,0,3600));
    else if(key==='agent.reasoning_effort'){if(!['low','medium','high'].includes(v))no('Value: low, medium or high.');val=v}
    else if(key==='model.default'){if(!/^[A-Za-z0-9][\w.:\[\]-]{1,80}$/.test(v))no('Not a model name.');
     const cfgs=[path.join(hh,'config.yaml'),...(await readdir(path.join(hh,'profiles')).catch(()=>[])).map(x=>path.join(hh,'profiles',x,'config.yaml'))];let known=false;
     for(const f of cfgs)if((await readFile(f,'utf8').catch(()=>'')).split('\n').some(l=>/^\s+default:/.test(l)&&l.replace(/^\s+default:\s*/,'').trim()===v)){known=true;break}
     if(!known)no('That model is not used by any agent on this box yet; a person must choose a new model.');val=v}
    else no('Allowed keys: agent.restart_drain_timeout, agent.reasoning_effort, model.default.');
    const [k1,k2]=key.split('.');return edit(ctx,path.join(d,'config.yaml'),t=>yamlSet(t,k1,k2,val))}},
  config_remove_fallback:{args:'agent, model',does:'Remove one fallback model from an agent\'s fallback_providers (so no request can go to another model).',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),m=S(a.model);if(!/^[A-Za-z0-9][\w.:\[\]-]{1,80}$/.test(m))no('Not a model name.');return edit(ctx,path.join(d,'config.yaml'),t=>yamlRemoveFallback(t,m))}},
  plugin_enable:{args:'agent, plugin',does:'Switch on a plugin that is already in that agent\'s plugins folder (or the shared one): adds it to plugins.enabled.',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),p=S(a.plugin);if(!/^[a-z0-9][\w.-]{0,80}$/.test(p))no('Not a plugin name.');
    if(!await isDir(path.join(d,'plugins',p))&&!await isDir(path.join(hh,'plugins',p)))no('That plugin is not installed for this agent; a person must install it.');return edit(ctx,path.join(d,'config.yaml'),t=>yamlEnablePlugin(t,p))}},
  soul_rule:{args:'agent, rule',does:'Add (or replace, for this issue) one short rule in an agent\'s SOUL.md. Plain words only: no commands, links, numbers or keys.',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),rule=text(a.rule,1200),f=path.join(d,'SOUL.md');if(!await isFile(f))no('That agent has no SOUL.md.');
    const open='<!-- fixer '+ctx.issue+' -->',close='<!-- /fixer '+ctx.issue+' -->',blockText=open+'\n'+rule.trim()+'\n'+close;
    return edit(ctx,f,t=>{const i=t.indexOf(open),j=t.indexOf(close);return i>=0&&j>i?t.slice(0,i)+blockText+t.slice(j+close.length):t.replace(/\s*$/,'')+'\n\n'+blockText+'\n'})}},
  schedule_clear_script:{args:'agent, job',does:'Take the script off one schedule so it runs the agent with its own prompt again (the schedule\'s pause stays as it is).',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),id=S(a.job);if(!/^[0-9a-f]{6,32}$/.test(id))no('Not a schedule id.');return jobs(ctx,d,id,j=>{if(j.script==null||j.script==='')no('That schedule has no script.');j.script=null;return 'script removed'})}},
  schedule_enable:{args:'agent, job, enabled',does:'Turn one schedule on or off (enabled: true or false).',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),id=S(a.job);if(!/^[0-9a-f]{6,32}$/.test(id))no('Not a schedule id.');if(typeof a.enabled!=='boolean')no('enabled must be true or false.');
    return jobs(ctx,d,id,j=>{j.enabled=a.enabled;j.state=a.enabled?'scheduled':'paused';if(!a.enabled)j.paused_at=new Date(now()).toISOString();else j.paused_at=null;return a.enabled?'turned on':'turned off'})}},
  skill_replace:{args:'where, skill, file, find, replace',does:'In a skill\'s own .md file, replace one exact piece of text (it must occur once) with other text, e.g. a wrong path. where: shared | <agent> | workspace:<agent>.',
   async do(ctx,a){const root=await skillRoot(ctx,a.where,{write:true}),sk=skillName(a.skill),rel=relPath(a.file,{depth:3});if(!/\.md$/i.test(rel))no('Only .md files of a skill.');
    const find=text(a.find,400),rep=text(a.replace,400,{empty:true});const u=await under(root,sk+'/'+rel);if(!u.exists)no('No such skill file.');
    return edit(ctx,u.path,t=>{const n=t.split(find).length-1;if(n!==1)no('The text to replace occurs '+n+' times; it must occur exactly once.');return t.replace(find,()=>rep)})}},
  skill_restore_file:{args:'skill, file, to, from',does:'Put a missing file of a skill back by copying it from another copy of the same skill (never overwrites). to / from: shared | <agent> | workspace:<agent>.',
   async do(ctx,a){const sk=skillName(a.skill),rel=relPath(a.file,{depth:4});if(!SKILL_EXT.test(rel)||SECRETISH.test(rel))no('That kind of file is not given back by a repair.');
    const toRoot=await skillRoot(ctx,a.to,{write:true}),fromRoot=await skillRoot(ctx,a.from);const src=await under(fromRoot,sk+'/'+rel),dst=await under(toRoot,sk+'/'+rel);
    if(!src.exists||!await isFile(src.path))no('The source copy does not have that file.');if(dst.exists)no('The file is already there; nothing is overwritten.');
    if((await stat(src.path)).size>5e6)no('The file is larger than 5 MB.');if(!await isDir(path.join(toRoot,sk)))no('The skill folder does not exist at the target.');
    await mkdir(path.dirname(dst.path),{recursive:true});await copyFile(src.path,dst.path);await note(ctx,{kind:'add',file:dst.path});return {ok:true,changed:true,note:'Copied '+rel+' into the skill.'}}},
  kirimdev_line_set:{args:'agent, key, value',does:'Set one wording or wait in an agent\'s Kirimdev line: humanWaitMin (0-60), humanWaitText, handoff.customerText (plain words, no links or numbers). Never the mode, testers, keys or webhook.',
   async do(ctx,a){await agentDir(ctx,a.agent);const key=S(a.key);let val;
    if(key==='humanWaitMin')val=intIn(a.value,0,60);else if(key==='humanWaitText'||key==='handoff.customerText')val=text(a.value,300,{empty:true});else no('Allowed keys: humanWaitMin, humanWaitText, handoff.customerText.');
    if(!await isFile(KIRIM))no('There is no Kirimdev settings file.');const b=await backup(ctx,KIRIM);let changed=false;
    await updateStore(KIRIM,{},d=>{const line=d?.lines?.[a.agent];if(!line||typeof line!=='object')no('That agent has no Kirimdev line.');
     if(key==='handoff.customerText'){line.handoff=line.handoff&&typeof line.handoff==='object'?line.handoff:{};if(line.handoff.customerText===val)return false;line.handoff.customerText=val}
     else{if(line[key]===val)return false;line[key]=val}changed=true});
    if(changed)await note(ctx,{kind:'edit',file:KIRIM,backup:b});return {ok:true,changed,note:changed?'Set '+key+'.':'Nothing to change: it is already so.'}}},
  upload_readable:{args:'name',does:'Make one uploaded file (in the uploads folder) readable (mode 644) so an agent can open it.',
   async do(ctx,a){const f=await upload(a.name),s=await lstat(f);if(!s.isFile())no('Not a regular file.');if((s.mode&0o044)===0o044)return {ok:true,changed:false,note:'Already readable.'};
    await chmod(f,0o644);await note(ctx,{kind:'mode',file:f});return {ok:true,changed:true,note:'Made the upload readable.'}}},
  upload_share:{args:'name, agent',does:'Let one agent\'s own user read one uploaded file (read-only access list on that file, passage on the uploads folder).',
   async do(ctx,a){await agentDir(ctx,a.agent);const f=await upload(a.name);if(a.agent==='default')no('The main agent runs as the owner already.');if(!(await lstat(f)).isFile())no('Not a regular file.');
    const u='u:ag-'+a.agent+':';const r1=await runCmd('setfacl',['-m',u+'--x',UPLOADS]),r2=await runCmd('setfacl',['-m',u+'r--',f]);if(!r1.ok||!r2.ok)no('The access list could not be set ('+(r1.err||r2.err).slice(0,120)+'). A person must run: setfacl -m '+u+'r-- <the file>');
    await note(ctx,{kind:'acl',file:f,agent:a.agent});return {ok:true,changed:true,note:'Gave '+a.agent+' read access to that file.'}}}};
 async function upload(name){name=S(name);if(!name||name.length>200||/[\\\/\u0000-\u001f]/.test(name)||name.startsWith('.')||name.includes('..'))no('Bad upload name.');const f=path.join(UPLOADS,name);
  if(!await lstat(f).catch(()=>null))no('No such upload.');return f}
 // one schedule of an agent's jobs.json: the engine's own file, changed in place, nothing else in it touched
 async function jobs(ctx,d,id,fn){const f=path.join(d,'cron','jobs.json');if(!await isFile(f))no('That agent has no schedules.');const raw=await readFile(f,'utf8');let j;try{j=JSON.parse(raw)}catch{no('The schedules file cannot be read; a person must look at it.')}
  const list=Array.isArray(j)?j:j?.jobs;const job=Array.isArray(list)?list.find(x=>x&&x.id===id):null;if(!job)no('No schedule with that id.');const what=fn(job);if(!Array.isArray(j)&&j)j.updated_at=new Date(now()).toISOString();
  const b=await backup(ctx,f);await writeFile(f,JSON.stringify(j,null,2));await note(ctx,{kind:'edit',file:f,backup:b});return {ok:true,changed:true,note:'Schedule '+id+': '+what+'.'}}

 // ---- the checks: read-only, secrets hidden, short answers
 const out=(t,max=6000)=>({ok:true,text:redactText(String(t)).slice(-max)});
 const lit=(s,n=80)=>{s=S(s);if(s.length>n||/[\u0000-\u001f]/.test(s))no('Bad search text.');return s};
 const tail=(t,n,f)=>String(t).split('\n').filter(l=>!f||l.includes(f)).slice(-n).join('\n');
 const CHECKS={
  agent_log:{args:'agent, file (errors|agent|gateway), lines (<=300), find (optional plain text)',does:'The last lines of one of that agent\'s logs.',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),f=S(a.file,'errors');if(!['errors','agent','gateway'].includes(f))no('file: errors, agent or gateway.');
    const t=await readFile(path.join(d,'logs',f+'.log'),'utf8').catch(()=>'');return out(tail(t,intIn(a.lines??100,1,300),a.find?lit(a.find):''))}},
  config_view:{args:'agent',does:'That agent\'s config.yaml with every key, token, secret, password and header line hidden.',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),t=await readFile(path.join(d,'config.yaml'),'utf8').catch(()=>'');return out(t.split('\n').map(l=>/(key|token|secret|password|auth|header|credential)/i.test(l)?l.replace(/:.*$/,': <hidden>'):l).join('\n'),9000)}},
  schedule_status:{args:'agent, job (id)',does:'One schedule\'s state: enabled, paused, next and last run, last status and error, failure streak, whether it has a script.',
   async do(ctx,a){const d=await agentDir(ctx,a.agent),id=S(a.job);if(!/^[0-9a-f]{6,32}$/.test(id))no('Not a schedule id.');let j;try{j=JSON.parse(await readFile(path.join(d,'cron','jobs.json'),'utf8'))}catch{no('No readable schedules.')}
    const job=(Array.isArray(j)?j:j?.jobs||[]).find(x=>x?.id===id);if(!job)no('No schedule with that id.');const k=['id','name','enabled','state','paused_reason','next_run_at','last_run_at','last_status','last_error','failure_streak','deliver'];
    return out(JSON.stringify({...Object.fromEntries(k.map(x=>[x,job[x]])),has_script:!!job.script},null,1))}},
  health_lists:{args:'find (plain text, e.g. a topic or agent id)',does:'The Health entries (reports and events) that mention that text; none means Health no longer lists it.',
   async do(ctx,a){const f=lit(a.find,120),b=JSON.parse(await readFile(path.join(DATA,'bottlenecks.json'),'utf8').catch(()=>'{}')||'{}');
    const hit=[...(Array.isArray(b.reports)?b.reports:Object.values(b.reports||{})),...(Array.isArray(b.events)?b.events:Object.values(b.events||{}))].filter(x=>JSON.stringify(x).includes(f));
    return out(JSON.stringify({listed:hit.length,items:hit.slice(0,12)},null,1))}},
  kirimdev_ours:{args:'agent',does:'What the Kirimdev line sent as itself lately (kirimdev-state.json "ours").',
   async do(ctx,a){await agentDir(ctx,a.agent);const s=JSON.parse(await readFile(path.join(DATA,'kirimdev-state.json'),'utf8').catch(()=>'{}')||'{}'),o=s.ours;
    const v=Array.isArray(o)?o.filter(x=>JSON.stringify(x).includes(a.agent)).slice(-20):o&&typeof o==='object'?(Array.isArray(o[a.agent])?o[a.agent].slice(-20):o[a.agent]??null):null;return out(JSON.stringify(v,null,1))}},
  test_agents:{args:'',does:'The agents a live test may run on.',async do(){return out(await readFile(path.join(hh,'.aqeelos-test-agents'),'utf8').catch(()=>''))}},
  test_message:{args:'agent, text, tester (optional name part)',does:'Post the signed test webhook as one of the line\'s testers (the script refuses real agents and real customers); the agent answers that tester.',
   async do(ctx,a){await agentDir(ctx,a.agent);const t=text(a.text,500),args=[path.join(appDir,'scripts','kirimdev-test-message.mjs'),a.agent,t];if(a.tester){args.push('--tester',lit(a.tester,40))}
    if(t.startsWith('-'))no('The text may not start with "-".');const r=await runCmd('node',args,{cwd:appDir,timeout:240000});return out(r.out+r.err)}},
  delivery_check:{args:'agent, link (optional https picture link), document (optional true)',does:'Send the line\'s picture (or PDF) to the main agent\'s own WhatsApp and say whether it arrived.',
   async do(ctx,a){await agentDir(ctx,a.agent);const args=[path.join(appDir,'scripts','delivery-check.mjs'),a.agent];if(a.link){const l=S(a.link);if(!/^https:\/\/[\w.-]+\/[\w\-./%?=&+~:@]{0,300}$/.test(l))no('The link must be a plain https address.');args.push('--link',l)}if(a.document===true)args.push('--document');
    const r=await runCmd('node',args,{cwd:appDir,timeout:360000});return out(r.out+r.err)}},
  skill_check:{args:'where, skill',does:'What a skill points to that is not there (nothing listed = all present).',
   async do(ctx,a){const root=await skillRoot(ctx,a.where),sk=skillName(a.skill),u=await under(root,sk);if(!u.exists)no('No such skill.');const r=await runCmd('node',[path.join(appDir,'scripts','skill-check.mjs'),u.path],{cwd:appDir,timeout:60000});return out(r.out+r.err)}},
  app_tests:{args:'files (1-4 like scripts/<name>.test.mjs)',does:'Run those tests in the live app folder (they use temporary folders).',
   async do(ctx,a){const f=[].concat(a.files||[]);if(!f.every(x=>typeof x==='string'))no('File names must be text.');if(!f.length||f.length>4||!f.every(x=>TEST_FILE.test(x)))no('Name 1 to 4 test files like scripts/<name>.test.mjs.');const r=await runCmd('node',['--test',...f],{cwd:appDir,timeout:220000});return out(r.out+r.err,5000)}},
  app_log:{args:'lines (<=300), find (optional plain text)',does:'The last lines of the app\'s own log.',
   async do(ctx,a){const r=await runCmd('journalctl',['--user','-n',String(intIn(a.lines??100,1,300)*(a.find?10:1)),'--no-pager','-o','cat']);if(!r.ok)no('The log is not available here.');return out(tail(r.out,intIn(a.lines??100,1,300),a.find?lit(a.find):''))}},
  upload_info:{args:'name',does:'The mode and size of one uploaded file.',async do(ctx,a){const f=await upload(a.name),s=await lstat(f);return out(JSON.stringify({file:s.isFile(),mode:(s.mode&0o777).toString(8),size:s.size}))}}};

 const counts=new Map();
 const count=(run,kind)=>{const k=run+':'+kind,n=(counts.get(k)||0)+1;counts.set(k,n);if(counts.size>500)counts.delete(counts.keys().next().value);return n};
 const names=o=>Object.keys(o);
 const help=()=>({repairs:names(REPAIRS).map(n=>({action:n,args:REPAIRS[n].args,does:REPAIRS[n].does})),checks:names(CHECKS).map(n=>({check:n,args:CHECKS[n].args,does:CHECKS[n].does})),
  otherwise:'Nothing else is allowed. If no repair fits, change nothing and end with status "needs_human": in "need" put what a person must do, with the exact command for the owner.'});
 const wrap=async f=>{try{return {status:200,json:await f()}}catch(e){if(e instanceof Refused)return {status:e.status,json:{ok:false,error:e.message}};log('fixer actions: '+e.message);return {status:200,json:{ok:false,error:'The app could not do that ('+String(e.code||e.message).slice(0,80)+').'}}}};
 // ctx: {issue, run, agents:[…]}; the caller (the signed route) has already proved the run is this issue's and still going
 async function repair(name,args,ctx){return wrap(async()=>{if(!Object.hasOwn(REPAIRS,name))return {ok:false,error:'"'+String(name).slice(0,40)+'" is not an allowed repair.',...help()};
  if(args===null||typeof args!=='object'||Array.isArray(args))no('args must be an object.');if(count(ctx.run,'r')>MAX_REPAIRS)no('Too many repairs in one run.');return REPAIRS[name].do(ctx,args)})}
 async function check(name,args,ctx){return wrap(async()=>{if(!Object.hasOwn(CHECKS,name))return {ok:false,error:'"'+String(name).slice(0,40)+'" is not an allowed check.',...help()};
  if(args===null||typeof args!=='object'||Array.isArray(args))no('args must be an object.');if(count(ctx.run,'c')>MAX_CHECKS)no('Too many checks in one run.');return CHECKS[name].do(ctx,args)})}
 return {repair,check,help,journal,added,REPAIRS:names(REPAIRS),CHECKS:names(CHECKS)}}
