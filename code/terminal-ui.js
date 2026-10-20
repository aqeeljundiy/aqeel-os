// Terminal panel with tabs: "AI" (commands the AI ran), "Dev server" logs, and persistent shell sessions.
import {Screen,renderRow,keyBytes} from './vt.js';
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

export function createTerminalUI(ctx){
 const sources={ai:{name:'AI commands',text:'Commands the AI runs appear here.'},dev:null};
 let shells=[],active='ai',seq=0,timer=null,loadedFor=null;
 // take over the old single-command console (drop its listeners by replacing the nodes)
 const oldForm=$('terminal-form'),form=oldForm.cloneNode(true);oldForm.replaceWith(form);const oldStop=$('stop-command'),stop=oldStop.cloneNode(true);oldStop.replaceWith(stop);
 const input=$('terminal-command'),out=$('terminal-output'),tabs=$('term-tabs');
 stop.textContent='Stop';stop.title='Stop the running command (restarts this shell in the same folder)';

 const isShell=k=>shells.some(s=>s.id===k);
 // PTY terminals: a live screen fed from the server; keys go straight to the shell
 const screenEl=el('pre','term-screen');screenEl.tabIndex=0;screenEl.setAttribute('role','textbox');screenEl.setAttribute('aria-multiline','true');screenEl.setAttribute('aria-label','Terminal: type here');screenEl.hidden=true;out.after(screenEl);
 const measure=el('span','term-measure','MMMMMMMMMM');screenEl.append(measure);const views=new Map();let pending='',sendTimer=null,frame=0,reading=null;
 const isPty=k=>shells.find(s=>s.id===k)?.pty;
 function view(id){let v=views.get(id);if(!v){v={screen:new Screen(100,30,{onReply:d=>sendKeys(id,d)}),end:0};views.set(id,v)}return v}
 function sendKeys(id,data){pending+=data;clearTimeout(sendTimer);sendTimer=setTimeout(async()=>{const d=pending;pending='';try{await ctx.api('/terminal/keys',{id,data:d})}catch(e){ctx.notify(e.message)}},8)}
 function paintScreen(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const v=views.get(active);if(!v)return;const s=v.screen,atEnd=screenEl.scrollHeight-screenEl.scrollTop-screenEl.clientHeight<24;const focused=document.activeElement===screenEl;
  const hist=s.altActive?[]:s.history.slice(-1000);const rows=s.lines.map((line,y)=>renderRow(line,focused&&s.cursorVisible&&y===s.y?s.x:-1));screenEl.innerHTML=hist.map(l=>renderRow(l)).concat(rows).join('\n');screenEl.append(measure);if(atEnd)screenEl.scrollTop=screenEl.scrollHeight})}
 function fit(){if(!isPty(active)||screenEl.hidden)return;const r=measure.getBoundingClientRect();if(!r.width)return;const cw=r.width/10,lh=r.height,cs=getComputedStyle(screenEl);const w=screenEl.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),h=screenEl.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  const cols=Math.max(20,Math.floor(w/cw)),rows=Math.max(5,Math.floor(h/lh));const v=view(active);if(v.screen.resize(cols,rows)){ctx.api('/terminal/resize',{id:active,cols,rows}).catch(()=>{});paintScreen()}}
 new ResizeObserver(()=>fit()).observe(screenEl);
 async function readLoop(id){if(reading===id)return;reading=id;const v=view(id);try{while(active===id&&isPty(id)&&!$('terminal').hidden){const r=await ctx.api('/terminal/read?id='+id+'&after='+v.end+'&wait=20000');if(r.reset){v.screen.reset();v.screen.history=[]}if(r.data)v.screen.write(r.data);v.end=r.end;if(r.data)paintScreen();const s=shells.find(x=>x.id===id);if(s&&s.alive!==r.alive){s.alive=r.alive;render()}if(!r.alive)break}}catch{await new Promise(r=>setTimeout(r,1000))}finally{if(reading===id)reading=null}}
 screenEl.addEventListener('keydown',e=>{if(!isPty(active))return;if((e.ctrlKey||e.metaKey)&&(e.key==='c'||e.key==='C')&&String(getSelection())){return}if((e.ctrlKey||e.metaKey)&&(e.key==='v'||e.key==='V'))return;if(e.metaKey)return;const b=keyBytes(e,view(active).screen.appCursor);if(b===null)return;e.preventDefault();sendKeys(active,b)});
 screenEl.addEventListener('paste',e=>{if(!isPty(active))return;e.preventDefault();const t=(e.clipboardData?.getData('text/plain')||'').replace(/\r?\n/g,'\r');if(t)sendKeys(active,view(active).screen.bracketed?'\x1b[200~'+t+'\x1b[201~':t)});
 screenEl.addEventListener('focus',paintScreen);screenEl.addEventListener('blur',paintScreen);
 function paintOutput(text){const end=out.scrollHeight-out.scrollTop-out.clientHeight<40;out.textContent=text;if(end)out.scrollTop=out.scrollHeight}
 function render(){tabs.replaceChildren();
  const tab=(key,name,closable)=>{const b=el('button','term-tab'+(key===active?' active':''));b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-selected',String(key===active));b.append(el('span','',name));
   b.addEventListener('click',()=>select(key));if(closable){const x=el('span','term-close','×');x.setAttribute('role','button');x.setAttribute('aria-label','Close '+name);x.tabIndex=0;const close=e=>{e.stopPropagation();closeShell(key)};x.addEventListener('click',close);x.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')close(e)});b.append(x);
    b.addEventListener('dblclick',async()=>{const name=prompt('Rename terminal',shells.find(s=>s.id===key)?.name);if(name)try{await ctx.api('/terminal/rename',{id:key,name});await load(true)}catch(e){ctx.notify(e.message)}})}tabs.append(b)};
  tab('ai',sources.ai.name);if(sources.dev)tab('dev',sources.dev.name);for(const s of shells)tab(s.id,s.name,true);
  const add=el('button','term-add','+');add.type='button';add.title='New terminal';add.setAttribute('aria-label','New terminal');add.addEventListener('click',()=>openShell());tabs.append(add);
  const shell=isShell(active),ptyOn=Boolean(isPty(active));form.hidden=!shell||(ptyOn&&!matchMedia('(pointer:coarse)').matches);stop.hidden=!shell;stop.textContent=ptyOn?'Ctrl+C':'Stop';stop.title=ptyOn?'Send Ctrl+C to the running program':'Stop the running command (restarts this shell in the same folder)';input.disabled=!shell||!shells.find(s=>s.id===active)?.alive;stop.disabled=input.disabled;
  out.hidden=ptyOn;screenEl.hidden=!ptyOn;if(ptyOn){paintScreen();requestAnimationFrame(fit)}
  if(!shell)paintOutput((active==='dev'?sources.dev?.text:sources.ai.text)||'')}
 function select(key){active=key;seq=0;render();if(isPty(key)){readLoop(key);screenEl.focus()}else if(isShell(key)){poll();input.focus()}}
 async function poll(){clearTimeout(timer);if(isPty(active)){readLoop(active);return}if(!isShell(active)||$('terminal').hidden)return;
  try{const r=await ctx.api('/terminal/read?id='+active+'&after='+seq);if(r.output!==null){seq=r.seq;paintOutput(r.output)}const s=shells.find(x=>x.id===active);if(s&&s.alive!==r.alive){s.alive=r.alive;render()}}catch{}timer=setTimeout(poll,500)}
 async function load(keep){const id=ctx.projectId();if(!id)return;const {terminals}=await ctx.api('/terminals?projectId='+id);if(id!==ctx.projectId())return;shells=terminals;loadedFor=id;if(!keep&&!isShell(active)&&active!=='ai'&&!(active==='dev'&&sources.dev))active='ai';if(isShell(active)||!keep&&shells.length&&active==='ai'&&false)poll();render()}
 // the terminal runs in a project folder: with none open, opening it on its own does nothing and the + button says why
 async function openShell(auto){if(!ctx.projectId()){if(!auto)ctx.notify('Open a project first. The terminal runs in its folder.');return}try{const s=await ctx.api('/terminal/open',{projectId:ctx.projectId()});await load(true);select(s.id)}catch(e){ctx.notify(e.message)}}
 async function closeShell(id){try{await ctx.api('/terminal/close',{id});views.delete(id);if(active===id)active='ai';await load(true)}catch(e){ctx.notify(e.message)}}
 form.addEventListener('submit',async e=>{e.preventDefault();if(isPty(active)){sendKeys(active,input.value+'\r');input.value='';return}if(!isShell(active)||!input.value.trim())return;const text=input.value;input.value='';try{await ctx.api('/terminal/input',{id:active,text});seq=0;poll()}catch(err){ctx.notify(err.message)}});
 stop.addEventListener('click',async()=>{if(!isShell(active))return;if(isPty(active)){sendKeys(active,'\x03');screenEl.focus();return}try{const fresh=await ctx.api('/terminal/interrupt',{id:active});await load(true);select(fresh.id)}catch(e){ctx.notify(e.message)}});

 return {
  // called when the panel opens: make sure there is a shell to type into
  async shown(){if(loadedFor!==ctx.projectId())await load();if(!shells.length&&active==='ai'&&!sources.ai.touched)await openShell(true);else{render();poll()}},
  projectChanged:()=>{active='ai';shells=[];sources.dev=null;load().catch(()=>{})},
  setAI(text,focus){sources.ai.text=text;sources.ai.touched=true;if(focus&&active!=='ai'&&!isShell(active))active='ai';render()},
  setDev(text,title){if(text===null){sources.dev=null;if(active==='dev')active='ai';render();return}sources.dev={name:title||'Dev server',text};active='dev';render()},
 };
}
