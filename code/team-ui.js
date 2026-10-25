// Team folders (Plan 4, 25 Oct 2026): the Team control in the project header. Not shared yet: Share to team (a dialog:
// name, members, files only or files and chats) or get a folder someone shared with you. Shared: a popover with a short
// status ("2 new changes from Rina", "You have 3 changes to push"), Pull and Push, History (a side panel with Go back to
// this version), Members for the one who shared it, and conflicts side by side (Keep mine, Keep theirs, or ask the
// coding AI to combine them). Nobody types git commands; Code does them (team.mjs).
import {confirmDialog} from './ui-kit.js';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const svg=d=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>';
const PEOPLE='<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>';
const names=a=>a.length<=2?a.join(' and '):a.slice(0,2).join(', ')+' and others';
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
const ago=t=>{const s=Math.round((Date.now()-t)/1000);return s<60?'just now':s<3600?Math.round(s/60)+' min ago':s<86400?Math.round(s/3600)+' h ago':new Date(t).toLocaleDateString([],{day:'numeric',month:'short'})+' '+new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})};
const shut=d=>{d.close();setTimeout(()=>d.remove(),200)};

export function createTeamUI(ctx){
 let st=null,stFor='',working='',timer=null,pop=null;
 const p=()=>ctx.project(),btn=()=>document.getElementById('team-btn');
 // the short status line
 function line(s){if(!s)return 'Checking with the team…';if(s.gone)return 'This folder is no longer shared with you.';if(s.merging)return plural(s.conflicts.length,'file')+' to sort out before you can push';
  const out=[];if(s.n)out.push(plural(s.n,'new change')+' from '+names(s.from));if(s.files)out.push('You have '+plural(s.files,'change')+' to push');else if(s.chats&&s.team?.chats)out.push('Your chats changed');return out.join(' · ')||'Up to date with the team'}
 function paint(){const b=btn();if(!b)return;const x=p();b.hidden=!x||ctx.online();if(!x)return;const s=stFor===x.id?st:null,lab=b.querySelector('span');
  lab.textContent=working||(!x.team?'Team':s?.merging?'Team · conflicts':s?.n?'Team · '+s.n+' new':s?.files?'Team · '+s.files+' to push':'Team');
  b.classList.toggle('has-new',Boolean(s&&(s.n||s.merging)));b.title=x.team?'Shared with your team as “'+x.team.name+'”. '+line(s):'Share this project with your team, or get a folder shared with you'}
 async function refresh(){const x=p();clearTimeout(timer);if(!x?.team||ctx.online()){st=null;stFor='';paint();return}
  try{const s=await ctx.api('/team/status?projectId='+x.id);if(p()?.id===x.id){st=s;stFor=x.id}}catch(e){if(p()?.id===x.id){st={error:e.message,team:x.team};stFor=x.id}}
  paint();if(pop)fillPop();timer=setTimeout(()=>{if(!document.hidden)refresh();else timer=setTimeout(refresh,60000)},60000)}
 // a pulled chat may have been continued here: it then has a new id, and the open chat follows it
 async function after(r){await ctx.afterChange();const cur=ctx.chatId(),to=r?.renamed?.[cur];if(to)await ctx.openChat(p().id,to)}
 async function act(label,fn){if(working)return;working=label;paint();closePop();try{return await fn()}catch(e){ctx.notify(e.message)}finally{working='';paint();void refresh()}}
 const pull=()=>act('Pulling…',async()=>{const r=await ctx.api('/team/pull',{projectId:p().id});await after(r);if(r.conflicts?.length)return conflicts();ctx.notify(r.pulled?'Pulled '+plural(r.pulled,'change')+' from '+(names(r.from)||'the team')+'. They are in the Changes tab.':'You already have everything from the team.')});
 const push=()=>act('Pushing…',async()=>{const r=await ctx.api('/team/push',{projectId:p().id});await after(r);if(r.conflicts?.length){ctx.notify('The team changed the same files. Sort them out, then push.');return conflicts()}
  ctx.notify(r.pushed||r.summary&&r.summary!=='No file changes'?'Pushed: '+r.summary+'.'+(r.pulled?' '+names(r.from)+'’s changes came in first.':''):'Nothing new to push.')});

 // the popover: status, Pull and Push, and the rest
 function closePop(){if(!pop)return;const x=pop;pop=null;x.classList.remove('shown');x.classList.add('closing');setTimeout(()=>x.remove(),170);btn()?.setAttribute('aria-expanded','false')}
 function fillPop(){if(!pop)return;const x=p(),s=st,t=x.team;pop.replaceChildren();const head=el('div','team-pop-head');head.append(el('strong','',t.name),el('small','',(t.owner===t.me?'You shared it':'Shared by '+t.ownerName)+' · '+(t.chats?'files and chats':'files only')));
  const status=el('p','team-pop-status'+(s?.n||s?.merging?' new':''),s?.error||line(s));pop.append(head,status);
  if(s?.gone){const b=el('button','','Stop syncing here');b.type='button';b.onclick=()=>{closePop();leave()};pop.append(b);return}
  const acts=el('div','team-pop-acts');
  if(s?.merging){const c=el('button','primary','Sort out conflicts');c.type='button';c.onclick=()=>{closePop();conflicts()};acts.append(c)}
  else{const pl=el('button',s?.n?'primary':'','Pull');pl.type='button';pl.onclick=pull;acts.append(pl);
   if(t.role!=='pull'){const ps=el('button',s?.n?'':'primary','Push');ps.type='button';ps.onclick=push;ps.title=s?.n?'Pulls the new changes first, then pushes yours':'Send your version to the team';acts.append(ps)}}
  pop.append(acts);if(t.role==='pull')pop.append(el('p','team-pop-note','You can pull from this folder. Ask '+t.ownerName+' if you need to push.'));
  const more=el('div','team-pop-more');const link=(label,fn,cls='')=>{const b=el('button','team-link '+cls,label);b.type='button';b.onclick=()=>{closePop();fn()};more.append(b)};
  link('History',history);if(t.owner===t.me)link('Members',members);else link('Stop syncing here',leave,'danger');pop.append(more)}
 function openPop(){const b=btn();if(pop){closePop();return}pop=el('div','team-pop');pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Team');fillPop();document.body.append(pop);
  const r=b.getBoundingClientRect(),w=pop.offsetWidth;pop.style.top=(r.bottom+6)+'px';pop.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+'px';void pop.offsetWidth;pop.classList.add('shown');b.setAttribute('aria-expanded','true');pop.querySelector('button')?.focus({preventScroll:true});void refresh()}
 document.addEventListener('pointerdown',e=>{if(pop&&!pop.contains(e.target)&&!btn()?.contains(e.target))closePop()},true);
 document.addEventListener('keydown',e=>{if(pop&&e.key==='Escape'){closePop();btn()?.focus()}});addEventListener('resize',closePop);

 function click(){const x=p();if(!x)return;if(x.team)return openPop();
  // not shared yet: two quick choices
  ctx.openMenu(btn(),[{label:'Share to team…',hint:'Push and pull together',action:()=>share()},{label:'Folders shared with you…',action:()=>join()}],{anchor:btn(),label:'Team'})}

 // members as rows: No access / Can pull / Can push
 function memberRows(box,people,picked){box.replaceChildren();if(!people.length){box.append(el('p','kit-message','No one else has an aqeelOS account yet. Invite people under People in aqeelOS first.'));return}
  for(const x of people){const row=el('div','share-row');row.append(el('b','',x.name||'Someone'));const seg=el('div','share-seg');const paintSeg=()=>seg.querySelectorAll('button').forEach(k=>k.classList.toggle('on',(picked[x.id]||'')===k.dataset.v));
   for(const [v,label] of [['','No access'],['pull','Can pull'],['push','Can push']]){const k=el('button','',label);k.type='button';k.dataset.v=v;k.onclick=()=>{if(v)picked[x.id]=v;else delete picked[x.id];paintSeg()};seg.append(k)}paintSeg();row.append(seg);box.append(row)}}
 const choice=(cur)=>{const seg=el('div','share-seg team-what');let v=cur;for(const [k,label] of [[false,'Files only'],[true,'Files and chats']]){const b=el('button','',label);b.type='button';b.onclick=()=>{v=k;seg.querySelectorAll('button').forEach((x,i)=>x.classList.toggle('on',(i===1)===v))};seg.append(b)}seg.querySelectorAll('button').forEach((x,i)=>x.classList.toggle('on',(i===1)===v));return {seg,get:()=>v}};

 async function share(){const x=p();const d=el('dialog','kit-dialog team-dialog');const form=el('form');form.append(el('h2','','Share to team'));
  form.append(el('p','kit-message','Everyone works in their own copy on their own computer. Push sends your version up; Pull brings in the others’ latest. Big files, dependencies, build output and secret files such as .env stay out.'));
  const nl=el('label','','Name');const name=el('input');name.maxLength=80;name.value=x.name;nl.append(name);
  const wl=el('label','','What to share');const what=choice(false);wl.append(what.seg);const wh=el('p','kit-message small-print','With chats, teammates can read and continue your Code chats. Keys and tokens in them are hidden first.');
  const ml=el('label','','Members');const box=el('div','share-list');box.append(el('p','kit-message','Loading people…'));const picked={};
  const msg=el('p','kit-message team-err');msg.hidden=true;const acts=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button','primary','Share');acts.append(cancel,ok);
  form.append(nl,wl,wh,ml,box,msg,acts);d.append(form);document.body.append(d);d.showModal();let busy=false;const close=()=>{if(!busy)shut(d)};cancel.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});
  try{const r=await ctx.api('/team/people');memberRows(box,r.people,picked)}catch(e){box.replaceChildren(el('p','kit-message',e.message))}
  form.onsubmit=async e=>{e.preventDefault();busy=true;ok.disabled=cancel.disabled=true;ok.textContent='Sharing…';msg.hidden=true;
   try{const r=await ctx.api('/team/share',{projectId:x.id,name:name.value.trim()||x.name,chats:what.get(),members:Object.entries(picked).map(([uid,role])=>({uid,role}))});busy=false;shut(d);await ctx.afterChange();
    ctx.notify(r.warning||'Shared with your team. They find it under Team › Folders shared with you.');void refresh()}catch(err){busy=false;ok.disabled=cancel.disabled=false;ok.textContent='Share';msg.textContent=err.message;msg.hidden=false}}}

 async function members(){const x=p(),t=x.team;const d=el('dialog','kit-dialog team-dialog');const form=el('form');form.append(el('h2','','Members of “'+t.name+'”'));
  const wl=el('label','','What is shared');const what=choice(t.chats);wl.append(what.seg);const box=el('div','share-list');box.append(el('p','kit-message','Loading people…'));const picked=Object.fromEntries((t.members||[]).map(m=>[m.uid,m.role]));
  const msg=el('p','kit-message team-err');msg.hidden=true;const stop=el('button','team-link danger','Stop sharing…');stop.type='button';
  const acts=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button','primary','Save');acts.append(cancel,ok);form.append(wl,el('label','','Members'),box,msg,stop,acts);d.append(form);document.body.append(d);d.showModal();
  const close=()=>shut(d);cancel.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});
  try{const r=await ctx.api('/team/people');memberRows(box,r.people,picked)}catch(e){box.replaceChildren(el('p','kit-message',e.message))}
  stop.onclick=async()=>{if(!(await confirmDialog({title:'Stop sharing “'+t.name+'”?',message:'Nobody can push or pull it any more. Everyone keeps their own copy, and aqeelOS keeps the shared history aside.',confirm:'Stop sharing',danger:true})))return;
   try{await ctx.api('/team/unshare',{projectId:x.id});close();await ctx.afterChange();ctx.notify('No longer shared. Your files stay here.');void refresh()}catch(e){msg.textContent=e.message;msg.hidden=false}};
  form.onsubmit=async e=>{e.preventDefault();ok.disabled=true;try{await ctx.api('/team/update',{projectId:x.id,chats:what.get(),members:Object.entries(picked).map(([uid,role])=>({uid,role}))});close();await ctx.afterChange();ctx.notify('Members saved.');void refresh()}catch(err){ok.disabled=false;msg.textContent=err.message;msg.hidden=false}}}

 async function leave(){const x=p();if(!(await confirmDialog({title:'Stop syncing “'+x.team.name+'” here?',message:'The files stay in this project on your computer; it just stops pushing and pulling with the team.',confirm:'Stop syncing'})))return;
  try{await ctx.api('/team/leave',{projectId:x.id});await ctx.afterChange();ctx.notify('This project no longer syncs with the team.');void refresh()}catch(e){ctx.notify(e.message)}}

 // folders shared with you: get one onto this computer (a new project) or open the one you have
 async function join(){const d=el('dialog','kit-dialog team-dialog');const head=el('div','np-head');const x=el('button','dialog-x','×');x.type='button';x.setAttribute('aria-label','Close');head.append(el('h2','','Folders shared with you'),x);
  const list=el('div','team-list');list.append(el('p','kit-message','Loading…'));d.append(head,list);document.body.append(d);d.showModal();const close=()=>shut(d);x.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});
  try{const r=await ctx.api('/team/folders');const mine=r.folders.filter(f=>f.owner!==r.me||f.here);list.replaceChildren();
   if(!mine.length)list.append(el('p','kit-message','Nothing is shared with you yet. When someone shares a project with you in Code, it shows up here.'));
   for(const f of mine){const row=el('div','team-row');const t=el('div','team-row-t');t.append(el('strong','',f.name),el('small','',(f.owner===r.me?'You':f.ownerName)+' · '+(f.role==='pull'?'you can pull':'you can push')+(f.last?' · last push '+ago(f.last.at)+' by '+f.last.name:'')));
    const b=el('button',f.here?'':'primary',f.here?'Open':'Get it');b.type='button';b.onclick=async()=>{if(f.here){close();return ctx.openProject(f.here)}b.disabled=true;b.textContent='Getting…';
     try{const j=await ctx.api('/team/join',{id:f.id});close();await ctx.openProject(j.projectId);ctx.notify('“'+f.name+'” is on this computer now, in Documents › aqeelOS Code.');void refresh()}catch(e){b.disabled=false;b.textContent='Get it';ctx.notify(e.message)}};row.append(t,b);list.append(row)}}
  catch(e){list.replaceChildren(el('p','kit-message',e.message))}}

 // History: a side panel, newest push first; going back makes a new push, so nothing is lost
 async function history(){const x=p();const d=el('dialog','team-side');const head=el('div','team-side-head');const close=el('button','dialog-x','×');close.type='button';close.setAttribute('aria-label','Close');head.append(el('h2','','History'),close);
  const body=el('div','team-side-body');body.append(el('p','kit-message','Loading…'));d.append(head,body);document.body.append(d);d.showModal();const done=()=>shut(d);close.onclick=done;d.addEventListener('cancel',e=>{e.preventDefault();done()});d.addEventListener('click',e=>{if(e.target===d)done()});
  try{const r=await ctx.api('/team/history?projectId='+x.id);body.replaceChildren();if(!r.pushes.length)body.append(el('p','kit-message','No pushes yet.'));
   r.pushes.forEach((h,i)=>{const row=el('div','team-push');const top=el('div','team-push-top');top.append(el('strong','',h.name),el('small','',ago(h.at)));row.append(top,el('p','',h.summary));
    {const fs=h.files.filter(f=>!f[1].startsWith('.code-team/'));if(fs.length>1)row.append(el('small','team-push-files',fs.slice(0,6).map(f=>f[1].split('/').pop()).join(', ')+(fs.length>6?' and '+(fs.length-6)+' more':'')))}
    if(i===0)row.append(el('span','chip','Latest'));else if(x.team.role!=='pull'){const b=el('button','team-link','Go back to this version');b.type='button';
     b.onclick=async()=>{if(!(await confirmDialog({title:'Go back to this version?',message:'Code makes a new push with the files as '+h.name+' left them '+ago(h.at)+'. The history stays, so you can come back to today’s version too.',confirm:'Go back'})))return;
      done();await act('Going back…',async()=>{const r2=await ctx.api('/team/restore',{projectId:x.id,commit:h.after});await after(r2);if(r2.conflicts?.length)return conflicts();ctx.notify('Back to the version of '+ago(h.at)+'. Everyone gets it when they pull.')})};row.append(b)}
    body.append(row)})}catch(e){body.replaceChildren(el('p','kit-message',e.message))}}

 // conflicts: both versions side by side, one file at a time
 async function conflicts(){const x=p();let s;try{s=await ctx.api('/team/status?projectId='+x.id);st=s;stFor=x.id;paint()}catch(e){return ctx.notify(e.message)}if(!s.conflicts?.length)return ctx.notify('Nothing to sort out.');
  const d=el('dialog','kit-dialog compare-branches team-conflicts');const head=el('div','compare-head');const xb=el('button','dialog-x','×');xb.type='button';xb.setAttribute('aria-label','Close');const title=el('h2','');head.append(title,xb);
  const files=el('div','team-files'),view=el('div','compare-body');const foot=el('div','team-conf-foot');const abort=el('button','team-link danger','Cancel the pull');abort.type='button';foot.append(abort);d.append(head,files,view,foot);document.body.append(d);d.showModal();
  const close=()=>{shut(d);void refresh()};xb.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});let list=s.conflicts,cur=list[0].path,asked=new Set();
  abort.onclick=async()=>{if(!(await confirmDialog({title:'Cancel the pull?',message:'Your files go back to how they were before the pull. The team’s changes wait until you pull again.',confirm:'Cancel the pull',danger:true})))return;try{await ctx.api('/team/abort',{projectId:x.id});close();await ctx.afterChange();ctx.notify('Pull cancelled.')}catch(e){ctx.notify(e.message)}};
  const paintFiles=()=>{title.textContent=list.length===1?'1 file changed on both sides':list.length+' files changed on both sides';files.replaceChildren(...list.map(c=>{const b=el('button','team-file'+(c.path===cur?' on':''),c.path);b.type='button';b.onclick=()=>{cur=c.path;paintFiles();show()};return b}))};
  const side=(label,v)=>{const col=el('div','team-col');col.append(el('h3','',label));const pre=el('pre','team-code');pre.textContent=v.gone?'(removed on this side)':v.big?'(too big to show here: '+Math.round(v.size/1024)+' KB)':v.binary?'(not a text file)':v.text;col.append(pre);return col};
  async function show(){view.replaceChildren(el('p','kit-message','Loading…'));let v;try{v=await ctx.api('/team/conflict?projectId='+x.id+'&path='+encodeURIComponent(cur))}catch(e){view.replaceChildren(el('p','kit-message',e.message));return}
   const who=names(v.from)||'the team',cols=el('div','team-sides');cols.append(side('Yours',v.mine),side(who+'’s',v.theirs));const acts=el('div','team-conf-acts');
   const pick=async(choice)=>{acts.querySelectorAll('button').forEach(b=>b.disabled=true);try{const r=await ctx.api('/team/resolve',{projectId:x.id,path:cur,choice});list=r.left;await ctx.afterChange();
     if(!list.length){close();ctx.notify(x.team.role==='pull'?'All sorted out.':'All sorted out. Push when you are ready.');return}cur=list[0].path;paintFiles();show()}catch(e){ctx.notify(e.message);acts.querySelectorAll('button').forEach(b=>b.disabled=false)}};
   const mine=el('button','','Keep mine');mine.type='button';mine.onclick=()=>pick('mine');const theirs=el('button','','Keep '+who+'’s');theirs.type='button';theirs.onclick=()=>pick('theirs');acts.append(mine,theirs);
   const text=!v.mine.binary&&!v.theirs.binary&&!v.mine.gone&&!v.theirs.gone;
   if(text){const ai=el('button','primary','Ask the coding AI to combine');ai.type='button';ai.onclick=()=>{asked.add(cur);const small=!v.mine.big&&!v.theirs.big&&(v.mine.text.length+v.theirs.text.length)<9000;
     ctx.askAI('Combine two versions of '+cur+' after a team folder pull: keep what each version adds, and write the result to '+cur+' with no conflict markers left. Do not run git commands; I mark it as combined in Code afterwards.\n\n'+(small?'My version:\n```\n'+v.mine.text+'\n```\n\n'+who+'’s version:\n```\n'+v.theirs.text+'\n```':'The versions are big: read mine with git show :2:'+cur+' and '+who+'’s with git show :3:'+cur+'.'));shut(d);ctx.notify('The AI is combining '+cur+'. When it is done, open Team › Sort out conflicts and press Mark as combined.')};acts.append(ai);
    const comb=el('button',asked.has(cur)?'primary':'team-link','Mark as combined');comb.type='button';comb.title='When the file has both versions in it and no conflict markers';comb.onclick=()=>pick('combined');acts.append(comb)}
   else acts.append(el('small','team-pop-note','Pick one: this file cannot be combined line by line.'));view.replaceChildren(cols,acts)}
  paintFiles();show()}

 // before publishing: say so when the team has changes this copy does not have yet
 async function beforePublish(x){if(!x?.team)return true;let s;try{s=await ctx.api('/team/status?projectId='+x.id)}catch{return true}
  if(s.merging)return confirmDialog({title:'Publish with conflicts open?',message:'Some files changed on both sides and are not sorted out yet. Sort them out first, or publish anyway.',confirm:'Publish anyway'});
  if(!s.n)return true;return confirmDialog({title:'You are behind the team',message:plural(s.n,'new change')+' from '+names(s.from)+' are not in your copy yet. Pull first to publish the latest, or publish your copy as it is.',confirm:'Publish my copy'})}

 // after the project list redraws: ask the team again only when another project is open now
 let asked='';function sync(){const x=p();const k=x?.team?x.id+'|'+x.team.id:'';if(k!==asked){asked=k;if(stFor!==x?.id){st=null;stFor=''}void refresh()}else paint()}
 document.getElementById('team-btn')?.addEventListener('click',click);
 addEventListener('visibilitychange',()=>{if(!document.hidden&&p()?.team)void refresh()});
 return {refresh,paint,sync,join,share,beforePublish}}
