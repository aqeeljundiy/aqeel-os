// Live: apps published from Code, running on the server (Dokploy) at <name>.<LIVE_DOMAIN>. Anyone signed in can
// publish from Code on their computer (the project is uploaded as a zip; Dokploy works out how to build and run it).
// Each app runs in its own container in a separate Dokploy project, never on the AI box, with its own Postgres
// database when it needs one (DATABASE_URL). aqeelOS talks to Dokploy with an API key an admin pastes in once.
// Who can open an app (visibility, the publisher or an admin picks it):
//   public   = anyone, and listed for the whole team under Code › Live
//   unlisted = anyone with the link; listed only for its publisher and admins
//   private  = only people signed in to aqeelOS (Traefik asks aqeelOS first: forwardAuth to /live-auth)
// Admins see every app with its visits (from the server's request log), can take any offline (stopped, kept) or delete it.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {brandAppOff} from './icons-off.mjs';

// names kept for aqeelOS or for later; any other address that already answers is taken too (taken())
const RESERVED=new Set(['www','app','apps','ai','api','code','code-preview','n8n','mail','admin','deploy','dokploy','live','dashboard','status','static','cdn','test','staging','preview','auth','login','signin','smtp','imap','ftp','vpn','git','blog','shop','store','docs','help','support','assets','files','media','pub']);
const VIS=['public','unlisted','private'];
const PRIVATE_MW='aq-live-private@file';
const RAILPACK='0.15.4';   // the version Dokploy 0.30 sets by itself on the server's other apps
const DAY=864e5,dayKey=t=>new Date(t).toISOString().slice(0,10);

export function createLive({DATA,DOMAIN='app.localhost',SECRET,PUBLIC_URL,AUTH_URL=process.env.LIVE_AUTH_URL||'http://ai-box:4400/live-auth',auto=false,onIcons=async()=>{}}){
 const FILE=path.join(DATA,'live.json');let db=null;
 const load=async()=>{if(!db){db=await readStore(FILE);db.apps||=[];db.dokploy||={};db.stats||={}}return db};
 // saves run one after another so two never share the .tmp file; a failed one still lets the next run
 let saving=Promise.resolve();
 const save=()=>{const p=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(db,null,1))});saving=p.catch(()=>{});return p};
 // addresses being published right now, so two people can't claim the same new one at once
 const busy=new Set();
 // Dokploy's API: POST /api/<procedure> with the key in x-api-key (GET with ?input= for reads); trpc for the few
 // procedures its OpenAPI leaves out (the request log)
 async function dk(proc,body,{get=false,form=null,trpc=false}={}){const c=(await load()).dokploy;if(!c.url||!c.key)throw Error('Live isn’t connected to the server yet. An admin connects it under Code › Live.');
  // (the REST reads take their fields as plain query parameters; ?input= is refused as "Input validation failed")
  const u=c.url.replace(/\/$/,'')+(trpc?'/api/trpc/'+proc+'?input='+encodeURIComponent(JSON.stringify({json:body})):'/api/'+proc+(get&&body?'?'+new URLSearchParams(body):''));
  const r=await fetch(u,{method:get||trpc?'GET':'POST',headers:{'x-api-key':c.key,...(form?{}:{'content-type':'application/json'})},body:get||trpc?undefined:form||JSON.stringify(body||{}),signal:AbortSignal.timeout(form?300000:30000)});
  const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}
  if(!r.ok)throw Error('The server said: '+(j?.message||j?.error?.message||j?.error?.json?.message||t.slice(0,200)||r.status));return trpc?j?.result?.data?.json:j}
 const clean=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
 const urlOf=slug=>'https://'+slug+'.'+DOMAIN;
 // the Dokploy project and environment the apps go into ("Live apps"), made once
 async function envId(){const c=db.dokploy;if(c.environmentId)return c.environmentId;
  const find=async()=>{const all=await dk('project.all',null,{get:true});const p=(all||[]).find(x=>x.name==='Live apps');return p&&(p.environments?.[0]?.environmentId)};
  let id=await find();if(!id){await dk('project.create',{name:'Live apps',description:'Apps published from aqeelOS Code. aqeelOS creates and removes them.'});id=await find()}
  if(!id)throw Error('Could not make the Live apps project on the server.');c.environmentId=id;await save();return id}
 // a new address and key are kept only once the server answers with them; a wrong one leaves the old ones in place
 async function connect({url,key}){await load();const next={url:String(url||'').trim().replace(/\/$/,''),key:String(key||'').trim()};if(!/^https?:\/\//.test(next.url)||next.key.length<10)throw Error('Paste the server address and its API key.');
  const prev=db.dokploy;db.dokploy=next;try{await envId();await privateMiddleware()}catch(e){db.dokploy=prev;throw e}await save();return {ok:true}}

 /* ---------- private apps: Traefik asks aqeelOS (forwardAuth) before every request ---------- */
 // the middleware, defined once in Traefik's dynamic folder; each private app's routers name it
 async function privateMiddleware(){const yml='# aqeelOS Live: private apps ask aqeelOS who is visiting (only people signed in to aqeelOS get in)\nhttp:\n  middlewares:\n    aq-live-private:\n      forwardAuth:\n        address: '+AUTH_URL+'\n        trustForwardHeader: true\n        authResponseHeaders:\n          - X-Aq-User\n';
  await dk('settings.updateTraefikFile',{path:'/etc/dokploy/traefik/dynamic/aq-live-private.yml',traefikConfig:yml})}
 // add or take out the middleware in every router of the app's own Traefik file (Dokploy's layout: routers at 4 spaces,
 // their keys at 6, list items at 8)
 function withPrivate(yml,on){const L=yml.split('\n'),out=[];let inRouters=false;
  for(let i=0;i<L.length;i++){const l=L[i];
   if(/^\S/.test(l))inRouters=/^http:/.test(l)?inRouters:false;if(/^  routers:\s*$/.test(l)){inRouters=true;out.push(l);continue}if(/^  \S/.test(l)&&!/^  routers:/.test(l))inRouters=false;
   if(!inRouters||!/^    \S[^:]*:\s*$/.test(l)){out.push(l);continue}
   // one router: copy it, then fix its middlewares
   const block=[l];while(i+1<L.length&&/^ {6}/.test(L[i+1]))block.push(L[++i]);
   // its middlewares as a list below the key, or inline ("middlewares: []" / "[a, b]")
   let mi=block.findIndex(x=>/^ {6}middlewares:/.test(x));let items=[];
   if(mi>=0){const inl=/^ {6}middlewares:\s*\[(.*)\]\s*$/.exec(block[mi]);let n=1;
    if(inl)items=inl[1].split(',').map(x=>x.trim().replace(/^["']|["']$/g,'')).filter(Boolean);else{let j=mi+1;while(j<block.length&&/^ {8}- /.test(block[j]))items.push(block[j++].trim().slice(2));n+=items.length}
    block.splice(mi,n)}
   items=items.filter(x=>x!==PRIVATE_MW);if(on)items.push(PRIVATE_MW);
   if(items.length){const at=Math.max(1,block.findIndex(x=>/^ {6}rule:/.test(x))+1);block.splice(at,0,'      middlewares:',...items.map(x=>'        - '+x))}
   out.push(...block)}
  return out.join('\n')}
 async function applyVisibility(a){if(!a.appId)return;if(a.visibility==='private')await privateMiddleware();const cur=await dk('application.readTraefikConfig',{applicationId:a.appId},{get:true});
  if(typeof cur!=='string'||!cur.includes('routers:'))return;const next=withPrivate(cur,a.visibility==='private');if(next!==cur)await dk('application.updateTraefikConfig',{applicationId:a.appId,traefikConfig:next})}
 // signed passes: a short one in the address (from aqeelOS to the app), a longer one as the app's own cookie
 const sign=s=>createHmac('sha256',SECRET).update('live|'+s).digest('base64url');
 const pass=(host,uid,ms)=>{const v=host+'|'+uid+'|'+(Date.now()+ms);return Buffer.from(v).toString('base64url')+'.'+sign(v)};
 const readPass=(t,host)=>{const [b,s]=String(t||'').split('.');if(!b||!s)return null;const v=Buffer.from(b,'base64url').toString();const want=sign(v);
  if(want.length!==s.length||!timingSafeEqual(Buffer.from(want),Buffer.from(s)))return null;const [h,uid,exp]=v.split('|');return h===host&&+exp>Date.now()?uid:null};
 const appByHost=host=>{const m=new RegExp('^([a-z0-9-]+)\\.'+DOMAIN.replace(/\./g,'\\.')+'$').exec(String(host||'').toLowerCase().split(':')[0]);return m&&db?.apps.find(a=>a.slug===m[1])};
 // GET /live-auth from Traefik: 200 lets the request through; anything else goes back to the visitor as is
 async function auth(req,res,userById){await load();const h=req.headers,host=String(h['x-forwarded-host']||'').split(',')[0].trim(),uri=String(h['x-forwarded-uri']||'/');
  const a=appByHost(host);if(!a||a.visibility!=='private'){res.writeHead(200);return res.end()}
  const back='https://'+host+uri;const ok=async uid=>{const u=uid&&await userById(uid);return u&&!u.disabled?u:null};
  // arriving from aqeelOS with a pass in the address: keep it as this app's cookie and drop it from the address
  const q=new URL(uri,'https://x');const tk=q.searchParams.get('aq_live');
  if(tk){const u=await ok(readPass(tk,host));if(u){q.searchParams.delete('aq_live');res.writeHead(302,{location:'https://'+host+q.pathname+(q.search||''),'set-cookie':'aq_live='+pass(host,u.id,7*DAY)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+7*86400,'cache-control':'no-store'});return res.end()}}
  const ck=/(?:^|;\s*)aq_live=([^;]+)/.exec(String(h.cookie||''))?.[1];const u=await ok(readPass(ck,host));
  if(u){res.writeHead(200,{'x-aq-user':String(u.name||u.username||u.id).replace(/[^\w .@-]/g,'')});return res.end()}
  res.writeHead(302,{location:PUBLIC_URL+'/live-login?to='+encodeURIComponent(back),'cache-control':'no-store'});res.end()}
 // GET /live-login?to=<app address> on aqeelOS: signed in → back to the app with a one-minute pass; else sign in first
 async function login(req,res,u){await load();const to=new URL(req.url,'http://x').searchParams.get('to')||'';let t;try{t=new URL(to)}catch{}
  const a=t&&t.protocol==='https:'&&appByHost(t.host);if(!a){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});return res.end('No such app.')}
  if(!u){res.writeHead(302,{location:'/?live_next='+encodeURIComponent('/live-login?to='+encodeURIComponent(to))+'#/signin','cache-control':'no-store'});return res.end()}
  t.searchParams.set('aq_live',pass(t.host,u.id,60000));res.writeHead(302,{location:t.href,'cache-control':'no-store'});res.end()}

 /* ---------- visits: counted from the server's request log (Dokploy › Requests), every 10 minutes ---------- */
 async function statsTick(){await load();if(!db.dokploy.key||!db.apps.length)return;
  const on=await dk('settings.haveActivateRequests',null,{get:true}).catch(()=>null);db.stats.on=on===true;if(!db.stats.on){await save();return}
  const since=db.stats.cursor||Date.now()-DAY;let newest=since,stop=false;const hosts=new Map(db.apps.map(a=>[a.slug+'.'+DOMAIN,a]));
  for(let page=0;page<20&&!stop;page++){const r=await dk('settings.readStatsLogs',{page:{pageIndex:page,pageSize:500},sort:{id:'StartUTC',desc:true}},{trpc:true}).catch(()=>null);const l=r?.data||[];if(!l.length)break;
   for(const e of l){const t=Date.parse(e.StartUTC||e.StartLocal||e.time||'');if(!t)continue;if(t<=since){stop=true;break}if(t>newest)newest=t;
    const a=hosts.get(String(e.RequestHost||'').toLowerCase().split(':')[0]);if(!a)continue;
    // pages people open (not redirects such as a private app's sign-in hop), not every image or script they load
    const p=String(e.RequestPath||'/').split('?')[0];const st=+e.DownstreamStatus;if(String(e.RequestMethod||'GET')!=='GET'||!(st>=200&&st<300||st===304)||/\.[a-z0-9]{1,5}$/i.test(p)&&!/\.html?$/i.test(p))continue;
    a.visits||={};const k=dayKey(t);a.visits[k]=(a.visits[k]||0)+1;if(!a.lastVisit||t>a.lastVisit)a.lastVisit=t}}
  db.stats.cursor=newest;const keep=dayKey(Date.now()-62*DAY);for(const a of db.apps)for(const k of Object.keys(a.visits||{}))if(k<keep)delete a.visits[k];await save()}
 const sumDays=(a,n)=>{const from=dayKey(Date.now()-(n-1)*DAY);return Object.entries(a.visits||{}).reduce((s,[k,v])=>k>=from?s+v:s,0)};
 // unused = online for over 2 weeks with no page opened in 30 days (only once visits are being counted)
 const unused=a=>Boolean(db.stats.on&&a.status==='live'&&Date.now()-(a.created||0)>14*DAY&&!sumDays(a,30)&&(!a.lastVisit||Date.now()-a.lastVisit>30*DAY));

 const view=(a,u,admin)=>({id:a.id,name:a.name,slug:a.slug,url:urlOf(a.slug),owner:a.owner,ownerName:a.ownerName,repo:a.repo||'',db:Boolean(a.dbId),status:a.stopped?'offline':a.status,error:a.error||'',created:a.created,updated:a.updated,
  visibility:a.visibility||'unlisted',icon:a.icons?{source:a.icons.source,needsLogo:a.icons.needsLogo}:null,mine:a.owner===u.id,canManage:a.owner===u.id||admin,canRemove:a.owner===u.id||admin,
  ...(a.owner===u.id||admin?{visits7:sumDays(a,7),visits30:sumDays(a,30),lastVisit:a.lastVisit||null,unused:unused(a)}:{})});
 // the team sees public apps; unlisted and private ones only their publisher and admins
 async function list(u,admin){await load();return {apps:db.apps.filter(a=>admin||a.owner===u.id||(a.visibility||'unlisted')==='public').map(a=>view(a,u,admin)).sort((a,b)=>(b.updated||0)-(a.updated||0)),
  connected:Boolean(db.dokploy.url&&db.dokploy.key),domain:DOMAIN,stats:Boolean(db.stats.on)}}
 // the app's state on the server
 async function refresh(a){try{const app=await dk('application.one',{applicationId:a.appId},{get:true});const s=app?.applicationStatus;
  const next=s==='done'?'live':s==='running'?'building':s==='error'?'failed':a.status;if(next!==a.status){a.status=next;a.error=next==='failed'?'The build failed. Ask Code to check that the app starts with npm start (or is a plain website), then publish again.':'';await save()}}catch{}return a}
 async function check(id){await load();const a=db.apps.find(x=>x.id===id);if(!a)throw Error('No such app.');if(a.appId)await refresh(a);return a}
 // is this address free for this person? (theirs already, or unused on this domain)
 async function taken(slug){const r=await fetch(urlOf(slug)+'/',{redirect:'manual',signal:AbortSignal.timeout(8000)}).catch(()=>null);if(!r)return false;
  if(r.status!==404)return true;return !/404 page not found/i.test(await r.text().catch(()=>''))}
 async function nameCheck(u,raw){await load();const slug=clean(raw);if(slug.length<2)return {ok:false,slug,reason:'At least 2 letters.'};
  if(RESERVED.has(slug))return {ok:false,slug,reason:slug+'.'+DOMAIN+' is kept for aqeelOS. Choose another name.'};
  const a=db.apps.find(x=>x.slug===slug);if(a)return a.owner===u.id?{ok:true,slug,mine:true,domain:DOMAIN}:{ok:false,slug,reason:slug+'.'+DOMAIN+' belongs to '+(a.ownerName||'someone else')+'.'};
  if(await taken(slug))return {ok:false,slug,reason:slug+'.'+DOMAIN+' is already in use. Choose another name.'};return {ok:true,slug,domain:DOMAIN}}
 // publish (or update) one app from a zip of its project
 // can a new address on this domain open at all? A certificate that does not cover it (Cloudflare covers one level: x.example.com, not x.app.example.com) or no wildcard DNS fails every app
 let domainOk=0;async function domainProblem(){if(/localhost$/.test(DOMAIN)||Date.now()-domainOk<3600e3||process.env.NODE_TEST_CONTEXT)return '';
  const host='aq-check-'+Math.random().toString(36).slice(2,8)+'.'+DOMAIN;
  try{await fetch('https://'+host+'/',{redirect:'manual',signal:AbortSignal.timeout(12000)});domainOk=Date.now();return ''}
  catch(e){const c=String(e?.cause?.code||e?.cause?.message||e?.message||'');if(/ENOTFOUND|EAI_AGAIN/.test(c))return 'No address on '+DOMAIN+' can be found. Add a wildcard DNS record (*.'+DOMAIN+') pointing at this server, then publish again.';
   if(/SSL|TLS|CERT|EPROTO|alert/i.test(c))return 'Addresses on '+DOMAIN+' have no valid HTTPS certificate. Cloudflare covers one level only: set LIVE_DOMAIN to your main domain (example.com, not app.example.com).';return ''}}
 async function publish(u,o={}){const slug=clean(o.slug||o.name);{const bad=await domainProblem();if(bad)throw Error(bad)}if(busy.has(slug))throw Error('Someone is publishing '+slug+'.'+DOMAIN+' right now. Try again in a minute.');
  busy.add(slug);try{return await publishOne(u,o)}finally{busy.delete(slug)}}
 async function publishOne(u,{name,slug,repo,database,zip,visibility}){await load();slug=clean(slug||name);
  if(!zip?.length)throw Error('The project is empty.');let a=db.apps.find(x=>x.slug===slug);
  if(!a){const n=await nameCheck(u,slug);if(!n.ok)throw Error(n.reason)}else if(a.owner!==u.id)throw Error(slug+'.'+DOMAIN+' already belongs to '+(a.ownerName||'someone else')+'. Choose another name.');
  // any failure from here on marks the app failed with its reason
  try{const env=await envId();
  // setup:false until its build type and address are made, so a failed first publish redoes them on retry (older records have no field: done)
  if(!a){a={id:'l'+randomBytes(6).toString('hex'),slug,name:String(name||slug).slice(0,80),owner:u.id,ownerName:u.name||u.username||'',repo:'',created:Date.now(),status:'building',setup:false,visibility:VIS.includes(visibility)?visibility:'unlisted'};
   const app=await dk('application.create',{name:'live-'+slug,appName:'live-'+slug,description:'Published by '+a.ownerName+' from aqeelOS Code',environmentId:env});
   a.appId=app?.applicationId;if(!a.appId){const all=await dk('project.all',null,{get:true});a.appId=(all||[]).flatMap(p=>p.environments||[]).flatMap(e=>e.applications||[]).find(x=>x.name==='live-'+slug)?.applicationId}
   if(!a.appId)throw Error('The server did not make the app.');
   db.apps.push(a);await save()}
  if(a.setup===false||a.railpack!==RAILPACK){if(a.setup!==false){await dk('application.saveBuildType',{applicationId:a.appId,buildType:'railpack',dockerfile:null,dockerContextPath:null,dockerBuildStage:null,herokuVersion:null,railpackVersion:RAILPACK});a.railpack=RAILPACK}}
  if(a.setup===false){
   // Railpack works out how to build it: Node, Python, Go, PHP, a plain website…
   // with Dokploy's own Railpack version (no version made it fetch "railpack vnull" and every build failed)
   await dk('application.saveBuildType',{applicationId:a.appId,buildType:'railpack',dockerfile:null,dockerContextPath:null,dockerBuildStage:null,herokuVersion:null,railpackVersion:RAILPACK});
   await dk('domain.create',{host:slug+'.'+DOMAIN,path:'/',port:3000,https:true,certificateType:'letsencrypt',applicationId:a.appId,domainType:'application'});a.setup=true;a.railpack=RAILPACK;await save()}
  a.name=String(name||a.name).slice(0,80);if(repo)a.repo=String(repo).slice(0,200);a.ownerName=u.name||u.username||a.ownerName;if(VIS.includes(visibility))a.visibility=visibility;
  // a database the first time it asks for one
  if(database&&!a.dbId){const pw=randomBytes(18).toString('base64url');const pg=await dk('postgres.create',{name:'live-'+slug+'-db',appName:'live-'+slug+'-db',databaseName:'app',databaseUser:'app',databasePassword:pw,environmentId:env});
   let id=pg?.postgresId;if(!id){const all=await dk('project.all',null,{get:true});id=(all||[]).flatMap(p=>p.environments||[]).flatMap(e=>e.postgres||[]).find(x=>x.name==='live-'+slug+'-db')?.postgresId}
   if(!id)throw Error('The server did not make the database.');const one=await dk('postgres.one',{postgresId:id},{get:true});await dk('postgres.deploy',{postgresId:id});
   a.dbId=id;a.dbUrl='postgresql://app:'+pw+'@'+(one?.appName||'live-'+slug+'-db')+':5432/app'}
  await dk('application.saveEnvironment',{applicationId:a.appId,env:'PORT=3000\nHOST=0.0.0.0\nNODE_ENV=production'+(a.dbUrl?'\nDATABASE_URL='+a.dbUrl:''),buildArgs:'',buildSecrets:'',createEnvFile:true});
  await applyVisibility(a);
  // home-screen icon and manifest from the app's own logo, only for what the project lacks (pwa-zip.mjs); no real logo = the plain tile and one question
  // drawn off the main thread with a time limit (icons-off.mjs): a logo that cannot be drawn in time leaves the project as it is
  {const r=await brandAppOff(zip,{name:a.name,mono:a.mono}).catch(e=>({zip,added:[],kept:[],source:'',needsLogo:false,skipped:'Its icons were not made: '+String(e.message).slice(0,200)}));if(r.zip!==zip)zip=r.zip;a.icons={at:Date.now(),source:r.source,added:r.added.length,kept:r.kept,needsLogo:r.needsLogo,why:r.why||'',skipped:r.skipped||''};await save();onIcons(a,r).catch(e=>console.warn('live icons',e.message))}
  const form=new FormData();form.append('applicationId',a.appId);form.append('zip',new Blob([zip],{type:'application/zip'}),'app.zip');
  a.status='building';a.error='';a.stopped=false;a.updated=Date.now();await save();
  await dk('application.dropDeployment',null,{form})}catch(e){if(a){a.status='failed';a.error=e.message;await save()}throw e}
  return view(a,u,false)}
 const mineOr=(u,admin,id,what)=>{const a=db.apps.find(x=>x.id===id);if(!a)throw Error('No such app.');if(a.owner!==u.id&&!admin)throw Error('Only its publisher or an admin can '+what+'.');return a};
 async function setVisibility(u,admin,id,v){await load();const a=mineOr(u,admin,id,'change who can open it');if(!VIS.includes(v))throw Error('Choose public, unlisted or private.');
  const was=a.visibility;a.visibility=v;try{await applyVisibility(a)}catch(e){a.visibility=was;throw e}await save();return view(a,u,admin)}
 // take offline = stopped on the server, everything kept; back online = started again
 async function setOnline(u,admin,id,on){await load();const a=mineOr(u,admin,id,on?'put it back online':'take it offline');
  await dk(on?'application.start':'application.stop',{applicationId:a.appId});a.stopped=!on;if(on)a.status='live';await save();return view(a,u,admin)}
 // delete = the app and its database are removed from the server
 async function remove(u,admin,id){await load();const a=mineOr(u,admin,id,'delete it');
  if(a.appId)await dk('application.delete',{applicationId:a.appId}).catch(e=>{if(!/not found/i.test(e.message))throw e});
  if(a.dbId)await dk('postgres.remove',{postgresId:a.dbId}).catch(e=>{if(!/not found/i.test(e.message))throw e});
  db.apps=db.apps.filter(x=>x!==a);await save();return {ok:true}}
 // admins: switch the server's request log on so visits can be counted (Traefik restarts for a few seconds)
 async function countVisits(on){await dk('settings.toggleRequests',{enable:!!on});await dk('settings.reloadTraefik',{});   // the log setting is read only when Traefik starts
await load();db.stats.on=!!on;if(on&&!db.stats.cursor)db.stats.cursor=Date.now();await save();return {ok:true}}
 if(auto){setInterval(()=>statsTick().catch(e=>console.warn('live visits',e.message)),10*60000).unref()}
 // the owner chose a letter for an app with no logo: used from its next publish
 async function useLetter(slug){await load();const a=db.apps.find(x=>x.slug===slug);if(!a)throw Error('No such app.');a.mono=true;await save();return {ok:true}}
 return {useLetter,list,publish,remove,check,connect,clean,urlOf,nameCheck,setVisibility,setOnline,countVisits,auth,login,statsTick,withPrivate}}
