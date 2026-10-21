// The engine's dashboard plugins inside aqeelOS: their list for one agent, their files (only what is under the
// plugin's dist folder) and their backend (HTTP and WebSocket). The engine's key is added here and never reaches
// the browser. Members get no plugins: the engine's plugin routes are not part of what users.gate lets them call.
import {request as httpRequest} from 'node:http';
const NAME=/^(?!\.{1,2}$)[\w.-]{1,80}$/;
const FILE=/^dist\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(js|mjs|css|json|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/;
const TYPES={js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8',map:'application/json; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf'};
const KEEP=['name','label','description','icon','version','tab','slots','entry','css','has_api','source','user_hidden'];
export function createPluginHost({DASH,DASH_TOKEN,users,send,security,proxy,me,validCookie,sameOrigin}){
 const lists=new Map();
 const key={'x-hermes-session-token':DASH_TOKEN};
 const agentQ=q=>{const a=String(q.get('profile')||q.get('agent')||'default');return /^[\w-]{1,64}$/.test(a)?a:null};
 async function list(agent,fresh){const c=lists.get(agent);if(c&&!fresh&&Date.now()-c.t<15000)return c.list;
  const r=await fetch(DASH.origin+'/api/dashboard/plugins?profile='+encodeURIComponent(agent),{headers:key});if(!r.ok)throw Object.assign(Error('The engine did not list its plugins.'),{status:502});
  const raw=await r.json();const out=(Array.isArray(raw)?raw:raw?.plugins||[]).filter(m=>m&&NAME.test(String(m.name||''))).map(m=>{const o={};for(const k of KEEP)if(m[k]!==undefined)o[k]=m[k];return o});
  lists.set(agent,{t:Date.now(),list:out});if(lists.size>200)lists.delete(lists.keys().next().value);return out}
 // null when this person may use the plugin's backend for this agent, else {status,error}
 const allowed=(u,name,rest,method,q,agent)=>users.isAdmin(u)?users.gate(u,'/hapi/plugins/'+name+'/'+rest,method,q,agent):{status:403,error:'Plugins are for admins.'};
 async function handle(req,res,u,url){const p=url.pathname,q=url.searchParams,agent=agentQ(q);
  if(!agent)return send(res,400,{error:'Unknown agent'});
  if(p==='/ui/plugin-list'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,200,{plugins:[]});
   const no=users.gate(u,'/hapi/dashboard/plugins','GET',new URLSearchParams({profile:agent}),agent);if(no)return send(res,200,{plugins:[]});
   try{return send(res,200,{plugins:await list(agent,q.get('fresh')==='1')})}catch(e){return send(res,e.status||502,{error:e.message})}}
  let m=/^\/ui\/plugin-files\/([^/]+)\/(.+)$/.exec(p);
  if(m&&(req.method==='GET'||req.method==='HEAD')){let name,file;try{name=decodeURIComponent(m[1]);file=decodeURIComponent(m[2])}catch{return send(res,404,'Not found')}
   if(!NAME.test(name)||!FILE.test(file)||file.includes('..')||!users.isAdmin(u))return send(res,404,'Not found');
   let known;try{known=(await list(agent)).find(x=>x.name===name)}catch{}if(!known)return send(res,404,'Not found');
   const ext=/\.(\w+)$/.exec(file)[1].toLowerCase();
   const up=httpRequest({hostname:DASH.hostname,port:DASH.port,path:'/dashboard-plugins/'+encodeURIComponent(name)+'/'+file.split('/').map(encodeURIComponent).join('/'),method:req.method,headers:{...key,host:DASH.host}},r=>{
    if((r.statusCode||500)>=300){r.resume();return send(res,404,'Not found')}
    res.writeHead(200,{'content-type':TYPES[ext]||'application/octet-stream','cache-control':'no-cache',...(r.headers.etag?{etag:r.headers.etag}:{}),...(r.headers['content-length']?{'content-length':r.headers['content-length']}:{}),...security});r.pipe(res)});
   up.on('error',()=>{if(!res.headersSent)send(res,502,{error:'The engine is not reachable'});else res.end()});return up.end()}
  m=/^\/ui\/plugin-api\/([^/]+)(?:\/(.*))?$/.exec(p);
  if(m){let name;try{name=decodeURIComponent(m[1])}catch{return send(res,404,{error:'Not found'})}if(!NAME.test(name))return send(res,404,{error:'Not found'});
   const rest=m[2]||'';if(/\.\.|%2e/i.test(rest))return send(res,404,{error:'Not found'});const no=allowed(u,name,rest,req.method,q,agent);if(no)return send(res,no.status,{error:no.error});
   // the same pass-through as /hapi, without the body rewrites aqeelOS's own calls get: a plugin sees its request as sent
   const qs=new URLSearchParams(q);qs.delete('agent');qs.set('profile',agent);req.url='/hapi/plugins/'+encodeURIComponent(name)+(rest?'/'+rest:'')+'?'+qs;
   return proxy(req,res,DASH,'/hapi',key)}
  return send(res,404,{error:'Not found'})}
 // A plugin's live connection (the Task board's event stream too): same login, same site, the engine's key added here.
 function upgrade(req,sock,headBuf){const no=()=>sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');if(!validCookie(req)||!sameOrigin(req))return no();
  const url=new URL(req.url,'http://x'),q=url.searchParams,agent=agentQ(q);const m=/^\/(?:hapi\/plugins|ui\/plugin-api)\/([^/]+)\/(.+)$/.exec(url.pathname);if(!m||!agent)return no();
  let name,rest;try{name=decodeURIComponent(m[1]);rest=m[2]}catch{return no()}if(!NAME.test(name)||/\.\.|%2e/i.test(rest))return no();
  me(req).then(u=>{if(!u||allowed(u,name,rest,'GET',q,agent))return no();
   const up=new URLSearchParams();for(const [k,v] of q)if(!['token','ticket','agent'].includes(k))up.set(k,v);up.set('profile',agent);if(DASH_TOKEN)up.set('token',DASH_TOKEN);
   const h={host:DASH.host,connection:'Upgrade',upgrade:'websocket','sec-websocket-key':req.headers['sec-websocket-key']||'','sec-websocket-version':req.headers['sec-websocket-version']||'13'};for(const k of ['sec-websocket-extensions','sec-websocket-protocol'])if(req.headers[k])h[k]=req.headers[k];
   const r=httpRequest({hostname:DASH.hostname,port:DASH.port,path:'/api/plugins/'+encodeURIComponent(name)+'/'+rest+'?'+up,headers:h});
   r.on('upgrade',(res,us,uh)=>{let head='HTTP/1.1 101 Switching Protocols\r\n';for(let i=0;i<res.rawHeaders.length;i+=2)head+=res.rawHeaders[i]+': '+res.rawHeaders[i+1]+'\r\n';sock.write(head+'\r\n');if(uh?.length)sock.write(uh);if(headBuf?.length)us.write(headBuf);
    us.pipe(sock);sock.pipe(us);const end=()=>{us.destroy();sock.destroy()};us.on('error',end);sock.on('error',end);us.on('close',end);sock.on('close',end)});
   r.on('response',res=>{res.resume();sock.end('HTTP/1.1 '+(res.statusCode||502)+' Bad Gateway\r\n\r\n')});r.on('error',()=>sock.destroy());r.end()}).catch(()=>sock.destroy())}
 return {handle,upgrade,list}}
