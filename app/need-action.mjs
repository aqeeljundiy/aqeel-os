// The one button of a "Needs you" item (12 Nov 2026, owner: "it asked me to sign into Higgsfield, why not just give me a button to sign
// in rather than a random button that doesn't make sense?"). Every item says in one plain line what to do and has ONE primary
// button that does exactly that thing, or opens the exact place where it is done (bottlenecks.js actions, health-page.js).
// This file works out the buttons for the free-text needs the fixer and the agents write ("Re-authorize Higgsfield for ...") by
// looking at the words and at what this install really has (connected apps, signed-out AI accounts). Pure: no files, no network.
//   acts: [{do, label, ...}]  the first is the primary button; 'recheck' is the honest last one ("I did it, look again")
//   do: signin-app {agent,name,app} | signin-account {key,name} | google {agent} | screen {agent} | copy {cmd} | go {to} | recheck

// a label that does not say what it does, or is too long to read at a glance
export const VAGUE=/^(open|view|ok|okay|got it|review|details|see details|more|done|dismiss|close|continue|go|fix|fix it|check|click here|yes|submit)$/i;
export const vagueLabel=l=>{l=String(l??'').trim();return !l||VAGUE.test(l)||l.split(/\s+/).length>5};

const SIGN=/\b(sign(?:ed)?[ -]?in|sign(?:ed)? (?:back|again)|log(?:ged)?[ -]?in|log(?:ged)? back|re-?authori[sz]e|authori[sz]e|re-?connect|oauth|click allow|consent)\b/i;
const word=(t,w)=>new RegExp('(^|[^a-z0-9])'+String(w).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)','i').test(t);
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
const PROVIDERS=['chatgpt','codex','antigravity','claude','anthropic','gemini','copilot','openrouter','kimi','qwen','deepseek','minimax','zai'];

// the connected apps (access.list('mcp') items: {id,label,users:[{id,name,signed}]}) the text is about, best match first
export function appsFor(text,mcp=[]){const t=String(text||'').toLowerCase();
 const exact=mcp.filter(m=>word(t,m.id)||m.label&&m.label.length>2&&word(t,String(m.label).toLowerCase()));
 if(exact.length)return exact.slice(0,3);
 const pre=mcp.filter(m=>{const h=String(m.id).toLowerCase().split(/[-_ .]/)[0];return h.length>2&&word(t,h)});
 return pre.slice(0,1)}
// which agent signs in: the one the item is about when it has the app, else one that is not signed in, else the first that has it
export function agentFor(m,agent){const u=m.users||[];if(agent&&u.some(x=>x.id===agent))return agent;return (u.find(x=>!x.signed)||u[0])?.id||agent||'default'}

export function issueActs(i,ctx={}){const need=String(i?.need||''),text=[need,i?.title,i?.missing].filter(Boolean).join(' '),acts=[],agent=i?.agent||'default';
 if(SIGN.test(text)||/\bconnect\b/i.test(need)){
  for(const m of appsFor(text,ctx.mcp))acts.push({do:'signin-app',agent:agentFor(m,agent),name:m.id,app:m.label||cap(m.id),label:'Sign in to '+(m.label||cap(m.id)).split(/\s[·(-]/)[0].slice(0,24)});
  if(!acts.length){const t=text.toLowerCase();
   for(const a of ctx.accounts||[]){if(a.key==='exhausted')continue;const n=String(a.name||'').toLowerCase();if(n&&t.includes(n)||PROVIDERS.some(p=>n.includes(p)&&word(t,p)))acts.push({do:'signin-account',key:a.key,name:a.name,label:'Sign in to '+String(a.name).slice(0,24)})}}
  if(!acts.length&&/\bgoogle\b/i.test(text)&&/\b(sheets?|drive|docs?|gmail|calendar|account)\b/i.test(text))acts.push({do:'google',agent,label:'Connect Google'});
  if(!acts.length&&/\b(browser|screen|website|site|page|dashboard|kirimdev|take over|session)\b/i.test(text)&&!/\b(models?|accounts?) ›|aqeelOS Models/i.test(text))acts.push({do:'screen',agent,label:'Sign in on screen'});
  if(!acts.length&&/Models › Accounts/i.test(text))acts.push({do:'go',to:'/models/accounts',label:'Open Accounts'})}
 const cmd=/`([^`\n]{6,200})`/.exec(need)?.[1];if(cmd&&/\s/.test(cmd)&&!acts.length)acts.push({do:'copy',cmd,label:'Copy the command'});
 acts.push({do:'recheck',label:'Check again'});return acts}

// the same for a Bottlenecks item the popup shows (an agent's report, a fixer message, merged app sign-ins): its sentence is x.ask
export function itemActs(x,ctx={}){if(x?.kind==='apps'){const t=String(x.title||'').replace(/ needs? a sign-in$/,'').split(/, | and /).map(s=>s.trim().toLowerCase()).filter(Boolean),out=[];
  for(const a of t){const m=appsFor(a,ctx.mcp)[0];if(m)out.push({do:'signin-app',agent:agentFor(m,x.agent),name:m.id,app:m.label||cap(a),label:'Sign in to '+cap(a)})}return out}
 return issueActs({need:x?.ask||x?.text,title:x?.title,missing:x?.missing,agent:x?.agent},ctx).filter(a=>a.do!=='recheck')}
