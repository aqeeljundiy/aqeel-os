// What an agent is doing right now, in words: the bar above the message box, the line under a finished reply and the
// notification when it ends in another tab. No percentages: nobody knows how long a run will take. Time, the current
// step and the agent's own checklist are what is really known.
const RunStatus={
 LONG:60e3,STUCK:180e3,
 NAMES:{read_file:'Reading a file',write_file:'Editing a file',patch:'Editing a file',search_files:'Searching files',terminal:'Running a command',process:'Checking a running command',execute_code:'Running code',web_search:'Searching the web',web_extract:'Reading a web page',session_search:'Searching past chats',memory:'Checking memory',skill_view:'Reading a skill',skills_list:'Looking through skills',skill_manage:'Updating a skill',delegate_task:'Handing part of this to a helper',todo_list:'Updating the checklist',vision_analyze:'Looking at an image',image_generate:'Making an image',text_to_speech:'Making audio',send_message:'Sending a message',clarify:'Asking a question',cronjob:'Updating a schedule'},
 // a tool's name as a person would say it
 plain(tool){const t=String(tool||'');if(this.NAMES[t])return this.NAMES[t];if(/^browser_/.test(t))return 'Using the browser';
  const m=/^mcp__([^_]+(?:_[^_]+)*?)__/.exec(t);if(m)return 'Using '+this.nice(m[1].replace(/^aqeelos[_-]?/,'')||'aqeelOS tools');
  return this.nice(t)||'Working'},
 nice(s){const x=String(s).replace(/[_-]+/g,' ').trim();return x?x[0].toUpperCase()+x.slice(1):''},
 dur(ms){const s=Math.max(0,Math.round(ms/1000));if(s<60)return s+'s';const m=Math.floor(s/60);if(m<60)return m+'m '+String(s%60).padStart(2,'0')+'s';return Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m'},
 // the agent's checklist: from a tool's arguments, or from the full list its result returns
 readTodos(ai,{args,result}={}){let l=null;try{const r=typeof result==='string'?JSON.parse(result):result;if(Array.isArray(r?.todos))l=r.todos}catch{}
  if(!l&&Array.isArray(args?.todos)&&!args.merge)l=args.todos;if(l)ai.todos=l.map(x=>({id:x.id,text:String(x.content||x.text||''),status:x.status||'pending'}))},
 progress(ai){const l=(ai?.todos||[]).filter(x=>x.status!=='cancelled');if(!l.length)return null;const done=l.filter(x=>x.status==='completed').length;return {done,total:l.length,now:l.find(x=>x.status==='in_progress')?.text||'',items:l}},
 // where this reply stands: {state,label,detail,elapsed,canStop}, or null when there is nothing to show
 state(s,{asking=false,now=Date.now()}={}){if(!s)return null;
  if(s.conn==='lost')return {state:'lost',label:'Connection lost',detail:'The reply may still be running on the server.'};
  if(s.conn==='reconnecting')return {state:'reconnecting',label:'Reconnecting',detail:'Picking the reply up again.'};
  const waiting=(s.queue||[]).length;
  if(!s.running)return waiting?{state:'queued',label:'Queued',detail:waiting===1?'1 message waiting to send.':waiting+' messages waiting to send.'}:null;
  const ai=s.ai,elapsed=now-(s.started||now),base={elapsed,waiting,progress:this.progress(ai)};
  if(s.conn==='connecting')return {...base,state:'starting',label:'Starting',detail:'Sending your message.'};
  if((ai?.approval&&!ai.approval.resolved)||asking)return {...base,state:'waiting',label:'Waiting for you',detail:ai?.approval&&!ai.approval.resolved?'Approve or decline the request below.':'It needs something from you below.'};
  const open=[...(ai?.steps||[])].reverse().find(x=>!x.done),quiet=now-(s.lastAct||s.started||now);
  const doing=base.progress?.now||(open?this.plain(open.tool):ai?.text?'Writing the reply':'Thinking');
  if(quiet>=this.STUCK)return {...base,state:'quiet',label:'No updates for '+Math.floor(quiet/60e3)+' minutes',detail:open?this.plain(open.tool)+'. Long steps can take a while.':'It may be stuck.',canStop:true};
  return {...base,state:'working',label:'Working on it',detail:quiet>=this.LONG?doing+', still on this step':doing}},
 // how a reply ended, for the line under it
 finish(s,ai,{hidden=typeof document!=='undefined'&&document.hidden,title=''}={}){if(!ai||ai.dropped)return null;const steps=(ai.steps||[]).length,failed=/\*Stopped\.\*\s*$/.test(ai.text||'')?false:Boolean(ai.error);
  const state=/\*Stopped\.\*\s*$/.test(ai.text||'')?'stopped':failed?'failed':'done',secs=Date.now()-(s.started||Date.now());
  ai.result={state,ms:secs,steps,why:failed?String(ai.error).slice(0,120):''};if(hidden)this.notify(state,title,ai.result);return ai.result},
 endHtml(r){if(!r)return '';const label={done:'Done',failed:'Failed',stopped:'Stopped'}[r.state],bits=[this.dur(r.ms),r.steps?r.steps+(r.steps===1?' step':' steps'):''].filter(Boolean).join(' · ');
  return `<div class="run-end ${r.state}"><i></i><b>${label}</b><span>${esc(r.why||bits)}</span></div>`},
 askNotify(){try{if(typeof Notification==='undefined'||Notification.permission!=='default'||store.get('notifyAsked'))return;store.set('notifyAsked',1);Notification.requestPermission().catch(()=>{})}catch{}},
 notify(state,title,r){const head={done:'Finished',failed:'Stopped with a problem',stopped:'Stopped'}[state];
  try{if(typeof Notification!=='undefined'&&Notification.permission==='granted'){const n=new Notification(AGENT()+': '+head.toLowerCase(),{body:title||this.dur(r.ms),tag:'aq-run'});n.onclick=()=>{focus();n.close()}}}catch{}
  if(!this._title){this._title=document.title;document.title=(state==='done'?'✓ ':'! ')+this._title;addEventListener('focus',()=>{document.title=this._title;this._title=''},{once:true})}},
 // the bar: built once and updated in place, so the time can tick without touching the rest of the page
 paint(slot,s,opts){if(!slot)return;const st=this.state(s,opts);slot.classList.toggle('on',!!st);if(!st)return;
  let b=slot.querySelector('.run-bar');if(!b){slot.innerHTML='<div class="run-clip"><div class="run-bar"><i class="rb-dot"></i><b class="rb-l"></b><span class="rb-d"></span><span class="rb-p"></span><span class="rb-t" aria-hidden="true"></span><button type="button" class="rb-stop" hidden>Stop</button></div><details class="rb-list" hidden><summary>Checklist</summary><ul></ul></details></div>';b=slot.querySelector('.run-bar');slot.querySelector('.rb-stop').onclick=()=>Chat.stop()}
  b.dataset.state=st.state;const set=(c,v)=>{const e=b.querySelector(c);if(e.textContent!==v)e.textContent=v};set('.rb-l',st.label);set('.rb-d',st.detail||'');set('.rb-t',st.elapsed!=null?this.dur(st.elapsed):'');
  set('.rb-p',[st.progress?st.progress.done+' of '+st.progress.total+' done':'',st.waiting?st.waiting+' waiting':''].filter(Boolean).join(' · '));b.querySelector('.rb-stop').hidden=!st.canStop;
  const list=slot.querySelector('.rb-list'),p=st.progress,key=p?JSON.stringify(p.items.map(x=>[x.text,x.status])):'';list.hidden=!p;if(p&&list.dataset.k!==key){list.dataset.k=key;list.querySelector('ul').innerHTML=p.items.map(x=>`<li class="${x.status}">${esc(x.text)}</li>`).join('')}},
 tick(){const id=Chat.id,s=Chat.live[id];this.paint(document.getElementById('runBar'),s,{asking:!!document.querySelector('.composer-wrap ~ * .secret-card, #secretSlot .secret-card, .secret-card')})},
 start(){clearInterval(this._t);this._t=setInterval(()=>this.tick(),1000)}
};
