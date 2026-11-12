// Agents as a shared resource (Nov 2026, workstream D). One agent can look after another at a level, using the
// same sharing levels as accounts and secrets (sharing.mjs, resource type "agent", id = the agent's name):
//   owner   - everything below, plus share at any level below owner, hand over, delete
//   manager - edit instructions, skills, schedules and settings; share this agent as editor or viewer
//   editor  - edit instructions, skills and schedules; no settings, no keys, no sharing
//   viewer  - read its setup and its logs
//   none    - nothing (the default)
// Every agent owns itself. The main agent (MAIN_AGENT, default "default") is the one main agent: it acts as the owner of
// every agent, and it alone may change keys, permissions and aqeelOS itself. No level ever shows another agent's keys:
// a key is shared on its own (resource type "secret").
// The check happens here, server-side, on every call of the one tool that writes another agent's files or settings
// (manage_agent, aqeelos-notify). Agents of a team run as their own system user and cannot reach another agent's
// folder any other way. Every change goes through onChange (agent-versions.mjs, when present) so it is attributed and
// can be undone there.
// Main agent rule: when the main agent edits another agent's own work, the answer reminds it to give that agent the
// access it lacks instead (a reminder, not a block: the owner may still ask for a direct fix).
import {readFile,writeFile,mkdir,readdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {TOOL_HELP,TOOL_PROPS} from './design-guard.mjs';
import {rank,base,AGENT} from './sharing.mjs';import {ownSettingProblem,ownSettingKey} from './agent-settings.mjs';

// the least level each part of manage_agent needs on the target agent
export const AGENT_NEEDS={show:'viewer',logs:'viewer',instructions:'editor',skill:'editor',schedule:'editor',settings:'manager',share:'manager'};
// settings that are about keys, permissions or aqeelOS itself: the main agent only, whatever the level
export const MAIN_ONLY_SETTING=/(^|\.)(env|headers|auth|api_key|apikey|token|tokens|secret|secrets|password|credentials?|oauth|client_secret)(\.|$)|key$|^mcp_servers\b|^approvals\b|^security\b|^terminal\b|^platforms?\b|^plugins\b|^gateway\b|^providers?\b|^model\.(base_url|api_key)/i;
const SECRETISH=/(key|token|secret|password|passwd|credential|bearer|cookie|session|auth|sig)/i;
const NAME=/^[a-z0-9][a-z0-9._-]{0,63}$/;

export const MAIN_RULE_LINES=[
 '','## Main agent rule','',
 'You are the main agent: the only one that changes aqeelOS itself, other agents, keys, permissions, money and deletions. When another agent has a problem, do not fix that agent\'s work for it. Give it what it lacks (a tool, a connection, a setting, a level on something with manage_agent share), so it can fix the problem itself.',
 'Supervision: when an admin asks how the team is using aqeelOS, use team_view (overview, list, read chats, where things are; every agent, private ones too; each lookup is logged). For anything else, such as people\'s files, agents\' work, schedules or Code projects, use your own tools. Never repeat the value of a key or password. If team_view refuses, say why and do not work around it with your terminal.',
 'When a person (the owner or someone on the team) tells you about a problem with another agent: 1) check what access or tools that agent lacks for it (manage_agent show, its logs, its settings); 2) give it exactly that; 3) answer the person along these lines: "I have given <agent> the access it needs to fix this itself (<what you gave it>). Please ask <agent> directly in its chat or topic to fix it now." If it already had everything it needs, say so and send the person to that agent the same way.',
 'Then tell that agent too (in its own chat or topic) what it now has and that it should fix the problem. Do the fix yourself only when the owner explicitly asks you to fix it directly, or when it is aqeelOS code that no agent can reach.'];

// Conflict rule (11 Nov 2026, owner): with ANY conflict, two sides or more, the agent asks and never picks. In every agent's turn.
export const CONFLICT_RULE_LINES=[
 '','## Conflicts: ask, never pick','',
 'If two or more things disagree (instructions, saved decisions, a schedule prompt against Run rules or posting limits, people asking for different things, a request against a policy or a tool limit, what you were told against what you see, a skill against your instructions, a new request against an earlier one), do not choose. Ask the person who gave the instructions (the owner when people disagree): "You said A (where, when) and B (where, when), and C. What should I do?" List every side, one choice per side and "something else"; one question for all conflicts on a topic. Also call file_conflict so it shows on Health until answered. Until it is answered, follow the strictest side: never post, send, spend or delete more than any side allows. When answered, write the answer in one place (your decisions file; timing and limits in Run rules), delete every losing version, then call conflict_done.'];

// what an agent's own answer from manage_agent says to the main agent when it changes another agent's own work
export const MAIN_RULE_NOTE='Main agent rule: this was another agent\'s own work. Unless the owner asked you to fix it directly, give that agent the access it lacks instead (manage_agent share, a tool, a connection) and tell it in its own chat or topic to fix it itself.';

// a config read back without anything that could be a key (values of secret-looking names, env, headers, urls with tokens)
export function redact(v,k=''){if(v==null)return v;if(SECRETISH.test(k)&&typeof v!=='object')return '(hidden)';
 if(Array.isArray(v))return v.map(x=>redact(x,k));
 if(typeof v==='object'){const o={};for(const [kk,vv] of Object.entries(v)){if(/^(env|headers)$/i.test(kk)){o[kk]='(hidden)';continue}o[kk]=redact(vv,kk)}return o}
 if(typeof v==='string'&&/^https?:\/\//.test(v))return v.replace(/\/\/[^/@]+@/,'//(hidden)@').replace(/([?&][^=]*(key|token|secret|sig)[^=]*=)[^&]+/gi,'$1(hidden)').replace(/\/([A-Za-z0-9_-]{24,})(?=\/|$)/g,'/(hidden)');
 return v}
// log lines without keys (long tokens, key=value pairs of secret-looking names)
export const redactText=t=>String(t).replace(/\b(sk|xox[abpr]|ghp|gho|ya29|AIza)[-_A-Za-z0-9.]{8,}/g,'(hidden)').replace(/((?:key|token|secret|password|authorization|bearer)["']?\s*[:=]\s*["']?)[^\s"',]+/gi,'$1(hidden)').replace(/\b[A-Za-z0-9_-]{40,}\b/g,'(hidden)');

export function createAgentAccess({guard=()=>null,sharing,HERMES_HOME,listAgents=async()=>[],MAIN='default',instructions=null,readConfig=async()=>null,setKey=async()=>({ok:false,out:'no settings'}),
 cron=null,versions=null,reload=async()=>{},names=a=>a,
 mainLike=()=>false,   // F: agents acting with main-agent power (the lead of an admin person), read live on every call
 scope=()=>null,
 ownerLike=()=>false}={}){   // F: (caller,target) -> true when the caller is the lead of the person who owns target (Owner level)   // F: (caller,target,part) -> null, or why a caller's person may not do this (their role decides)
 const home=a=>a===MAIN||a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const isMain=a=>base(a)===MAIN||!!mainLike(base(a));
 // every agent owns itself; made the first time anyone asks, so a new agent is covered at once
 async function ensure(a){a=base(a);if(!AGENT.test(a))throw new Error('Give the agent id, like cove-support.');if(!await stat(path.join(home(a),'config.yaml')).catch(()=>null)&&a!=='default')throw new Error('There is no agent called '+a+'.');
  if(!await sharing.exists('agent',a))await sharing.claim('agent',a,a,{label:names(a),by:'aqeelOS'});return a}
 // the level `actor` has on agent `target` (itself and the main agent: owner)
 async function levelOn(actor,target){const me=base(actor),t=base(target);if(me===t||isMain(me)||ownerLike(me,t))return 'owner';await ensure(t);return sharing.levelOf('agent',t,me)}
 async function check(actor,target,part){const need=AGENT_NEEDS[part];if(!need)throw new Error('Unknown part '+part);const level=await levelOn(actor,target);const ok=rank(level)>=rank(need);
  return {ok,level,need,why:ok?'':(level==='none'?names(base(target))+' is not shared with you. The main agent or its owner can share it with you.':'You have '+level+' access to '+names(base(target))+'; this needs '+need+'.')}}
 // the agents this one looks after (for its own context), never itself
 async function managed(actor){const me=base(actor);if(isMain(me))return [];return (await sharing.forAgent(me)).filter(r=>r.type==='agent'&&r.id!==me).map(r=>({agent:r.id,level:r.level}))}
 const record=async e=>{try{await versions?.record?.(e)}catch(err){console.warn('agent-access: versions hook',err.message)}};

 async function show(t){const c=await readConfig(t)||{};const skills=[];
  const walk=async(d,rel='')=>{for(const e of await readdir(d,{withFileTypes:true}).catch(()=>[])){if(!e.isDirectory()||e.name.startsWith('.'))continue;const r=rel?rel+'/'+e.name:e.name;
   if(await stat(path.join(d,e.name,'SKILL.md')).catch(()=>null))skills.push(r);else if(r.split('/').length<3)await walk(path.join(d,e.name),r)}};
  await walk(path.join(home(t),'skills'));
  let jobs=[];try{jobs=(await cron?.list(t)||[]).map(j=>({id:j.id,name:j.name,schedule:j.schedule_display||j.schedule?.display||j.schedule,paused:!!(j.paused||j.state==='paused'),deliver:j.deliver}))}catch{}
  const cfg=redact({model:c.model,platform_toolsets:c.platform_toolsets,agent:{disabled_toolsets:c.agent?.disabled_toolsets},mcp_servers:Object.fromEntries(Object.entries(c.mcp_servers||{}).map(([k,v])=>[k,{enabled:v?.enabled!==false}])),timezone:c.timezone,approvals:c.approvals});
  return 'Setup of '+names(t)+' ('+t+'). Keys are never shown here; a key is shared on its own.\n\nSettings:\n'+JSON.stringify(cfg,null,1)+'\n\nSkills ('+skills.length+'): '+(skills.join(', ')||'none')+'\n\nSchedules ('+jobs.length+'):\n'+(jobs.map(j=>'- '+j.id+' '+JSON.stringify(j.name)+' '+(j.schedule||'')+(j.paused?' (paused)':'')).join('\n')||'none')}
 async function logs(t,a){const f=a.file==='errors'?'errors.log':a.file==='gateway'?'gateway.log':'agent.log';const n=Math.min(Math.max(Number(a.lines)||80,1),400);
  const txt=await readFile(path.join(home(t),'logs',f),'utf8').catch(()=>null);if(txt==null)return 'No '+f+' for '+names(t)+'.';
  return 'Last '+n+' lines of '+names(t)+'\'s '+f+' (keys hidden):\n'+redactText(txt.split('\n').slice(-n-1).join('\n'))}

 async function skill(t,a,by){const cat=String(a.category||'').trim(),nm=String(a.name||'').trim();if(!NAME.test(nm)||(cat&&!NAME.test(cat)))return {isError:true,text:'Give the skill name (and category) in lowercase letters, digits and dashes.'};
  const dir=path.join(home(t),'skills',...(cat?[cat]:[]),nm),f=path.join(dir,'SKILL.md');const before=await readFile(f,'utf8').catch(()=>null);
  if(a.remove){if(before==null)return {isError:true,text:'That skill does not exist on '+names(t)+'.'};const gone=path.join(home(t),'skills-removed');await mkdir(gone,{recursive:true});await rename(dir,path.join(gone,(cat?cat+'--':'')+nm+'-'+Date.now()));
   await record({agent:t,kind:'skill',id:(cat?cat+'/':'')+nm,by,before,after:null,why:a.why});return {text:'Moved the skill '+nm+' of '+names(t)+' to its removed skills (it can be brought back).'}}
  const content=String(a.content||'');if(!/^---\r?\n(?:[\s\S]*?\n)?name:/.test(content))return {isError:true,text:'content must be the whole SKILL.md, starting with its --- front matter (name, description).'};
  await mkdir(dir,{recursive:true});const tmp=f+'.'+process.pid+'.tmp';await writeFile(tmp,content);await rename(tmp,f);
  await record({agent:t,kind:'skill',id:(cat?cat+'/':'')+nm,by,before,after:content,why:a.why});return {text:(before==null?'Added':'Updated')+' the skill '+nm+' on '+names(t)+'. It is used from its next chat.'}}

 async function schedule(t,a,by){if(!cron)return {isError:true,text:'Schedules cannot be reached right now.'};const op=String(a.op||'').trim();const id=String(a.job_id||'').trim();
  const mine=async()=>{const j=(await cron.list(t)).find(x=>x.id===id);if(!j)throw new Error('No schedule '+id+' on '+names(t)+'.');return j};
  // create and update go through the design guard first (design-guard.mjs before), as my_schedules does
  const G=guard(),design={...Object.fromEntries(['script','keep','drop','prefix','checks','check_script','on_event','accept_cost','why','schedule','prompt','deliver'].filter(k=>a[k]!=null).map(k=>[k,a[k]])),...(a.title!=null?{name:a.title}:{})},none={body:{},after:async()=>[]},tail=n=>n.length?'\n\n'+n.join('\n'):'';
  if(op==='create'){const g=G?await G.before(t,{...design,action:'create'},null,{tool:'manage_agent',by:by.name}):none;if(g.refuse)return {isError:true,text:g.refuse};if(g.done){await record({agent:t,kind:'schedule',id:'hook',by,before:null,after:{on_event:a.on_event,script:a.script},why:a.why});return {text:g.done}}
   if(!a.schedule||!(a.prompt||g.body.prompt))return {isError:true,text:'Give schedule (like "every 2h" or a cron line) and prompt, or script for a schedule with no AI.'};const r=await cron.create(t,{name:String(a.title||'').slice(0,80),schedule:String(a.schedule),prompt:String(a.prompt||''),deliver:a.deliver||'local',...g.body}),j=r?.job||r;
   const notes=await g.after(j).catch(e=>['aqeelOS could not finish setting it up: '+e.message+'.']);
   await record({agent:t,kind:'schedule',id:j?.id,by,before:null,after:{name:a.title,schedule:a.schedule,prompt:a.prompt,...g.body},why:a.why});return {text:'Made the schedule '+JSON.stringify(a.title||'')+' on '+names(t)+' ('+(j?.id||'?')+').'+tail(notes)}}
  if(!id)return {isError:true,text:'Give job_id (from manage_agent show).'};const before=await mine();
  let notes=[];
  if(op==='update'){const u={};for(const k of ['name','schedule','prompt','deliver'])if(a[k==='name'?'title':k]!=null)u[k]=String(a[k==='name'?'title':k]);
   const g=G?await G.before(t,{...design,action:'edit'},before,{tool:'manage_agent',by:by.name}):none;if(g.refuse)return {isError:true,text:g.refuse};Object.assign(u,g.body);
   if(!Object.keys(u).length&&!['script','checks','check_script','on_event'].some(k=>a[k]!=null))return {isError:true,text:'Say what to change: title, schedule, prompt, deliver, script, checks, check_script or on_event.'};
   if(Object.keys(u).length)await cron.update(t,id,u);notes=await g.after({...before,...u}).catch(e=>['aqeelOS could not finish setting it up: '+e.message+'.'])}
  else if(op==='pause'||op==='resume')await cron[op](t,id);else if(op==='delete')await cron.remove(t,id);else return {isError:true,text:'op must be create, update, pause, resume or delete.'};
  await record({agent:t,kind:'schedule',id,by,before,after:op==='delete'?null:{op},why:a.why});return {text:'Schedule '+id+' of '+names(t)+': '+op+' done.'+tail(notes)}}

 // manage_agent: the one way an agent changes another agent. args: {agent, part, ...}
 async function call(caller,args={}){const me=base(caller);let t;try{t=await ensure(String(args.agent||'').trim())}catch(e){return {isError:true,text:e.message}}
  const part=String(args.part||'show').trim();if(!AGENT_NEEDS[part])return {isError:true,text:'part must be one of: '+Object.keys(AGENT_NEEDS).join(', ')+'.'};
  const sc=scope(me,t,part);if(sc){console.log('agent-access: refused by role',me,'->',t,part);return {isError:true,text:sc}}
  const c=await check(me,t,part);if(!c.ok){console.log('agent-access: refused',me,'->',t,part,'('+c.level+')');return {isError:true,text:c.why}}
  const by={agent:me,name:names(me),level:c.level};const other=me!==t;const say=r=>({...r,text:r.text+(other&&isMain(me)&&!r.isError&&['instructions','skill','schedule'].includes(part)?'\n\n'+MAIN_RULE_NOTE:'')});
  try{
   if(part==='show')return {text:await show(t)};
   if(part==='logs')return {text:await logs(t,args)};
   if(part==='instructions'){if(!instructions)return {isError:true,text:'Instructions cannot be reached right now.'};const r=await instructions.change(t,args,{by:names(me)+(other?' (for '+names(t)+', '+c.level+')':'')});
    if(!r.isError)await record({agent:t,kind:'instructions',by,why:args.why});return say({...r,text:other?String(r.text).replace(/your instructions/g,names(t)+'\'s instructions').replace(/your history/g,'its history'):r.text})}
   if(part==='skill')return say(await skill(t,args,by));
   if(part==='schedule')return say(await schedule(t,args,by));
   if(part==='settings'){const key=String(args.key||'').trim();if(!/^[a-z0-9_.-]{1,120}$/i.test(key))return {isError:true,text:'Give the setting key, like timezone or platform_toolsets.telegram.'};
    // Only the main agent (the box's own user already) reads or writes any setting. Every other agent, on itself as on an agent it
    // manages, is held to the exact list of plain settings in agent-settings.mjs: the engine runs commands found in its settings
    // (apps, voice providers, hooks) as the box's user (audit CR-2, 12 Nov 2026).
    if(!isMain(me)){const why=args.value===undefined?(ownSettingKey(key)?null:'Not one of the settings an agent reads this way.'):ownSettingProblem(key,args.value);if(why)return {isError:true,text:key+': '+why+(MAIN_ONLY_SETTING.test(key)?' It is about keys, permissions or aqeelOS itself: only the main agent changes that.':'')}}
    if(args.value===undefined){const cfg=await readConfig(t);const v=key.split('.').reduce((x,y)=>x&&typeof x==='object'?x[y]:undefined,cfg);return {text:key+' = '+JSON.stringify(redact(v,key.split('.').pop())??null)}}
    const before=(await readConfig(t))||{};const r=await setKey(t,key,args.value===null?'':args.value).catch(e=>({ok:false,out:e.message}));if(!r.ok)return {isError:true,text:'Could not change it: '+String(r.out||'').trim().slice(-300)};
    await record({agent:t,kind:'settings',id:key,by,before:key.split('.').reduce((x,y)=>x&&typeof x==='object'?x[y]:undefined,before)??null,after:args.value,why:args.why});await reload(names(me)+' changed '+key+' of '+names(t)).catch(()=>{});
    return {text:'Saved '+key+' on '+names(t)+'. It takes effect once aqeelOS reloads the agents (no reply running).'}}
   if(part==='share'){const to=base(String(args.to||'').trim()),lv=String(args.level||'').toLowerCase();if(!AGENT.test(to))return {isError:true,text:'Give to: the agent id to share with.'};if(to===t)return {isError:true,text:'That is the agent itself.'};
    const actor=isMain(me)?{person:'main agent '+me,admin:true}:{agent:me};
    try{const r=await sharing.share('agent',t,actor,to,lv);await record({agent:t,kind:'access',id:to,by,before:r.from,after:lv,why:args.why});return {text:names(to)+' now has '+lv+' access to '+names(t)+' (was '+r.from+').'}}catch(e){return {isError:true,text:e.message}}}
  }catch(e){return {isError:true,text:e.message}}}

 // the tool as agents see it
 const TOOL={name:'manage_agent',description:'Look after another agent you have access to (or yourself): read its setup or logs, change its instructions, skills or schedules, change its settings, or share it with another agent. What you may do depends on your level on that agent: viewer reads its setup and logs; editor also changes its instructions, skills and schedules; manager also changes its settings and shares it as editor or viewer; owner can do everything. Its keys are never shown. Every change is kept in its history with your name and can be undone. For a schedule:'+TOOL_HELP,
  inputSchema:{type:'object',properties:{agent:{type:'string',description:'the agent id, like cove-support'},part:{type:'string',enum:Object.keys(AGENT_NEEDS)},
   edits:{type:'array',items:{type:'object',properties:{old_text:{type:'string'},new_text:{type:'string'}}},description:'instructions: exact old text and its replacement for each place'},rewrite:{type:'string',description:'instructions: the whole new text (applies at once, can be undone)'},why:{type:'string',description:'what changes and why (kept in its history)'},said_by:{type:'string'},
   name:{type:'string',description:'skill: its name'},category:{type:'string',description:'skill: its folder, like productivity'},content:{type:'string',description:'skill: the whole SKILL.md'},remove:{type:'boolean'},
   op:{type:'string',enum:['create','update','pause','resume','delete'],description:'schedule'},job_id:{type:'string'},title:{type:'string'},schedule:{type:'string'},prompt:{type:'string'},deliver:{type:'string'},...Object.fromEntries(Object.entries(TOOL_PROPS).map(([k,v])=>[k,{...v,description:'schedule: '+v.description}])),
   key:{type:'string',description:'settings: the key (leave value out to read it)'},value:{description:'settings: the new value'},
   to:{type:'string',description:'share: the agent to share with'},level:{type:'string',enum:['manager','editor','viewer','none']},file:{type:'string',enum:['agent','errors','gateway']},lines:{type:'number'}},required:['agent','part']}};
 return {ensure,levelOn,check,managed,call,TOOL,isMain,MAIN}}
