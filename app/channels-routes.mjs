// System › Channels, per agent: link, unlink, pause and resume a channel, WhatsApp pairing and approving a person on a channel (/ui/channels/*).
// They used to sit in server.mjs inside the signed-in /ui/ gate. Same checks in the same order; server.mjs calls this where the block was
// (the person `u` is already signed in and the x-hui header already checked) and it answers true when it handled the request.
import {writeStore} from './store.mjs';
import {readFile,stat,rename,readdir} from 'node:fs/promises';
import {withFlock,readConfig,editEnv} from './agentops.mjs';
import path from 'node:path';
import {parseEnv,setEnvLine,channelWho,globalWho,removePerson,engineChange,approvedWithout} from './allowlist.mjs';
export function createChannelsRoutes({ADDED_FILE,DASH,DASH_TOKEN,HERMES_HOME,NAMES,PERSON_HELP,approvePerson,attention,channelAttention,checkChannel,editAdded,envQueue,links,listAllProfiles,pairingDir,pausedLoad,pausedSave,personId,platCache,platformsCached,readBody,relay,restartGateway,samePerson,send,stopBridges,syncNotifyTool,users,waLinking,waMapping,waPrepOff}){
 return async function handle(req,res,p,url,u){
   // approve a person on one of an agent's channels before they message it (admins, or members who may edit that agent)
   if(p==='/ui/channels/approve-person'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const ag=String(b.agent||''),pf=String(b.platform||''),base=ag.split('--')[0];
    if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent.'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+base+'/soul','PUT',new URLSearchParams(),base)!==null)return send(res,403,{error:'You can only add people to agents you may edit.'}),true;
    if(!PERSON_HELP[pf])return send(res,400,{error:'Adding people by hand works for WhatsApp, Telegram, Slack, Discord and email.'}),true;
    const pl=await platformsCached(ag).catch(()=>null);const c=(pl?.platforms||pl||[]).find?.(x=>x.id===pf);if(!c||!(c.configured||c.state==='connected'||c.paused))return send(res,400,{error:(NAMES[base]||base)+' has no '+PERSON_HELP[pf]+' connected.'}),true;
    let id;try{id=personId(pf,b.id)}catch(e){return send(res,400,{error:e.message}),true}
    const name=String(b.name||'').trim().slice(0,80),note=String(b.note||'').trim().slice(0,140);if(!name)return send(res,400,{error:'Give their name, so everyone knows who it is.'}),true;
    const pr=await fetch(DASH.origin+'/api/pairing?profile='+encodeURIComponent(ag),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(20000)}).then(r=>r.ok?r.json():null).catch(()=>null);
    if(!pr)return send(res,502,{error:'The engine did not answer, so nobody was added. Try again in a moment.'}),true;
    const dup=(pr.approved||[]).find(x=>x.platform===pf&&samePerson(pf,x.user_id,id));if(dup)return send(res,409,{error:(dup.user_name||id)+' is already approved on this '+PERSON_HELP[pf]+'.'}),true;
    let how;try{how=await approvePerson(ag,pf,id,name)}catch(e){return send(res,500,{error:e.message}),true}
    await editAdded(all=>{all[ag+'|'+pf+'|'+id]={by:u.name||u.id,name,note,t:Date.now()}}).catch(e=>console.warn('approvals added: the mark was not saved:',e.message));
    console.log('approved by hand on',ag,pf,'('+how+') by',u.name||u.id);return send(res,200,{ok:true,id}),true}
   /* Who can message (1-2 Nov 2026): read straight from the agent's own .env, config.yaml, pairing store and WhatsApp
      lid-mapping files, never from the 10-minute platforms cache (allowlist.mjs decides; it matches the engine and the
      WhatsApp bridge). GET: per channel the people who may message (one row per person, every alias; groups apart) and
      what strangers get; the list for every channel. POST remove-person: one person (or "*", or clear:true for one whole
      list) off the lists the row stands for and out of the approvals, then everything read again.
      Writing touches only the agent asked about, never another's files:
      - a list: under the engine's own .env lock (editEnv) and in the same in-app queue as the WhatsApp loop guard, worked
        out from the file as it is then; the engine is then told that value for this profile (PUT without `enabled`, so a
        paused channel stays paused), which makes a named agent's gateway apply it at once. The main agent's gateway keeps
        its old list in memory until the agents restart, and the answer says so.
      - an approval: in this agent's own pairing store, under the store's own lock (its folder's .lock), never through the
        engine's revoke: that also rewrites the dashboard's own scope, the MAIN agent's .env, whatever profile was asked.
      For an agent other than the main one the check afterwards also proves the main agent's .env did not change. */
   if((p==='/ui/channels/who'&&req.method==='GET')||(p==='/ui/channels/remove-person'&&req.method==='POST')){const post_=req.method==='POST';let b={};if(post_){try{b=JSON.parse(await readBody(req,4096))}catch{}}
    const ag=String(post_?b.agent:url.searchParams.get('agent')||'default'),base=ag.split('--')[0];if(ag.startsWith('.')||!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent.'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+base+'/soul','PUT',new URLSearchParams(),base)!==null)return send(res,403,{error:'You can only see and change who may message agents you may edit.'}),true;
    const home=ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),envF=path.join(home,'.env'),hh={'x-hermes-session-token':DASH_TOKEN},pdir=pairingDir(home);
    // the store's own approvals ({platform}-approved.json); the engine's /api/pairing would add the .env entries again
    const approvals=async()=>{const out=[];for(const n of await readdir(pdir).catch(()=>[])){const m=/^(.+)-approved\.json$/.exec(n);if(!m)continue;let d={};try{d=JSON.parse(await readFile(path.join(pdir,n),'utf8'))}catch{continue}
     for(const [uid,v] of Object.entries(d&&typeof d==='object'?d:{}))out.push({platform:m[1],user_id:uid,user_name:v?.user_name||''})}return out};
    const read=async()=>{const [env,approved,conf]=await Promise.all([readFile(envF,'utf8').catch(()=>'').then(parseEnv),approvals(),readConfig(ag).catch(()=>({}))]);return {env,approved,mapping:waMapping(home),conf:conf||{}}};
    if(!post_){const st=await read();const pl=await platformsCached(ag).catch(()=>null);
     const on=(pl?.platforms||pl||[]).filter?.(c=>(c.configured||c.state==='connected'||c.paused)&&!['api_server','webhook'].includes(c.id)).map(c=>c.id)||[];
     const ids=[...new Set([...on,...st.approved.map(x=>x.platform),...Object.keys(st.env).map(k=>/^([A-Z0-9]+)_ALLOWED_USERS$/.exec(k)?.[1]).filter(x=>x&&x!=='GATEWAY').map(x=>x==='QQ'?'qqbot':x.toLowerCase())])];
     return send(res,200,{agent:ag,channels:ids.map(pf=>channelWho(st.env,pf,st.approved,st.mapping,st.conf)),global:globalWho(st.env,st.mapping,st.conf)}),true}
    const pf=String(b.platform||''),id=String(b.id??''),every=!!b.every,clear=b.clear===true;if(!/^[a-z0-9_]{1,40}$/.test(pf)&&!every)return send(res,400,{error:'Unknown channel.'}),true;
    const io={read,
     setList:(k,fn)=>envQueue(envF,async()=>{let val=null;const changed=await editEnv(envF,t=>setEnvLine(t,k,old=>{const v=fn(old??'');val=v;return v}));if(!changed)return {changed:false,hot:true};
      // tell the engine for this profile (this channel's own list only; the list for every channel is read at its start)
      const kp=/^([A-Z0-9]+)_ALLOWED_USERS$/.exec(k)?.[1];if(!kp||kp==='GATEWAY')return {changed:true,hot:false};
      const r=await fetch(DASH.origin+'/api/messaging/platforms/'+encodeURIComponent(kp==='QQ'?'qqbot':kp.toLowerCase())+'?profile='+encodeURIComponent(ag),{method:'PUT',headers:{...hh,'content-type':'application/json'},body:JSON.stringify(engineChange(k,val)),signal:AbortSignal.timeout(30000)}).catch(()=>null);
      return {changed:true,hot:!!(r?.ok&&(await r.json().catch(()=>({}))).hot_served)}}),
     revoke:(platform,ids)=>envQueue(envF,()=>withFlock(path.join(pdir,'.lock'),async()=>{const f=path.join(pdir,platform+'-approved.json');let d;try{d=JSON.parse(await readFile(f,'utf8'))}catch(e){if(e.code==='ENOENT')return;throw new Error('The approved list for '+platform+' could not be read, so it was left as it is.')}
      const {data,gone}=approvedWithout(d,platform,ids,waMapping(home));if(!gone.length)return;await writeStore(f,JSON.stringify(data,null,2),{mode:0o600})},10)),
     ...(ag==='default'?{}:{mainEnv:()=>readFile(path.join(HERMES_HOME,'.env'),'utf8').catch(()=>'')})};
    let out;try{out=await removePerson(io,{pf,id,every,clear})}catch(e){platCache.delete(ag);return send(res,e.status||500,{error:e.message}),true}
    if(id&&id!=='*'){const mp=waMapping(home);await editAdded(all=>{let ch=false;for(const k2 of Object.keys(all)){const [a2,p2,...r2]=k2.split('|');if(a2===ag&&(every||p2===pf)&&samePerson(p2,r2.join('|'),id,mp)){delete all[k2];ch=true}}return ch?undefined:false}).catch(()=>{})}
    platCache.delete(ag);console.log('who can message:',u.name||u.id,'removed',clear?'(the whole list)':id,'from',ag,every?'every channel':pf,out.still?'(still there: '+out.why.join(', ')+')':'');
    return send(res,200,{ok:!out.still,...out,main:ag==='default'}),true}
   if(p==='/ui/channels/approvals-added'&&req.method==='GET'){const all=await readFile(ADDED_FILE,'utf8').then(JSON.parse).catch(()=>({}));if(users.isAdmin(u))return send(res,200,all),true;
    // only the agents they may edit, as for adding someone (who added whom is not for everyone who can chat with it)
    const out={};for(const [k,v] of Object.entries(all)){const a=k.split('|')[0].split('--')[0];if(users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a)===null)out[k]=v}return send(res,200,out),true}
   // Remove access on a person added by hand: the engine's revoke runs from the page; this forgets the mark
   if(p==='/ui/channels/approve-person/forget'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||''),base=ag.split('--')[0];
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+base+'/soul','PUT',new URLSearchParams(),base)!==null)return send(res,403,{error:'Not your agent.'}),true;
    const k=ag+'|'+String(b.platform||'')+'|'+String(b.id||'');try{await editAdded(all=>{if(!all[k])return false;delete all[k]})}catch(e){return send(res,500,{error:'The mark could not be removed: '+e.message}),true}return send(res,200,{ok:true}),true}
   if(p==='/ui/channels/check'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),pf=String(b.platform||'');
    if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf))return send(res,400,{error:'Unknown channel'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+ag.split('--')[0],'GET',new URLSearchParams(),ag.split('--')[0]))return send(res,403,{error:'Not your agent.'}),true;
    const r=await checkChannel(ag,pf);attention.t=0;return send(res,200,r),true}
   if(p==='/ui/channels/attention'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,200,{items:[]}),true;return send(res,200,{items:await channelAttention(url.searchParams.has('fresh'))}),true}
   // removing a WhatsApp that is no longer wanted: its connection stops, the ended login is set aside, the channel is switched off
   if(p==='/ui/channels/remove'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||''),pf=String(b.platform||'');
    if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf)||['api_server','webhook','whatsapp'].includes(pf))return send(res,400,{error:'Unknown channel'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'You can only change agents you may edit.'}),true;
    if(ag.includes('--')){await links.remove(ag).catch(()=>{});platCache.clear();attention.t=0;return send(res,200,{ok:true}),true}
    const pl=await platformsCached(ag).catch(()=>null);const c=(pl?.platforms||pl||[]).find(x=>x.id===pf);const keys=(c?.env_vars||[]).map(v=>v.key).filter(Boolean);
    const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
    const r=await fetch(DASH.origin+'/api/messaging/platforms/'+pf+'?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:false,env:{},clear_env:keys,profile:ag})});const j=await r.json().catch(()=>({}));
    if(!r.ok)return send(res,400,{error:j.detail||j.error||'The engine did not accept it.'}),true;
    const ps=await pausedLoad();if(ps[ag+'|'+pf]){delete ps[ag+'|'+pf];await pausedSave(ps)}
    platCache.clear();attention.t=0;if(!j.hot_served&&ag==='default')restartGateway(pf+' removed from '+ag).catch(()=>{});console.log('channel',pf,'removed from',ag);return send(res,200,{ok:true}),true}
   if(p==='/ui/channels/whatsapp/remove'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default');
    if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'You can only change agents you may edit.'}),true;
    // a paused one goes too: its Paused row has nothing left to resume
    const unpause=async()=>{const ps=await pausedLoad();if(ps[ag+'|whatsapp']){delete ps[ag+'|whatsapp'];await pausedSave(ps)}};
    if(ag.includes('--')){await links.remove(ag).catch(()=>{});await unpause();platCache.clear();attention.t=0;return send(res,200,{ok:true,removed:'extra'}),true}
    // switched off first, and only when the engine says so is the login set aside
    const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
    const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:false,env:{WHATSAPP_ENABLED:'false'},profile:ag})}).catch(e=>({ok:false,json:async()=>({detail:e.message})}));const j=await r.json().catch(()=>({}));
    if(!r.ok)return send(res,400,{error:j.detail||j.error||'The engine did not accept it, so nothing was removed.'}),true;
    await stopBridges(ag);const dir=path.join(ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),'platforms','whatsapp','session');
    if(await stat(dir).then(()=>true,()=>false))await rename(dir,dir+'.unlinked-'+new Date().toISOString().replace(/[:.]/g,'-')).catch(()=>{});
    await unpause();platCache.clear();attention.t=0;if(!j.hot_served&&ag==='default')restartGateway('WhatsApp removed from '+ag).catch(()=>{});console.log('whatsapp removed from',ag);return send(res,200,{ok:true}),true}
   if((p==='/ui/channels/whatsapp/prepare'||p==='/ui/channels/whatsapp-reset')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}waLinking.set(String(b.agent||'default'),Date.now());
    const ag=String(b.agent||'default');if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'You can only link channels of agents you may edit.'}),true;
    const home=ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),dir=path.join(home,'platforms','whatsapp','session');
    platCache.delete(ag);const pl=await platformsCached(ag).catch(()=>null);const w=(pl?.platforms||pl||[]).find?.(x=>x.id==='whatsapp');
    // a working link is never thrown away by accident: replacing it (another phone) has to be asked for
    if(w?.state==='connected'&&!b.replace)return send(res,409,{error:'This WhatsApp is connected'+(w.account?.phone?' ('+w.account.phone+')':'')+'. To link a different phone, choose “Link a different phone”.',connected:true,account:w.account||null}),true;
    // a login that is only starting or reconnecting is not set aside unless the person asked to replace it
    const busy=w&&/retrying|reconnecting|connecting|starting/.test(w.state||'');
    if(busy&&!w.needs_link&&!b.replace)return send(res,409,{error:'This WhatsApp is reconnecting with its saved login'+(w.account?.phone?' ('+w.account.phone+')':'')+'. Give it a minute. To link a different phone, choose “Link a different phone”.',connected:true,account:w.account||null}),true;
    // the engine still retrying the old login would fight the new QR on the same files: switch it off first (and back on if the QR is not used)
    let switchedOff=false;if(busy){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
     const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:false,env:{},profile:ag})}).catch(()=>null);const j=await r?.json().catch(()=>({}))||{};
     if(r?.ok){switchedOff=true;if(!j.hot_served)await restartGateway('stopping WhatsApp retries on '+ag+' before linking')}}
    const stopped=await stopBridges(ag);
    let kept=null;if(await stat(dir).then(()=>true,()=>false)){const keep=dir+'.unlinked-'+new Date().toISOString().replace(/[:.]/g,'-');kept=path.basename(keep);await rename(dir,keep).catch(async()=>{const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true})});
     const parent=path.dirname(dir);const old=(await readdir(parent).catch(()=>[])).filter(n=>n.startsWith('session.unlinked-')).sort().reverse().slice(2);   // keep the last two ended logins only
     const {rm}=await import('node:fs/promises');for(const o of old)await rm(path.join(parent,o),{recursive:true,force:true}).catch(()=>{})}
    if(switchedOff)waPrepOff.set(ag,kept||'');else waPrepOff.delete(ag);
    platCache.clear();console.log('whatsapp: cleared the ended login of',ag,stopped?'(stopped '+stopped+' bridge)':'');return send(res,200,{ok:true,was:w?.account||null,kept}),true}
   // the QR window closed before a phone was linked: the ended login goes back, so the channel still shows (Logged out · Link again)
   if(p==='/ui/channels/whatsapp/restore'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),kept=String(b.kept||'');
    if(!(await listAllProfiles()).includes(ag)||!/^session\.unlinked-[\w-]+$/.test(kept))return send(res,400,{error:'Nothing to restore'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'Not your agent.'}),true;
    const dir=path.join(ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),'platforms','whatsapp','session');
    const keptDir=path.join(path.dirname(dir),kept);if(!await stat(keptDir).then(x=>x.isDirectory(),()=>false))return send(res,200,{ok:true,restored:false}),true;
    // prepare switched it off to make room for the QR: the old login goes back on as it was
    const backOn=async()=>{if(waPrepOff.get(ag)!==kept)return;waPrepOff.delete(ag);const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
     const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:true,env:{},profile:ag})}).catch(()=>null);const j=await r?.json().catch(()=>({}))||{};
     if(!r?.ok)console.warn('whatsapp: could not switch',ag,'back on after a cancelled link:',j.detail||j.error||'no answer');else if(!j.hot_served)restartGateway('WhatsApp back on '+ag+' after a cancelled link').catch(()=>{})};
    // a new phone got linked: kept unless the person cancelled after scanning (force), then that login is set aside (never deleted)
    // and the old one goes back, with every bridge on it stopped first so nothing keeps writing to it
    if(await stat(path.join(dir,'creds.json')).then(()=>true,()=>false)){if(b.force!==true)return send(res,200,{ok:true,restored:false}),true;
     await stopBridges(ag);const aside=dir+'.unlinked-'+new Date().toISOString().replace(/[:.]/g,'-')+'-cancelled';
     try{await rename(dir,aside)}catch(e){return send(res,500,{error:'Could not set the new login aside: '+e.message}),true}
     try{await rename(keptDir,dir)}catch(e){await rename(aside,dir).catch(()=>{});return send(res,500,{error:'Could not put the old login back: '+e.message}),true}
     await backOn();platCache.clear();attention.t=0;console.log('whatsapp: cancelled after scanning on',ag,'- new login set aside, old one back');return send(res,200,{ok:true,restored:true,setAside:path.basename(aside)}),true}
    await stopBridges(ag,{pairOnly:true});const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true});await rename(keptDir,dir).catch(()=>{});await backOn();platCache.clear();return send(res,200,{ok:true,restored:true}),true}
   if(p==='/ui/channels/shares'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can share channels.'}),true;
    if(req.method==='GET'){const sh=await relay.shares();return send(res,200,{shares:sh}),true}
    if(req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const v=await relay.setShare(String(b.owner||''),String(b.platform||''),b);syncNotifyTool().catch(e=>console.warn('notify tool',e.message));return send(res,200,{share:v}),true}}
   if(p==='/ui/channels/recipients'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;return send(res,200,{recipients:await relay.recipients(url.searchParams.get('owner')||'default',url.searchParams.get('platform')||'')}),true}
   if(p==='/ui/channels/send'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}const from=String(b.from||b.owner||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+from,'GET',new URLSearchParams(),from))return send(res,403,{error:'You can only send as an agent you use.'}),true;
    try{return send(res,200,await relay.sendAs(from,String(b.owner||''),String(b.platform||''),String(b.text||''),b.chat?String(b.chat):null,{person:!users.isAdmin(u)})),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/channels/for'&&req.method==='GET'){const a=url.searchParams.get('agent')||'default';if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'}),true;
    return send(res,200,{channels:await relay.channelsFor(a)}),true}   // its own, its extra connections and shared ones, each with an ID
  return false}}
