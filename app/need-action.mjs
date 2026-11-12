// The buttons of a "Needs you" item. Every item says in one plain line what to do and has ONE primary button that does exactly
// that thing (owner, 12 Nov 2026: "it asked me to sign into Higgsfield, why not just give me a button to sign in?").
//
// Rewritten the same day (owner: "What's the point of clicking sign in if it doesn't lead me anywhere?"). The first version
// guessed an app from loose words in the sentence: "Pixel Agent needs a person…" matched a tool called pixel that has no
// sign-in page, so the button was "Sign in to pixel" and it ended in a toast. The rule now:
//   1. A need carries FACTS, not words: steps:[{what,id,agent,alt}] written by the fixer and the sorter next to the sentence
//      (issues.mjs), what = ai-account | google | app | remove-app | key | screen.
//   2. Each step is CHECKED against what this install really has, every time it is shown: the account exists, the app is on
//      that agent and has a sign-in page (mcpCanSignIn, the same test the server makes before it starts one), the agent exists.
//      Only then is it a button. A step that is already done says so. Several steps are a numbered list, a button each.
//   3. A need filed before steps existed is read for things named IN FULL only (an account's exact name, an app's exact name
//      in quotes or right after "sign in to", Connect Google), never a part of a word, and goes through the same check.
//   4. Nothing known, or the check fails: no sign-in is offered. The button opens the exact page where it is done.
// Pure: no files, no network. ctx (server.mjs needCtx): {agents:[{id,name}], mcp:[{id,label,detail,users:[{id,signed,signin}]}],
//   accounts:[{key,name,aka,state,listed}], google:[{id,users:[{id}]}]}
//   acts: [{do,label,say,step,alt,...}]; the first is the primary button; 'recheck' is the honest last one ("I did it, look again")
//   do: signin-app {agent,name,app} | signin-account {key,name} | unlist-account {key,name} | google {agent} | remove-app {agent,name}
//       | screen {agent} | copy {cmd} | go {to,tab} | done (a step already done: a tick, no button) | recheck
//   Every one has a handler in bottlenecks.js act() (scripts/health-actions.test.mjs holds that).

// a label that does not say what it does, or is too long to read at a glance
export const VAGUE=/^(open|view|ok|okay|got it|review|details|see details|more|done|dismiss|close|continue|go|fix|fix it|check|click here|yes|submit)$/i;
export const vagueLabel=l=>{l=String(l??'').trim();return !l||VAGUE.test(l)||l.split(/\s+/).length>5};

export const DOES=['signin-app','signin-account','unlist-account','google','remove-app','screen','copy','go','recheck'];
export const STEP_KINDS=['ai-account','google','app','remove-app','key','screen'];
const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// what the fixer or the sorter wrote, made safe to keep: at most 6 steps of a known kind
export function cleanSteps(l){return (Array.isArray(l)?l:[]).filter(s=>s&&STEP_KINDS.includes(s.what)).slice(0,6).map(s=>({what:s.what,id:String(s.id??'').trim().slice(0,120),agent:AGENT.test(String(s.agent||''))?String(s.agent):'',...(s.alt===true?{alt:true}:{})}))}

// can a sign-in page be started for this tool? The one test: an address, and no key or token of its own (share.mjs
// prepareSignin refuses the rest with "Only tools with an address sign in this way")
export const mcpCanSignIn=b=>!!b&&typeof b==='object'&&/^https?:\/\//i.test(String(b.url||''))&&(!b.auth||b.auth==='oauth')&&!b.bearer&&!b.bearer_token&&!b.token&&!Object.keys(b.headers||{}).some(k=>/auth|token|key|bearer/i.test(k));

// where each kind of thing is done, for the button that opens the exact page
export const PLACES={
 accounts:{to:'/models/models',tab:['models','AI accounts'],label:'Open AI accounts'},
 apps:{to:'/abilities/connections',tab:['connections','Apps'],label:'Open Connections'},
 google:{to:'/abilities/connections',tab:['connections','Logins'],label:'Open Connections'},
 keys:{to:'/system/keys',label:'Open Keys and secrets'},
 health:{to:'/system/health',label:'Open it on Health'}};
const KIND_PLACE={'ai-account':'accounts',app:'apps','remove-app':'apps',google:'google',key:'keys'};
// a page the sentence names itself ("on aqeelOS Models › Accounts")
const NAMED=[[/Models\s*[›>]\s*(AI )?Accounts/i,'accounts'],[/System\s*[›>]\s*Keys/i,'keys'],[/Abilities\s*[›>]\s*Connections|Connected apps/i,'apps']];
const place=k=>({do:'go',...PLACES[k]});

const rx=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const low=s=>String(s??'').toLowerCase().trim();
const short=(s,n=26)=>{s=String(s||'');return s.length<=n?s:s.slice(0,n).replace(/\s+\S*$/,'')+'…'};
// the whole name, standing on its own in the text (not inside another word)
const whole=(t,name)=>{name=String(name||'').trim();return name.length>2&&new RegExp('(^|[^a-z0-9])'+rx(name)+'([^a-z0-9]|$)','i').test(t)};
// on a button an account goes by its short name: "Google AI Pro (Antigravity)" is Antigravity
const nick=n=>/\(([^)]{3,40})\)\s*$/.exec(String(n||''))?.[1]||String(n||'');
const agName=(ctx,a)=>(ctx.agents||[]).find(x=>x.id===a)?.name||a;
// the model providers people call by another name
const ALIAS={chatgpt:'openai-codex',codex:'openai-codex','chatgpt/codex':'openai-codex',openai:'openai-codex',gemini:'google-gemini-cli',copilot:'github-copilot'};

// ---- the targets, looked up in what the install has
// every name an account goes by: its own name, its provider's name and id, and a name in brackets ("Google AI Pro (Antigravity)").
// A Claude account goes by "Claude" only while it is the only one.
export function akaOf(a,ctx={}){const out=[a.name,...(a.aka||[])],slug=String(a.key||'').startsWith('p:')?a.key.slice(2):'';
 if(slug){out.push(slug,slug.replace(/-(subscription|cli|oauth|api)$/,''));for(const [k,v] of Object.entries(ALIAS))if(v===slug)out.push(k)}
 else if(String(a.key||'').startsWith('claude:')&&(ctx.accounts||[]).filter(x=>String(x.key).startsWith('claude:')).length===1)out.push('Claude','Anthropic');
 for(const n of [...out])for(const m of String(n||'').matchAll(/\(([^)]{3,40})\)/g))out.push(m[1]);
 return [...new Set(out.map(x=>String(x||'').trim()).filter(x=>x.length>2))]}
export function findAccount(id,ctx={}){const l=(ctx.accounts||[]).filter(a=>a.key&&a.key!=='exhausted'),v=low(id);if(!v)return null;
 return l.find(a=>low(a.key)===v)||l.find(a=>low(a.name)===v)||l.find(a=>akaOf(a,ctx).some(n=>low(n)===v))||null}
export function findApp(id,ctx={}){const v=low(id);if(!v)return null;return (ctx.mcp||[]).find(m=>low(m.id)===v)||(ctx.mcp||[]).find(m=>low(m.label)===v)||null}
// which agent signs in: the one the item is about when it has the app, else one that has it and is not signed in
const appAgent=(m,agent)=>{const u=m.users||[];if(agent&&u.some(x=>x.id===agent))return agent;return (u.find(x=>!x.signed&&x.signin)||u.find(x=>!x.signed)||u[0])?.id||''};
const isSheetLink=m=>/^https?:\/\/(docs|sheets|drive|slides|forms)\.google\.com\//i.test(String(m?.detail||''))||/google sheet/i.test(String(m?.label||m?.id||''));

// ---- one step, checked: {acts:[main, alt…]} a real button | {done:'…'} already done | {place:'apps'} only the page is known
export function resolveStep(s,i,ctx={}){const agent=s.agent||i?.agent||'';const has=a=>!ctx.agents||ctx.agents.some(x=>x.id===a);
 if(s.what==='ai-account'){const a=findAccount(s.id,ctx);if(!a)return {place:'accounts'};
  // the account's state is the one Models > Accounts shows (account-state.mjs): a report that says its sign-in stopped working is only
  // a button while the account really needs a person; connected or at a limit it says so, and no sign-in is offered
  if(a.state==='connected')return {done:a.name+' is connected now, as Models shows.',live:true};
  if(a.state==='limit')return {done:a.name+' is signed in but at its limit. It works again when the limit resets.',live:true};
  if(a.state==='checking')return {place:'accounts'};
  const acts=[{do:'signin-account',key:a.key,name:a.name,label:(a.rejected?'New key for ':'Sign in to ')+short(nick(a.name),22),say:a.rejected?a.name+': the provider refuses its key. Paste a new one.':a.name+': its sign-in stopped working. Sign in again as this account.'}];
  if(a.listed)acts.push({do:'unlist-account',key:a.key,name:a.name,alt:true,label:'Take it out of the priority list',say:'Agents stop trying '+a.name+' until you put it back.'});return {acts}}
 if(s.what==='google'){if(!agent||!has(agent))return {place:'google'};
  const got=(ctx.google||[]).filter(g=>(g.users||[]).some(u=>u.id===agent)).map(g=>g.id);
  return {acts:[{do:'google',agent,label:short('Connect Google for '+agName(ctx,agent),40),say:got.length?agName(ctx,agent)+' uses '+got.slice(0,2).join(' and ')+' now. Connect the Google account that can open the file: pick it and allow access.':agName(ctx,agent)+' gets a Google sign-in of its own: pick the account and allow access.'}]}}
 if(s.what==='app'){const m=findApp(s.id,ctx);if(!m)return {place:'apps'};const ag=appAgent(m,agent),u=(m.users||[]).find(x=>x.id===ag);if(!u)return {place:'apps'};
  const app=m.label||m.id;if(u.signed&&u.signin)return {done:app+' is signed in for '+agName(ctx,ag)+'.'};if(!u.signin)return {place:'apps'};
  return {acts:[{do:'signin-app',agent:ag,name:m.id,app,label:'Sign in to '+short(String(app).split(/\s[·(-]/)[0],24),say:app+' needs a sign-in for '+agName(ctx,ag)+'. Its own page opens in a new tab.'}]}}
 if(s.what==='remove-app'){const m=findApp(s.id,ctx);const who=m&&(m.users||[]).filter(u=>!agent||u.id===agent);
  if(!m||!who.length)return {done:'“'+(s.id||'It')+'” is removed.'};const ag=who[0].id,sheet=isSheetLink(m);
  return {acts:[{do:'remove-app',agent:ag,name:m.id,app:m.label||m.id,label:sheet?'Remove the sheet link entry':'Remove '+short(m.label||m.id,22),say:sheet?'“'+(m.label||m.id)+'” is a link to a Google file, not an app, so it can never connect. Remove it from '+agName(ctx,ag)+'.':'Remove “'+(m.label||m.id)+'” from '+agName(ctx,ag)+'.'}]}}
 if(s.what==='screen'){if(!agent||!has(agent))return {place:'health'};return {acts:[{do:'screen',agent,label:'Sign in on screen',say:'Open '+agName(ctx,agent)+'’s screen and sign in on the page that is open there.'}]}}
 if(s.what==='key')return {acts:[{...place('keys'),say:(s.id?s.id+': ':'')+'add or change the key under Keys and secrets.'}]};
 return {place:'health'}}

// ---- a need filed before steps existed: only things named in full
const SIGNV='(?:sign(?:ed|ing)?[ -]?in(?: again)?(?: to| for| on)?|log(?:ged|ging)?[ -]?(?:back )?in(?: to| for)?|login|re-?authori[sz]e|authori[sz]e|re-?connect|connector sign-in for)';
const QUOTE='[\'"`‘’“”]';
const named=(t,name)=>{name=String(name||'').trim();if(name.length<3)return false;const n=rx(name);
 return new RegExp(QUOTE+n+QUOTE,'i').test(t)||new RegExp('\\b'+SIGNV+'\\s+(?:the\\s+)?'+n+'(?![a-z0-9])','i').test(t)};
export function readSteps(i,ctx={}){const need=String(i?.need||''),t=[need,i?.missing].filter(Boolean).join(' '),out=[],agent=i?.agent||'';
 for(const a of ctx.accounts||[]){if(a.key==='exhausted')continue;const nm=akaOf(a,ctx).filter(n=>whole(t,n));if(nm.length)out.push({what:'ai-account',id:a.key,at:Math.min(...nm.map(n=>t.toLowerCase().indexOf(low(n))))})}
 for(const m of ctx.mcp||[]){const nm=[m.id,m.label].filter(Boolean).find(n=>named(t,n));if(!nm)continue;const at=t.toLowerCase().indexOf(low(nm));
  const gone=new RegExp('\\b(remove|delete|take out|drop)\\b[^.;]{0,60}'+rx(nm),'i').test(t);out.push({what:gone?'remove-app':'app',id:m.id,agent:gone?agent:'',at})}
 {const m=new RegExp('\\b(?:remove|delete)\\b[^.;]{0,40}'+QUOTE+'([^\'"`‘’“”]{3,80})'+QUOTE+'\\s+(?:entry|app|server|connection|tool)','i').exec(t);if(m&&!out.some(s=>s.what==='remove-app'&&low(findApp(s.id,ctx)?.id)===low(findApp(m[1],ctx)?.id||m[1])))out.push({what:'remove-app',id:m[1],agent,at:m.index})}
 if(/\bconnect\b[^.;]{0,80}\bGoogle\b|\bsign(?:ing)?[ -]in with (?:their|your|his|her|a|the|its) (?:own )?Google account\b|\bConnect Google\b/i.test(t)&&!out.some(s=>s.what==='ai-account'))out.push({what:'google',agent,at:t.search(/Google/i)-.5});
 if(!out.length&&/\b(log(?:ged)?[ -]?(?:back )?in|sign(?:ed)?[ -]?(?:back )?in|session expired|take over)\b/i.test(t)&&/\b(browser|screen|website|password page)\b/i.test(t)&&!NAMED.some(([r])=>r.test(t)))out.push({what:'screen',agent,at:0});
 return out.sort((a,b)=>a.at-b.at).map(({at,...s})=>s)}

// ---- the buttons of one need
export function issueActs(i,ctx={}){const need=String(i?.need||''),text=[need,i?.title,i?.missing].filter(Boolean).join(' ');
 const given=cleanSteps(i?.steps),steps=given.length?given:readSteps(i,ctx),acts=[],places=[];let n=0,live=false;
 for(const s of steps){const r=resolveStep(s,i,ctx);
  if(r.acts){if(!s.alt)n++;for(const a of r.acts)acts.push({...a,...(s.alt||a.alt?{alt:true}:{}),step:n||1})}
  else if(r.done){if(r.live)live=true;if(!s.alt){n++;acts.push({do:'done',step:n,say:r.done,label:''})}}
  else if(r.place)places.push(r.place)}
 // nothing that can really start: the exact page, never a guess
 if(!acts.some(a=>a.do!=='done')&&!live){const p=places[0]||NAMED.find(([r])=>r.test(text))?.[1]||steps.map(s=>KIND_PLACE[s.what]).find(Boolean);
  const cmd=/`([^`\n]{6,200})`/.exec(need)?.[1];
  if(p)acts.push(place(p));else if(cmd&&/\s/.test(cmd))acts.push({do:'copy',cmd,label:'Copy the command'});else acts.push(place('health'))}
 // the steps in their order; inside a step the secondary never leads; a tick only where other steps are still open
 const many=new Set(acts.filter(a=>a.step&&!a.alt).map(a=>a.step)).size>1||live;
 const out=acts.filter(a=>a.do!=='done'||many).sort((a,b)=>(a.step||9)-(b.step||9)||(a.alt?1:0)-(b.alt?1:0));
 out.push({do:'recheck',label:'Check again'});return out}

// the same for a Bottlenecks item the popup shows (an agent's report, a fixer message, merged app sign-ins): its sentence is
// x.ask; issue: the fixer's issue the message is about, when there is one (its steps are the facts)
export function itemActs(x,ctx={},issue=null){
 if(x?.kind==='apps'){const t=String(x.title||'').replace(/ needs? a sign-in$/,'').split(/, | and /).map(s=>s.trim()).filter(Boolean),out=[];
  for(const a of t){const r=resolveStep({what:'app',id:a,agent:''},{agent:x.agent},ctx);if(r.acts)out.push(...r.acts)}return out}
 return issueActs(issue?{...issue,agent:issue.agent||x?.agent}:{need:x?.ask||x?.text,title:x?.title,missing:x?.missing,agent:x?.agent},ctx).filter(a=>a.do!=='recheck'&&a.do!=='done'&&!(a.do==='go'&&a.to===PLACES.health.to))}
