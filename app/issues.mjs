// Issues and the fixer: a closed loop (owner's rules of 7 Nov 2026: "agents fix themselves, without asking the main agent or me";
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
// 8 Nov 2026 (owner's stability plan): nobody edits the live system by hand, the fixer included. A fix to aqeelOS's own
// code is made in a copy and filed as a patch for the daily deploy (state "deploy"); after the deploy one proof run
// checks it. Only an urgent outage (aqeelOS's own tool server down for every agent) may be hot-patched on the box, and
// that patch is saved for git too. No live tests on real agents, ever: a test message only on a test agent.
// 12 Nov 2026 (GIT-2): with a fixer-git.mjs checkout a code fix never touches the live folder at all, urgent or not: it is made
// in a git work dir on branch fix/<issue>, committed, pushed and opened as a pull request (state "deploy" = waits for the
// review and the deploy). No GitHub token yet: the branch waits committed, one "Needs you" item asks for the token, and
// the tick opens the pull requests by itself once there is one. Without the checkout the older patch-file way still runs.
import {readFile,writeFile,mkdir,rename,open,stat,copyFile,readdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const clip=(s,n)=>String(s??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').slice(0,n);
export const TRIES=3;
// team policy fixer.urgentAgents: every new issue for these agents (agent or affects) is filed urgent
export const urgentFor=(pol,o)=>{const u=[].concat(pol?.fixer?.urgentAgents||[]);return !!u.length&&[o?.agent,...[].concat(o?.affects||[])].some(a=>u.includes(a))};
export const OPEN=['queued','fixing','applying','verify','verifying','rollback','reloaded-back'];
// waiting for something (re-checked by the sweep): not in the middle of a run
export const WAITING=['queued','open','stuck','needs_human','stopped','deploy'];
// how alike two problems are (shared words, ignoring the short ones): 1 is the same text
const COMMON=new Set('that there this with from file files points does have when into were been will what which their they them need needs skill agent agents should could would make sure after before about only also than then just more some like every because still while where being other most same work works working'.split(' '));
export function similar(a,b){const w=t=>new Set(String(t||'').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>3&&!COMMON.has(x)));const A=w(a),B=w(b);if(A.size<4||B.size<4)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.min(A.size,B.size)}
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
 // a chat in aqeelOS itself (the engine's api_server): aqeelOS knows whose chat it is, so the asker hears it there (11 Nov 2026)
 if(issue?.by?.platform==='api_server'&&issue.by.chat)return {kind:'asker',name:issue.byName||'the person who asked'};
 const t=teamOf(policy,issue?.agent),m=t&&((t.members||[]).find(x=>x.name===t.contact)||(t.members||[])[0]);
 if(m)return {kind:'team',name:m.name,member:m,team:t.name};
 return {kind:'owner',name:policy?.owner?.name||'Owner'}}

// the fix run's last line:   RESULT: {"status":"changed|patch|no_change|needs_human|failed","apply":"none|engine|ui","changes":[{"file","backup"}],"patches":[{"file","copy"}],"check":"…","summary":"…","proof":"…","need":"…"}
// the proof run's last line: RESULT: {"status":"proven|not_proven","proof":"…","need":"…"}
const FIX=['changed','patch','no_change','needs_human','failed'],PROOF=['proven','not_proven'];
export function parseResult(out,kind='fix'){const m=[...String(out||'').matchAll(/RESULT:\s*(\{[^\n]*\})/g)].pop();if(!m)return null;let j;try{j=JSON.parse(m[1])}catch{return null}
 // older wording from a run that was going when this was deployed
 if(j.status==='fixed')j.status=kind==='proof'?'proven':'changed';if(j.status==='needs_owner')j.status='needs_human';
 if(!(kind==='proof'?PROOF:FIX).includes(j.status))return null;
 const apply=['engine','ui'].includes(j.apply)?j.apply:j.restart_ui===true?'ui':'none';
 const changes=(Array.isArray(j.changes)?j.changes:[]).filter(c=>c&&typeof c.file==='string'&&c.file.startsWith('/')).slice(0,40).map(c=>({file:clip(c.file,400),backup:typeof c.backup==='string'&&c.backup.startsWith('/')?clip(c.backup,400):null}));
 const patches=(Array.isArray(j.patches)?j.patches:[]).filter(c=>c&&typeof c.file==='string'&&c.file.startsWith('/')&&typeof c.copy==='string'&&c.copy.startsWith('/')).slice(0,40).map(c=>({file:clip(c.file,400),copy:clip(c.copy,400)}));
 return {status:j.status,summary:clip(j.summary,1500),proof:clip(j.proof,3000),need:clip(j.need,600),check:clip(j.check,1000),apply,changes,patches}}
// a run that never reached the model (the engine was restarting or draining) is not a try
// owner's ladder (7 Nov 2026): a person is asked only for what physically needs them (money, a key or login only they
// have, a person adding a bot, a decision only they can make), never for a plain approval of a fix
// "a person must send a WhatsApp message from the tester phone" is never a need (7 Nov 2026): the fixer posts the same
// signed webhook Kirimdev posts, as one of the line's testers (scripts/kirimdev-test-message.mjs)
export const testerSendOnly=t=>{t=String(t||'');return /\b(tester|test(ing)? (phone|number|nomor|hp)|nomor (tester|test))\b/i.test(t)&&/\b(send|sends|sent|message|write|writes|kirim|chat|reply|replies|whatsapp|wa)\b/i.test(t)&&!/\b(pay|paid|invoice|top ?up|billing|key|token|password|log ?in|sign ?in|qr|scan|add (the )?bot|invite|decid|choose|which one)/i.test(t)};
// a "need" that is really a technical failure is the fixer's, never a person's (11 Nov 2026: four "higgsfield needs someone
// to sign in" issues on Elkiya, where the sign-in itself fails in the engine: "Server-sent event exceeded the 1048576 byte
// limit"). Signing in does nothing there; a person is asked only for money, a key or login only they have that can work,
// adding a bot, or a decision only they can make.
export const technicalOnly=t=>{t=String(t||'');return /\b(engine|MCP client|server-sent event|SSE|byte limit|\d+ ?MB limit|rejects? (the|its) (response|reply)|time[sd]? ?out|exit code|traceback|stack trace|bug|code (change|fix)|patch|crash(es|ed)?|HTTP 5\d\d|internal error|parking|failed initial connection)\b/i.test(t)&&!/\b(pay|paid|invoice|top ?up|billing|password only|add (the )?bot|invite|decid|choose|which one)\b/i.test(t)};
export const noPersonNeeded=t=>approvalOnly(t)||testerSendOnly(t)||technicalOnly(t);
export const approvalOnly=t=>{t=String(t||'');return /\b(approv|sign[ -]?off|give (the |your )?ok|ok (it|this|the change)|confirm (that|whether|the change|this change)|review (the|this) (change|fix|rule))/i.test(t)&&!/\b(pay|paid|invoice|top ?up|billing|key|token|password|log ?in|sign ?in|qr|add (the )?bot|invite|decid|choose|which one)/i.test(t)};
export const notStarted=out=>/couldn'?t start the model connection|Gateway draining|not_ready|Connection refused.*gateway/i.test(String(out||'').slice(-3000));

// the values set in an .env text: {KEY: value}
export function envValues(t){const o={};for(const l of String(t||'').split('\n')){const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);if(m)o[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2')}return o}
// keys rule: every value an .env gained or changed must already be somewhere on the box (in the other .env texts)
export function newSecrets(before,after,known=[]){const b=envValues(before),a=envValues(after),pool=new Set(known.flatMap(t=>Object.values(envValues(t))));
 return Object.entries(a).filter(([k,v])=>v&&v.length>=8&&b[k]!==v&&!pool.has(v)).map(([k])=>k)}

// proving a Kirimdev reply without a phone (7 Nov 2026: the fixer asked a person to write from the tester phone)
// no live tests on real agents, ever (owner, 8 Nov 2026): a test message only on a test agent; a real agent is proven
// from what really happened after the change
const NO_LIVE_TEST='Never test on a real agent: no test messages, no trial runs of it. A real agent is proven only from what really happened after the change (its logs, a real reply it delivered, Health checking again). A live test only on a test agent (listed in ~/.hermes/.aqeelos-test-agents)';
// a picture that does not reach a customer's phone is provable without a person (11 Nov 2026, if734729a: three fix runs were
// rolled back only because the proof asked a person to look at a tester phone)
const DELIVERY_PROOF='A picture (QRIS, product photo) that does not reach the phone is provable WITHOUT a person: run node ~/apps/hermes-ui/scripts/delivery-check.mjs <agent> [--link <the picture link>]. It sends the line\'s picture to the main agent\'s own WhatsApp and says whether it downloaded ("picture": true). It is not a customer message. Never ask a person to look at a phone for this';
const KIRIM_TEST='on a real agent, a real reply it delivered after the change (~/apps/hermes-ui-data/kirimdev-state.json "ours", the log lines "kirimdev <agent>"); none yet means not proven yet. Only on a test agent you may write as a tester: never ask a person to write from a tester phone, run node ~/apps/hermes-ui/scripts/kirimdev-test-message.mjs <agent> "<text>" (optionally --tester <name>). It posts the same signed webhook Kirimdev posts when a customer writes, as one of the line\'s testers, to this box; the agent then answers that tester for real through Kirimdev. Check the reply was sent (~/apps/hermes-ui-data/kirimdev-state.json "ours", and the log lines "kirimdev <agent>"). Only testers, never a customer number; the script refuses a real agent';
// the code-change rule when the fixer has its own git work dir (fixer-git.mjs)
export const gitRule=(i,g)=>'- aqeelOS\'s own code is NEVER changed in the live folders (~/apps/hermes-ui, ~/.hermes/hermes-agent), urgent or not: the next deploy would put the old file back and nobody would have reviewed it. Your own git checkout for this issue is '+g.dir+' (branch '+g.branch+', cut from main). Change the app code (app/, scripts/, engine/, assets/) there and nowhere else. Do not commit or push: aqeelOS commits the branch and opens the pull request. Run the tests there (node --test scripts/<name>.test.mjs). Then prove it on the test copy: bash '+g.dir+'/scripts/fixer-testcopy.sh '+g.dir+' starts the checkout as the private test copy on port 4402 (its own password and data, never the live app); rerun the original check against http://127.0.0.1:4402 and paste what you saw in "proof". Use status "patch" and name the changed files in "summary". '+(i.urgent?'This issue is URGENT: say so in "summary"; it still goes through the pull request. ':'')+'The engine source ~/.hermes/hermes-agent is never changed in place either: copy the file to ~/apps/hermes-ui-data/fixer-work/'+i.id+'/<its full path without the leading slash>, change and check the copy, and list it in "patches" as {"file":"<live path>","copy":"<copy path>"}; aqeelOS makes it an engine/patches file in the same pull request. The change goes live only when a person merges the pull request and the next deploy runs; aqeelOS then checks the problem again. If the same fix is already waiting as a branch or pull request (System › Health › Fixes waiting for review), say so with status "no_change".';
export function fixerPrompt(i,{rules='',day=new Date().toISOString().slice(0,10).replace(/-/g,''),attempt=1,tries=TRIES,git=null}={}){
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
 '- Write in "check" exactly how to rerun the ORIGINAL failing check end to end after the reload (the real thing that failed, not a unit test). For a Kirimdev reply problem: '+KIRIM_TEST+'.',
 '- '+NO_LIVE_TEST+'.',
 '- '+DELIVERY_PROOF+'. Write that command in "check" when the problem is a picture that did not arrive.',
 git?gitRule(i,git):i.urgent?'- aqeelOS\'s own code lives in git: ~/apps/hermes-ui (app/, scripts/, engine/) and the engine source ~/.hermes/hermes-agent are replaced by the next deploy. This issue is URGENT (an outage), so you may change those files on the box (back them up as above). Keep the change small. Once it is proven, aqeelOS saves it as ~/apps/hermes-ui-data/fixer-patches/'+i.id+'-try<n>.patch for git; say in "summary" that it is a code change and name the file. Never commit or push. First look in ~/apps/hermes-ui-data/fixer-patches and ~/apps/hermes-ui-data/drift: if the same fix was made before and a deploy put the old file back, apply that patch again and say so.'
  :'- Nobody edits aqeelOS\'s live code by hand, you included. Its code (~/apps/hermes-ui app/, scripts/, engine/, and the engine source ~/.hermes/hermes-agent) is never changed in place: copy the file to ~/apps/hermes-ui-data/fixer-work/'+i.id+'/<its full path without the leading slash>, change and check the copy (node --check, or the test against a copy), and list it in "patches" as {"file":"<live path>","copy":"<copy path>"} with status "patch". aqeelOS files it as ~/apps/hermes-ui-data/fixer-patches/'+i.id+'-try<n>.patch for the daily deploy and checks the problem again after that deploy. A live code file you change anyway is put back and filed the same way. Never commit or push. First look in ~/apps/hermes-ui-data/fixer-patches and ~/apps/hermes-ui-data/drift: the same fix may be filed already; then say so with status "patch" and that patch\'s file in "patches".',
 '- If you find nothing to change (it already works), use status "no_change": a proof run still has to show it works.',
 '- A skill that points to a file that is not there (Health kind skill): find the file and put it back in every skill folder listed. Look in this order: the *.bak* copies next to it, other agents\' copies of the same skill (~/.hermes/profiles/*/skills and ~/.hermes/skills), ~/.hermes/backups and ~/apps/hermes-ui-data backups, the skill\'s git history if it has one. Only if it is nowhere, change the SKILL.md so it no longer needs the file (remove or replace that step); never invent the file\'s content. The check: every file each SKILL.md points to exists (node ~/apps/hermes-ui/scripts/skill-check.mjs <skill folder> lists what is still missing; nothing listed means proven).',
 '- needs_human only when a person must physically act and no tool or key on this box can do it: money, a new key or login only a person has, someone adding a bot to a Telegram group, or a decision only the owner can make. Never to ask for approval or an OK: nobody approves fixes, you decide. Never to have someone send a WhatsApp message from a tester phone: you can do that yourself (see above). Put in "need" exactly what they must do, in one or two plain sentences.',
 rules?'- '+rules:null,
 '','End with exactly one line (JSON on one line):',
 'RESULT: {"status":"changed|patch|no_change|needs_human|failed","apply":"none|engine|ui","changes":[{"file":"/abs/path","backup":"/abs/path.bak-…"}],"patches":[{"file":"/live/path","copy":"/copy/path"}],"check":"how to rerun the original check","summary":"one or two plain sentences","proof":"what you ran and saw","need":"only for needs_human or failed: what a person must do"}'].filter(x=>x!==null).join('\n')}

export function proofPrompt(i,fix,{reloaded=null,recheck=false,deployed=false}={}){return [
 'You are the aqeelOS fixer\'s proof run: a headless run on this server. Nobody is chatting with you. Do NOT change any file. Only prove whether ONE problem is gone.',
 '','ISSUE '+i.id+' (agent '+i.agent+(i.source==='health'?', found by the Health check':'')+')',
 'Problem: '+i.missing,'Evidence when it was filed: '+(i.evidence||'-'),
 'What the fix run did: '+(fix?.summary||'-'),fix?.changes?.length?'Files changed: '+fix.changes.map(c=>c.file).join(', '):'No files were changed.',
 reloaded?'aqeelOS reloaded '+(reloaded==='engine'?'the agents\' engine':'the web app')+' after the change.':null,
 deployed?'AFTER THE DEPLOY: the fix was filed as a patch ('+(i.patch||'-')+') for the daily deploy, and a deploy changed the files it is about since. Nothing was changed by the fixer now: prove whether the original problem is gone.':recheck?'RECHECK: this issue was stuck, and since then a deploy changed the files it is about. Nothing was changed by the fixer now: prove whether the original problem is gone by itself.':null,
 'How to rerun the original check: '+(fix?.check||'rerun what failed in the evidence above, end to end'),
 '','RULES',
 '- Rerun the ORIGINAL failing check end to end, for real, now. A unit test or reading a file is not proof. For a Kirimdev reply problem: '+KIRIM_TEST+'. For a Health problem, Health (~/apps/hermes-ui-data/bottlenecks.json) must no longer list it after its check ran again.',
 '- Never spend money, never delete anything, never message customers, never restart anything. '+NO_LIVE_TEST+'.',
 '- '+DELIVERY_PROOF,
 '- proven only if you saw it work after the change. Otherwise not_proven. Fill "need" only if a person must physically act (money, a key or login only they have, adding a bot, a decision only the owner can make); never an approval, and never a message from a tester phone.',
 '','End with exactly one line (JSON on one line):',
 'RESULT: {"status":"proven|not_proven","proof":"the commands you ran and what you saw, with times","need":""}'].filter(x=>x!==null).join('\n')}

// The model and effort of a fixer run, from the team policy (11 Nov 2026, the owner: fewer tokens for the same fixes):
// fixer.models {fix, proof, escalate} and fixer.effort {fix, proof, escalate}; escalate is the third try of a fix. Empty =
// the fixer agent's own model. aqeelOS names no model itself (any provider's names go here).
const MODEL_OK=/^[\w.:\/\[\]@-]{1,100}$/,EFFORT_OK=/^(minimal|low|medium|high|xhigh|max)$/;
// kind 'sort' (sorting a new issue, one short call) falls back to the proof run's model, at low effort
export function fixerModel(pol,kind,attempt){const m=pol?.fixer?.models||{},e=pol?.fixer?.effort||{};const esc=kind==='fix'&&attempt>=TRIES&&m.escalate;
 const model=String((esc?m.escalate:kind==='sort'?m.sort||m.proof:m[kind])||''),effort=String((esc?e.escalate||e.fix:kind==='sort'?e.sort||'low':e[kind])||'');
 return {model:MODEL_OK.test(model)?model:'',effort:EFFORT_OK.test(effort)?effort:''}}

// The fixer's line (System › Health, 11 Nov 2026, owner's agreed mock-up): proof runs first, then urgent agents, then
// the rest oldest first. A person can move one up or down (its place is kept as `rank`), or skip it until the daily
// runs reset (`skipUntil`). Items still being sorted (MODEL-3) are not in it yet.
export const lineKey=i=>i.rank??((i.state==='verify'?0:i.urgent?1:2)*1e13+(i.created||0));
export function lineOf(items,t){return items.filter(i=>(i.state==='verify'||i.state==='queued')&&!(i.skipUntil>t)&&!i.sorting).sort((a,b)=>lineKey(a)-lineKey(b))}
// the install's own day ('YYYY-MM-DD' in its time zone), and when the next one starts
export function dayIn(t,tz){try{return new Intl.DateTimeFormat('en-CA',{timeZone:tz||undefined,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t))}catch{return new Date(t).toISOString().slice(0,10)}}
export function nextDay(t,tz){const d=dayIn(t,tz);let x=t;while(dayIn(x+3600e3,tz)===d&&x-t<49*3600e3)x+=3600e3;while(dayIn(x,tz)===d)x+=60e3;return x-(x%60e3)}
// a short plain line for a person: what one issue is, from what the sorter wrote, else the problem text
const SORT_KINDS=['fixer','person','duplicate'];
export function parseSort(out){const m=[...String(out||'').matchAll(/SORT:\s*(\{[^\n]*\})/g)].pop();if(!m)return null;let j;try{j=JSON.parse(m[1])}catch{return null}
 if(!SORT_KINDS.includes(j.kind))return null;
 return {kind:j.kind,duplicateOf:/^i[0-9a-f]{8}$/.test(String(j.duplicateOf||''))?j.duplicateOf:null,title:clip(j.title,140).trim(),need:clip(j.need,600).trim(),group:clip(j.group,80).trim()}}
export function sortPrompt(i,others){return [
 'You sort ONE new problem for the aqeelOS fixer. Do not use any tool. Answer with one line only.',
 '','ISSUE '+i.id+' (agent '+i.agent+')','Problem: '+clip(i.missing,600),'Evidence: '+clip(i.evidence||'-',600),
 '','Problems already open (id · agent · what):',...(others.length?others.map(o=>o.id+' · '+o.agent+' · '+clip(o.title||o.missing,160).replace(/\n/g,' ')):['(none)']),
 '','Decide:',
 '- "duplicate" if one open problem above is the same problem (the same cause and the same fix; the same thing for another agent counts too, for example one app that needs signing in again). Put its id in duplicateOf.',
 '- "person" only if nothing on the server can fix it and a person must physically act: pay, give a key or login only they have, sign in to an app, add a bot to a group, or make a decision only the owner can make. Never for an approval, never for something technical (errors, crashes, limits, timeouts, code). Put in need what they must do, in one plain sentence.',
 '- "fixer" for everything else.',
 'title: the problem in plain words a non-technical owner understands, at most 12 words, no ids, key names, file paths or versions.',
 'group: for "person", a short name of the task that stays the same across agents (for example "Sign in to Higgsfield again"); otherwise empty.',
 '','The line (JSON on one line):','SORT: {"kind":"fixer|person|duplicate","duplicateOf":"","title":"","need":"","group":""}'].join('\n')}

export function createIssues({DATA,home,bin,fixerHome,now=()=>Date.now(),reply=async()=>false,tellOwner=async()=>{},toTeam=async()=>false,busy=async()=>0,ready=async()=>true,
 apply=async()=>({ok:true}),usageOf=async()=>null,nameOf=a=>a,codeRoots=[],onFixed=async()=>{},checks={},quiet=()=>null,log=m=>console.log(m),launch=null,alive=null,envFiles=async()=>[],
 // tz: the install's time zone (the daily runs and Skip reset at its midnight); sortRun: one short model call, {prompt,agent,model,effort} → its output
 tz=()=>'',sortRun=null,
 // GIT-2: the fixer's own git checkout (fixer-git.mjs); needToken / tokenOk: the one "Needs you" item that asks for the GitHub token
 git=null,needToken=async()=>{},tokenOk=async()=>{},
 // kept for older callers (the Approve/Decline flow is gone)
 askOwner=null,approvalLink=null,restartSelf=null,engineOk=()=>true}){
 const FILE=path.join(DATA,'issues.json'),POL=path.join(DATA,'team-policy.json'),DIR=path.join(DATA,'issues');let db=null,chain=Promise.resolve();
 // older states: approved and waiting (the old owner's OK) are queued; a failed one gets its tries again once
 // one time (8 Nov 2026): these were built and tested in git, so the fixer must not also patch them by hand on the live box. Safe to remove once deployed.
 const BUILT_IN_GIT=new Set(['i0d5eb2ec','i5d6243c8','iea75bff3','ib4edc25e','i1180523a','if33d6e3d','ieffb23a5','id69659c6','i914aaad7','i4f162796']);
 const migrate=()=>{if(!db.dupLink){db.dupLink=1;for(const i of db.items)if(i.sorted==='duplicate'&&!i.mergedInto&&!i.dupOf)delete i.sorted}
  for(const i of db.items)if(i.mergedInto&&i.state==='closed'){const e=(x=>{for(let k=0;x?.mergedInto&&k<20;k++){const n=db.items.find(y=>y.id===x.mergedInto);if(!n)break;x=n}return x})(i);
   if(e&&e!==i&&e.id!==i.mergedInto){const mid=db.items.find(y=>y.id===i.mergedInto);i.mergedInto=e.id;(e.reports||=[]).push({agent:i.agent,missing:clip(i.missing,300),at:i.created,id:i.id});e.reports=e.reports.slice(-20);e.count=(e.count||1)+1;if(mid){mid.count=Math.max(1,(mid.count||1)-1);mid.reports=(mid.reports||[]).filter(r=>r.id!==i.id)}
    if(i.agent&&i.agent!==e.agent&&!(e.affects||=[]).includes(i.agent))e.affects.push(i.agent)}}
  for(const i of db.items){if(i.state==='queued'&&BUILT_IN_GIT.has(i.id)){i.state='closed';i.notBefore=0;i.updated=now();(i.history||=[]).push({kind:'person',at:now(),status:'close',summary:'Built, tested and deployed in git'})}
  if(i.state==='approved'||i.state==='waiting'){i.state='queued';i.decision='every issue goes to the fixer (owner, 7 Nov 2026)'}
   if(i.state==='failed'&&!i.migrated){i.state='queued';i.tries=0;i.migrated=1;i.decision='tried again with the new fixer loop'}
   if(i.tries==null)i.tries=OPEN.includes(i.state)?0:(i.attempts||0);i.history||=[]}
  // filed again and again while the fixer was off (before 7 Nov 2026 'open' was not matched): one issue per problem
  const seen=new Map();for(const i of db.items){if(i.state!=='open')continue;const k=seen.get(i.key);if(!k){seen.set(i.key,i);continue}
   k.count=(k.count||1)+(i.count||1);i.state='closed';i.history.push({kind:'person',at:now(),status:'close',summary:'Closed as a duplicate of '+k.id})}};
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
  let i=db.items.find(x=>x.key===key&&(OPEN.includes(x.state)||['needs_human','stopped','open','deploy'].includes(x.state)));
  // filed again while it waited for a person: they may have done it, so the fixer tries again
  if(i){i.count++;i.updated=now();if(o.evidence)i.evidence=clip(o.evidence,2000);if((i.state==='needs_human'||i.state==='open'&&pol.fixer?.on!==false)&&!i.noRetry){i.state='queued';i.tries=0}await save();return {issue:view(i),again:true}}
  // filed again after the sorter merged it into another issue that is still open: that one counts it, no new sorting
  {const g=db.items.find(x=>x.key===key&&x.mergedInto),to=g&&db.items.find(x=>x.id===g.mergedInto);
   if(to&&[...OPEN,'needs_human','open','deploy','stuck'].includes(to.state)){to.count=(to.count||1)+1;to.updated=now();await save();return {issue:view(to),again:true,merged:true}}}
  // HEALTH-9: the same problem for the same agent in other words joins the open one (the sorter also merges across agents)
  if(!o.healthKey){const d=db.items.find(x=>x.agent===o.agent&&[...OPEN,'queued','needs_human','open','deploy'].includes(x.state)&&similar(x.missing,m)>=0.8);
   if(d){merge(d,{agent:o.agent,missing:m,evidence:o.evidence,at:now()});await save();log('issue merged into '+d.id+' (same problem)');return {issue:view(d),again:true,merged:true}}}
  const by=o.origin||{},p=personOf(pol,by.platform,by.uid);
  i={id:'i'+randomBytes(4).toString('hex'),key,agent:o.agent,source:o.source||(p?'person':'agent'),what:clip(o.what,400),missing:m,evidence:clip(o.evidence,2000),proposed_fix:clip(o.proposed_fix,1000),
   affects:[].concat(o.affects||[]).map(x=>clip(x,64)).filter(Boolean),needs:[].concat(o.needs||[]).map(String),created:now(),updated:now(),count:1,
   by:{platform:by.platform||null,uid:by.uid||null,chat:by.chat||null,thread:by.thread||null},byName:p?.name||by.who||null,tries:0,history:[],...(o.healthKey?{healthKey:String(o.healthKey)}:{}),...(o.report?{report:String(o.report)}:{}),...(o.urgent||urgentFor(pol,o)?{urgent:true}:{})};
  i.decision=decide(pol,i,by).why;i.state=pol.fixer?.on===false?'open':'queued';if(i.state==='open')i.decision='the fixer is switched off in the team policy';
  // MODEL-3: one short call sorts it before it joins the line (duplicate, person-only, or the fixer's); urgent ones go at once
  if(i.state==='queued'&&!i.urgent&&sortRun)i.sorting=now();
  db.items.unshift(i);db.items=db.items.slice(0,300);await save();log('issue '+i.id+' filed by '+(i.source==='health'?'Health':i.agent)+': '+i.state);
  if(i.sorting)setTimeout(()=>sortNext().catch(e=>log('issues: sort: '+e.message)),0);return {issue:view(i)}});
 // the item a merged one ended up in (it may have been merged on in turn)
 const endOf=x=>{for(let k=0;x?.mergedInto&&k<20;k++){const n=db.items.find(y=>y.id===x.mergedInto);if(!n)break;x=n}return x};
 // what was merged into `from` moves on to `to`: its reports, its count and the items that point at it
 function carry(from,to){if(from===to)return;for(const r of from.reports||[])if(!(to.reports||=[]).some(x=>x.id&&x.id===r.id&&x.at===r.at)){to.reports.push(r);if(r.agent&&r.agent!==to.agent&&!(to.affects||=[]).includes(r.agent))to.affects.push(r.agent)}
  to.reports=(to.reports||[]).slice(-20);to.count=(to.count||1)+Math.max(0,(from.count||1)-1);from.count=1;from.reports=[];for(const y of db.items)if(y.mergedInto===from.id)y.mergedInto=to.id}
 // one report joins another: counted, the agent added, kept for the history
 function merge(into,r){into.count=(into.count||1)+1;into.updated=now();
  (into.reports||=[]).push({agent:r.agent,missing:clip(r.missing,300),at:r.at||now(),...(r.id?{id:r.id}:{})});into.reports=into.reports.slice(-20);
  if(r.agent&&r.agent!==into.agent&&!(into.affects||=[]).includes(r.agent))into.affects.push(r.agent);
  if(r.evidence&&!into.evidence)into.evidence=clip(r.evidence,2000)}
 // the sorter (MODEL-3): one item at a time, new ones first, then (once) the older ones still open, so duplicates filed
 // before this existed merge too and every open item gets a plain title. Only an item that has not started its tries is
 // merged or moved to Needs you. A failed or unclear answer leaves the item with the fixer.
 // one sorting pass at a time; a second caller waits for the one going
 let sorting=null;
 const unsorted=()=>db.items.find(i=>i.sorting)||[...db.items].reverse().find(i=>!i.sorted&&['queued','needs_human','verify','stuck','deploy','stopped','open'].includes(i.state));
 function sortNext(){if(!sortRun)return Promise.resolve();return sorting||=(async()=>{try{for(let k=0;k<40;k++){await load();const i=unsorted();if(!i)return;await sortOne(i)}}finally{sorting=null}})()}
 async function sortOne(i){const pol=await policy(),mdl=fixerModel(pol,'sort');
  const others=db.items.filter(x=>x!==i&&!x.sorting&&[...OPEN,...WAITING].includes(x.state)&&x.state!=='stopped').slice(0,40).map(x=>({id:x.id,agent:nameOf(x.agent),title:x.title,missing:x.missing}));
  const at=now();let out='';try{out=await sortRun({prompt:sortPrompt({...i,agent:nameOf(i.agent)},others),agent:pol.fixer?.agent||'default',model:mdl.model,effort:mdl.effort})}catch(e){log('issues: sorting '+i.id+' failed: '+e.message)}
  const s=parseSort(out);const rec={issue:i.id,kind:'sort',day:today(),at,done:now(),agent:pol.fixer?.agent||'default',...(mdl.model?{model:mdl.model}:{})};
  rec.usage=await usageOf(rec).catch(()=>null)||undefined;
  await queue(async()=>{(db.sorts||={})[i.id+'-s'+at]=rec;const ks=Object.keys(db.sorts);if(ks.length>400)for(const k of ks.slice(0,ks.length-400))delete db.sorts[k];
   i.sorting=0;i.sorted=s?.kind||'unclear';if(s?.title)i.title=s.title;
   const live=x=>x&&[...OPEN,'needs_human','open','deploy','stuck'].includes(x.state);
   const to=s?.kind==='duplicate'&&s.duplicateOf!==i.id?endOf(db.items.find(x=>x.id===s.duplicateOf)):null;
   // only an item that has not started its own tries is folded into another
   if(to&&live(to)&&['queued','needs_human'].includes(i.state)&&!i.tries){merge(to,{agent:i.agent,missing:i.missing,evidence:i.evidence,at:i.created,id:i.id});carry(i,to);
    i.state='closed';i.mergedInto=to.id;i.updated=now();i.history.push({kind:'sorted',at:now(),status:'merged',summary:'The same problem as '+to.id+'; merged into it.'});await save();log('issues: '+i.id+' merged into '+to.id);return}
   if(s?.kind==='person'&&s.need&&!noPersonNeeded(s.need)&&i.state==='queued'&&!i.tries){i.state='needs_human';i.need=s.need;i.group=s.group||null;i.history.push({kind:'sorted',at:now(),status:'needs_human',summary:s.need});await save();
    const w=await tell(i,nameOf(i.agent)+' needs a person\n\nProblem: '+(i.title||i.missing)+'\nWhat is needed: '+s.need+'\n\naqeelOS does the rest by itself once this is done (System › Health).');i.told=w;await save();log('issues: '+i.id+' sorted: needs a person, told '+w);return}
   if(s?.kind==='person'&&s.group&&i.state==='needs_human')i.group=s.group;
   // the same problem as an open one, but this one already had tries of its own: kept apart, linked, so Needs you shows one card
   // never a loop: no link to an item whose own links lead back here
   if(to&&live(to)&&to!==i){let x=to,loop=false;for(let k=0;x&&k<20;k++){if(x===i){loop=true;break}x=db.items.find(y=>y.id===x.dupOf)}if(!loop)i.dupOf=to.id}
   await save()})}
 // Health saw the problem go away before the fixer started: closed, nobody told
 // 7 Nov 2026 (owner: solved problems close by themselves, nobody is asked to close anything): every waiting item is
 // re-checked against its own condition (sweep) and closes as "resolved by itself", silently, with the evidence kept
 async function resolved(i,why){i.state='gone';i.updated=now();i.resolvedBy=clip(why,800);i.result={...(i.result||{}),summary:'Resolved by itself: '+clip(why,600)};
  i.history.push({kind:'resolved',at:now(),summary:clip(why,800)});await save();log('issues: '+i.id+' resolved by itself: '+clip(why,200));return true}
 const healthGone=keys=>queue(async()=>{await load();const cur=new Set(keys);let n=0;
  for(const i of db.items)if(i.healthKey&&WAITING.includes(i.state)&&!cur.has(i.healthKey)){await resolved(i,'Health checked again and no longer sees it.');n++}
  return n});
 let sweptAt=0;
 const sweep=(force=false)=>queue(async()=>{await load();if(!force&&now()-sweptAt<10*60e3)return 0;sweptAt=now();let n=0;
  for(const i of db.items){if(!WAITING.includes(i.state)||i.healthKey&&!['stuck','deploy'].includes(i.state))continue;   // Health items: healthGone
   // a planned test (the ladder proof and the like) is not a problem to keep: closed at once
   if(/PLANNED TEST|planned (?:ladder )?test|ladder[- ]proof/i.test([i.missing,i.evidence].join(' '))){i.state='closed';i.updated=now();i.result={...(i.result||{}),summary:'Test item, closed.'};
    i.history.push({kind:'resolved',at:now(),summary:'Test item, closed.'});await save();log('issues: '+i.id+' test item, closed');n++;continue}
   const why=await whyGone(i).catch(e=>{log('issues: sweep '+i.id+': '+e.message);return null});if(why){await resolved(i,why);n++;continue}
   // a stuck issue whose files a deploy changed since: one proof run checks whether the problem is gone now
   // a fix filed as a patch for the daily deploy (state deploy): the same, once a deploy changed the files it patches
   if((i.state==='stuck'||i.state==='deploy')&&!i.recheck&&checks.changedSince){const files=[...new Set(i.history.flatMap(h=>[...(h.changes||[]).map(c=>c.file),...(h.patchFiles||[])]))];const since=Math.max(i.state==='deploy'?i.patchedAt||0:i.updated||0,i.recheckedAt||0);
    if(files.length&&await checks.changedSince(files,since).catch(()=>false)){const dep=i.state==='deploy';i.recheck=dep?'deploy':true;i.state='verify';i.updated=now();await save();log('issues: '+i.id+(dep?' its patch waited for a deploy, and a deploy changed its files':' stuck, but a deploy changed its files')+': a proof run checks it again');continue}}
   // nothing left to check for 7 days: it leaves quietly, to the Activity log
   if(!checkable(i)&&now()-(i.updated||i.created||0)>7*864e5){i.state='expired';i.updated=now();i.history.push({kind:'expired',at:now(),summary:'No check could tell whether it was solved; closed after 7 days.'});await save();
    await (checks.activity?checks.activity(nameOf(i.agent)+': '+clip(i.missing,120)+' closed after 7 days with nothing left to check',i):null)?.catch?.(()=>{});n++}}
  return n});
 // the condition an item is about, checked again: the duplicate's original is closed, an app it needed a sign-in for
 // is signed in, the files it said were missing exist, a commit it names is live, a newer issue of the same agent on the
 // same thing exists (the older one is the duplicate)
 async function whyGone(i){const text=[i.missing,i.evidence,i.proposed_fix,...i.history.map(h=>h.summary)].filter(Boolean).join('\n');
  const dup=/\b(?:duplicate of|same as|already filed as)\s+(i[0-9a-f]{8})\b/i.exec(text)?.[1];
  if(dup){const o=db.items.find(x=>x.id===dup);if(o&&['fixed','gone','closed','expired'].includes(o.state))return 'its original issue '+dup+' is '+o.state+'.'}
  // only a newer one that still carries it on (waiting or being fixed) or that fixed it; one that went away proves nothing
  const at=db.items.indexOf(i);const newer=db.items.find((x,k)=>x!==i&&x.agent===i.agent&&((x.created||0)>(i.created||0)||(x.created||0)===(i.created||0)&&k<at)&&[...OPEN,...WAITING,'fixed'].includes(x.state)&&similar(x.missing,i.missing)>=0.8);
  if(newer)return newer.state==='fixed'?'the same problem was fixed and proven as '+newer.id+'.':'the same problem was filed again as '+newer.id+' ('+newer.state+'), which carries it on.';
  if(checks.appSignedIn&&/sign[ -]?in|oauth|log ?in|token|tools?\b/i.test(i.missing)){const apps=await checks.apps?.(i.agent).catch(()=>[])||[];
   const named=apps.filter(a=>new RegExp('(^|[^\\w-])'+a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^\\w-])','i').test(i.missing));
   if(named.length){const ok=[];for(const a of named)if(await checks.appSignedIn(i.agent,a))ok.push(a);if(ok.length===named.length)return named.join(', ')+(named.length>1?' are':' is')+' signed in now (its sign-in is saved on the box).'}}
  if(checks.exists&&/not there|missing|no such file|does not exist|is gone/i.test(text)){const paths=[...new Set([...String(i.missing+' '+(i.evidence||'')).matchAll(/(?:^|[\s'"`(])((?:\/home\/|~\/)[\w.\-/]+\.\w+)/g)].map(m=>m[1]))];
   if(paths.length){let all=true;for(const p of paths)if(!await checks.exists(p)){all=false;break}if(all)return 'the file'+(paths.length>1?'s are':' is')+' there now: '+paths.slice(0,4).join(', ')+'.'}}
  // access to someone else's files is no longer needed once the agent has its own copy in its workspace (7 Nov 2026:
  // continue-threads' labels and tiktok/.venv)
  if(checks.ownCopy&&/access|permission denied|read\/?exec/i.test(i.missing)){const paths=[...new Set([...String(i.missing).matchAll(/(\/home\/[\w.-]+\/[\w.\-/]+)/g)].map(m=>m[1].replace(/[.,)]+$/,'')))];
   if(paths.length){let all=true;for(const p of paths)if(!await checks.ownCopy(i.agent,p)){all=false;break}if(all)return 'the files it needs are in its own workspace now: '+paths.map(p=>p.split('/').slice(-2).join('/')).join(', ')+'.'}}
  if(checks.commitLive){const shas=[...new Set([...text.matchAll(/\b(?:commit|fixed in|in git|live as)\s+([0-9a-f]{7,40})\b/gi)].map(m=>m[1].toLowerCase()))];
   for(const c of shas)if(await checks.commitLive(c))return 'the fix commit '+c+' is live on the box.'}
  return null}
 const checkable=i=>/\b(duplicate of|same as)\s+i[0-9a-f]{8}|sign[ -]?in|oauth|not there|missing|no such file|does not exist|\bcommit [0-9a-f]{7,}|access|permission denied/i.test([i.missing,i.evidence].join(' '))||i.history.some(h=>(h.changes||[]).length);
 const forAgent=async a=>{await load();return db.items.filter(i=>i.agent===a).slice(0,10).map(view)};
 const spend=()=>{const d=today(),mo=d.slice(0,7),t={runs:0,tokens:0,cost:0},m={runs:0,tokens:0,cost:0};
  for(const r of [...Object.values(db.runs||{}),...Object.values(db.sorts||{})]){const k=String(r.day||'');const add=x=>{x.runs++;const u=r.usage||{};x.tokens+=(u.input||0)+(u.output||0)+(u.cacheRead||0)+(u.cacheWrite||0);x.cost+=Number(u.cost)||0};if(k===d)add(t);if(k.startsWith(mo))add(m)}
  const so=Object.values(db.sorts||{}).filter(r=>String(r.day).startsWith(mo));
  return {today:t,month:m,sorts:{month:so.length,cost:so.reduce((a,r)=>a+(Number(r.usage?.cost)||0),0)}}};
 // every open item, and the last 120 that ended (History, HEALTH-4)
 const list=async()=>{await load();const end=['fixed','declined','gone','closed','expired'];
  return {items:[...db.items.filter(i=>!end.includes(i.state)),...db.items.filter(i=>end.includes(i.state)).slice(0,120)].map(view),policy:await policy(),spend:spend(),fixer:await fixerView()}};
 // what the fixer is doing now and why the rest waits (HEALTH-2)
 async function fixerView(){const pol=await policy(),t=now(),cap=pol.fixer?.cap||20,used=fixRunsToday();
  const cur=Object.values(db.runs).find(r=>!r.done),ci=cur&&db.items.find(i=>i.id===cur.issue);
  const ap=db.items.find(i=>i.state==='applying'||i.state==='rollback'||i.state==='reloaded-back');
  const card=i=>({id:i.id,state:i.state,agent:i.agent,agentName:nameOf(i.agent),title:i.title||null,missing:i.missing,urgent:!!i.urgent,tries:i.tries||0,count:i.count||1,
   why:i.state==='verify'?'proof':i.urgent?'urgent':'line',...(i.notBefore>t?{notBefore:i.notBefore}:{}),...(i.rank!=null?{moved:true}:{}),...(i.skipUntil>t?{skipUntil:i.skipUntil}:{})});
  const step=s=>s==='fixing'?'fix':['applying','rollback','reloaded-back'].includes(s)?'reload':'prove';
  const now_=ci?{...card(ci),kind:cur.kind||'fix',step:cur.kind==='proof'?'prove':'fix',model:cur.model||null,effort:cur.effort||null,at:cur.at,minutes:cur.kind==='proof'?Math.min(30,pol.fixer?.proof_minutes||15):Math.min(40,pol.fixer?.minutes||25)}:null;
  const wait=ap?{...card(ap),step:step(ap.state),kind:ap.applyKind||'engine',since:ap.waitingSince||ap.updated,back:ap.state!=='applying',quiet:engineOk(),
   model:db.runs[ap.run]?.model||null,effort:db.runs[ap.run]?.effort||null}:null;
  return {on:pol.fixer?.on!==false,paused:db.pause||null,now:now_,wait,cap:{used,cap,resetAt:nextDay(t,tz())},quiet:{from:1,to:5},
   line:lineOf(db.items,t).map(card),skipped:db.items.filter(i=>i.skipUntil>t&&['queued','verify'].includes(i.state)).map(card),
   sorting:db.items.filter(i=>i.sorting).length,stuck:db.items.filter(i=>i.state==='stuck'&&!i.need).map(card)}}
 // move one place up or down in the line; the two swap their places
 const move=(id,dir)=>queue(async()=>{await load();const l=lineOf(db.items,now()),k=l.findIndex(i=>i.id===id);if(k<0)return null;const j=dir==='up'?k-1:k+1;if(j<0||j>=l.length)return view(l[k]);
  const a=l[k],b=l[j],ka=lineKey(a),kb=lineKey(b);a.rank=kb;b.rank=ka===kb?ka+(dir==='up'?1:-1):ka;await save();return view(a)});
 // skip until the daily runs reset; Put back undoes it
 const skip=(id,on=true)=>queue(async()=>{await load();const i=db.items.find(x=>x.id===id);if(!i||!['queued','verify'].includes(i.state))return null;
  if(on){i.skipUntil=nextDay(now(),tz());i.history.push({kind:'person',at:now(),status:'skip',summary:'Skipped for today'})}else delete i.skipUntil;await save();return view(i)});
 // Pause holds the whole line (a run already going finishes its step); new issues still join it
 const pause=(on,who)=>queue(async()=>{await load();db.pause=on?{at:now(),by:clip(who,60)||null}:null;await save();return db.pause});
 // kept so old Telegram buttons and links answer something sensible
 const decideOwner=async(id)=>{await load();const i=db.items.find(x=>x.id===id);return i?view(i):null};
 const press=async()=>({ok:false,toast:'Nothing to approve any more: the fixer handles every issue by itself.'});

 // ---- the loop
 let running=null;
 const today=()=>dayIn(now(),tz());
 const fixRunsToday=()=>Object.values(db.runs).filter(r=>r.day===today()&&r.kind!=='proof'&&!r.notStarted).length;
 // switched off (fixer.on false): a run already going still has its result saved; nothing new starts and nothing reloads
 async function tick(){if(running)return;running=true;try{await load();const pol=await policy();await sweep().catch(e=>log('issues: sweep: '+e.message));await publishWaiting().catch(e=>log('issues: publish: '+e.message));
  sortNext().catch(e=>log('issues: sort: '+e.message));
  const cur=Object.values(db.runs).find(r=>!r.done);if(cur)return await check(cur,pol);if(pol.fixer?.on===false||db.pause)return;
  // a change waiting to be reloaded or rolled back comes first
  {const b=db.items.find(i=>i.state==='reloaded-back');if(b)return await afterTry(b)}
  const ap=db.items.find(i=>i.state==='applying'||i.state==='rollback');let held=false;
  if(ap){
   // a fix or rollback that needs the engine reloaded waits for the quiet hours like every other restart that can wait (8 Nov
   // 2026: four fixer restarts between 08:33 and 08:49 WIB). A web-app reload is not an engine restart and goes on. While one
   // waits, no other fix starts (urgent ones aside), so no second fix lands on files with an unloaded change. Proof runs
   // change no file, so they go on (owner, 11 Nov 2026: one waiting reload held 20 proof runs for a day).
   if((ap.applyKind||'engine')!=='engine'||engineOk())return await reload(ap);
   if(!ap.quietNoted){ap.quietNoted=true;await save();log('issues: '+ap.id+(ap.state==='rollback'?' rollback':'')+' needs an engine reload; it waits for the quiet hours')}
   held=true}
  if(!held){const d=db.items.find(i=>i.uiDirty&&!OPEN.includes(i.state));if(d){if(await busy().catch(()=>1)>0)return;d.uiDirty=false;await save();
   const r=await apply('ui','fixer '+d.id+' (files put back)').catch(e=>({ok:false,why:e.message}));if(!r?.ok){d.uiDirty=true;await save();log('issues: '+d.id+' reload of the put-back files waits: '+(r?.why||'not done'))}return}}
  if(!await ready().catch(()=>false))return;
  // the line in its order (proof runs, urgent, the rest, or as a person moved them); the daily limit holds back fixes
  // that are not urgent, never proof runs
  const capped=fixRunsToday()>=(pol.fixer?.cap||20);
  for(const i of lineOf(db.items,now())){if(i.notBefore>now())continue;
   if(i.state==='verify')return await start(i,pol,'proof');
   if(!i.urgent&&(held||capped))continue;return await start(i,pol,'fix')}}finally{running=null}}
 async function start(i,pol,kind){const n=kind==='fix'?i.tries+1:i.tries,id=i.id+'-'+n+(kind==='proof'?'p':''),dir=path.join(DIR,id);await mkdir(dir,{recursive:true,mode:0o700});
  const last=i.history.filter(h=>h.kind==='fix').at(-1);
  let gw=null;if(git&&kind==='fix'){gw=await git.prepare(i.id).catch(e=>({ok:false,why:e.message}));if(!gw.ok){log('issues: '+i.id+' no git work dir ('+gw.why+'); the older patch-file way');gw=null}}
  await writeFile(path.join(dir,'prompt.txt'),kind==='fix'?fixerPrompt(i,{rules:pol.fixer?.rules||'',attempt:n,git:gw}):proofPrompt(i,last,{reloaded:i.applied||null,recheck:!!i.recheck,deployed:i.recheck==='deploy'}),{mode:0o600});
  if(kind==='fix'){i.tries=n;i.state='fixing'}else i.state='verifying';i.run=id;i.updated=now();
  const mdl=fixerModel(pol,kind,n);const r={id,issue:i.id,kind,day:today(),at:now(),agent:pol.fixer?.agent||'default',...(mdl.model?{model:mdl.model}:{}),...(mdl.effort?{effort:mdl.effort}:{})};if(gw)r.git={dir:gw.dir,branch:gw.branch};db.runs[id]=r;await save();
  const minutes=kind==='fix'?Math.min(40,pol.fixer?.minutes||25):Math.min(30,pol.fixer?.proof_minutes||15);
  try{r.pid=await (launch||spawnRun)({dir,agent:r.agent,minutes,model:mdl.model,effort:mdl.effort})}catch(e){r.done=now();r.exit=-1;r.notStarted=true;if(kind==='fix')i.tries--;i.state=kind==='fix'?'queued':'verify';await save();log('issues: fixer could not start: '+e.message);return}
  await save();log('issues: '+kind+' run started for '+i.id+' ('+id+')')}
 async function spawnRun({dir,agent,minutes,model='',effort=''}){const out=await open(path.join(dir,'out.txt'),'w',0o600);
  try{const script='timeout -k 20 '+minutes*60+' "$1" -p "$2" chat --query-file "$3/prompt.txt" -Q --source tool ${4:+-m "$4"} ${5:+--reasoning "$5"} </dev/null; printf %s "$?" > "$3/exit"';
   const p=spawn('bash',['-c',script,'aqeelos-fixer',bin,agent,dir,model||'',effort||''],{detached:true,cwd:fixerHome,env:{HOME:fixerHome,USER:process.env.USER||'claude',PATH:path.join(fixerHome,'.local','bin')+':/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',TERM:'dumb',AQEELOS_FIXER:'1'},stdio:['ignore',out.fd,out.fd]});
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
 // 7 Nov 2026: a fix to aqeelOS's own code (the app folder, or the engine's source) lives only on this box, and the next
 // git deploy overwrote it (the problem came back). So a proven change to code is also saved as a patch, from each
 // file's backup, in DATA/fixer-patches/<issue>-try<n>.patch: the coding sessions and the next deploy take it into git.
 const codeRoot=f=>{const a=path.resolve(String(f||''));for(const r of codeRoots){const d=path.resolve(r.dir);const rel=path.relative(d,a);
   if(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&!/^(data|node_modules|mockup)(\/|$)/.test(rel))return {root:r,rel}}return null};
 const diffOf=(a,b,la,lb)=>new Promise(res=>{let out='';const c=spawn('diff',['-u','--label',la,'--label',lb,a,b]);c.stdout.on('data',d=>out+=d);c.on('error',()=>res(''));c.on('close',()=>res(out))});
 async function savePatch(i,fix,attempt){const own=(fix?.changes||[]).map(c=>({...c,at:codeRoot(c.file)})).filter(c=>c.at&&c.backup);if(!own.length)return null;
  const parts=[];for(const c of own){const d=await diffOf(c.backup,c.file,'a/'+c.at.root.prefix+c.at.rel,'b/'+c.at.root.prefix+c.at.rel);if(d)parts.push(d)}
  if(!parts.length)return null;const dir=path.join(DATA,'fixer-patches');await mkdir(dir,{recursive:true});
  const name=i.id+'-try'+attempt+'.patch',head=['# aqeelOS fixer, issue '+i.id+' ('+nameOf(i.agent)+'), proven '+new Date(now()).toISOString(),
   '# Problem: '+clip(i.missing,300).replace(/\n/g,' '),'# Fix: '+clip(fix.summary,400).replace(/\n/g,' '),
   '# Made on the live box only. Take it into git (git apply), or the next deploy puts the old file back.',''];
  await writeFile(path.join(dir,name),head.join('\n')+parts.join(''),{mode:0o600});return 'fixer-patches/'+name}
 // put every listed file back from its backup (copy, so the backup stays)
 // (7 Nov 2026) a file that already matches its backup (a deploy or an earlier rollback put it back) is not counted:
 // with nothing really put back, nothing is reloaded
 async function rollBack(changes){const done=[];for(const c of changes||[])if(c.backup&&await exists(c.backup)){
   const [b,a]=await Promise.all([readFile(c.backup).catch(()=>null),readFile(c.file).catch(()=>null)]);if(b&&a&&b.equals(a))continue;
   // ibd8a5021 (10 Nov 2026): a rollback put a whole old SOUL.md back and erased rules added after the fix. If the file
   // changed since the fixer left it, only the fixer's own diff is reversed (patch -R); if that does not apply, it is left alone
   if(c.after&&await exists(c.after)){const aft=await readFile(c.after).catch(()=>null);
    if(aft&&a&&!aft.equals(a)){const ok=await reverseOwn(c);log('issues: rollback '+c.file+' changed since the fix: '+(ok?'reversed only the fix\'s own diff':'left alone (its own diff no longer applies)'));if(ok)done.push(c.file);continue}}
   await copyFile(c.backup,c.file);done.push(c.file)}return done}
 const run=(cmd,args,input)=>new Promise(res=>{let out='';const c=spawn(cmd,args);c.stdout.on('data',d=>out+=d);c.on('error',()=>res({code:1,out}));c.on('close',code=>res({code,out}));if(input!=null){c.stdin.end(input)}else c.stdin.end()});
 async function reverseOwn(c){const d=await diffOf(c.backup,c.after,'a','b');if(!d)return true;
  const dry=await run('patch',['-R','--dry-run','-s','-f','-p0',c.file],d);if(dry.code!==0)return false;return (await run('patch',['-R','-s','-f','-p0','--no-backup-if-mismatch',c.file],d)).code===0}
 // what each changed file looked like when the fixer finished, so a rollback can tell later edits apart from the fix
 async function snapAfter(dir,changes){let k=0;for(const c of changes||[]){if(!c?.file||!c.backup)continue;const b=await readFile(c.file).catch(()=>null);if(!b)continue;
   const f=path.join(dir,'after-'+(k++));await writeFile(f,b,{mode:0o600});c.after=f}}
 // a code fix for the daily deploy: the copies the fixer changed (patches) and any live code file it changed anyway
 // become DATA/fixer-patches/<issue>-try<n>.patch; every live change of this try is put back (the whole fix ships
 // with the deploy, then one proof run checks it). A try that leaves nothing to file is a failed try.
 async function forDeploy(i,fr,h){const n=i.history.filter(x=>x.kind==='fix').length,parts=[],files=[];
  for(const c of fr.patches||[]){const at=codeRoot(c.file);if(!at||!await exists(c.copy))continue;const d=await diffOf(await exists(c.file)?c.file:'/dev/null',c.copy,'a/'+at.root.prefix+at.rel,'b/'+at.root.prefix+at.rel);if(d){parts.push(d);files.push(c.file)}}
  for(const c of fr.changes){const at=codeRoot(c.file);if(!at||!c.backup||files.includes(c.file))continue;const d=await diffOf(c.backup,c.file,'a/'+at.root.prefix+at.rel,'b/'+at.root.prefix+at.rel);if(d){parts.push(d);files.push(c.file)}}
  const back=await rollBack(fr.changes);
  if(!parts.length){h.outcome='no code change to file'+(back.length?', live changes put back':'');log('issues: '+i.id+' try '+i.tries+' filed no patch');return await nextTry(i,null)}
  const dir=path.join(DATA,'fixer-patches');await mkdir(dir,{recursive:true});const name=i.id+'-try'+n+'.patch';
  const head=['# aqeelOS fixer, issue '+i.id+' ('+nameOf(i.agent)+'), filed '+new Date(now()).toISOString()+' for the daily deploy',
   '# Problem: '+clip(i.missing,300).replace(/\n/g,' '),'# Fix: '+clip(fr.summary,400).replace(/\n/g,' '),
   '# Not applied on the box (nobody edits the live system by hand). Take it into git (git apply); after the deploy aqeelOS checks the problem again.',''];
  await writeFile(path.join(dir,name),head.join('\n')+parts.join(''),{mode:0o600});
  const pf='fixer-patches/'+name;h.patch=pf;h.patchFiles=files;h.outcome='filed for the daily deploy as '+pf+(back.length?' (the live edit was put back)':'');
  i.state='deploy';i.patch=pf;i.patchedAt=now();i.rechecks=0;i.updated=now();i.result={...(i.result||{}),summary:clip((fr.summary||'')+' Filed as '+pf+' for the daily deploy.',1600)};
  await save();log('issues: '+i.id+' code fix filed for the daily deploy: '+pf);return}
 // GIT-2: a code fix made in the fixer's git work dir. Live code files it touched anyway are copied into the work dir (app files)
 // or turned into an engine/patches file, and put back. The branch is committed, pushed and opened as a pull request when there
 // is a token; with none it waits committed. Returns 'other' when the try changed no code (a config or file fix: the normal flow).
 async function forReview(i,fr,h,g){const rootOf=p=>codeRoots.find(x=>x.prefix===p)?.dir;const eng=[],live=[];
  const put=async(file,from)=>{const at=codeRoot(file);if(!at||at.root.prefix!=='')return false;const to=path.join(g.dir,at.rel);await mkdir(path.dirname(to),{recursive:true});await copyFile(from,to);live.push(file);return true};
  const engDiff=async(file,from,at)=>{const d=await diffOf(from,file,'a/'+at.rel,'b/'+at.rel);if(d){eng.push(d);live.push(path.join(at.root.dir,at.rel))}};
  for(const c of fr.patches||[]){const at=codeRoot(c.file);if(!at||!await exists(c.copy))continue;if(!await put(c.file,c.copy))await engDiff(c.copy,await exists(c.file)?c.file:'/dev/null',at)}
  for(const c of fr.changes||[]){const at=codeRoot(c.file);if(!at||!c.backup||live.includes(c.file))continue;if(at.root.prefix===''){if(await exists(c.file))await put(c.file,c.file)}else await engDiff(c.file,c.backup,at)}
  const codeLive=live.length>0,mine=await git.dirty(i.id).catch(()=>false);
  if(!codeLive&&!mine&&fr.status!=='patch')return 'other';
  const back=await rollBack(fr.changes);
  const day=new Date(now()).toISOString().slice(0,10),title='Fixer: '+clip(i.title||i.missing,90).replace(/\n/g,' ');
  const fin=await git.finish(i.id,{message:title+'\n\nIssue '+i.id+' ('+nameOf(i.agent)+'). '+clip(fr.summary,600)+'\n\nOpened by the aqeelOS fixer.',
   engine:eng.length?[{name:day+'-fixer-'+i.id+'.patch',text:'# aqeelOS fixer, issue '+i.id+': '+clip(fr.summary,200).replace(/\n/g,' ')+'\n'+eng.join('')}]:[]}).catch(e=>({ok:false,why:e.message}));
  if(!fin.ok||fin.empty){h.outcome=fin.ok?'no code change in the checkout'+(back.length?', live changes put back':''):'not committed: '+fin.why;log('issues: '+i.id+' try '+i.tries+' '+h.outcome);await afterTry(i);return 'done'}
  const files=[...new Set([...live,...fin.files.filter(f=>!/^engine\/patches\//.test(f)).map(f=>path.join(rootOf('')||'',f))])];
  const body=['Opened by the aqeelOS fixer for issue `'+i.id+'` ('+nameOf(i.agent)+').','','**Problem**',clip(i.missing,600),'','**Fix**',clip(fr.summary,800),'','**Proof (test copy and tests)**',clip(fr.proof,2500),'',
   'Files: '+fin.files.slice(0,30).join(', '),'','Merge it and the next deploy ships it; aqeelOS then checks the problem again. An engine change is a file in engine/patches.'].join('\n');
  i.git={branch:g.branch,sha:fin.sha,files:fin.files,title,body,state:'waiting',at:now(),tries:0};h.patchFiles=files;h.patch=g.branch;
  await publishOne(i);
  h.outcome='branch '+g.branch+' committed; '+(i.git.state==='pr'?'pull request opened':'waits for review')+(back.length?' (the live edit was put back)':'');
  i.state='deploy';i.patch=g.branch;i.patchedAt=now();i.rechecks=0;i.updated=now();i.result={...(i.result||{}),summary:clip((fr.summary||'')+' Waits for review as branch '+g.branch+'.',1600)};
  await save();log('issues: '+i.id+' code fix on branch '+g.branch+' ('+i.git.state+')');if(i.git.state==='waiting')await noteToken();return 'done'}
 // push + pull request for one waiting branch; sets i.git.state to pr, waiting (no token) or error (tried again later)
 async function publishOne(i){const g=i.git,p=await git.publish(i.id,{title:g.title,body:g.body}).catch(e=>({state:'error',why:e.message}));
  g.state=p.state;g.tryAt=now();if(p.state==='pr'){g.url=p.url;g.number=p.number;g.why=null;g.opened=now()}else if(p.state==='error'){g.why=clip(p.why,300);g.tries=(g.tries||0)+1}return p}
 // the one "Needs you" item: asked once, not once per fix; taken away when a token appears
 async function noteToken(){if(db.tokenAsked)return;db.tokenAsked=now();await save();await needToken().catch(e=>log('issues: token note: '+e.message))}
 async function publishWaiting(){if(!git)return;const w=db.items.filter(x=>x.git&&['waiting','error'].includes(x.git.state));if(!w.length)return;
  if(!await git.hasToken().catch(()=>false)){if(w.some(x=>x.git.state==='waiting'))await noteToken();return}
  if(db.tokenAsked){db.tokenAsked=0;await save();await tokenOk().catch(()=>{})}
  for(const x of w){if(x.git.state==='error'&&now()-(x.git.tryAt||0)<30*60e3)continue;const was=x.git.state;await publishOne(x);await save();log('issues: '+x.id+' branch '+x.git.branch+': '+was+' → '+x.git.state+(x.git.why?' ('+x.git.why+')':''))}}
 // fixes waiting for review (System › Health): every branch whose issue still waits for the merge and the deploy
 const reviews=async()=>{await load();return db.items.filter(i=>i.git&&['deploy','verify','verifying'].includes(i.state)).map(i=>({issue:i.id,branch:i.git.branch,at:i.git.at,files:i.git.files,note:i.result?.summary||i.missing,url:i.git.url||null,number:i.git.number||null,state:i.git.state,why:i.git.why||null}))};
 async function check(r,pol){const dir=path.join(DIR,r.id);const ex=await readFile(path.join(dir,'exit'),'utf8').catch(()=>null);
  const up=r.pid&&(alive?await alive(r):(()=>{try{process.kill(r.pid,0);return true}catch{return false}})());
  if(ex===null&&up)return;const out=await readFile(path.join(dir,'out.txt'),'utf8').catch(()=>'');r.done=now();r.exit=ex===null?null:Number(ex);r.usage=await usageOf(r).catch(()=>null)||undefined;
  const i=db.items.find(x=>x.id===r.issue);const kind=r.kind||'fix';const res=parseResult(out,kind);
  if(!i){await save();return}i.updated=now();
  // never reached the model: not a try; again in 5 minutes
  if(!res&&notStarted(out)){r.notStarted=true;if(kind==='fix')i.tries--;if(kind==='fix'&&i.noRetry){await save();return await afterTry(i)}i.state=kind==='fix'?'queued':'verify';i.notBefore=now()+5*60e3;await save();log('issues: '+r.id+' did not reach the model; again in 5 minutes');return}
  if(kind==='fix'){const fr=res||{status:'failed',summary:'The fixer ended without a result'+(r.exit!=null?' (exit '+r.exit+')':' (stopped)')+'.',proof:clip(out.slice(-800),800),changes:[],apply:'none'};r.result=fr;
   await snapAfter(dir,fr.changes).catch(()=>{});const h={kind:'fix',run:r.id,at:now(),status:fr.status,summary:fr.summary,proof:fr.proof,need:fr.need,check:fr.check,apply:fr.apply,changes:fr.changes};i.history.push(h);i.result=fr;
   // asking a person to approve is not needing one: the fixer decides itself on the next try
   if(fr.status==='needs_human'&&(!fr.need||approvalOnly(fr.need))){await rollBack(fr.changes);h.outcome='asked for an approval; nobody approves fixes, so it decides itself';return await nextTry(i,null)}
   if(fr.status==='needs_human'&&testerSendOnly(fr.need)){await rollBack(fr.changes);h.outcome='asked a person to send a test message; it posts a signed test webhook as the tester itself (scripts/kirimdev-test-message.mjs)';return await nextTry(i,null)}
   if(fr.status==='needs_human'&&i.closeAfter){await rollBack(fr.changes);i.state='closed';i.updated=now();await save();log('issues: '+i.id+' closed after its last try');return}
   if(fr.status==='needs_human'){await rollBack(fr.changes);i.state='needs_human';i.need=fr.need||fr.summary;await save();
    const to=await tell(i,nameOf(i.agent)+' needs a person for a fix\n\nProblem: '+i.missing+'\nWhat is needed: '+(i.need||'-')+'\n\naqeelOS fixes the rest by itself once this is done (issue '+i.id+' on System › Health).');i.told=to;await save();log('issues: '+i.id+' needs a human, told '+to);return}
   // put back before it was ever reloaded: nothing to reload
   if(fr.status==='failed'){await rollBack(fr.changes);h.outcome='failed, rolled back';return await nextTry(i,null)}
   const bad=await guard(fr);
   if(bad.length){const back=await rollBack(fr.changes);h.outcome='unsafe ('+bad.join('; ')+'), '+(back.length?'put back':'nothing to put back');log('issues: '+i.id+' try '+i.tries+' broke a rule: '+bad.join('; '));return await nextTry(i,null)}
   // 8 Nov 2026: not urgent and it touches aqeelOS's code: filed as a patch for the daily deploy, nothing stays live
   if(r.git&&git&&await forReview(i,fr,h,r.git)!=='other')return;
   if(!i.urgent&&(fr.status==='patch'||fr.patches.length||fr.changes.some(c=>codeRoot(c.file))))return await forDeploy(i,fr,h);
   i.applied=null;
   if(fr.apply!=='none'&&fr.changes.length){i.state='applying';i.applyKind=fr.apply==='engine'||!i.uiDirty?fr.apply:'ui';i.waitingSince=now()}
   else if(i.uiDirty){i.state='applying';i.applyKind='ui';i.waitingSince=now()}else i.state='verify';
   await save();log('issues: '+r.id+' '+fr.status+' → '+i.state);return}
  // the proof run
  const pr=res||{status:'not_proven',proof:'The proof run ended without a result'+(r.exit!=null?' (exit '+r.exit+')':' (stopped)')+'. '+clip(out.slice(-600),600),need:''};r.result=pr;
  const last=i.history.filter(h=>h.kind==='fix').at(-1);i.history.push({kind:'proof',run:r.id,at:now(),status:pr.status,proof:pr.proof,need:pr.need,...(i.recheck?{recheck:true}:{})});
  // a recheck of a stuck issue (sweep): nothing to roll back; proven closes it, otherwise it stays stuck until its files change again
  if(i.recheck==='deploy'){i.recheck=false;i.recheckedAt=now();i.rechecks=(i.rechecks||0)+1;
   if(pr.status==='proven'){i.state='fixed';i.fixed=now();i.proof=pr.proof;i.result={...(i.result||{}),status:'fixed',proof:pr.proof,summary:clip('Fixed by the daily deploy ('+(i.patch||'its patch')+'). '+(i.result?.summary||''),1600)};if(last)last.outcome='proven after the deploy';
    await save();log('issues: '+i.id+' fixed by the deploy and proven');await onFixed(view(i)).catch(e=>log('issues: '+i.id+' after the fix: '+e.message));return}
   // not in that deploy, or not enough: it keeps waiting for the next one; after 3 deploys it is stuck (nobody told)
   i.state=i.rechecks>=TRIES?'stuck':'deploy';await save();log('issues: '+i.id+' not proven after the deploy ('+i.rechecks+'), '+i.state);return}
  if(i.recheck){i.recheck=false;i.recheckedAt=now();if(pr.status==='proven')return await resolved(i,'a recheck after a deploy proved it gone: '+clip(pr.proof,600));i.state='stuck';await save();return}
  if(pr.status==='proven'){i.state='fixed';i.fixed=now();i.proof=pr.proof;i.result={...(i.result||{}),status:'fixed',proof:pr.proof};if(last)last.outcome='proven';
   const pf=await savePatch(i,last,i.history.filter(h=>h.kind==='fix').length).catch(e=>{log('issues: '+i.id+' patch not saved: '+e.message);return null});
   if(pf){i.patch=pf;if(last)last.patch=pf;i.result.summary=clip((i.result.summary||'')+' The code change is saved as '+pf+' for git.',1600)}
   await save();log('issues: '+i.id+' fixed and proven'+(pf?', patch '+pf:''));await onFixed(view(i)).catch(e=>log('issues: '+i.id+' after the fix: '+e.message));return}
  if(last){last.outcome='not proven';last.proofNeed=pr.need}
  const back=await rollBack(last?.changes);if(last&&back.length)last.outcome+=', rolled back';i.lastNeed=pr.need||i.lastNeed;
  return await nextTry(i,back.length&&last?.apply!=='none'?last.apply:null)}
 // after a failed try: reload what was put back (if anything), then queued again, or stuck after the last try
 // 7 Nov 2026 (i87c8beb0 restarted the web app twice per try: once for the fix, once to roll it back): a try restarts the
 // web app at most once. A web-app rollback after a failed proof waits (uiDirty): the next try's own reload picks up the
 // files that were put back, and once the issue stops trying, one reload brings the app back to them (tick).
 async function nextTry(i,reloadKind){if(reloadKind==='ui'&&i.uiRestartTry===i.tries){i.uiDirty=true;await save();log('issues: '+i.id+' put the web app files back; the reload waits for the next try or the end');return await afterTry(i)}
  if(reloadKind){i.state='rollback';i.applyKind=reloadKind;i.waitingSince=now();await save();return}return await afterTry(i)}
 async function afterTry(i){if(i.noRetry){i.state=i.closeAfter?'closed':'stopped';i.updated=now();await save();log('issues: '+i.id+' '+i.state+' after its try (no more tries asked)');return}
 if(i.tries<TRIES){i.state='queued';i.notBefore=now()+60e3;await save();return}
  i.state='stuck';await save();
  const tried=i.history.filter(h=>h.kind==='fix').map((h,n)=>(n+1)+') '+clip(h.summary,200)+(h.outcome?' ('+h.outcome+')':'')).join('\n');
  const need=[i.lastNeed,...i.history.filter(h=>h.need).map(h=>h.need).reverse()].find(x=>x&&!noPersonNeeded(x));
  // nothing a person must physically do: no message; it stays on System › Health as stuck
  if(!need){i.need=null;log('issues: '+i.id+' stuck; nothing needs a person, so nobody is told');return}
  const to=await tell(i,nameOf(i.agent)+': aqeelOS tried '+TRIES+' times and could not fix this by itself\n\nProblem: '+i.missing+'\nTried:\n'+tried+'\n\nWhat is needed from you: '+need);i.told=to;i.need=need;await save();log('issues: '+i.id+' stuck, told '+to)}
 // reload safely once nothing is busy (/healthz busy 0); a restart hold or a busy box just waits for the next tick
 async function reload(i){const n=await busy().catch(()=>1);if(n>0)return;
  const kind=i.applyKind||'engine',back=i.state==='rollback';
  if(kind==='ui'){i.applied='ui';i.state=back?'reloaded-back':'verify';i.uiRestartTry=i.tries;i.uiDirty=false;await save()}   // the web app restarts now: the next start continues
  const r=await apply(kind,'fixer '+i.id+(back?' (rollback)':'')).catch(e=>({ok:false,why:e.message}));
  if(!r?.ok){if(kind==='ui'){i.state=back?'rollback':'applying';await save()}log('issues: '+i.id+' reload waits: '+(r?.why||'not done'));return}
  i.applied=kind;i.waitingSince=null;if(back)return await afterTry(i);i.state='verify';await save();log('issues: '+i.id+' reloaded ('+kind+')')}
 // "Try again" on Health (after a person did what was needed, or for a stuck one): a fresh set of tries
 const retry=id=>queue(async()=>{await load();const i=db.items.find(x=>x.id===id);if(!i||OPEN.includes(i.state))return i?view(i):null;i.state='queued';i.tries=0;i.notBefore=0;i.noRetry=i.closeAfter=false;i.updated=now();await save();return view(i)});
 // Stop retrying (System › Health): a queued one stops now; one in the middle of a try finishes that try (a proven fix
 // still counts as fixed, a change that fails its proof is still put back) and then stops
 const IDLE=['queued','open','needs_human','stuck','failed'];
 const stop=(id,who)=>queue(async()=>{await load();const i=db.items.find(x=>x.id===id);if(!i)return null;if(!OPEN.includes(i.state)&&i.state!=='open')return view(i);
  i.history.push({kind:'person',at:now(),status:'stop',summary:'Stop retrying'+(who?' ('+clip(who,60)+')':'')});
  if(IDLE.includes(i.state)){i.state='stopped';i.notBefore=0}else i.noRetry=true;i.updated=now();await save();return view(i)});
 // Close: done with it, whatever state; one in the middle of a try is closed when that try ends
 const close=(id,who)=>queue(async()=>{await load();const i=db.items.find(x=>x.id===id);if(!i)return null;if(['closed','fixed','gone','expired'].includes(i.state))return view(i);
  i.history.push({kind:'person',at:now(),status:'close',summary:'Closed'+(who?' by '+clip(who,60):'')});
  if(IDLE.includes(i.state)||!OPEN.includes(i.state)){i.state='closed';i.notBefore=0}else{i.noRetry=true;i.closeAfter=true}i.updated=now();await save();return view(i)});
 return {file,reviews,healthGone,sweep,retry,stop,close,decideOwner,press,forAgent,list,tick,policy,move,skip,pause,fixerView:async()=>{await load();return fixerView()},sortNext,_db:async()=>{await load();return db}}}
// one short sorting call through the engine (MODEL-3): no tools, no agent rules or memory, one turn, at most 2 minutes;
// its answer is the last line of what it prints
export function engineSortRun({bin,home,dir}){return async({prompt,agent,model='',effort=''})=>{await mkdir(dir,{recursive:true,mode:0o700});
 const f=path.join(dir,'sort-'+randomBytes(4).toString('hex')+'.txt');await writeFile(f,prompt,{mode:0o600});
 try{return await new Promise((res,rej)=>{let out='';const script='timeout -k 10 120 "$1" -p "$2" chat --query-file "$3" -Q --source tool --max-turns 1 --ignore-rules -t "" ${4:+-m "$4"} ${5:+--reasoning "$5"} </dev/null';
  const p=spawn('bash',['-c',script,'aqeelos-sort',bin,agent,f,model||'',effort||''],{cwd:home,env:{HOME:home,USER:process.env.USER||'claude',PATH:path.join(home,'.local','bin')+':/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',TERM:'dumb',AQEELOS_FIXER:'1'},stdio:['ignore','pipe','pipe']});
  p.stdout.on('data',d=>{out+=d;if(out.length>200000)out=out.slice(-100000)});p.stderr.on('data',()=>{});p.on('error',rej);p.on('close',()=>res(out))})}
 finally{await rm(f,{force:true}).catch(()=>{})}}}
