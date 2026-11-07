// Everything an agent makes has a plain name and one line on what it is for (owner, 7 Nov 2026: "make sure in general
// all agents do this when they create a connection, skill or anything"). Checked in code at each aqeelOS tool that
// makes something; the engine's own skill and schedule tools are checked by the engine plugin engine/aqeelos-names.
// A call without them is refused with a short message saying what to add, and the agent calls again.
const words=s=>String(s||'').trim().split(/\s+/).filter(Boolean).length;
export const okName=s=>{s=String(s||'').trim();return s.length>=3&&s.length<=80&&!/^[A-Z0-9_]+$/.test(s)};   // not an env-style id
export const okDesc=s=>{s=String(s||'').trim();return s.length>=12&&s.length<=300&&words(s)>=3};
const ask=(what,fields,again)=>'Not done yet: add '+fields.join(' and ')+' for this '+what+', then call '+again+' again. Plain words, one line each.';
const NAME_F='a plain name ("label", e.g. "GitHub token for acme-dev")';
const KEY_D='a one-line "description" of what it is for and which account or user it belongs to';
// one rule per tool: the arguments → null when fine, else the refusal text
export const NAME_RULES={
 ask_secret:a=>a.mode!=='save'?null:check(a,'label','description','key','ask_secret',KEY_D),
 request_secret_link:a=>check(a,'label','description','key','request_secret_link',KEY_D),
 register_account:a=>check(a,'label','description','login','register_account','a one-line "description" of what it is for and whose account it is'),
 organize_schedule:a=>a.summary===undefined||okDesc(a.summary)?null:'Not done yet: "summary" must be one plain sentence on what the schedule does and why, then call organize_schedule again.'};
function check(a,nf,df,what,tool,descText){const miss=[];if(!okName(a[nf]))miss.push(NAME_F.replace('"label"','"'+nf+'"'));if(!okDesc(a[df]))miss.push(descText);return miss.length?ask(what,miss,tool):null}
export function nameRefusal(tool,args){const r=NAME_RULES[tool];return r?r(args&&typeof args==='object'?args:{}):null}
// the schema fields the rules need, added to each tool's inputSchema in tools/list so the agent sees them up front
export const NAME_FIELDS={
 ask_secret:{description:{type:'string',description:'For save (required): one line on what it is for and which account or user it belongs to, e.g. "GitHub token for the acme-dev account, repo access, for pushing code"'}},
 request_secret_link:{description:{type:'string',description:'Required: one line on what it is for and which account or user it belongs to'}},
 register_account:{description:{type:'string',description:'Required: one line on what it is for and whose account it is'}}};
export function addNameFields(tools){for(const t of tools||[]){const f=NAME_FIELDS[t?.name];if(!f||!t.inputSchema)continue;t.inputSchema.properties={...(t.inputSchema.properties||{}),...f};
  if(t.name!=='ask_secret'){const req=new Set(t.inputSchema.required||[]);for(const k of ['label','description'])req.add(k);t.inputSchema.required=[...req]}}
 return tools}

// Health: what an agent has that still has no plain description (pure; tested). skills: [{name,desc}] from its own
// SKILL.md files; keys: the Keys list items it holds; labels: every label (built in and set). Each item says how to fix it.
export function namesMissing({skills=[],keys=[],labels={}}={}){const out=[];
 for(const s of skills){const l=labels['skill:'+s.name];if(okDesc(l?.description)||okDesc(s.desc))continue;out.push({kind:'skill',id:s.name,what:'Skill '+s.name+' has no clear one-line description'})}
 for(const k of keys){const l=labels['key:'+k.id];if(okDesc(l?.description)||okDesc(k.note?.description))continue;out.push({kind:'key',id:k.id,what:'Key '+k.name+(k.account?' ('+k.service+': '+k.account+')':'')+' has no description of what it is for'})}
 return out}
// the agent's own run that fills them in: plain, no owner, no customers
export function namesPrompt(items){return 'aqeelOS found things you have that people cannot recognise, because they have no plain name or description. Fix them yourself now, without asking anyone.\n\n'+
 items.slice(0,15).map(x=>'- '+x.what+' (kind '+x.kind+', id '+x.id+')').join('\n')+
 '\n\nFor each one, find out what it is really for (your instructions, skills, scripts, schedules and recent chats; for a key, the Keys line shows its account), then call name_thing with its kind and id, a plain name and one line on what it is for (for a key, which account or user it belongs to). Do not message the owner or customers. If you truly cannot tell what one is for, skip it. End with one line per item: its new name.'}
