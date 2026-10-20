// Ctrl/Cmd+K command palette (actions + search across every chat and message), slash commands,
// settings and desktop notifications.
import {fuzzy} from './composer.js';
import {LANGUAGES,lang,setLang} from './i18n.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const DEFAULTS={theme:'system',notify:true,sound:false,defaultMode:'ask',editorSize:13,sendKey:'enter'};
export function loadSettings(){try{return {...DEFAULTS,...JSON.parse(localStorage.getItem('cba-settings')||'{}')}}catch{return {...DEFAULTS}}}
function saveSettings(s){try{localStorage.setItem('cba-settings',JSON.stringify(s))}catch{}}

export function createPalette(ctx){
 let dialog=null;
 function open(initial=''){if(dialog)return;dialog=el('dialog','palette');const input=el('input','palette-input');input.placeholder='Search chats and messages, or type a command…';input.setAttribute('aria-label','Command palette');input.value=initial;
  const list=el('div','palette-list');list.setAttribute('role','listbox');list.id='palette-list';input.setAttribute('aria-controls','palette-list');dialog.append(input,list);document.body.append(dialog);dialog.showModal();input.focus();let active=0,items=[];
  const close=()=>{const d=dialog;d.close();setTimeout(()=>d.remove(),180);dialog=null};dialog.addEventListener('cancel',e=>{e.preventDefault();close()});dialog.addEventListener('click',e=>{if(e.target===dialog)close()});
  function render(){const q=input.value.trim();// short queries match loosely; from 4 letters on the words must actually appear
   const match=(text)=>q.length>=4?(text.toLowerCase().includes(q.toLowerCase())?fuzzy(q,text)+10:0):fuzzy(q,text);
   const actions=ctx.actions().map(a=>({...a,kind:'Action',score:match(a.label)}));
   const chats=[],hits=[];for(const p of ctx.projects())for(const c of p.chats){if(c.archived)continue;const s=match(c.title);if(s>0)chats.push({label:c.title,hint:p.name,kind:'Chat',score:s,run:()=>ctx.openChat(p.id,c.id)});
    if(q.length>=3){const ql=q.toLowerCase();c.messages.forEach((m,i)=>{const at=(m.text||'').toLowerCase().indexOf(ql);if(at>=0&&hits.length<30){const s=m.text.slice(Math.max(0,at-30),at+60).replace(/\s+/g,' ');hits.push({label:(at>30?'…':'')+s+'…',hint:c.title+' · '+p.name,kind:'Message',score:1,run:()=>ctx.openChat(p.id,c.id,i)})}})}}
   items=[...actions.filter(a=>a.score>0).sort((a,b)=>b.score-a.score).slice(0,q?8:30),...chats.sort((a,b)=>b.score-a.score).slice(0,q?8:6),...hits];active=Math.min(active,Math.max(0,items.length-1));
   const GROUP={Action:'Actions',Chat:'Chats',Message:'Messages'};list.replaceChildren(...(items.length?items:[{label:'No matches',kind:'',disabled:true}]).flatMap((it,i,all)=>{const o=el('div','palette-item'+(i===active?' active':''));const head=it.kind&&it.kind!==all[i-1]?.kind?[el('div','pal-group',GROUP[it.kind]||it.kind)]:[];o.id='pal-'+i;o.setAttribute('role','option');o.setAttribute('aria-selected',String(i===active));
    o.append(el('span','pal-label',it.label));if(it.hint)o.append(el('span','pal-hint',it.hint));if(it.keys)o.append(el('kbd','',it.keys));if(!it.disabled)o.addEventListener('click',()=>{close();it.run()});return [...head,o]}));
   input.setAttribute('aria-activedescendant','pal-'+active);list.querySelector('.active')?.scrollIntoView({block:'nearest'})}
  input.addEventListener('input',()=>{active=0;render()});
  input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+items.length)%Math.max(1,items.length);render()}else if(e.key==='Enter'&&items[active]){e.preventDefault();const it=items[active];close();it.run()}});
  render()}
 addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open()}else if((e.ctrlKey||e.metaKey)&&e.key==='/'){e.preventDefault();openShortcuts()}});
 return {open};
}

export function openSettings(ctx){
 const s=loadSettings(),d=el('dialog','kit-dialog settings-dialog');const form=el('form');form.append(el('h2','','Settings'));
 const field=(label,control,hint)=>{const row=el('label','set-row');const t=el('span','set-label');t.append(el('strong','',label));if(hint)t.append(el('small','',hint));row.append(t,control);form.append(row);return control};
 const select=(value,opts)=>{const x=el('select');for(const [v,t] of opts)x.append(new Option(t,v));x.value=value;return x};
 const check=v=>{const x=el('input');x.type='checkbox';x.checked=v;x.setAttribute('role','switch');return x};
 const language=field('Language',select(lang(),LANGUAGES),'Bahasa Indonesia or English for menus and labels. Your chats are not translated.');
 const theme=field('Theme',select(s.theme,[['system','Match my computer'],['light','Light'],['dark','Dark']]));
 const notify=field('Notifications',check(s.notify),'When a run finishes, fails or needs your approval while you are elsewhere');
 const sound=field('Sound',check(s.sound),'Play a short chime with notifications');
 const mode=field('New chats start in',select(s.defaultMode,[['ask','Ask before changes'],['auto','Auto-edit'],['plan','Plan only']]));
 const sendKey=field('Send messages with',select(s.sendKey,[['enter','Enter'],['ctrl','Ctrl+Enter']]),'The other key adds a new line. On phones the send button always sends.');
 const size=field('Editor text size',select(String(s.editorSize),[['12','Small'],['13','Medium'],['15','Large'],['17','Extra large']]));
 const instr=el('textarea','set-instructions');instr.rows=5;instr.placeholder='For example: Write copy in British English. Prefer accessible, semantic HTML.';instr.value='';
 field('Instructions for every project',instr,'Sent to both Claude and GPT in every chat. Project-specific instructions live in AGENTS.md (project menu › Edit instructions).');
 // memory the AIs keep about you across every project (they add to it with their remember tool; you can edit it)
 const memory=el('textarea','set-instructions');memory.rows=4;memory.placeholder='- Prefers short answers\n- Writes client documents in Bahasa Indonesia';let memoryLoaded='';field('Memory',memory,'Facts the AIs remember about you in every chat. They add to it when you tell them something lasting; edit or delete lines here. Each project has its own memory in its settings.');ctx.api('/memory?scope=global').then(r=>{memory.value=memoryLoaded=r.text||''}).catch(()=>{});
 const web=field('Web access',check(true),'Let the AIs search the web, fetch pages and use the side browser.');
 const fast=field('Fast mode',check(false),'GPT uses the priority tier and Claude uses fast mode where the model supports it. Faster replies; uses your limit or extra usage faster.');
 const style=field('Response style',select('default',[['default','Default'],['concise','Concise'],['explanatory','Explanatory'],['learning','Learning']]));
 const cu=field('Computer use',check(false),'Lets Claude, GPT and Gemini see and control other apps on this computer. The first time an AI asks for an app, you choose: allow for that run, always allow, or deny. Off by default.');
 let grants=[];const grantBox=el('div','grant-list');const paintGrants=()=>{grantBox.replaceChildren(...(grants.length?[el('small','set-label','Always allowed apps'),...grants.map((g,i)=>{const r=el('div','grant-row');r.append(el('span','',g));const x=el('button','','Revoke');x.type='button';x.onclick=()=>{grants.splice(i,1);paintGrants()};r.append(x);return r})]:[]))};form.append(grantBox);
 // MCP tool servers shared by Claude and GPT. One service can have several accounts (e.g. Higgsfield · Main and · Client A),
 // each its own server with its own keys; saved keys show as "•••• saved" and are never sent back to this page.
 let servers=[];const mcpBox=el('div','mcp-box');const mcpHead=el('div','set-label');mcpHead.append(el('strong','','Tool servers (MCP)'),el('small','','Extra tools both AIs can use, such as an image generator or a database. Add a service more than once to use several accounts; each project can choose which ones it uses.'));const mcpList=el('div','mcp-list');
 const slug=t=>String(t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,20);
 const envText=env=>Object.entries(env||{}).map(([k,v])=>k+'='+v).join('\n');const parseEnv=t=>Object.fromEntries(String(t||'').split('\n').map(l=>l.trim()).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
 const paintMcp=()=>{const groups=new Map();servers.forEach((m,i)=>{const g=m.service||m.name;if(!groups.has(g))groups.set(g,[]);groups.get(g).push([m,i])});mcpList.replaceChildren();
  if(!servers.length)mcpList.append(el('p','kit-message small-print','No tool servers yet.'));
  for(const [service,rows] of groups){const box=el('div','mcp-group');box.append(el('div','mcp-service',service+(rows.length>1?' · '+rows.length+' accounts':'')));
   for(const [m,i] of rows){const r=el('div','mcp-row');const on=el('input');on.type='checkbox';on.checked=m.enabled!==false;on.setAttribute('aria-label','Use '+m.name);on.onchange=()=>{m.enabled=on.checked};
    const who=el('div','mcp-who');who.append(el('strong','',m.account||'Main'),el('code','',m.name));const keys=Object.keys(m.env||{});const meta=el('span','mcp-cmd',[m.command,...(m.args||[])].join(' ')+(keys.length?' · keys: '+keys.join(', '):''));
    const more=el('button','','Add another account');more.type='button';more.onclick=()=>fillForm({service,command:m.command,args:m.args,env:Object.fromEntries(keys.map(k=>[k,''])),account:''});
    const edit=el('button','','Edit');edit.type='button';edit.onclick=()=>fillForm({...m,was:m.name},i);
    const x=el('button','','Remove');x.type='button';x.onclick=()=>{servers.splice(i,1);paintMcp()};
    const perm=el('select','mcp-perm');perm.setAttribute('aria-label','Permission for '+m.name);perm.append(new Option('Ask first','ask'),new Option('Always allow','allow'));perm.value=m.permission||'ask';perm.onchange=()=>{m.permission=perm.value};
    const h=health[m.name];const st=el('span','mcp-status'+(h?(h.ok?' ok':' bad'):''),h?(h.ok?h.tools.length+' tools':'Not working'):'Not tested');if(h&&!h.ok)st.title=h.error||'';
    const test=el('button','','Test');test.type='button';test.onclick=async()=>{test.disabled=true;test.textContent='Testing…';try{const r=await ctx.api('/mcp/test',{name:m.name});health[m.name]=r;ctx.notify(r.ok?m.name+' works: '+r.tools.length+' tools.':m.name+': '+r.error)}catch(e){ctx.notify(e.message+' (save settings first if you just added it)')}paintMcp()};
    r.append(on,who,meta,st,perm,test,more,edit,x);box.append(r)}
   mcpList.append(box)}};
 // ready-made servers: pick one to fill the form (you add the keys); remote servers (such as Higgsfield's) go through mcp-remote
 const CATALOG=[['GitHub','npx','-y @modelcontextprotocol/server-github','GITHUB_PERSONAL_ACCESS_TOKEN='],['Notion','npx','-y @notionhq/notion-mcp-server','NOTION_TOKEN='],['Figma','npx','-y figma-developer-mcp --stdio','FIGMA_API_KEY='],['Slack','npx','-y @modelcontextprotocol/server-slack','SLACK_BOT_TOKEN=\nSLACK_TEAM_ID='],['Google Drive','npx','-y @modelcontextprotocol/server-gdrive',''],['Postgres','npx','-y @modelcontextprotocol/server-postgres postgresql://user:password@localhost/db',''],['Brave Search','npx','-y @modelcontextprotocol/server-brave-search','BRAVE_API_KEY='],['Playwright','npx','-y @playwright/mcp',''],['Remote server (URL, e.g. Higgsfield)','npx','-y mcp-remote https://example.com/mcp --header Authorization:${AUTH_HEADER}','AUTH_HEADER=Bearer ']];
 const cat=el('select','mcp-catalog');cat.setAttribute('aria-label','Add from the catalog');cat.append(new Option('Add from the catalog…',''));for(const [n] of CATALOG)cat.append(new Option(n,n));
 cat.onchange=()=>{const c=CATALOG.find(x=>x[0]===cat.value);cat.value='';if(!c)return;fillForm({service:c[0].replace(/ \(.*\)$/,''),command:c[1],args:c[2].split(' '),env:parseEnv(c[3])});ctx.notify('Filled in '+c[0]+'. Add your keys, then Add.')};
 let health={};const loadHealth=()=>ctx.api('/mcp/health').then(r=>{health=r.health||{};paintMcp()}).catch(()=>{});
 const add=el('div','mcp-add');const svc=el('input');svc.placeholder='Service, e.g. Higgsfield';svc.setAttribute('aria-label','Service');const acct=el('input');acct.placeholder='Account, e.g. Client A';acct.setAttribute('aria-label','Account name');
 const cmd=el('input');cmd.placeholder='Command, e.g. npx';cmd.setAttribute('aria-label','Command');const args=el('input');args.placeholder='Arguments, e.g. -y @higgsfield/mcp';args.setAttribute('aria-label','Arguments');
 const envBox=el('textarea');envBox.rows=2;envBox.placeholder='Keys, one per line: API_KEY=…';envBox.setAttribute('aria-label','Keys and settings');envBox.spellcheck=false;
 const addBtn=el('button','','Add');addBtn.type='button';let editing=null,was=null;
 function fillForm(m,index=null){svc.value=m.service||m.name||'';acct.value=m.account||'';cmd.value=m.command||'';args.value=(m.args||[]).join(' ');envBox.value=envText(m.env);editing=index;was=m.was||null;addBtn.textContent=index==null?'Add':'Save account';(index==null&&m.service?acct:svc).focus()}
 addBtn.onclick=()=>{if(!svc.value.trim()||!cmd.value.trim())return ctx.notify('Give the tool server a service name and a command.');
  const base=slug(svc.value)||'tool',name=acct.value.trim()?base+'-'+slug(acct.value):base;const m={name,service:svc.value.trim(),account:acct.value.trim(),command:cmd.value.trim(),args:args.value.match(/"[^"]*"|\S+/g)||[],env:parseEnv(envBox.value),enabled:true,...(was?{was}:{})};
  if(servers.some((s,j)=>s.name===name&&j!==editing))return ctx.notify('There is already an account called '+name+'. Give this one another account name.');
  if(editing!=null)servers[editing]=m;else servers.push(m);svc.value=acct.value=cmd.value=args.value=envBox.value='';editing=was=null;addBtn.textContent='Add';paintMcp()};
 add.append(cat,svc,acct,cmd,args,envBox,addBtn);mcpBox.append(mcpHead,mcpList,add);form.append(mcpBox);loadHealth();
 // helper agents: named helpers with their own instructions (Claude runs them as its sub-agents; GPT takes on the role)
 let agents=[];const agBox=el('div','mcp-box');const agHead=el('div','set-label');agHead.append(el('strong','','Helper agents'),el('small','','Specialists the AI can hand work to, for example a copy editor or a reviewer.'));const agList=el('div','mcp-list');
 const paintAgents=()=>{agList.replaceChildren(...(agents.length?agents.map((a,i)=>{const r=el('div','mcp-row');r.append(el('strong','',a.name),el('span','mcp-cmd',a.description));const x=el('button','','Remove');x.type='button';x.onclick=()=>{agents.splice(i,1);paintAgents()};r.append(x);return r}):[el('p','kit-message small-print','No helper agents yet.')]))};
 const agAdd=el('div','mcp-add');const agName=el('input');agName.placeholder='Name, e.g. copy-editor';agName.setAttribute('aria-label','Agent name');const agDesc=el('input');agDesc.placeholder='When to use it';agDesc.setAttribute('aria-label','When to use it');const agInstr=el('textarea');agInstr.rows=2;agInstr.placeholder='Its instructions';agInstr.setAttribute('aria-label','Instructions');const agModel=el('select');agModel.setAttribute('aria-label','Model for Claude');for(const [v,t] of [['','Same model'],['opus','Opus'],['sonnet','Sonnet'],['haiku','Haiku']])agModel.append(new Option(t,v));
 const agBtn=el('button','','Add agent');agBtn.type='button';agBtn.onclick=()=>{if(!agName.value.trim()||!agDesc.value.trim())return ctx.notify('Give the agent a name and say when to use it.');agents.push({name:agName.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-'),description:agDesc.value.trim(),instructions:agInstr.value.trim(),model:agModel.value});agName.value=agDesc.value=agInstr.value='';paintAgents()};
 agAdd.append(agName,agDesc,agInstr,agModel,agBtn);agBox.append(agHead,agList,agAdd);form.append(agBox);
 // deploy: your Dokploy server (each project picks its application in its own settings)
 const dpBox=el('div','mcp-box');const dpHead=el('div','set-label');dpHead.append(el('strong','','Deploy (Dokploy)'),el('small','','Your Dokploy address and an API key (Dokploy › Settings › Profile › API). Projects choose their application in their settings.'));const dpUrl=el('input');dpUrl.placeholder='https://dokploy.example.com';dpUrl.setAttribute('aria-label','Dokploy address');const dpKey=el('input');dpKey.type='password';dpKey.placeholder='API key';dpKey.setAttribute('aria-label','Dokploy API key');dpKey.autocomplete='off';const dpRow=el('div','mcp-add');dpRow.append(dpUrl,dpKey);dpBox.append(dpHead,dpRow);form.append(dpBox);
 // bundles: skills, tool servers and commands in one JSON file
 const bnBox=el('div','mcp-box');const bnHead=el('div','set-label');bnHead.append(el('strong','','Install a bundle'),el('small','','A .json file with skills, tool servers and commands, installed in one step. Tool servers stay off until you add their keys.'));const bnPick=el('input');bnPick.type='file';bnPick.accept='.json,application/json';bnPick.hidden=true;const bnBtn=el('button','','Choose a bundle file…');bnBtn.type='button';bnBtn.onclick=()=>bnPick.click();
 bnPick.onchange=async()=>{const f=bnPick.files[0];bnPick.value='';if(!f)return;try{const bundle=JSON.parse(await f.text());const r=await ctx.api('/bundle',{bundle});ctx.notify(r.added.length?'Installed: '+r.added.join(', ')+'.':'Nothing new in that bundle.')}catch(e){ctx.notify(e instanceof SyntaxError?'That file is not valid JSON.':e.message)}};bnBox.append(bnHead,bnBtn,bnPick);form.append(bnBox);
 // group the rows under headings (built above in creation order)
 {const row=c=>c.closest('.set-row')||c;const groups=[['General',[language,theme,size]],['Chats',[mode,sendKey,style,instr,memory]],['AI access',[web,fast,cu,grantBox]],['Notifications',[notify,sound]],['Tool servers',[mcpBox,bnBox]],['Helpers and deploy',[agBox,dpBox]]];
  const title=form.querySelector('h2');let at=title;for(const [name,controls] of groups){const sec=el('section','set-section');sec.append(el('h3','set-heading',name));for(const c of controls)sec.append(row(c));at.after(sec);at=sec}}
 const info=el('p','kit-message small-print','');form.append(info);
 if(ctx.customize){const more=el('div','set-more');const c=el('button','','Customize…');c.title='Saved prompts, skills, hooks and schedules';c.type='button';c.onclick=()=>{close();ctx.customize()};const g=el('button','','Diagnostics…');g.type='button';g.onclick=()=>{close();ctx.diagnostics()};const h=el('button','','Guide…');h.type='button';h.onclick=()=>{close();ctx.guide()};more.append(c,g,h);form.append(more)}
 const actions=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button','primary','Save');actions.append(cancel,ok);form.append(actions);d.append(form);document.body.append(d);
 ctx.api('/settings').then(r=>{instr.value=r.instructions||'';web.checked=r.webAccess!==false;fast.checked=Boolean(r.fastMode);style.value=r.outputStyle||'default';cu.checked=Boolean(r.computerUse);grants=[...(r.desktopGrants||[])];paintGrants();servers=r.mcpServers||[];paintMcp();agents=r.agents||[];paintAgents();dpUrl.value=r.dokploy?.url||'';dpKey.value=r.dokploy?.key||'';info.textContent='Projects, chats and history are stored in '+r.dataFolder}).catch(()=>{});
 const close=()=>{d.close();setTimeout(()=>d.remove(),180)};cancel.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});
 form.onsubmit=async e=>{e.preventDefault();const next={...s,theme:theme.value,notify:notify.checked,sound:sound.checked,defaultMode:mode.value,editorSize:Number(size.value),sendKey:sendKey.value};saveSettings(next);const relang=language.value!==lang();
  if(next.notify&&'Notification' in window&&Notification.permission==='default')await Notification.requestPermission().catch(()=>{});
  if(cu.checked&&!s.cuWarned){if(!confirm('Allow the AIs to control other apps on this computer? Each app still needs your permission the first time. You can turn this off at any time.')){cu.checked=false}else next.cuWarned=true;saveSettings(next)}
  try{if(memory.value!==memoryLoaded)await ctx.api('/memory',{scope:'global',text:memory.value});await ctx.api('/settings',{instructions:instr.value,computerUse:cu.checked,desktopGrants:grants,mcpServers:servers,agents,dokploy:{url:dpUrl.value.trim(),key:dpKey.value},webAccess:web.checked,fastMode:fast.checked,outputStyle:style.value})}catch(err){ctx.notify(err.message);return}if(relang)return setLang(language.value);ctx.apply(next);close();ctx.notify('Settings saved.')};
 d.showModal();theme.focus();
}

// Every keyboard shortcut in one searchable sheet (Ctrl/Cmd+/)
export function openShortcuts(){if(document.querySelector('dialog.shortcuts-dialog'))return;const mac=/Mac|iPhone|iPad/.test(navigator.platform),mod=mac?'⌘':'Ctrl';const send=loadSettings().sendKey==='ctrl'?mod+'+Enter':'Enter';
 const groups=[['Messages',[[send,'Send the message'],[send==='Enter'?'Shift+Enter':'Enter','New line'],['↑ / ↓','Previous and next sent messages (empty box)'],['@','Mention a project file'],['/','Slash commands and saved prompts'],['#','Start a message with # to save it to AGENTS.md'],['Shift+Tab','Cycle Ask, Auto-edit and Plan'],['Esc','Stop the running AI']]],
  ['App',[[mod+'+K','Command palette and search'],[mod+'+/','This list of shortcuts']]],['Chats',[[mod+'+L','Go to the message box'],['Alt+N','New chat'],[mod+'+Shift+F','Search in project files']]],['Panels',[[mod+'+1','Preview'],[mod+'+2','Files'],[mod+'+3','Changes'],[mod+'+4','Browser'],[mod+'+`','Show or hide the terminal']]],['Editor',[[mod+'+S','Save the file'],[mod+'+F','Find in the file'],[mod+'+G','Go to line']]],['Menus and dialogs',[['↑ / ↓','Move between items'],['Enter','Choose'],['Esc','Close']]]];
 const d=el('dialog','kit-dialog shortcuts-dialog');const form=el('form');form.method='dialog';form.append(el('h2','','Keyboard shortcuts'));const q=el('input');q.type='search';q.placeholder='Filter shortcuts';q.setAttribute('aria-label','Filter shortcuts');form.append(q);const list=el('div','shortcut-list');form.append(list);
 const paint=()=>{const t=q.value.trim().toLowerCase();list.replaceChildren();for(const [g,rows] of groups){const hits=rows.filter(([k,v])=>!t||(k+' '+v).toLowerCase().includes(t));if(!hits.length)continue;list.append(el('h3','',g));for(const [k,v] of hits){const r=el('div','shortcut-row');const keys=el('span','shortcut-keys');for(const part of k.split(/(?<=\S)\+(?=\S)| \/ /))keys.append(el('kbd','',part));r.append(keys,el('span','',v));list.append(r)}}if(!list.children.length)list.append(el('p','kit-message','No shortcut matches.'))};
 q.oninput=paint;paint();const ok=el('button','dialog-x','×');ok.type='button';ok.setAttribute('aria-label','Close');ok.title='Close';const head=el('div','custom-head');form.querySelector('h2').replaceWith(head);head.append(el('h2','','Keyboard shortcuts'),ok);d.append(form);document.body.append(d);const close=()=>{d.close();setTimeout(()=>d.remove(),180)};ok.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});d.showModal();q.focus()}

// Desktop notification (and optional chime) when the window is not being looked at.
export function notifyDesktop(title,body,onClick){const s=loadSettings();if(!s.notify)return;if(document.hasFocus()&&!document.hidden)return;
 if(s.sound){try{const a=new AudioContext(),o=a.createOscillator(),g=a.createGain();o.frequency.value=880;g.gain.setValueAtTime(.08,a.currentTime);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+.4);o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+.4)}catch{}}
 if(!('Notification' in window)||Notification.permission!=='granted')return;const n=new Notification(title,{body,icon:'/assets/icon-180.png',tag:'cba-'+title});n.onclick=()=>{focus();onClick?.();n.close()}}
