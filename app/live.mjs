// Live: apps published from Code, running on the server (Dokploy) at <name>.<LIVE_DOMAIN>. Anyone signed in can
// publish from Code on their computer (the project is uploaded as a zip; Dokploy works out how to build and run it)
// and see every published app here; the publisher can update or take theirs offline, admins can take any offline.
// Each app runs in its own container in a separate Dokploy project, never on the AI box, with its own Postgres
// database when it needs one (DATABASE_URL). aqeelOS talks to Dokploy with an API key an admin pastes in once.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const RESERVED=new Set(['www','app','apps','ai','api','code','code-preview','n8n','mail','admin','deploy','dokploy','live','dashboard','status','static','cdn','test','staging']);
export function createLive({DATA,DOMAIN='app.localhost'}){
 const FILE=path.join(DATA,'live.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.apps||=[];db.dokploy||={}}return db};
 // saves run one after another so two never share the .tmp file; a failed one still lets the next run
 let saving=Promise.resolve();
 const save=()=>{const p=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)});saving=p.catch(()=>{});return p};
 // addresses being published right now, so two people can't claim the same new one at once
 const busy=new Set();
 // Dokploy's API: POST /api/<procedure> with the key in x-api-key (GET with ?input= for reads)
 async function dk(proc,body,{get=false,form=null}={}){const c=(await load()).dokploy;if(!c.url||!c.key)throw Error('Live isn’t connected to the server yet. An admin connects it under Code › Live.');
  const u=c.url.replace(/\/$/,'')+'/api/'+proc+(get&&body?'?input='+encodeURIComponent(JSON.stringify(body)):'');
  const r=await fetch(u,{method:get?'GET':'POST',headers:{'x-api-key':c.key,...(form?{}:{'content-type':'application/json'})},body:get?undefined:form||JSON.stringify(body||{}),signal:AbortSignal.timeout(form?300000:30000)});
  const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}
  if(!r.ok)throw Error('The server said: '+(j?.message||j?.error?.message||t.slice(0,200)||r.status));return j}
 const clean=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
 const urlOf=slug=>'https://'+slug+'.'+DOMAIN;
 // the Dokploy project and environment the apps go into ("Live apps"), made once
 async function envId(){const c=db.dokploy;if(c.environmentId)return c.environmentId;
  const find=async()=>{const all=await dk('project.all',null,{get:true});const p=(all||[]).find(x=>x.name==='Live apps');return p&&(p.environments?.[0]?.environmentId)};
  let id=await find();if(!id){await dk('project.create',{name:'Live apps',description:'Apps published from aqeelOS Code. aqeelOS creates and removes them.'});id=await find()}
  if(!id)throw Error('Could not make the Live apps project on the server.');c.environmentId=id;await save();return id}
 // a new address and key are kept only once the server answers with them; a wrong one leaves the old ones in place
 async function connect({url,key}){await load();const next={url:String(url||'').trim(),key:String(key||'').trim()};if(!/^https?:\/\//.test(next.url)||next.key.length<10)throw Error('Paste the server address and its API key.');
  const prev=db.dokploy;db.dokploy=next;try{await envId()}catch(e){db.dokploy=prev;throw e}await save();return {ok:true}}
 const view=(a,u,admin)=>({id:a.id,name:a.name,slug:a.slug,url:urlOf(a.slug),owner:a.owner,ownerName:a.ownerName,repo:a.repo||'',db:Boolean(a.dbId),status:a.status,error:a.error||'',created:a.created,updated:a.updated,mine:a.owner===u.id,canRemove:a.owner===u.id||admin});
 async function list(u,admin){await load();return {apps:db.apps.map(a=>view(a,u,admin)).sort((a,b)=>(b.updated||0)-(a.updated||0)),connected:Boolean(db.dokploy.url&&db.dokploy.key),domain:DOMAIN}}
 // the app's state on the server
 async function refresh(a){try{const app=await dk('application.one',{applicationId:a.appId},{get:true});const s=app?.applicationStatus;
  const next=s==='done'?'live':s==='running'?'building':s==='error'?'failed':a.status;if(next!==a.status){a.status=next;a.error=next==='failed'?'The build failed. Ask Code to check that the app starts with npm start (or is a plain website), then publish again.':'';await save()}}catch{}return a}
 async function check(id){await load();const a=db.apps.find(x=>x.id===id);if(!a)throw Error('No such app.');if(a.appId)await refresh(a);return a}
 // publish (or update) one app from a zip of its project
 async function publish(u,o={}){const slug=clean(o.slug||o.name);if(busy.has(slug))throw Error('Someone is publishing '+slug+'.'+DOMAIN+' right now. Try again in a minute.');
  busy.add(slug);try{return await publishOne(u,o)}finally{busy.delete(slug)}}
 async function publishOne(u,{name,slug,repo,database,zip}){await load();slug=clean(slug||name);if(slug.length<2)throw Error('Give the app a name of at least 2 letters.');
  if(RESERVED.has(slug))throw Error('“'+slug+'” is taken. Choose another name.');if(!zip?.length)throw Error('The project is empty.');
  let a=db.apps.find(x=>x.slug===slug);if(a&&a.owner!==u.id)throw Error(slug+'.'+DOMAIN+' already belongs to '+(a.ownerName||'someone else')+'. Choose another name.');
  // any failure from here on marks the app failed with its reason
  try{const env=await envId();
  // setup:false until its build type and address are made, so a failed first publish redoes them on retry (older records have no field: done)
  if(!a){a={id:'l'+randomBytes(6).toString('hex'),slug,name:String(name||slug).slice(0,80),owner:u.id,ownerName:u.name||u.username||'',repo:'',created:Date.now(),status:'building',setup:false};
   const app=await dk('application.create',{name:'live-'+slug,appName:'live-'+slug,description:'Published by '+a.ownerName+' from aqeelOS Code',environmentId:env});
   a.appId=app?.applicationId;if(!a.appId){const all=await dk('project.all',null,{get:true});a.appId=(all||[]).flatMap(p=>p.environments||[]).flatMap(e=>e.applications||[]).find(x=>x.name==='live-'+slug)?.applicationId}
   if(!a.appId)throw Error('The server did not make the app.');
   db.apps.push(a);await save()}
  if(a.setup===false){
   // Railpack works out how to build it: Node, Python, Go, PHP, a plain website…
   await dk('application.saveBuildType',{applicationId:a.appId,buildType:'railpack',dockerfile:null,dockerContextPath:null,dockerBuildStage:null,herokuVersion:null,railpackVersion:null});
   await dk('domain.create',{host:slug+'.'+DOMAIN,path:'/',port:3000,https:true,certificateType:'letsencrypt',applicationId:a.appId,domainType:'application'});a.setup=true;await save()}
  a.name=String(name||a.name).slice(0,80);if(repo)a.repo=String(repo).slice(0,200);a.ownerName=u.name||u.username||a.ownerName;
  // a database the first time it asks for one
  if(database&&!a.dbId){const pw=randomBytes(18).toString('base64url');const pg=await dk('postgres.create',{name:'live-'+slug+'-db',appName:'live-'+slug+'-db',databaseName:'app',databaseUser:'app',databasePassword:pw,environmentId:env});
   let id=pg?.postgresId;if(!id){const all=await dk('project.all',null,{get:true});id=(all||[]).flatMap(p=>p.environments||[]).flatMap(e=>e.postgres||[]).find(x=>x.name==='live-'+slug+'-db')?.postgresId}
   if(!id)throw Error('The server did not make the database.');const one=await dk('postgres.one',{postgresId:id},{get:true});await dk('postgres.deploy',{postgresId:id});
   a.dbId=id;a.dbUrl='postgresql://app:'+pw+'@'+(one?.appName||'live-'+slug+'-db')+':5432/app'}
  await dk('application.saveEnvironment',{applicationId:a.appId,env:'PORT=3000\nHOST=0.0.0.0\nNODE_ENV=production'+(a.dbUrl?'\nDATABASE_URL='+a.dbUrl:''),buildArgs:'',buildSecrets:'',createEnvFile:true});
  const form=new FormData();form.append('applicationId',a.appId);form.append('zip',new Blob([zip],{type:'application/zip'}),'app.zip');
  a.status='building';a.error='';a.updated=Date.now();await save();
  await dk('application.dropDeployment',null,{form})}catch(e){if(a){a.status='failed';a.error=e.message;await save()}throw e}
  return view(a,u,false)}
 async function remove(u,admin,id){await load();const a=db.apps.find(x=>x.id===id);if(!a)throw Error('No such app.');if(a.owner!==u.id&&!admin)throw Error('Only its publisher or an admin can take it offline.');
  if(a.appId)await dk('application.delete',{applicationId:a.appId}).catch(e=>{if(!/not found/i.test(e.message))throw e});
  if(a.dbId)await dk('postgres.remove',{postgresId:a.dbId}).catch(e=>{if(!/not found/i.test(e.message))throw e});
  db.apps=db.apps.filter(x=>x!==a);await save();return {ok:true}}
 return {list,publish,remove,check,connect,clean,urlOf}}
