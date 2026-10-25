// Customize dialog: saved prompts (slash commands), skills, hooks and scheduled runs, shared by Claude and GPT.
// Also the Diagnostics dialog (tool versions, sign-in state, recent errors).
import {confirmDialog} from './ui-kit.js';
import {renderMarkdown} from './md.js';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const when=t=>t?new Date(t).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const EVENTS={'run-start':['Before a run','A failing command (non-zero exit) stops the run.'],'files-changed':['After files change','$env:CBA_FILES / $CBA_FILES lists the changed files.'],'run-finished':['After a run finishes','$CBA_STATUS is complete, stopped or failed.']};
const EVERY={hour:'Every hour',day:'Every day',weekday:'Weekdays',week:'Every week'};
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function shell(title,{wide}={}){const d=el('dialog','kit-dialog custom-dialog'+(wide?' wide':''));const head=el('div','custom-head');head.append(el('h2','',title));const close=el('button','dialog-x','×');close.type='button';close.setAttribute('aria-label','Close');close.title='Close';head.append(close);
 const body=el('div','custom-body');d.append(head,body);document.body.append(d);d.showModal();const shut=()=>{d.close();setTimeout(()=>d.remove(),180)};close.onclick=shut;d.addEventListener('cancel',e=>{e.preventDefault();shut()});return {d,body,shut}}
const input=(value,attrs={})=>{const i=el('input');i.value=value??'';Object.assign(i,attrs);return i};
const select=(value,opts,label)=>{const s=el('select');for(const [v,t] of opts)s.append(new Option(t,v));s.value=value;if(label)s.setAttribute('aria-label',label);return s};
const labelled=(text,control)=>{const l=el('label','custom-field');l.append(el('span','',text),control);return l};

export function openCustomize(ctx,start='prompts'){
 const {body,shut}=shell('Customize',{wide:true});let data=null;
 const tabs=el('div','custom-tabs');tabs.setAttribute('role','tablist');const panel=el('div','custom-panel');panel.setAttribute('role','tabpanel');body.append(tabs,panel);
 const NAMES={prompts:'Saved prompts',skills:'Skills',hooks:'Hooks',schedules:'Schedules'};let current=start;
 for(const [k,t] of Object.entries(NAMES)){const b=el('button','custom-tab',t);b.type='button';b.setAttribute('role','tab');b.dataset.tab=k;b.onclick=()=>{current=k;paint()};tabs.append(b)}
 async function load(){try{data=await ctx.api('/extensions?projectId='+(ctx.projectId()||''));paint()}catch(e){panel.replaceChildren(el('p','kit-message',e.message))}}
 const save=async(patch,msg)=>{try{await ctx.api('/extensions',patch);ctx.notify(msg);ctx.changed?.();await load();return true}catch(e){ctx.notify(e.message);return false}};
 function paint(){for(const b of tabs.children){const on=b.dataset.tab===current;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on))}panel.replaceChildren();({prompts,skills,hooks,schedules})[current]()}

 function prompts(){panel.append(el('p','kit-message','Type / in the message box to use a prompt. Prompts in a project\'s .claude/commands or .codex/prompts folder (and your home folder) are listed too. Write $ARGUMENTS where your own text should go.'));
  const list=el('div','custom-list');const items=data.prompts.map(p=>({...p}));
  const paintList=()=>{list.replaceChildren(...items.map((p,i)=>{const row=el('div','custom-row');const name=input(p.name,{placeholder:'name'});name.setAttribute('aria-label','Prompt name');name.oninput=()=>p.name=name.value;
   const text=el('textarea');text.rows=3;text.value=p.text;text.placeholder='The prompt text';text.setAttribute('aria-label','Prompt text');text.oninput=()=>p.text=text.value;
   const x=el('button','','Remove');x.type='button';x.onclick=()=>{items.splice(i,1);paintList()};const top=el('div','custom-row-top');top.append(el('span','custom-slash','/'),name,x);row.append(top,text);return row}));if(!items.length)list.append(el('p','kit-message small-print','No saved prompts yet.'))};
  paintList();const add=el('button','','Add prompt');add.type='button';add.onclick=()=>{items.push({name:'',text:''});paintList();list.querySelector('.custom-row:last-child input')?.focus()};
  const ok=el('button','primary','Save prompts');ok.type='button';ok.onclick=()=>save({prompts:items},'Prompts saved.');const actions=el('div','custom-actions');actions.append(add,ok);panel.append(list,actions);
  const files=data.commandFiles.filter(p=>p.source!=='Saved');if(files.length){panel.append(el('h3','','From command files'));const f=el('div','custom-list compact');for(const p of files){const r=el('div','custom-line');r.append(el('code','','/'+p.name),el('span','',p.description),el('small','',p.source));f.append(r)}panel.append(f)}}

 function skills(){panel.append(el('p','kit-message','Skills are folders with a SKILL.md. Both AIs see each enabled skill\'s name and description, and read the full instructions when a request needs them. Add skills to .claude/skills in a project or in your home folder.'));
  if(!data.skills.length){panel.append(el('p','kit-message small-print','No skills found in this project, ~/.claude/skills or ~/.codex/skills.'));return}
  const off=new Set(data.skills.filter(s=>!s.enabled).map(s=>s.name));const list=el('div','custom-list compact');
  for(const s of data.skills){const r=el('label','custom-line skill');const box=el('input');box.type='checkbox';box.setAttribute('role','switch');box.checked=s.enabled;box.onchange=()=>{box.checked?off.delete(s.name):off.add(s.name)};const t=el('span');t.append(el('strong','',s.name),el('small','',s.description||'No description'));r.append(box,t,el('small','',s.source));r.title=s.path;list.append(r)}
  const ok=el('button','primary','Save skills');ok.type='button';ok.onclick=()=>save({disabledSkills:[...off]},'Skills saved.');const actions=el('div','custom-actions');actions.append(ok);panel.append(list,actions)}

 function hooks(){panel.append(el('p','kit-message','Hooks run a command in the project folder when something happens, for example a formatter after files change. They run on this computer with your permissions, so only add commands you trust. Each hook shows in the run timeline.'));
  const items=data.hooks.map(h=>({...h}));const list=el('div','custom-list');
  const paintList=()=>{list.replaceChildren(...items.map((h,i)=>{const row=el('div','custom-row');const top=el('div','custom-row-top');const ev=select(h.event,Object.entries(EVENTS).map(([k,v])=>[k,v[0]]),'When');ev.onchange=()=>{h.event=ev.value;hint.textContent=EVENTS[h.event][1]};
   const on=el('input');on.type='checkbox';on.checked=h.enabled!==false;on.setAttribute('role','switch');on.setAttribute('aria-label','Enabled');on.onchange=()=>h.enabled=on.checked;const x=el('button','','Remove');x.type='button';x.onclick=()=>{items.splice(i,1);paintList()};top.append(ev,on,x);
   const cmd=input(h.command,{placeholder:'Command, e.g. npx prettier --write .'});cmd.setAttribute('aria-label','Command');cmd.oninput=()=>h.command=cmd.value;const hint=el('small','custom-hint',EVENTS[h.event][1]);row.append(top,cmd,hint);return row}));if(!items.length)list.append(el('p','kit-message small-print','No hooks yet.'))};
  paintList();const add=el('button','','Add hook');add.type='button';add.onclick=()=>{items.push({event:'files-changed',command:'',enabled:true});paintList()};
  const ok=el('button','primary','Save hooks');ok.type='button';ok.onclick=async()=>{if(items.some(h=>h.enabled!==false&&!data.hooks.some(o=>o.command===h.command))&&!(await confirmDialog({title:'Save these hooks?',message:'Hook commands run automatically on this computer during AI runs, in every project.',confirm:'Save hooks'})))return;save({hooks:items},'Hooks saved.')};
  const actions=el('div','custom-actions');actions.append(add,ok);panel.append(list,actions)}

 function schedules(){panel.append(el('p','kit-message','Run a prompt on a schedule in a new chat, for example a daily dependency check. Runs happen while aqeelOS Code is open on this computer; a missed run happens once when it next starts. Scheduled runs use Plan only (read-only) or Auto-edit, never full access, and a Claude or ChatGPT model (they run with nobody signed in, so models on the aqeelOS engine cannot run them).'));
  const items=data.schedules.map(s=>({...s}));const list=el('div','custom-list');const projects=data.projects.map(p=>[p.id,p.name]);
  const paintList=()=>{list.replaceChildren(...items.map((s,i)=>{const row=el('div','custom-row');const top=el('div','custom-row-top');const name=input(s.name,{placeholder:'Name'});name.setAttribute('aria-label','Schedule name');name.oninput=()=>s.name=name.value;
   const on=el('input');on.type='checkbox';on.checked=s.enabled!==false;on.setAttribute('role','switch');on.setAttribute('aria-label','Enabled');on.onchange=()=>s.enabled=on.checked;const x=el('button','','Remove');x.type='button';x.onclick=()=>{items.splice(i,1);paintList()};top.append(name,on,x);
   const grid=el('div','custom-grid');const proj=select(s.projectId||projects[0]?.[0],projects,'Project');proj.onchange=()=>s.projectId=proj.value;s.projectId=proj.value;
   const every=select(s.every||'day',Object.entries(EVERY),'How often');const time=input(s.time||'09:00',{type:'time'});time.setAttribute('aria-label','Time');const day=select(String(s.day??1),DAYS.map((d,i)=>[String(i),d]),'Day');
   const syncDay=()=>{(day.closest('label')||day.parentElement).hidden=every.value!=='week';time.previousElementSibling&&(time.previousElementSibling.textContent=every.value==='hour'?'Minute past the hour':'Time')};every.onchange=()=>{s.every=every.value;syncDay()};time.onchange=()=>s.time=time.value;day.onchange=()=>s.day=Number(day.value);
   // the model, from aqeelOS's one list when paired (25 Oct 2026). A schedule runs with nobody signed in, so only
   // models with a CLI here (Claude Code, Codex) can run it; the aqeelOS engine needs the person, so it is not offered
   const os=[...(document.querySelector('#model-name optgroup[label="Models"]')?.querySelectorAll('option')||[])].filter(o=>!o.disabled&&/^(claude|codex):/.test(o.value)).map(o=>[o.value,o.textContent]);
   const ai=os.length?select(s.provider&&os.some(o=>o[0]===s.provider+':'+(s.model||''))?s.provider+':'+(s.model||''):os[0][0],os,'Model'):select(s.provider||'claude',[['claude','Claude'],['codex','GPT'],['gemini','Gemini']],'AI');
   const pickAi=()=>{if(os.length){const [h,...m]=ai.value.split(':');s.provider=h;s.model=m.join(':');s.effort=''}else s.provider=ai.value};ai.onchange=pickAi;const mode=select(s.mode||'plan',[['plan','Plan (read-only)'],['auto','Auto-edit']],'Permission');mode.onchange=()=>s.mode=mode.value;
   Object.assign(s,{every:every.value,time:time.value,mode:mode.value});pickAi();
   grid.append(labelled('Project',proj),labelled('Repeat',every),labelled('Time',time),labelled('Day',day),labelled(os.length?'Model':'AI',ai),labelled('Permission',mode));
   const prompt=el('textarea');prompt.rows=3;prompt.value=s.prompt||'';prompt.placeholder='What should the AI do each time?';prompt.setAttribute('aria-label','Prompt');prompt.oninput=()=>s.prompt=prompt.value;
   const meta=el('div','custom-meta');if(s.id&&data.schedules.some(o=>o.id===s.id)){meta.append(el('span','','Next: '+(s.enabled!==false?when(s.next):'paused')),el('span','','Last: '+when(s.lastRun)));if(s.lastError)meta.append(el('span','custom-error',s.lastError));
    if(s.lastChat){const open=el('button','link-button','Open last run');open.type='button';open.onclick=()=>{shut();ctx.openChat(s.projectId,s.lastChat)};meta.append(open)}
    const now=el('button','link-button','Run now');now.type='button';now.onclick=async()=>{try{const r=await ctx.api('/schedules/run',{id:s.id});shut();ctx.notify('Started '+s.name+'.');ctx.openChat(r.projectId,r.chatId)}catch(e){ctx.notify(e.message)}};meta.append(now)}
   row.append(top,grid,prompt,meta);queueMicrotask(syncDay);return row}));if(!items.length)list.append(el('p','kit-message small-print','No schedules yet.'))};
  paintList();const add=el('button','','Add schedule');add.type='button';add.disabled=!projects.length;add.onclick=()=>{items.push({name:'',projectId:ctx.projectId()||projects[0]?.[0],every:'day',time:'09:00',day:1,provider:'claude',mode:'plan',prompt:'',enabled:true});paintList()};
  const ok=el('button','primary','Save schedules');ok.type='button';ok.onclick=()=>save({schedules:items.map(({next,lastRun,lastChat,lastError,...s})=>s)},'Schedules saved.');const actions=el('div','custom-actions');actions.append(add,ok);panel.append(list,actions)}

 panel.append(el('p','kit-message','Loading…'));load();
}

export async function openDiagnostics(ctx){const {body}=shell('Diagnostics');body.append(el('p','kit-message','Checking…'));
 try{const r=await ctx.api('/diagnostics');const rows=el('div','diag-list');
  const line=(label,value,state)=>{const row=el('div','diag-row'+(state?' '+state:''));row.append(el('span','diag-dot'),el('strong','',label),el('span','diag-value',value));rows.append(row)};
  line('aqeelOS Code','Node '+r.app.node+' · '+r.app.platform+' · running for '+Math.round(r.app.uptime/60)+' min','ok');
  for(const t of r.tools)line(t.name,t.path?(t.version||'installed')+' · '+t.path:t.optional?'Not installed (optional)':'Not installed',t.path?'ok':t.optional?'':'bad');
  for(const p of r.providers)line(p.name,p.ready?'Signed in'+(p.account?' · '+p.account:''):p.message||'Not ready',p.ready?'ok':'bad');
  line('Side browser',r.browser||'No Chrome or Edge found',r.browser?'ok':'bad');line('Data folder',r.app.data+' · '+r.app.projects+(r.app.projects===1?' project':' projects'),'ok');
  body.replaceChildren(rows,el('h3','','Recent errors'));const errs=el('div','diag-errors');if(!r.errors.length)errs.append(el('p','kit-message small-print','No errors in the last 7 days.'));
  for(const e of r.errors){const row=el('div','diag-error');row.append(el('small','',when(e.time)+' · '+e.where),el('span','',e.text));errs.append(row)}
  const copy=el('button','','Copy report');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(r,null,2));ctx.notify('Report copied.')}catch{ctx.notify('Could not copy.')}};
  body.append(errs,copy)}catch(e){body.replaceChildren(el('p','kit-message',e.message))}}

// The guide: README.md rendered in the app
export async function openGuide(ctx){const {body}=shell('Guide',{wide:true});body.append(el('p','kit-message','Loading…'));
 try{const r=await fetch('/README.md');if(!r.ok)throw Error('The guide could not be loaded.');const box=el('div','md guide');renderMarkdown((await r.text()).replace(/^# .*\n+/,''),box);body.replaceChildren(box)}catch(e){body.replaceChildren(el('p','kit-message',e.message))}}
