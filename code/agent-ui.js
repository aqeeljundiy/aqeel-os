// Live agent runs in the conversation: streaming timeline, approval cards, auto-opening terminal.
import {effortLabel} from './model-picker.js';
import {renderMarkdown} from './md.js';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const STATUS={running:'Running',completed:'Done',failed:'Failed',declined:'Declined',pending:'Waiting for you',approved:'Approved',denied:'Denied'};
const label=p=>({claude:'Claude',codex:'GPT',gemini:'Gemini',aqeelos:'aqeelOS models'})[p]||p;
// the harness a model ran on (the run header says it with the model and the account, 25 Oct 2026)
const HARNESS={claude:'Claude Code',codex:'Codex',gemini:'Gemini CLI',aqeelos:'aqeelOS engine'};

// The end of a turn: a short recap and up to two one-click next steps (sent as your next message)
export function nextBox(next,send,extra=[]){const box=el('div','next-box');box.append(el('p','next-recap',next.recap||''));
 if(next.actions?.length||extra.length){const row=el('div','next-actions');(next.actions||[]).forEach((a,i)=>{const b=el('button',i?'':'primary',a.label);b.type='button';b.title=a.message;b.addEventListener('click',()=>{for(const x of row.querySelectorAll('button'))x.disabled=true;send(a.message)});row.append(b)});
  for(const [label,run] of extra){const b=el('button','',label);b.type='button';b.addEventListener('click',run);row.append(b)}box.append(row)}return box}

export function createAgentUI(ctx){
 const runs=new Map(); // runId -> {view, panel, nodes: Map(key->node), terminalSeen:Set}

 function speaker(v){return (v.team?'Team · '+({plan:'Plan',build:'Build',review:'Review'})[v.team.stage]+' · ':v.draft?'Compare draft · ':'')+label(v.provider)+(v.model?' · '+v.model:'')+(v.effort?' · '+effortLabel(v.effort):'')}
 function statusChip(status){const s=el('span','chip chip-'+(status||'running'),STATUS[status]||status);return s}

 function renderEvent(run,e){
  let node=run.nodes.get(e.key);const fresh=!node;
  if(e.type==='message'){if(fresh){node=el('div','ev ev-message');node.append(el('div','ev-text md'))}renderMarkdown(e.text,node.firstChild);node.classList.toggle('final',Boolean(e.final))}
  else if(e.type==='command'){
   if(fresh){node=el('details','ev ev-command');const s=el('summary');s.append(el('span','ev-icon','›_'),el('code','ev-cmd'),el('span','chip'));node.append(s,el('pre','ev-output'))}
   node.querySelector('.ev-cmd').textContent=e.command;node.querySelector('.chip').replaceWith(statusChip(e.status));node.querySelector('.ev-output').textContent=e.output||(e.status==='running'?'Waiting for output…':'No output.')}
  else if(e.type==='file'){if(fresh){node=el('div','ev ev-file');node.append(el('span','ev-icon','✎'),el('span','ev-paths'),el('span','chip'))}
   node.querySelector('.ev-paths').textContent=(e.status==='completed'?'Edited ':'Editing ')+(e.paths||[]).join(', ');node.querySelector('.chip').replaceWith(statusChip(e.status))}
  else if(e.type==='tool'){if(fresh){node=el('div','ev ev-tool');node.append(el('span','ev-icon','◇'),el('span','ev-paths'),el('span','chip'))}
   node.querySelector('.ev-paths').textContent=e.name+(e.detail?' — '+e.detail:'');node.querySelector('.chip').replaceWith(statusChip(e.status))}
  else if(e.type==='approval'){
   if(fresh){node=el('div','ev approval');node.setAttribute('role','group');const head=el('div','approval-head');head.append(el('strong','approval-title'),el('span','chip'));const more=el('details','approval-more');more.append(el('summary','',e.kind==='command'?'Show the exact command':'Show details'),el('pre','approval-detail'));node.append(head,el('p','approval-sub',''),more,el('div','approval-actions'))}
   node.querySelector('.approval-title').textContent=e.title;{const sub=node.querySelector('.approval-sub');if(sub)sub.textContent=e.kind==='command'?'The AI wants to run this on your computer. Approve if that’s what you asked for.':e.kind==='file'?'The AI wants to change this file.':''}node.setAttribute('aria-label',e.title);node.querySelector('.approval-detail').textContent=e.detail;node.querySelector('.chip').replaceWith(statusChip(e.status));node.classList.toggle('pending',e.status==='pending');
   const actions=node.querySelector('.approval-actions');actions.replaceChildren();
   if(e.status==='pending'){const decide=(decision,text,cls)=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',async()=>{for(const x of actions.querySelectorAll('button'))x.disabled=true;try{await ctx.api('/agent/decide',{id:run.view.id,approval:e.key,decision});await poll(run)}catch(err){ctx.notify(err.message);for(const x of actions.querySelectorAll('button'))x.disabled=false}});return b};
    actions.append(decide('accept',e.labels?.accept||'Approve','primary'),decide('acceptForSession',e.labels?.acceptForSession||'Allow similar this run',''),decide('decline',e.labels?.decline||'Deny','deny'));
    if(fresh)setTimeout(()=>actions.querySelector('.primary')?.focus({preventScroll:true}),50)}}
  else if(e.type==='error'){if(fresh)node=el('div','ev ev-error');node.textContent=e.text}
  else if(e.type==='thinking'){if(fresh){node=el('details','ev ev-thinking-summary');node.append(el('summary','','Thinking'),el('div','ev-text'))}node.querySelector('.ev-text').textContent=e.text}
  else if(e.type==='plan'){if(fresh){node=el('div','ev ev-plan');node.setAttribute('aria-label','The AI\'s to-do list')}const done=e.items.filter(i=>i.status==='completed').length;const head=el('div','plan-head',done+' of '+e.items.length+' done');const list=el('ul','plan-list');
   for(const it of e.items){const li=el('li','plan-item '+it.status);li.append(el('span','plan-mark',it.status==='completed'?'✓':it.status==='inProgress'?'●':'○'),el('span','',it.text));li.setAttribute('aria-label',(it.status==='completed'?'Done: ':it.status==='inProgress'?'In progress: ':'To do: ')+it.text);list.append(li)}
   node.replaceChildren(head,list);if(e.explanation)node.append(el('small','plan-why',e.explanation))}
  else if(e.type==='question'){if(fresh){node=el('div','ev question');node.setAttribute('role','group');node.setAttribute('aria-label','Questions from the AI')}node.replaceChildren();node.classList.toggle('pending',e.status==='pending');
   if(e.status!=='pending'){node.append(el('strong','approval-title',e.status==='answered'?'You answered':'Question closed'));for(const q of e.questions){const a=e.answers?.[q.id];node.append(el('div','q-done',q.question+' → '+(a?.length?(q.secret?'••••':a.join(', ')):'no answer')))}}
   else{const picks={};for(const q of e.questions){const box=el('div','q');if(q.header)box.append(el('span','q-header',q.header));box.append(el('p','q-text',q.question));picks[q.id]=new Set();
     const opts=el('div','q-options');for(const o of q.options||[]){const b=el('button','q-option');b.type='button';b.append(el('b','',o.label));if(o.description)b.append(el('small','',o.description));b.setAttribute('aria-pressed','false');
      b.addEventListener('click',()=>{if(!q.multi){picks[q.id].clear();for(const x of opts.children)x.setAttribute('aria-pressed','false')}const on=!picks[q.id].has(o.label);on?picks[q.id].add(o.label):picks[q.id].delete(o.label);b.setAttribute('aria-pressed',String(on))});opts.append(b)}box.append(opts);
     if(q.other||!(q.options||[]).length){const t=el('input','q-other');t.type=q.secret?'password':'text';t.placeholder=(q.options||[]).length?'Or type your own answer':'Type your answer';t.setAttribute('aria-label',q.question);t.dataset.q=q.id;box.append(t)}node.append(box)}
    const send=el('button','primary','Answer');send.type='button';send.addEventListener('click',async()=>{const answers={};for(const q of e.questions){const typed=node.querySelector(`.q-other[data-q="${CSS.escape(q.id)}"]`)?.value.trim();answers[q.id]=typed?[...picks[q.id],typed]:[...picks[q.id]]}
     send.disabled=true;try{await ctx.api('/agent/answer',{id:run.view.id,question:e.key,answers});await poll(run)}catch(err){ctx.notify(err.message);send.disabled=false}});const actions=el('div','approval-actions');actions.append(send);node.append(actions)}}
  else if(e.type==='steer'){if(fresh){node=el('div','ev ev-steer');node.append(el('span','ev-steer-label',e.queued?'Queued — sends when the AI finishes':'You, while it worked'),el('div','ev-text'))}node.querySelector('.ev-text').textContent=e.text}
   else if(e.type==='output'){if(fresh){node=el('button','ev ev-output');node.type='button';node.addEventListener('click',()=>ctx.openOutput?.(e.slug));ctx.openOutput?.(e.slug)}node.replaceChildren(el('span','ev-icon','▣'),el('span','ev-paths','Opened '+e.title+' in Artifacts'))}
  else if(e.type==='next'){const box=nextBox(e,t=>ctx.send?.(t));if(node)node.replaceWith(box);node=box;if(!fresh){run.nodes.set(e.key,node);return}}
 if(fresh&&node){run.nodes.set(e.key,node);run.list.append(node)}
  if(e.type==='command')terminalLog(run,e);
 }

 function terminalLog(run,e){
  if(!run.terminal.has(e.key))run.terminal.add(e.key);   // the panel only opens when you open it
  const commands=[...run.nodes.keys()].map(k=>run.events.get(k)).filter(x=>x?.type==='command');
  ctx.setTerminalOutput(commands.map(c=>'AI › '+c.command+'\n'+(c.output||'')+(c.status!=='running'?'\n['+(STATUS[c.status]||c.status)+(typeof c.exitCode==='number'?' · exit '+c.exitCode:'')+']':'')).join('\n\n'));
 }

 function ensurePanel(run){
  if(run.panel)return run.panel;
  const a=el('article','message assistant live');a.setAttribute('aria-live','polite');
  const head=el('div','live-head');run.title=el('span','speaker');run.state=el('span','live-state');head.append(run.title,run.state);
  run.list=el('div','timeline');a.append(head,run.list);run.panel=a;return a}

 function paint(run){
  const v=run.view;ensurePanel(run);
  // an engine run says which engine, agent, model and account did it (what the engine reports once it starts)
  if(v.provider==='aqeelos'){const e=v.engine||{},m=v.actualModel||e.model||String(v.model||'').split('::').pop();run.title.textContent=['aqeelOS engine',e.agentName||v.agent||'',m||'Default',e.account||''].filter(Boolean).join(' · ')}else
  run.title.textContent=(v.team?speaker(v):(v.draft?'Compare draft · ':'')+[HARNESS[v.provider]||label(v.provider),v.actualModel||v.model||'Default',v.accountNote||v.account||''].filter(Boolean).join(' · '));   // the harness, model and account (whose sign-in a run for an agent uses)
  const waiting=v.state==='waiting';run.state.textContent=waiting?'Needs your approval':v.state==='running'?'Working…':v.state==='complete'?'Finished':v.state==='stopped'?'Stopped':'Failed';
  run.panel.classList.toggle('waiting',waiting);
  if(!run.list.childElementCount&&v.state==='running'){run.list.append(run.placeholder??=el('div','ev ev-thinking','Starting '+label(v.provider)+'…'))}
  if(run.list.childElementCount>1)run.placeholder?.remove();
 }

 async function poll(run){
  const v=await ctx.api('/agent?id='+run.view.id+'&after='+run.after);run.after=v.seq;run.view=v;
  for(const e of v.events){run.events.set(e.key,e);renderEvent(run,e)}if(v.events.length)run.placeholder?.remove();
  paint(run);ctx.onActivity(run);
  if(document.contains(run.panel)&&v.events.length){const m=ctx.messages();if(m.scrollHeight-m.scrollTop-m.clientHeight<160)m.scrollTop=m.scrollHeight}
  return v}

 async function follow(view){
  if(runs.has(view.id))return;
  const run={view,after:0,nodes:new Map(),events:new Map(),terminal:new Set()};runs.set(view.id,run);paint(run);ctx.attach();
  // a failed poll is retried a few times before the run is treated as gone (a blip shouldn't drop a live run)
  try{let fails=0;while(true){let v;try{v=await poll(run);fails=0}catch(err){if(++fails<5){await new Promise(r=>setTimeout(r,1500));continue}throw err}if(v.state!=='running'&&v.state!=='waiting')break;await new Promise(r=>setTimeout(r,v.state==='waiting'?900:650))}}
  catch(err){ctx.notify(err.message)}
  runs.delete(view.id);run.panel?.remove();ctx.onFinish(run.view);
 }

 return {
  follow,
  runs:()=>[...runs.values()].map(r=>r.view),
  active:(projectId,chatId)=>[...runs.values()].find(r=>r.view.projectId===projectId&&(!chatId||r.view.chatId===chatId)),
 running:projectId=>[...runs.values()].filter(r=>r.view.projectId===projectId).length,
  // re-attach live panels after the chat re-renders
  panelsFor:chatId=>[...runs.values()].filter(r=>r.view.chatId===chatId).map(r=>ensurePanel(r)),
  stop:async(projectId,chatId)=>{const run=[...runs.values()].find(r=>r.view.projectId===projectId&&(!chatId||r.view.chatId===chatId));if(run)await ctx.api('/agent/stop',{id:run.view.id})},
 };
}
