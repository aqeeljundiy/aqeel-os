// Dev server controls in the preview toolbar. Static sites keep the built-in preview;
// projects with a package.json get Install / Start / Stop / Logs and the preview follows the live server.
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const LABEL={installing:'Installing…',installed:'Ready to start',starting:'Starting…',running:'Running',stopped:'Stopped',crashed:'Crashed',failed:'Failed'};

export function createDevUI(ctx){
 let data=null,timer=null,current=null,logsOpen=false;
 const live=s=>['installing','starting','running'].includes(s);

 async function act(route){try{data.server=await ctx.api('/dev/'+route,{projectId:ctx.projectId()});render();schedule()}catch(e){ctx.notify(e.message)}}

 function render(){
  const bar=ctx.bar();bar.replaceChildren();const info=data?.info,s=data?.server;
  bar.hidden=!info||info.kind!=='node';if(bar.hidden){ctx.setPreviewUrl(null);return}
  const state=s?.state&&s.state!=='stopped'?s.state:info.installed?'stopped':'not-installed';
  const chip=el('span','dev-chip dev-'+state);chip.append(el('span','dot'),(info.framework||info.name||'Node project')+' · '+(state==='not-installed'?'Not installed':LABEL[state]||state)+(s?.url&&state==='running'?' · '+s.url.replace(/^https?:\/\//,''):''));
  chip.title=info.script?'Runs: '+info.manager+' run '+info.script+(info.command?' ('+info.command+')':''):'No dev script in package.json';bar.append(chip);
  const button=(text,cls,fn)=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);bar.append(b);return b};
  if(state==='not-installed'||state==='failed'&&s?.task==='install')button('Install dependencies','primary',()=>act('install'));
  else if(live(state))button('Stop','',()=>act('stop'));
  else if(info.script)button(state==='crashed'?'Restart':'Start dev server','primary',()=>act('start'));
  if(s?.log)button(logsOpen?'Hide logs':'Logs','',()=>{logsOpen=!logsOpen;ctx.showLogs(logsOpen?s.log:null,info.framework||'Dev server');render()});
  ctx.setPreviewUrl(state==='running'&&s.url?s.url:null);
  if(logsOpen&&s?.log)ctx.showLogs(s.log,info.framework||'Dev server');
 }

 function schedule(){clearTimeout(timer);if(live(data?.server?.state))timer=setTimeout(refresh,1500)}

 async function refresh(){const id=ctx.projectId();if(!id)return;if(id!==current){current=id;logsOpen=false}
  try{const d=await ctx.api('/dev?projectId='+id);if(id!==ctx.projectId())return;const was=data?.server?.state;data=d;render();
   if(was==='installing'&&d.server.state==='installed')ctx.notify('Dependencies installed. Start the dev server to preview.');
   if(was==='starting'&&d.server.state==='running')ctx.notify('Dev server running at '+d.server.url);
   if(was&&live(was)&&['crashed','failed'].includes(d.server.state))ctx.notify('The dev server stopped. Open Logs to see why.');
   schedule()}catch{data=null;render()}}

 return {refresh};
}
