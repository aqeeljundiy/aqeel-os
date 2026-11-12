// The end of the signed-in /ui/ gate: reconnecting, pausing and moving a channel, QR codes, which account a key belongs to, built-in skills,
// names and descriptions, Explain, run gates and design-guard answers, Usage and its savings, chat starters, a member finishing an agent's
// setup, then the role gate (users.gate) and what comes after it: model accounts, Connect, service logos and the agents' names and pictures
// (/ui/channels/reconnect, /ui/channels/pause, /ui/channels/move, /ui/qr, /ui/keys/identity, /ui/skills/builtin, /ui/labels, /ui/explain,
// /ui/run-gates, /ui/design-guard, /ui/usage, /ui/starters, /ui/accounts, /ui/connect, /ui/logo, /ui/identities, /ui/avatar). They used to sit
// in server.mjs inside the signed-in /ui/ gate, last. Same checks in the same order; server.mjs calls this where the block was (the person `u`
// is already signed in and the x-hui header already checked) and it always answers: the last line hands anything left to identities().
import {unlink,readFile,mkdir,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {emojiSlugs,emojiAuto,AVATAR_TYPES,readPicture} from './avatar-file.mjs';
import {randomBytes} from 'node:crypto';
import {channelsPause} from './route-handlers.mjs';
import {HELP_AGENT} from './agentops.mjs';
export function createIdentitiesRoutes({accountsApi,billion,builtins,channels,connect,DASH,DASH_TOKEN,DATA,designGuard,displayName,explain,graphify,HERMES_HOME,keysId,labels,listAgents,listAllProfiles,NAMES,okProfile,ownsAgent,pausedLoad,platCache,readBody,readIds,reconnectOne,restartGateway,runGates,security,send,setChannelOn,setDisplayName,starters,usage,users,waitingNow,withIds,writeIds}){
// agent pictures: a photo (cropped to 256x256 in the browser, checked by its first bytes, one file per agent) or an emoji
// from assets/emoji (avatar-file.mjs). The two replace each other. With neither, the agent gets an automatic emoji from its
// id. avatarV changes with every new photo, so /ui/avatar/<agent>?v= shows the new one everywhere at once
async function identities(req,res,p,u){
 if(p==='/ui/identities'&&req.method==='GET'){const ids=await readIds();for(const a of await listAgents().catch(()=>[])){const n=String(ids[a]?.name||'').trim();if(!n)ids[a]={...(ids[a]||{}),name:NAMES[a]||await displayName(a)}}return send(res,200,ids)}
 const m=/^\/ui\/(identities|avatar)\/([^/]+)$/.exec(p);if(!m)return send(res,404,{error:'Not found'});
 const profile=decodeURIComponent(m[2]);if(!okProfile(profile))return send(res,400,{error:'Bad profile name'});
 const dropPhoto=async(cur,x)=>{if(cur.avatar)await unlink(path.join(DATA,'avatars',cur.avatar)).catch(()=>{});delete x.avatar;delete x.avatarV};
 const fail=e=>send(res,e.status||500,{error:e.message});
 if(m[1]==='identities'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{return send(res,400,{error:'Bad JSON'})}
  if('emoji' in b){const e=String(b.emoji||'');if(e&&!(await emojiSlugs()).includes(e))return send(res,400,{error:'Pick one of the listed emoji.'})}
  return withIds(async ids=>{const cur=ids[profile]||{};
   const name='name' in b?String(b.name||'').trim().slice(0,60):cur.name||'',title='title' in b?String(b.title||'').trim().slice(0,80):cur.title||'';   // a body with only the emoji keeps the name
   const next={...cur,name,title,updated:Date.now()};
   if('emoji' in b){const e=String(b.emoji||'');if(!e)delete next.emoji;else{next.emoji=e;await dropPhoto(cur,next)}}   // an emoji replaces the photo
   ids[profile]=next;await writeIds(ids);await setDisplayName(profile,name);if(!String(profile).includes('--'))NAMES[profile]=name||await displayName(profile);return send(res,200,ids[profile])}).catch(fail)}
 // no photo: send the agent's emoji (chosen or automatic) so anything outside the app that asks for the picture still gets one.
 // A private agent the person may not open shows only its automatic emoji, never its photo or chosen picture.
 if(m[1]==='avatar'&&req.method==='GET'){const cur=(await readIds())[profile]||{},base=profile.split('--')[0],ow=users.byId(users.agentOwner(base));
  const hidden=!!u&&!!ow&&!users.isAdmin(ow)&&!users.level(u,base);
  if(!cur.avatar||hidden){const l=await emojiSlugs(),e=!hidden&&l.includes(cur.emoji)?cur.emoji:emojiAuto(profile,l);if(!e)return send(res,404,'No picture');res.writeHead(302,{location:'/assets/emoji/'+e+'.png','cache-control':'private, max-age=300',...security});return res.end()}
  try{const body=await readFile(path.join(DATA,'avatars',cur.avatar));res.writeHead(200,{'content-type':AVATAR_TYPES[cur.avatar.split('.').pop()]||'application/octet-stream','cache-control':'private, max-age=86400',...security});return res.end(body)}catch{return send(res,404,'No picture')}}
 if(m[1]==='avatar'&&req.method==='PUT'){const r=await readPicture(req);if(r.error)return send(res,r.status,{error:r.error});
  return withIds(async ids=>{const cur=ids[profile]||{};
   const dir=path.join(DATA,'avatars'),file=profile+'.'+r.ext,tmp=path.join(dir,file+'.'+randomBytes(4).toString('hex')+'.tmp');await mkdir(dir,{recursive:true});await writeFile(tmp,r.buf);await rename(tmp,path.join(dir,file));
   if(cur.avatar&&cur.avatar!==file)await unlink(path.join(dir,cur.avatar)).catch(()=>{});   // one file per agent
   const {emoji:_e,...rest}=cur;ids[profile]={...rest,avatar:file,avatarV:Date.now()};await writeIds(ids);return send(res,200,ids[profile])}).catch(fail)}   // a photo replaces the emoji
 if(m[1]==='avatar'&&req.method==='DELETE')return withIds(async ids=>{const cur=ids[profile]||{};await dropPhoto(cur,cur);ids[profile]=cur;await writeIds(ids);return send(res,200,cur)}).catch(fail);   // back to its emoji, or the automatic one
 send(res,405,{error:'Method not allowed'});
}
/* ---------- service logos: fetched once per domain, cached on the box, served from this origin ---------- */
const LOGOS=path.join(DATA,'logos');
const letterSvg=(d)=>{const l=(d||'?')[0].toUpperCase();return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#0b0c10"/><text x="32" y="42" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${l}</text></svg>`};
// what kind of image a logo file really is (Google sometimes answers with JPEG or ICO)
const imgType=b=>b[0]===0x89&&b[1]===0x50?'image/png':b[0]===0xff&&b[1]===0xd8?'image/jpeg':b.slice(0,3).toString()==='GIF'?'image/gif':b.slice(8,12).toString()==='WEBP'?'image/webp':'image/x-icon';
async function logo(req,res){
 const d=String(new URL(req.url,'http://x').searchParams.get('d')||'').toLowerCase();
 if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)||d.length>80)return send(res,400,'bad domain');
 const file=path.join(LOGOS,d+'.png'),miss=path.join(LOGOS,d+'.miss');
 const hdr={'cache-control':'public, max-age=604800','x-content-type-options':'nosniff'};
 try{const b=await readFile(file);res.writeHead(200,{'content-type':imgType(b),...hdr});return res.end(b)}catch{}
 const short={'cache-control':'private, max-age=300','x-content-type-options':'nosniff'};   // a letter is a stand-in: let browsers ask again soon
 try{await stat(miss);res.writeHead(200,{'content-type':'image/svg+xml',...short});return res.end(letterSvg(d))}catch{}
 // Google answers unknown domains with a generic 16 px globe, so a logo counts only when the PNG is at least
 // 48 px wide (read from its header; small files can still be real logos). DuckDuckGo is the second source.
 const pngWidth=b=>b.length>24&&b.readUInt32BE(0)===0x89504e47?b.readUInt32BE(16):0;
 for(const [url,ok] of [[`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`,b=>pngWidth(b)>=48],[`https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico`,b=>pngWidth(b)>=32||(b.length>1500&&b[0]===0&&b[2]===1)||(b.length>1500&&b.slice(8,12).toString()==='WEBP')]]){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(8000)});const buf=Buffer.from(await r.arrayBuffer());
   if(r.ok&&ok(buf)){await mkdir(LOGOS,{recursive:true});await writeFile(file,buf);res.writeHead(200,{'content-type':imgType(buf),...hdr});return res.end(buf)}}catch{}}
 await mkdir(LOGOS,{recursive:true}).catch(()=>{});await writeFile(miss,'').catch(()=>{});
 res.writeHead(200,{'content-type':'image/svg+xml',...short});res.end(letterSvg(d));
}
 return async function handle(req,res,p,url,u){
   if(p==='/ui/channels/reconnect'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}if(!ownsAgent(u,b.agent))return send(res,403,{error:'Only an admin or this agent’s owner reconnects its channels.'}),true;
    const ag=String(b.agent||''),pf=String(b.platform||'');if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf))return send(res,400,{error:'Unknown channel'}),true;
    if((await pausedLoad())[ag+'|'+pf])return send(res,409,{error:'This channel is paused. Pick who answers it under Owned by first.'}),true;
    if(ag==='default'){restartGateway('reconnect '+pf+' (main agent)',{bridges:pf==='whatsapp'}).catch(()=>{});return send(res,200,{ok:true,restarting:true,waiting:await waitingNow()}),true}
    let j;try{j=await reconnectOne(ag,pf)}catch(e){platCache.clear();return send(res,502,{error:e.message}),true}platCache.clear();
    console.log('reconnected',pf,'on',ag,j.hot_served?'(live)':'');return send(res,200,{ok:true,restarting:false}),true}
   // an admin or the agent's owner (ownsAgent(u, agent) is checked inside: route-handlers.mjs, tested as a member, an owner and an admin)
   if(p==='/ui/channels/pause'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const r=await channelsPause({u,body:b,ownsAgent,profiles:listAllProfiles,setChannelOn});return send(res,r.status,r.body),true}
   if(p==='/ui/channels/move'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can move channels.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{return send(res,200,await channels.move(String(b.platform||''),String(b.from||''),String(b.to||''))),true}catch(e){return send(res,400,{error:e.message}),true}}   // the pause, sharing and note follow in channels' moved hook
   // QR codes (WhatsApp linking…): drawn here with the qrcode library that ships with the engine
   if(p==='/ui/qr'&&req.method==='GET'){const d=String(url.searchParams.get('d')||'');if(!d||d.length>2000)return send(res,400,'bad'),true;
    try{const mod=await import(path.join(HERMES_HOME,'hermes-agent','node_modules','qrcode','lib','index.js'));const QR=mod.default||mod;const svg=await QR.toString(d,{type:'svg',margin:1,errorCorrectionLevel:'M',color:{dark:'#0b0c10',light:'#ffffff'}});
     res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(svg),true}catch(e){return send(res,500,{error:'QR could not be drawn: '+e.message}),true}}
   // names and descriptions (labels.mjs): everyone signed in reads them, admins change them; ids never change here
   // which account each key belongs to (keys-identity.mjs): admins only; never a secret, only the account and last 4
   if(p==='/ui/keys/identity'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins see keys.'}),true;return send(res,200,await keysId.list()),true}
   if(p==='/ui/keys/identity/check'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can check keys.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{return send(res,200,await keysId.check(String(b.id||''))),true}catch(e){return send(res,e.status||500,{error:e.message}),true}}
   // which skills and plugins are Built in (ship with aqeelOS or the engine); the rest were added on this OS
   if(p==='/ui/skills/builtin'&&req.method==='GET')return send(res,200,await builtins.names()),true;
   if(p==='/ui/skills/builtin'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change this.'}),true;let b={};try{b=JSON.parse(await readBody(req,1024))}catch{}await builtins.setWanted(!!b.install);return send(res,200,b.install?await builtins.install({log:m=>console.log(m),force:true}):{ok:true}),true}
   if(p==='/ui/labels'&&req.method==='GET')return send(res,200,{labels:await labels.all()}),true;
   if(p==='/ui/labels'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can rename things.'}),true;let b={};try{b=JSON.parse(await readBody(req,8192))}catch{return send(res,400,{error:'Bad JSON'}),true}
    try{const v=await labels.set(String(b.kind||''),String(b.id||''),{name:b.name,description:b.description});console.log('label',b.kind+':'+b.id,'by',u.id||u.name||'?');return send(res,200,{ok:true,label:v}),true}catch(e){return send(res,e.status||500,{error:e.message}),true}}
   if(p==='/ui/explain'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,300000))}catch{}const items=(Array.isArray(b.items)?b.items:[]).slice(0,300).map(x=>({id:String(x?.id||'').slice(0,120),name:String(x?.name||'').slice(0,160),desc:String(x?.desc||'').slice(0,600)}));return send(res,200,await explain.get(String(b.kind||''),items,{write:users.isAdmin(u)})),true}
   // what billion-context saved and whether graphify is ready, for the Usage page (admins: it covers every agent)
   // run gates (run-gates.mjs): per schedule how many runs the gate stopped, and the rate proposals (admins)
   // "Add a check" / "Keep every N min" on the Health item of a schedule that starts the AI too often with no check (run-gates.mjs)
   if(p==='/ui/run-gates/decide'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins decide this.'}),true;let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}
    try{return send(res,200,await runGates.decide(String(b.agent||''),String(b.job||''),String(b.choice||''))),true}catch(e){return send(res,409,{error:e.message}),true}}
   // schedules that mostly woke the AI for nothing (design-guard.mjs): the Health item's buttons, and the review on demand
   if(p==='/ui/design-guard/decide'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins decide this.'}),true;let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}
    try{return send(res,200,await designGuard.decide(String(b.agent||''),String(b.job||''),String(b.choice||''))),true}catch(e){return send(res,409,{error:e.message}),true}}
   if(p==='/ui/design-guard/review'&&(req.method==='GET'||req.method==='POST')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins see this.'}),true;return send(res,200,{agents:await designGuard.review({force:req.method==='POST'})}),true}
   if(p==='/ui/run-gates'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins see this.'}),true;return send(res,200,await runGates.view()),true}
   if(p==='/ui/usage/savings'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins see savings for every agent.'}),true;
    const [compress,maps]=await Promise.all([billion.savings().catch(()=>null),graphify.status().catch(()=>null)]);return send(res,200,{compress,maps}),true}
   if(p==='/ui/usage'&&req.method==='GET'){const days=Math.min(365,Math.max(1,+url.searchParams.get('days')||7));const ag=String(url.searchParams.get('agent')||''),every=[...await listAllProfiles(),HELP_AGENT];   // Help's chats are each person's: its own line on Usage
    const all=await usage.breakdown(ag&&ag!=='all'?every.filter(x=>x===ag||x.startsWith(ag+'--')):every,days,users.ownerOf);
    const people=Object.fromEntries(users.people().map(x=>[x.id,{...users.face(x),name:x.name,limit:users.limitOf(x)||null}]));   // the limit that applies (a role's too), not only one set on the person
    if(!users.isAdmin(u))return send(res,200,{days,byPerson:{[u.id]:all.byPerson[u.id]||null},people:{[u.id]:people[u.id]},today:await usage.today(await listAllProfiles(),u.id,users.ownerOf)}),true;
    return send(res,200,{...all,people}),true}
   // the suggestions an empty chat starts with, for this install (admins write them on System › Branding)
   if(p==='/ui/starters/defaults'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;if(req.method==='GET')return send(res,200,await starters.defaults()),true;
    let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}return send(res,200,await starters.setDefaults(b)),true}
   if(p==='/ui/starters'){const agent=url.searchParams.get('agent')||'default';if(users.gate(u,'/ui/screens/'+agent,'GET',new URLSearchParams(),agent))return send(res,403,{error:'That agent is not shared with you.'}),true;
    let recent=[];try{const r=await fetch(`${DASH.origin}/api/sessions?limit=60${agent==='default'?'':'&profile='+encodeURIComponent(agent)}`,{headers:{'x-hermes-session-token':DASH_TOKEN}});recent=users.filter(u,'/hapi/sessions',await r.json()).sessions||[]}catch{}
    return send(res,200,await starters.get(u.id,users.isAdmin(u)?'admin':'member',agent,recent)),true}
   // a member finishing the setup of an agent they own (New agent, Finish setup): the same steps the app runs for it
   if(p==='/ui/accounts/setup-agent'&&req.method==='POST'&&!users.isAdmin(u)){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const n=String(b.name||'');
    if(users.level(u,n)!=='owner')return send(res,403,{error:'Only the owner of this agent can finish its setup.'}),true;
    return accountsApi(req,res,p,send,async()=>JSON.stringify({name:n}),a=>users.level(u,a)==='owner'),true}
   const no=users.gate(u,p,req.method,url.searchParams,'default');if(no)return send(res,no.status,{error:no.error}),true;
   // connecting, reconnecting, renaming and removing a model account, its priority and switching: admins only, every
   // route the same way (25 Oct; before, adding a Claude account and sending its code were open to any signed-in admin
   // check that passed the gate, while Google checked inside its own handler). Reading the list stays as the gate says.
   if((p.startsWith('/ui/accounts/old-code')||/^\/ui\/accounts\/[a-z0-9-]+\/login$/.test(p)||p.startsWith('/ui/accounts')&&req.method!=='GET')&&!users.isAdmin(u))return send(res,403,{error:'Only admins can change model accounts.'}),true;
   if(p.startsWith('/ui/connect/')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change model accounts.'}),true;return connect.handle(req,res,p,send,readBody),true}
   if(p.startsWith('/ui/accounts'))return accountsApi(req,res,p,send,readBody,a=>!!users.level(u,a)),true;
   if(p==='/ui/logo')return logo(req,res),true;
   return identities(req,res,p,u),true;
  return false}}
