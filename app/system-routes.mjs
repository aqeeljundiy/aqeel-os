// System settings and agent admin: the live test, Abilities opt-ins, your password, Branding, People, an agent's extra connections, pictures
// agents make, deleted agents and restoring one, add-ons, plugins on an agent, Antigravity, exchange rates, the box, Google accounts, WhatsApp
// Business, SSH keys, memory and system events (/ui/live-test, /ui/optins, /ui/me/password, /ui/brand, /ui/people, /ui/channels/links,
// /ui/media, /ui/agent-trash, /ui/agent-restore, /ui/addons, /ui/plugins/toggle, /ui/antigravity, /ui/fx, /ui/box, /ui/google-accounts,
// /ui/channels/wa-cloud, /ui/ssh-keys, /ui/memory, /ui/system-events). They used to sit in server.mjs inside the signed-in /ui/ gate. Same checks
// in the same order; server.mjs calls this where the block was (the person `u` is already signed in and the x-hui header already checked) and it
// answers true when it handled the request.
import {readFile,realpath,readdir,stat,unlink,mkdir,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isAgent,hermes as hcmd,LIVE_APP,editEnv} from './agentops.mjs';
import {homedir,userInfo} from 'node:os';
import {boxMemory} from './boxmem.mjs';
import {randomBytes} from 'node:crypto';
export function createSystemRoutes({accountsApi,addonBy,addons,agentAds,agentHealth,antigravity,appsOff,boxOps,brand,closeSolvedSignins,connectors,cookieAttrs,DATA,env,googleLabels,HERMES_HOME,knownApps,links,listAllProfiles,makeCookie,makeLead,memNow,NAMES,optins,ownsAgent,platCache,PUBLIC_URL,pwa,readBody,readRaw,restartGateway,revokeSessions,security,send,SESSION_DAYS,setChannelOn,setGlabels,SSH_HOST,SSH_PORT,syncNotifyTool,sysEvents,users,writeAgentContext,writeJsonAtomic}){
let sshLock=Promise.resolve();   // authorized_keys changes, one at a time
const FX={rates:{IDR:16500},at:0,day:''};   // dollar → every currency, refreshed by /ui/fx (7 Nov 2026: not only rupiah)
 return async function handle(req,res,p,url,u){
   // the real-life test after each deploy (scripts/live-test.mjs) and any automatic undo (box-live.sh), for System › Health
   if(p==='/ui/live-test'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;try{return send(res,200,JSON.parse(await readFile(path.join(DATA,'live-test.json'),'utf8'))),true}catch{return send(res,200,{runs:[]}),true}}
   // Edit agent › Abilities: AdsPower and sign-in apps per agent (admins change them; the agent's editors may read them)
   if(p==='/ui/optins'&&req.method==='GET'){const a=String(url.searchParams.get('agent')||'default');if(!users.isAdmin(u)&&!users.atLeast(u,a,'edit'))return send(res,403,{error:'Not your agent.'}),true;return send(res,200,{agent:a,admin:users.isAdmin(u),abilities:await optins.state(a),apps:await optins.appsState(a,await knownApps(a))}),true}
   if(p==='/ui/optins'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change this.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const a=String(b.agent||'').split('--')[0],k=String(b.kind||''),v=!!b.on;if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(a)||!await isAgent(a))return send(res,400,{error:'Unknown agent'}),true;
    try{if(k==='app')await optins.setApp(a,String(b.name||''),v);else await optins.set(k,a,v)}catch(e){return send(res,400,{error:e.message}),true}
    // applied now: AdsPower starts (or stops and loses its tool); a sign-in app is added (or removed)
    if(k==='adspower')(v?agentAds.tick().then(()=>agentAds.tools()):agentAds.retire(a)).catch(e=>console.warn('abilities',e.message));
    if(k==='app')(v?connectors.ensureAll():appsOff(a).then(()=>closeSolvedSignins())).catch(e=>console.warn('abilities',e.message));
    return send(res,200,{ok:true,abilities:await optins.state(a),apps:await optins.appsState(a,await knownApps(a))}),true}
   // a new password signs out every other browser and phone; this one gets a fresh sign-in
   if(p==='/ui/me/password'&&req.method==='PUT')return users.api(u,req,res,p,async(r,code,data,h)=>{if(code===200){await revokeSessions(u.id);return send(r,code,data,{...(h||{}),'set-cookie':'hui='+makeCookie(u.id)+'; '+cookieAttrs(SESSION_DAYS*86400)})}return send(r,code,data,h)},readBody),true;
   // System › Branding (admins): the name, logo and contact of this install
   if(p.startsWith('/ui/brand')&&req.method!=='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins change the branding.'}),true;
    try{let r;if(p==='/ui/brand'&&(req.method==='POST'||req.method==='PUT')){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}if('name' in b)r=await brand.setName(b.name);if('contact' in b)r=await brand.setContact(b.contact);if('colour' in b||'accent' in b)r=await brand.setColours({colour:b.colour,accent:b.accent});if('mono' in b)r=await brand.setMono(!!b.mono);r||=await brand.get()}
     else if(p==='/ui/brand/logo'&&req.method==='POST')r=await brand.setLogo(await readRaw(req,600*1024),String(req.headers['content-type']||''));
     else if(p==='/ui/brand/logo'&&req.method==='DELETE')r=await brand.clearLogo();
     else if(p==='/ui/brand/icon'&&req.method==='POST')r=await brand.setIcon(await readRaw(req,3.2*1024*1024),String(req.headers['content-type']||''));
     else if(p==='/ui/brand/icon'&&req.method==='DELETE')r=await brand.clearIcon();else return send(res,404,{error:'Not found'}),true;
     await pwa.current().catch(e=>console.warn('icons:',e.message));
     console.log('branding changed by',u.name||u.id,'→',r.name);return send(res,200,r),true}catch(e){return send(res,400,{error:e.message}),true}}
   {const lm=/^\/ui\/people\/([\w-]+)\/lead$/.exec(p);if(lm&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;const x=users.byId(lm[1]);if(!x||x.id==='owner')return send(res,404,{error:'Unknown person'}),true;try{return send(res,200,{ok:true,lead:await makeLead(x)}),true}catch(e){return send(res,502,{error:'The lead agent could not be made: '+e.message}),true}}}
   if(p==='/ui/me'||p.startsWith('/ui/me/')||p.startsWith('/ui/people')||p.startsWith('/ui/agents')||p.startsWith('/ui/mail')||p.startsWith('/ui/roles'))return users.api(u,req,res,p,send,readBody),true;
   // A true gateway restart (stop and start the service). The engine's own restart only reloads agents inside
   // the running process, so things read at startup (shell hooks) would not change.
   // extra connections of one app for one agent (WhatsApp 2…): admins, or whoever may edit that agent
   if(p.startsWith('/ui/channels')&&req.method!=='GET'){platCache.clear();setTimeout(()=>syncNotifyTool().catch(()=>{}),20000)}
   if(p==='/ui/channels/links'){const a=url.searchParams.get('agent')||'';
    if(req.method==='GET')return send(res,200,{links:(await links.list(a||null)).filter(l=>users.isAdmin(u)||users.gate(u,'/hapi/profiles/'+l.agent+'/soul','PUT',new URLSearchParams(),l.agent)===null)}),true;
    let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||a);
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only add connections to agents you may edit.'}),true;
    try{if(req.method==='POST')return send(res,200,await links.create(ag,String(b.platform||''))),true;
     if(req.method==='DELETE'){const l=(await links.list()).find(x=>x.name===b.name&&x.agent===ag);if(!l)throw new Error('Unknown connection.');await links.remove(l.name);return send(res,200,{ok:true}),true}
     if(req.method==='PUT'){const l=(await links.list()).find(x=>x.name===b.name&&x.agent===ag);if(!l)throw new Error('Unknown connection.');return send(res,200,await links.rename(l.name,b.label)),true}}
    catch(e){return send(res,400,{error:e.message}),true}}
   // pictures agents make (MEDIA:/…/cache/generated/…): served to signed-in people, nothing outside those folders
   if(p==='/ui/media'&&req.method==='GET'){const want=String(url.searchParams.get('path')||'');const ext=(/\.(png|jpe?g|gif|webp|bmp)$/i.exec(want)||[])[1];
    let real='';try{real=await realpath(want)}catch{}
    const okDir=real&&(real.startsWith(HERMES_HOME+'/')||real.startsWith(path.join(homedir(),'workspaces')+'/'))&&/\/cache\/generated\/|\/workspaces\//.test(real);
    if(!ext||!okDir)return send(res,404,{error:'Not found'}),true;
    if(!users.isAdmin(u)){const m=/\/workspaces\/([^/]+)\/|\/profiles\/([^/]+)\//.exec(real);const ag=(m&&(m[1]||m[2])||'default').split('--')[0];if(users.gate(u,'/ui/screens/'+ag,'GET',new URLSearchParams(),ag))return send(res,404,{error:'Not found'}),true}
    try{const buf=await readFile(real);res.writeHead(200,{'content-type':'image/'+(ext.toLowerCase()==='jpg'?'jpeg':ext.toLowerCase()),'cache-control':'private, max-age=86400',...security});return res.end(buf),true}catch{return send(res,404,{error:'Not found'}),true}}
   // recently deleted agents (backups) and restoring one
   if(p==='/ui/agent-trash'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'}),true;const trash=path.join(DATA,'agent-trash');const out=[];
    for(const f of await readdir(trash).catch(()=>[])){
     // a restored agent's backup is kept aside (.restored) for the same 30 days, out of this list
     if(f.endsWith('.tgz.restored')){const st=await stat(path.join(trash,f)).catch(()=>null);if(st&&Date.now()-st.mtimeMs>30*864e5)await unlink(path.join(trash,f)).catch(()=>{});continue}
     const m=/^(.+)__(.+)\.tgz$/.exec(f);if(!m)continue;const st=await stat(path.join(trash,f)).catch(()=>null);if(!st)continue;
     if(Date.now()-st.mtimeMs>30*864e5){await unlink(path.join(trash,f)).catch(()=>{});continue}out.push({file:f,agent:m[1],deleted:st.mtimeMs,size:st.size})}
    return send(res,200,{items:out.sort((a,b)=>b.deleted-a.deleted)}),true}
   if(p==='/ui/agent-trash/purge'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const f=String(b.file||'');if(!/^[\w.-]+__[\w.-]+\.tgz$/.test(f)||f.includes('..'))return send(res,400,{error:'Unknown backup'}),true;await unlink(path.join(DATA,'agent-trash',f)).catch(()=>{});console.log('deleted the kept backup',f);return send(res,200,{ok:true}),true}
   if(p==='/ui/agent-restore'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const f=String(b.file||'');const m=/^([a-z0-9][a-z0-9_-]{0,63})__[\w-]+\.tgz$/.exec(f);if(!m)return send(res,400,{error:'Unknown backup.'}),true;
    const dir=path.join(HERMES_HOME,'profiles',m[1]);if(await stat(dir).catch(()=>null))return send(res,409,{error:'An agent with that name exists already.'}),true;
    await mkdir(dir,{recursive:true});const {execFile}=await import('node:child_process');
    // a failed unpack leaves no half agent folder behind
    const ok=await new Promise(r=>execFile('tar',['-xzf',path.join(DATA,'agent-trash',f),'-C',dir],{timeout:180000},e=>r(!e)));if(!ok){await (await import('node:fs/promises')).rm(dir,{recursive:true,force:true}).catch(()=>{});return send(res,500,{error:'Could not unpack the backup.'}),true}
    // its extra numbers came back inside it: move each to its own folder and list it again (one that exists already stays as it is)
    const cl=path.join(dir,'.aqeel-copies.json');let copies=[];try{copies=JSON.parse(await readFile(cl,'utf8'))}catch{}
    for(const c of Array.isArray(copies)?copies:[]){const cn=String(c?.name||'');if(!cn.startsWith(m[1]+'--')||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cn))continue;const src=path.join(dir,cn),dst=path.join(HERMES_HOME,'profiles',cn);
     if(!await stat(src).catch(()=>null))continue;if(await stat(dst).catch(()=>null)){console.warn('restore: copy exists already',cn);continue}
     try{await rename(src,dst);await links.adopt(cn,{...c,agent:m[1]})}catch(e){console.warn('restore copy',cn,e.message)}}
    await unlink(cl).catch(()=>{});
    await users.restoreAgent(m[1]).catch(()=>{});await rename(path.join(DATA,'agent-trash',f),path.join(DATA,'agent-trash',f+'.restored')).catch(()=>{});restartGateway('restored '+m[1]).then(()=>agentHealth(m[1])).catch(()=>{});
    return send(res,200,{ok:true,agent:m[1]}),true}
   // plugins on/off for ONE agent (the engine's own plugin routes always change the main agent)
   // what each person added (apps, skills, plugins) and the block list of apps and hosts: admins only (addons.mjs)
   if(p==='/ui/addons'||p==='/ui/addons/block'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins see what each person added.'}),true;
    if(p==='/ui/addons'&&req.method==='GET'){const d=await addons.list();return send(res,200,{...d,added:d.added.map(x=>({...x,agentName:x.agent?(NAMES[x.agent]||x.agent):null}))}),true}
    if(p==='/ui/addons/block'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{return send(res,200,{blocked:await addons.block(b.value,{note:b.note,by:addonBy(u)})}),true}catch(e){return send(res,400,{error:e.message}),true}}
    if(p==='/ui/addons/block'&&req.method==='DELETE')return send(res,200,{blocked:await addons.unblock(url.searchParams.get('value')||'')}),true;
    return send(res,405,{error:'Not allowed'}),true}
   // personal add-ons (11 Nov 2026): anyone turns plugins on or off on the agents they own; admins on every agent
   if(p==='/ui/plugins/toggle'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),name=String(b.name||'');
    if(!/^[\w.@-]{1,80}$/.test(name))return send(res,400,{error:'Unknown plugin'}),true;
    {const no=users.addonCheck(u,ag,'plugin');if(no)return send(res,403,{error:no}),true}
    if(b.enabled){const no=await addons.refusal({name});if(no)return send(res,403,{error:no}),true}
    if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'}),true;
    const r=await hcmd(ag,['plugins',b.enabled?'enable':'disable',name],{timeout:150000});
    if(r.ok&&b.enabled)addons.note({kind:'plugin',agent:ag,name,by:addonBy(u),via:'turned on'}).catch(()=>{});
    return r.ok?send(res,200,{ok:true,restart_required:/restart/i.test(r.out)}):send(res,400,{error:(r.err||'Could not change the plugin').slice(0,300)}),true}
   // Google AI Pro through Antigravity (Google's agy tool): status for everyone, connecting, cancelling and removing for admins
   if(p.startsWith('/ui/antigravity/')){const act=p.slice(16);if(act==='status'&&req.method==='GET')return send(res,200,await antigravity.status(url.searchParams.has('fresh'))),true;
    if(!users.isAdmin(u))return send(res,403,{error:'Only admins can connect Google AI Pro.'}),true;if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;
    let b={};try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}
    try{if(act==='start')return send(res,200,await antigravity.start()),true;if(act==='code')return send(res,200,await antigravity.code(b.code)),true;if(act==='cancel')return send(res,200,await antigravity.cancel()),true;if(act==='logout'){const r=await antigravity.logout();await accountsApi.forget('p:antigravity-subscription').catch(()=>{});return send(res,200,r),true}}catch(e){return send(res,400,{error:e.message}),true}
    return send(res,404,{error:'Unknown'}),true}
   // today's US dollar → rupiah rate, so costs can be shown in rupiah (fetched twice a day, last good one kept)
   if(p==='/ui/fx'&&req.method==='GET'){if(!FX.at||Date.now()-FX.at>12*3600e3){try{const r=await fetch('https://open.er-api.com/v6/latest/USD',{signal:AbortSignal.timeout(8000)});const j=await r.json();const rates=Object.fromEntries(Object.entries(j?.rates||{}).filter(([k,v])=>/^[A-Z]{3}$/.test(k)&&+v>0));if(rates.EUR)Object.assign(FX,{rates,at:Date.now(),day:(j.time_last_update_utc||'').slice(5,16)})}catch{}}
    return send(res,200,{rates:FX.rates,IDR:FX.rates.IDR,updated:FX.day||null}),true}
   if(p==='/ui/box'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;return send(res,200,{...await boxMemory(),processes:await boxOps.janitor().catch(()=>null),screens:await boxOps.screens().catch(()=>null),agents:await boxOps.agentMemory().catch(()=>[])}),true;}
   // Google accounts an agent can use (the Google Workspace skill keeps one sign-in per account); never the tokens themselves
   if(p==='/ui/google-accounts'){const a=String(url.searchParams.get('agent')||'default');if(!(await listAllProfiles()).includes(a))return send(res,400,{error:'Unknown agent'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'}),true;
    const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
    if(req.method==='GET'){const out=[];for(const f of await readdir(home).catch(()=>[])){const m=/^google_token(?:_([\w.-]+))?\.json$/.exec(f);if(!m)continue;
      try{const j=JSON.parse(await readFile(path.join(home,f),'utf8'));const L=(await googleLabels())[a+'|'+(m[1]||'')]||{};out.push({name:m[1]||'',email:j.account||'',label:L.label||'',note:L.note||'',scopes:(j.scopes||[]).map(s=>String(s).split('/').pop()),renews:!!j.refresh_token,expiry:j.expiry||null})}catch{}}
     return send(res,200,{accounts:out}),true}
    // the name people see and a note on what the account is for; the agent is told both (see writeAgentContext).
    // The skill's own account name (google_token_<name>.json) never changes, so nothing has to sign in again.
    if(req.method==='PUT'){if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a)!==null)return send(res,403,{error:'You can only change agents you may edit.'}),true;
     let b={};try{b=JSON.parse(await readBody(req,8192))}catch{return send(res,400,{error:'Bad request'}),true}const n=String(b.name||'');if(n&&!/^[\w.-]{1,60}$/.test(n))return send(res,400,{error:'Unknown account'}),true;
     const all=await googleLabels();const k=a+'|'+n;const label=String(b.label||'').replace(/[\r\n"]+/g,' ').trim().slice(0,60),note=String(b.note||'').replace(/[\r\n]+/g,' ').trim().slice(0,400);
     if(label||note)all[k]={label,note};else delete all[k];await writeJsonAtomic(path.join(DATA,'google-accounts.json'),all);setGlabels(all);
     if(LIVE_APP)writeAgentContext().catch(()=>{});return send(res,200,{ok:true,label,note}),true}
    if(req.method==='DELETE'){if(!ownsAgent(u,a))return send(res,403,{error:'Only an admin or this agent’s owner removes its Google accounts.'}),true;const n=String(url.searchParams.get('name')||'');if(n&&!/^[\w.-]{1,60}$/.test(n))return send(res,400,{error:'Unknown account'}),true;
     await unlink(path.join(home,'google_token'+(n?'_'+n:'')+'.json')).catch(()=>{});console.log('removed google account',n||'(main)','from',a);return send(res,200,{ok:true}),true}}
   // WhatsApp Business (Meta's Cloud API) for one agent: the keys from Meta's app go in the agent's own .env, aqeelOS
   // makes the check word (verify token) and gives the address to paste into Meta. Values are never sent back.
   if(p==='/ui/channels/wa-cloud'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can set up WhatsApp Business.'}),true;
    const a=String(url.searchParams.get('agent')||'default');if(!(await listAllProfiles()).includes(a)||a.includes('--'))return send(res,400,{error:'Unknown agent'}),true;
    const envF=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'.env');const KEYS={phone_number_id:'WHATSAPP_CLOUD_PHONE_NUMBER_ID',access_token:'WHATSAPP_CLOUD_ACCESS_TOKEN',app_secret:'WHATSAPP_CLOUD_APP_SECRET',app_id:'WHATSAPP_CLOUD_APP_ID',waba_id:'WHATSAPP_CLOUD_WABA_ID'};
    const read=async()=>{const t=await readFile(envF,'utf8').catch(()=>'');const v=k=>(new RegExp('^'+k+'=["\']?([^"\'\\n]*)','m').exec(t)||[])[1]||'';return {v,t}};
    const callback=PUBLIC_URL+'/whatsapp-cloud'+(a==='default'?'':'/'+a);
    if(req.method==='GET'){const {v}=await read();return send(res,200,{callback,verify_token:v('WHATSAPP_CLOUD_VERIFY_TOKEN'),set:Object.fromEntries(Object.entries(KEYS).map(([k,e])=>[k,!!v(e)]))}),true}
    if(req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{return send(res,400,{error:'Bad request'}),true}
     const put={};for(const [k,e] of Object.entries(KEYS)){const x=String(b[k]||'').trim();if(!x)continue;if(/[\s"'\\]/.test(x)||x.length>600)return send(res,400,{error:'That '+k.replace(/_/g,' ')+' does not look right.'}),true;put[e]=x}
     if(put.WHATSAPP_CLOUD_PHONE_NUMBER_ID&&!/^\d{6,30}$/.test(put.WHATSAPP_CLOUD_PHONE_NUMBER_ID))return send(res,400,{error:'The phone number ID is the long number Meta shows under API Setup, not the phone number itself.'}),true;
     const {v}=await read();if(!v('WHATSAPP_CLOUD_VERIFY_TOKEN'))put.WHATSAPP_CLOUD_VERIFY_TOKEN=randomBytes(18).toString('base64url');
     if(!(put.WHATSAPP_CLOUD_PHONE_NUMBER_ID||v(KEYS.phone_number_id))||!(put.WHATSAPP_CLOUD_ACCESS_TOKEN||v(KEYS.access_token)))return send(res,400,{error:'The phone number ID and the access token are both needed.'}),true;
     await editEnv(envF,cur=>{const lines=cur.split('\n').filter(l=>!Object.keys(put).some(k=>l.startsWith(k+'=')));while(lines.length&&lines[lines.length-1]==='')lines.pop();return [...lines,...Object.entries(put).map(([k,x])=>k+'='+x),''].join('\n')});
     console.log('whatsapp business set up for',a,Object.keys(put).map(k=>k.replace('WHATSAPP_CLOUD_','')).join(' '));
     let on=true;try{await setChannelOn(a,'whatsapp_cloud',true)}catch(e){on=false;console.warn('whatsapp business on',a,e.message)}
     const r=await read();return send(res,200,{ok:true,on,callback,verify_token:r.v('WHATSAPP_CLOUD_VERIFY_TOKEN')}),true}}
   // Who can reach the AI box over SSH: one public key per device or AI tool, added and removed here (admins only).
   // Only public keys are ever handled; the key aqeelOS's own builder uses cannot be removed from here.
   if(p==='/ui/ssh-keys'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can manage access to the AI box.'}),true;
    // every other line (comments, blank lines, ones not understood) is kept as it is; key lines may start with options
    // (from="…",command="…"); the builder's key is known by its fingerprint, recorded the first time (DATA/ssh-protected.json)
    const f=path.join(homedir(),'.ssh','authorized_keys'),pf=path.join(DATA,'ssh-protected.json');const {createHash}=await import('node:crypto');
    const KEY=/(?:^|\s)(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+([A-Za-z0-9+/]+={0,3})(?:\s+(.*))?$/;
    const fpOf=b=>{try{return 'SHA256:'+createHash('sha256').update(Buffer.from(b,'base64')).digest('base64').replace(/=+$/,'')}catch{return ''}};
    const read=async()=>{const lines=(await readFile(f,'utf8').catch(()=>'')).split('\n');if(lines.length&&lines[lines.length-1]==='')lines.pop();
     const keys=lines.map((l,i)=>{if(l.trim().startsWith('#'))return null;const m=KEY.exec(l.trim());return m?{i,type:m[1],b64:m[2],name:(m[3]||'').trim()||'(no name)',fp:fpOf(m[2])}:null}).filter(Boolean);
     let prot=await readFile(pf,'utf8').then(JSON.parse).catch(()=>null);
     // which keys stay: chosen here with Protect (or SSH_PROTECTED_FP); none by default on a new install
     if(!Array.isArray(prot)){prot=[];await writeJsonAtomic(pf,prot).catch(()=>{})}
     const pset=new Set([...prot,...String(process.env.SSH_PROTECTED_FP||'').split(',').map(x=>x.trim()).filter(Boolean)]);
     return {lines,keys,list:keys.map(k=>({type:k.type,name:k.name,fp:k.fp,protected:pset.has(k.fp)}))}};
    // the user people sign in as (shown in "How to connect"): set here, else SSH_USER, else the user aqeelOS runs as
    const sf=path.join(DATA,'ssh-settings.json'),sshUser=async()=>(await readFile(sf,'utf8').then(JSON.parse).catch(()=>({}))).user||env.SSH_USER||(()=>{try{return userInfo().username}catch{return 'root'}})();
    if(req.method==='GET')return send(res,200,{keys:(await read()).list,host:SSH_HOST,port:SSH_PORT,user:await sshUser()}),true;
    let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
    if(req.method==='PUT'&&'user' in b){const un=String(b.user||'').trim();if(un&&!/^[a-z_][a-z0-9_-]{0,31}$/.test(un))return send(res,400,{error:'Use a Linux user name: small letters, numbers, dashes or underscores.'}),true;await writeJsonAtomic(sf,{user:un});return send(res,200,{user:await sshUser()}),true}
    // one change at a time, each on a fresh read, so two adds at once both stay
    const locked=fn=>{const r=sshLock.then(fn);sshLock=r.catch(()=>{});return r};
    // Protect: a key that can't be removed here by mistake (the one that maintains the box, for example)
    if(req.method==='PUT'&&b.fp)return locked(async()=>{const r=await read();if(!r.keys.some(x=>x.fp===b.fp))return send(res,404,{error:'No such key'});let prot=await readFile(pf,'utf8').then(JSON.parse).catch(()=>[]);if(!Array.isArray(prot))prot=[];
     if(!b.protected&&String(env.SSH_PROTECTED_FP||'').split(',').map(x=>x.trim()).includes(b.fp))return send(res,400,{error:'This key is protected in the server settings (SSH_PROTECTED_FP), so it stays.'});
     prot=b.protected?[...new Set([...prot,b.fp])]:prot.filter(x=>x!==b.fp);await writeJsonAtomic(pf,prot);
     console.log('ssh key',b.fp,b.protected?'protected':'no longer protected','by',u.name||u.id);return send(res,200,{keys:(await read()).list})}),true;
    if(req.method==='POST'){const k=String(b.key||'').trim().replace(/\s+/g,' ');const name=String(b.name||'').trim().replace(/[^\w .@-]/g,'').slice(0,60);
     const m=/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com) ([A-Za-z0-9+/=]{60,}) ?(.*)$/.exec(k);if(!m)return send(res,400,{error:'That is not an SSH public key. It starts with ssh-ed25519 (or ssh-rsa) and is one line. Never paste a private key.'}),true;
     if(!name)return send(res,400,{error:'Give it a name, like “Sam’s laptop” or “Codex on the office PC”.'}),true;
     return locked(async()=>{const r=await read();if(r.keys.some(x=>x.b64===m[2]))return send(res,400,{error:'That key already has access.'});
      const line=m[1]+' '+m[2]+' '+name.replace(/\s+/g,'-');await mkdir(path.dirname(f),{recursive:true,mode:0o700});await writeFile(f,[...r.lines,line].join('\n')+'\n',{mode:0o600});
      console.log('ssh access added:',name,'by',u.name||u.id);return send(res,200,{keys:(await read()).list})}),true}
    if(req.method==='DELETE')return locked(async()=>{const r=await read();const k=r.keys.find(x=>x.fp===b.fp);if(!k)return send(res,404,{error:'No such key'});
     if(r.list.find(x=>x.fp===k.fp).protected)return send(res,400,{error:'This key is protected. Choose Allow removing first.'});
     r.lines.splice(k.i,1);await writeFile(f,r.lines.join('\n')+'\n',{mode:0o600});console.log('ssh access removed:',k.name,'by',u.name||u.id);return send(res,200,{keys:(await read()).list})}),true}
   if(p==='/ui/memory'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'}),true;return send(res,200,await memNow()),true}
   if(p==='/ui/system-events'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,200,{events:[]}),true;return send(res,200,{events:sysEvents().filter(e=>e.kind!=='restart-failed')}),true}   // that one is a Bottlenecks item (noteSys)
  return false}}
