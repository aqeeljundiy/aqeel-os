import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFile, readdir, access, mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID} from 'node:crypto';
import {LoginConsole} from './login.mjs';
import {createWorkspaceAPI,previewOrigin} from './workspace-api.mjs';
import {createAqeelos} from './aqeelos.mjs';
import {createPlanning} from './planning.mjs';
import {Accounts,readCodexAccount} from './accounts.mjs';
import * as platform from './platform.mjs';
import {Remote,isLoopback,pairPage} from './remote.mjs';
import {CLAUDE_MODELS,listCodexModels} from './models.mjs';
import {GEMINI_MODELS,locateGemini,geminiAuth,geminiSignIn} from './gemini.mjs';
let codexModels={at:0,list:[]};
async function models(){if(Date.now()-codexModels.at>600000||!codexModels.list.length){const exe=await findExecutable('codex');codexModels={at:Date.now(),list:exe?await listCodexModels(exe,accounts.env(),work):[]}}// Gemini's own list is saved after a run (data/gemini-models.json); until then its tier aliases
 let gemini=GEMINI_MODELS;try{const saved=JSON.parse(await readFile(path.join(root,'data','gemini-models.json'),'utf8'));if(saved.length)gemini=[GEMINI_MODELS[0],...saved.map(m=>({id:m.modelId,name:m.name||m.modelId,description:m.description||'',efforts:[],defaultEffort:''}))]}catch{}
 return {codex:codexModels.list,claude:CLAUDE_MODELS,gemini}}
const root=path.dirname(fileURLToPath(import.meta.url));
const aqeelos=createAqeelos({root});
const work=path.join(root,'scratch');
await mkdir(work,{recursive:true});
const token=randomBytes(24).toString('hex');
const jobs=new Map();
let active=0;
const cleanEnv={...process.env};
for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','GEMINI_API_KEY','GOOGLE_API_KEY']) delete cleanEnv[key];
for(const key of ['CODEX_API_KEY','CODEX_AUTH_JSON','CLAUDE_CODE_OAUTH_TOKEN']) delete cleanEnv[key];
const accounts=await new Accounts(root,cleanEnv).init();
const claudeAccounts=await new Accounts(root,cleanEnv,'claude').init();
const store=p=>p==='claude'?claudeAccounts:accounts;
const remote=await new Remote(root).init();
async function exists(p){try{await access(p);return true}catch{return false}}
async function directories(p){try{return await readdir(p,{withFileTypes:true})}catch{return []}}
async function findExecutable(name){
 const variable=process.env[name.toUpperCase()+'_CLI_PATH'];
 if(variable && await exists(variable))return variable;
 for(const p of (process.env.PATH||'').split(path.delimiter)){const target=path.join(p,platform.exeName(name));if(await exists(target))return target;}
 if(name==='codex'){
  const base=path.join(os.homedir(),'AppData/Local/OpenAI/Codex/bin');
  for(const d of (await directories(base)).reverse()){const p=path.join(base,d.name,'codex.exe');if(await exists(p))return p;}
 }
 if(name==='claude'){
  const native=path.join(os.homedir(),'.local/bin/claude.exe');if(await exists(native))return native;
  const packages=path.join(os.homedir(),'AppData/Local/Packages');
  for(const pkg of await directories(packages))if(pkg.name.startsWith('Claude_')){
   const base=path.join(packages,pkg.name,'LocalCache/Roaming/Claude/claude-code');
   const versions=(await directories(base)).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true}));
   for(const version of versions)for(const build of await directories(path.join(base,version.name))){const p=path.join(base,version.name,build.name,'claude.exe');if(await exists(p))return p;}
  }
 }
 return platform.findOnPath(name);
}
const loginConsole=new LoginConsole({cwd:work,env:cleanEnv,findExecutable,geminiSignIn:async onOutput=>{const g=await locateGemini({appRoot:root,findOnPath:platform.findOnPath});if(!g)throw Error('Gemini CLI is not installed. Run: npm install -g @google/gemini-cli');return {promise:geminiSignIn(g,{cwd:work,env:cleanEnv,onOutput})}}});
export function validatePrompt(value){if(typeof value!=='string'||!value.trim()||value.length>12000)throw Error('Enter a prompt between 1 and 12,000 characters.');return value.trim()}
function execute(exe,args,input='',timeout=90000,options={}){return new Promise(resolve=>{
 let stdout='',stderr='',settled=false;
 const child=spawn(exe,args,{cwd:work,env:options.env||cleanEnv,windowsHide:true,shell:false});
 options.onSpawn?.(child);
 const timer=setTimeout(()=>{child.kill();finish({code:-1,error:'Timed out. Try a shorter prompt.',stdout,stderr})},timeout);
 function finish(result){if(settled)return;settled=true;clearTimeout(timer);resolve(result)}
 child.stdout.on('data',d=>{stdout+=d;if(stdout.length>2000000)child.kill()});
 child.stderr.on('data',d=>{stderr+=d;if(stderr.length>2000000)child.kill()});
 child.on('error',e=>finish({code:-1,error:e.message,stdout,stderr}));
 child.on('close',code=>finish({code,stdout,stderr}));
 child.stdin.on('error',()=>{});child.stdin.end(input);
})}
async function status(name,profileId){
 if(name==='gemini'){const g=await locateGemini({appRoot:root,findOnPath:platform.findOnPath});if(!g)return {id:'gemini',installed:false,ready:false,message:'Not installed. Run: npm install -g @google/gemini-cli'};const a=await geminiAuth(cleanEnv);return {id:'gemini',installed:true,ready:a.ready,gemini:g,path:g.command,method:a.method||null,account:{email:a.email||null},message:a.message}}
 const exe=await findExecutable(name);if(!exe)return {id:name,installed:false,ready:false,message:'Not found on this PC'};
 if(name==='codex'){const profile=accounts.profile(profileId);const info=await readCodexAccount(exe,accounts.env(profile.id),work);const ready=info.account?.type==='chatgpt';return {id:name,installed:true,ready,path:exe,...info,profileId:profile.id,profileLabel:profile.label,message:ready?'Signed in with ChatGPT':'Sign in to this Codex profile.'}}
 const cp=claudeAccounts.profile(profileId);const result=await execute(exe,['auth','status'],'',10000,{env:claudeAccounts.env(cp.id)});
 let auth;try{auth=JSON.parse(result.stdout)}catch{}
 const ready=result.code===0&&auth?.loggedIn===true&&auth?.authMethod==='claude.ai';
 return {id:name,installed:true,ready,path:exe,profileId:cp.id,profileLabel:cp.label,account:{email:auth?.email||null,name:auth?.name||null,plan:auth?.subscriptionType||null},message:ready?'Signed in with Claude account; billing depends on provider policy':'Claude subscription login not confirmed. Sign in through Claude Code.'};
}
async function selectAccount(name){if(name==='codex')return accounts.choose(id=>status('codex',id));if(name==='claude'&&claudeAccounts.state.profiles.length>1)return claudeAccounts.choose(async id=>{const s=await status('claude',id);return {...s,exhausted:s.ready&&await claudeExhausted(s.account?.email)}});return status(name)}
// a Claude account is spent when a window recorded from its last runs is at 100% and has not reset yet
async function claudeExhausted(email){if(!email)return false;try{const l=JSON.parse(await readFile(path.join(root,'data','limits.json'),'utf8'))['claude:'+email];return Boolean(l?.windows?.some(w=>w.usedPercent>=100&&(!w.resetsAt||w.resetsAt>Date.now())))}catch{return false}}
export function parseResponse(name,stdout){
 if(name==='claude'){try{const data=JSON.parse(stdout);return {text:data.result||'',failed:Boolean(data.is_error),billing:typeof data.total_cost_usd==='number'?'CLI reported estimated usage: $'+data.total_cost_usd.toFixed(4)+'. This does not establish how your account was billed.':null}}catch{return {text:stdout.trim()}}}
 let text='',error='';for(const line of stdout.split('\n')){try{const event=JSON.parse(line);if(event.type==='item.completed'&&event.item?.type==='agent_message')text+=event.item.text+'\n';if(event.type==='error'||event.type==='turn.failed')error=event.message||event.error?.message||'Provider request failed.'}catch{}}
 return {text:text.trim(),failed:Boolean(error),error};
}
async function run(job){
 active++;
 try{
  const provider=await selectAccount(job.provider);if(!provider.ready)throw Error(provider.message);
  job.account=provider.profileLabel||provider.account?.email||'Desktop account';job.switched=Boolean(provider.switched);
  const prompt='Respond to the following prompt using text only. Do not access files or run tools.\n\n'+job.prompt;
  const args=job.provider==='codex'?['exec','--ignore-user-config','--sandbox','read-only','--skip-git-repo-check','--ephemeral','--json','-']:['-p','--output-format','json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--settings','{"disableAllHooks":true}','--no-session-persistence'];
  const result=await execute(provider.path,args,prompt,90000,{env:job.provider==='codex'?accounts.env(provider.profileId):cleanEnv});
  const parsed=parseResponse(job.provider,result.stdout);
  if(result.code!==0||parsed.failed||!parsed.text)throw Error(parsed.error||parsed.text||result.error||result.stderr.trim()||'The provider returned no response.');
  job.text=parsed.text;job.billing=parsed.billing;job.state='complete';
 }catch(e){job.state='failed';job.error=e.message.slice(0,4000)}finally{job.finishedAt=Date.now();active--}
}
const workspaceAPI=await createWorkspaceAPI({aqeelos,claudeAccounts,root,platform,appUrl:()=>'http://127.0.0.1:'+(server.address()?.port||4321),findExecutable,status:selectAccount,execute,parseResponse,env:cleanEnv,token,accounts});
const planning=await createPlanning(root);
const server=http.createServer(async(req,res)=>{
 const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
 const url=new URL(req.url,'http://127.0.0.1'),local=isLoopback(req.socket.remoteAddress);
 if(local){const hostname=(req.headers.host||'').split(':')[0];if(!['127.0.0.1','localhost'].includes(hostname))return send(403,{error:'Local access only.'})}
 else{ // phone / other device on the network
  if(!remote.state.enabled)return send(403,{error:'Phone access is turned off on the computer.'});
  if(url.pathname==='/pair'){if(req.method==='POST'){let body='';for await(const c of req){body+=c;if(body.length>2000)return send(413,{error:'Too large.'})}const f=new URLSearchParams(body);
    try{const t=await remote.pair(f.get('code'),f.get('name'));res.writeHead(303,{Location:'/','Set-Cookie':'cba_device='+t+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=7776000'});return res.end()}catch(e){res.writeHead(400,{'Content-Type':'text/html; charset=utf-8'});return res.end(pairPage(e.message))}}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(pairPage())}
  const open=/^\/assets\/(icon-\d+\.png|plus-jakarta-sans\.woff2|elkiya-mark\.svg)$/.test(url.pathname)||url.pathname==='/manifest.webmanifest';
  if(!open&&!remote.device(req.headers.cookie)){if(req.method==='GET'&&!url.pathname.startsWith('/api/')){res.writeHead(303,{Location:'/pair'});return res.end()}return send(401,{error:'Pair this device first.'})}
  if(url.pathname.startsWith('/api/remote'))return send(403,{error:'Manage phone access from the computer.'})}
 try{
  if(req.method==='POST'||url.pathname==='/api/login'||url.pathname==='/api/accounts'){
   const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`)return send(403,{error:'Origin rejected.'});
   if(req.headers['x-local-token']!==token)return send(403,{error:'Reload the page before sending.'});
  }
  // aqeelOS: this computer's link (shown inside aqeelOS, paired by the page with a key aqeelOS gives it)
  if(url.pathname==='/api/aqeelos'&&req.method==='GET')return send(200,await aqeelos.state());
  if(url.pathname==='/api/aqeelos/pair'&&req.method==='POST'){let body='';for await(const c of req){body+=c;if(body.length>4000)return send(413,{error:'Too large.'})}const d=JSON.parse(body||'{}');try{return send(200,await aqeelos.pair(String(d.base||''),String(d.token||'')))}catch(e){return send(400,{error:e.message})}}
  if(url.pathname==='/api/aqeelos/agents'&&req.method==='GET')return send(200,{agents:await aqeelos.agents()});
  if(url.pathname==='/api/aqeelos/unpair'&&req.method==='POST')return send(200,await aqeelos.unpair());
  if(url.pathname==='/api/remote'&&req.method==='GET')return send(200,remote.view(server.address().port));
  if(url.pathname==='/api/remote'&&req.method==='POST'){let body='';for await(const c of req){body+=c;if(body.length>2000)return send(413,{error:'Too large.'})}const d=JSON.parse(body||'{}');
   if(d.action==='enable'||d.action==='disable'){await remote.setEnabled(d.action==='enable');await syncLan()}else if(d.action==='code')remote.newCode();else if(d.action==='revoke')await remote.revoke(d.id);else return send(400,{error:'Unknown action.'});return send(200,remote.view(server.address().port))}
  if(req.method==='GET'&&url.pathname==='/api/login')return send(200,{session:loginConsole.snapshot()});
  if(req.method==='POST'&&url.pathname.startsWith('/api/login/')){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>6000)return send(413,{error:'Input too long.'})}
   const data=JSON.parse(body);
   if(url.pathname==='/api/login/start'){const s=store(data.provider==='claude'?'claude':'codex'),profile=data.profileId?s.profile(data.profileId):null;return send(200,{session:await loginConsole.start(data.provider,profile?{env:s.env(profile.id),profileId:profile.id,profileLabel:profile.label}:{})})}
   if(url.pathname==='/api/login/input')return send(200,{session:loginConsole.input(data.id,data.value)});
   if(url.pathname==='/api/login/stop')return send(200,{session:loginConsole.stop(data.id)});
   return send(404,{error:'Not found.'});
  }
  if(req.method==='GET'&&url.pathname==='/api/models')return send(200,await models());
  if(req.method==='GET'&&url.pathname==='/api/share-hosts'){const port=server.address().port;return send(200,{lan:remote.state.enabled?remote.addresses(port).map(a=>'http://'+new URL(a.url).hostname+':'+(port+1)):[]})}
  if(req.method==='GET'&&url.pathname==='/api/status')return send(200,{token,preview:previewOrigin(req.headers.host),platform:{os:process.platform,shell:platform.shell('').label,prompt:platform.shell('').prompt,fileManager:platform.fileManagerName},providers:url.searchParams.has('quick')?[]:await Promise.all(['codex','claude','gemini'].map(name=>status(name)))});
  if(req.method==='GET'&&url.pathname==='/api/accounts'){const prov=url.searchParams.get('provider')==='claude'?'claude':'codex',s=store(prov);return send(200,{...s.state,provider:prov,profiles:await Promise.all(s.state.profiles.map(async p=>({...await status(prov,p.id),...p})))})}
  if(req.method==='POST'&&url.pathname==='/api/accounts'){let input='';for await(const c of req){input+=c;if(input.length>4000)throw Error('Account input too large.')}{const body=JSON.parse(input);return send(200,await store(body.provider==='claude'?'claude':'codex').update(body))}}
  if(req.method==='GET'&&url.pathname==='/api/session')return send(200,{token});
  if(req.method==='GET'&&url.pathname==='/api/development')return send(200,await planning.get());
  if(req.method==='POST'&&url.pathname==='/api/development'){let input='';for await(const c of req){input+=c;if(input.length>30000)throw Error('Task input too large.')}return send(200,await planning.update(JSON.parse(input)))}
  if(req.method==='GET'&&url.pathname==='/development.html'){res.writeHead(301,{Location:'/backlog'});return res.end()}
  if(req.method==='GET'&&url.pathname==='/prd'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; frame-src "+previewOrigin(req.headers.host)+" http://127.0.0.1:* http://localhost:*; img-src 'self' blob: data: "+previewOrigin(req.headers.host)+"; media-src 'self' blob: "+previewOrigin(req.headers.host)+"; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"});return res.end(await planning.prd())}
  if(req.method==='GET'&&/^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(url.pathname)){try{const body=await readFile(path.join(root,'data',url.pathname));res.writeHead(200,{'Content-Type':{png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[url.pathname.split('.').pop()],'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(body)}catch{return send(404,{error:'Not found.'})}}
  if(await workspaceAPI(req,res,url,send))return;
  if(req.method==='POST'&&url.pathname==='/api/run'){
   const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`)return send(403,{error:'Origin rejected.'});
   if(req.headers['x-local-token']!==token)return send(403,{error:'Reload the page before sending.'});
   let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)return send(413,{error:'Prompt too long.'})}
   const data=JSON.parse(body);const prompt=validatePrompt(data.prompt);if(!['codex','claude'].includes(data.provider))return send(400,{error:'Choose Claude or Codex.'});
   if(active>=2)return send(429,{error:'Two requests are running. Wait for one to finish.'});
   for(const [id,j]of jobs)if(j.finishedAt&&Date.now()-j.finishedAt>3600000)jobs.delete(id);
   const job={id:randomUUID(),provider:data.provider,prompt,state:'running',startedAt:Date.now()};jobs.set(job.id,job);void run(job);return send(202,{id:job.id});
  }
  if(req.method==='GET'&&url.pathname.startsWith('/api/jobs/')){const job=jobs.get(url.pathname.split('/').pop());return job?send(200,job):send(404,{error:'Request not found.'})}
  const files={'/':'studio.html','/kinds.js':'kinds.js','/ui-check.js':'scripts/ui-check.js','/doc-ui.js':'doc-ui.js','/md-lite.mjs':'md-lite.mjs','/design-ui.js':'design-ui.js','/artifacts-ui.js':'artifacts-ui.js','/canvas-ui.js':'canvas-ui.js','/data-ui.js':'data-ui.js','/deck-ui.js':'deck-ui.js','/deck-render.js':'deck-render.js','/deck.css':'deck.css','/mockup':'mockups/phase0.html','/mockup.css':'mockups/phase0.css','/mockup.js':'mockups/phase0.js','/studio.js':'studio.js','/studio.css':'studio.css','/connections':'index.html','/app.js':'app.js','/style.css':'style.css','/backlog':'development.html','/development.js':'development.js','/development.css':'development.css','/planning.css':'planning.css','/PRODUCT-REQUIREMENTS.md':'PRODUCT-REQUIREMENTS.md','/README.md':'README.md','/assets/plus-jakarta-sans.woff2':'assets/plus-jakarta-sans.woff2','/assets/elkiya-mark.svg':'assets/elkiya-mark.svg','/dropdown.js':'dropdown.js','/i18n.js':'i18n.js','/icons.js':'icons.js','/theme.js':'theme.js','/native-frame.js':'native-frame.js','/native-frame.css':'native-frame.css','/theme.css':'theme.css','/lang-id.js':'lang-id.js','/dropdown.css':'dropdown.css','/model-picker.js':'model-picker.js','/agent-ui.js':'agent-ui.js','/sidebar.js':'sidebar.js','/ui-kit.js':'ui-kit.js','/md.js':'md.js','/diff.mjs':'diff.mjs','/review.js':'review.js','/customize.js':'customize.js','/file-tree.js':'file-tree.js','/vt.js':'vt.js','/sw.js':'sw.js','/git-ui.js':'git-ui.js','/dev-ui.js':'dev-ui.js','/browser-ui.js':'browser-ui.js','/composer.js':'composer.js','/terminal-ui.js':'terminal-ui.js','/phone-ui.js':'phone-ui.js','/mobile.js':'mobile.js','/usage.html':'usage.html','/usage-ui.js':'usage-ui.js','/usage-cost.js':'usage-cost.js','/palette.js':'palette.js','/editor.js':'editor.js','/usage.css':'usage.css','/manifest.webmanifest':'manifest.webmanifest','/assets/icon-180.png':'assets/icon-180.png','/assets/icon-512.png':'assets/icon-512.png'};
  if(req.method==='GET'&&files[url.pathname]){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.md')?'text/plain; charset=utf-8':url.pathname.endsWith('.woff2')?'font/woff2':url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.webmanifest')?'application/manifest+json':url.pathname.endsWith('.svg')?'image/svg+xml':/\.m?js$/.test(url.pathname)?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; frame-src "+previewOrigin(req.headers.host)+" http://127.0.0.1:* http://localhost:*; img-src 'self' blob: data: "+previewOrigin(req.headers.host)+"; media-src 'self' blob: "+previewOrigin(req.headers.host)+"; frame-ancestors "+((await aqeelos.origins()).join(' ')||"'none'")+"; object-src 'none'; base-uri 'none'"});return res.end(await readFile(path.join(root,files[url.pathname])))}
  send(404,{error:'Not found.'});
 }catch(e){send(e.status||400,{error:e.message})}
});
// Website previews get their own origin on the next port so they are isolated from the app.
const previewServer=http.createServer(async(req,res)=>{const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 // share links: a frozen copy anyone with the link can view (from this computer, or the local network when phone access is on); pages run in a sandbox
 {const u=new URL(req.url,'http://127.0.0.1');const m=u.pathname.match(/^\/share\/([0-9a-f]{32})(\/.*)?$/);if(m){if(req.method!=='GET'||(!isLoopback(req.socket.remoteAddress)&&!remote.state.enabled))return send(404,{error:'Not found.'});if(!m[2]){res.writeHead(302,{Location:u.pathname+'/'});return res.end()}
  let rel='';try{rel=decodeURIComponent(m[2].slice(1))||'index.html'}catch{return send(400,{error:'Bad link.'})}if(rel.split('/').some(p=>p==='..'||p.startsWith('.')))return send(404,{error:'Not found.'});const base=path.join(root,'data','shares',m[1]),file=path.join(base,rel);if(!file.startsWith(base+path.sep))return send(404,{error:'Not found.'});
  try{const buf=await readFile(file);const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.woff2':'font/woff2','.csv':'text/csv; charset=utf-8','.mp4':'video/mp4','.webm':'video/webm'};res.writeHead(200,{'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox allow-scripts allow-forms allow-popups'});return res.end(buf)}catch{return send(404,{error:'This link was removed or never existed.'})}}}
 if(isLoopback(req.socket.remoteAddress)){const hostname=(req.headers.host||'').split(':')[0];if(!['127.0.0.1','localhost'].includes(hostname))return send(403,{error:'Local access only.'})}
 else if(!remote.state.enabled||!remote.device(req.headers.cookie))return send(401,{error:'Pair this device first.'});
 const url=new URL(req.url,'http://127.0.0.1');if(!url.pathname.startsWith('/preview/')&&!url.pathname.startsWith('/draft/'))return send(404,{error:'Not found.'});req.previewServer=true;
 try{await workspaceAPI(req,res,url,send)}catch(e){send(400,{error:e.message})}});
let lan=[];
async function syncLan(){for(const s of lan)s.close();lan=[];if(!remote.state.enabled)return;const port=server.address().port;
 for(const a of remote.addresses(port)){const ip=new URL(a.url).hostname;for(const [handler,p] of [[server.listeners('request')[0],port],[previewServer.listeners('request')[0],port+1]]){const s=http.createServer(handler);s.on('error',e=>console.error('Phone access on '+ip+':'+p+' failed: '+e.message));s.listen(p,ip);lan.push(s)}}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.HUB_PORT||process.env.PORT||4321);server.listen(port,'127.0.0.1',()=>{console.log('code by aqeel: http://127.0.0.1:'+server.address().port);syncLan()});previewServer.listen(port+1,'127.0.0.1')}
