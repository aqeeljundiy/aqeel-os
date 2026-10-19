// Code online: the copy of aqeelOS Code on the AI box, for projects that live there ("online"), so agents can work on
// them any time, even with the person's computer off. It is reached at code.elkiya.com (the app) and
// code-preview.elkiya.com (its previews), both behind aqeelOS sign-in: aqeelOS hands the browser a short ticket,
// each address turns it into its own cookie, and every request after that is checked here and passed to the app on
// the box (127.0.0.1:4321 / :4322) as if it came from the box itself. Nothing reaches the app without that cookie.
import {request as httpRequest} from 'node:http';
import {createHmac,timingSafeEqual} from 'node:crypto';

export function createCodeOnline({SECRET,SECURE,users,HOST='code.elkiya.com',PREVIEW_HOST='code-preview.elkiya.com',APP='127.0.0.1:4321',PREVIEW='127.0.0.1:4322',HOME='https://ai.elkiya.com'}){
 const sig=s=>createHmac('sha256',SECRET).update(s).digest('base64url').slice(0,32);
 const same=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&timingSafeEqual(a,b)};
 // a ticket (two minutes, one person) and the cookie it becomes (seven days)
 const ticket=uid=>{const exp=Date.now()+120000;return uid+'.'+exp+'.'+sig('code-ticket:'+uid+'.'+exp)};
 const readTicket=t=>{const [uid,exp,s]=String(t||'').split('.');if(!uid||!exp||Number(exp)<Date.now()||!same(s,sig('code-ticket:'+uid+'.'+exp)))return null;return uid};
 const cookie=uid=>{const exp=Date.now()+7*86400e3;return uid+'.'+exp+'.'+sig('code-cookie:'+uid+'.'+exp)};
 const readCookie=req=>{const m=/(?:^|;\s*)aqc=([^;]+)/.exec(req.headers.cookie||'');if(!m)return null;const [uid,exp,s]=decodeURIComponent(m[1]).split('.');if(!uid||Number(exp)<Date.now()||!same(s,sig('code-cookie:'+uid+'.'+exp)))return null;return uid};
 const attrs='; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'+(SECURE?'; Secure':'');
 const scheme=SECURE?'https://':'http://';
 const hostOf=req=>String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim().split(':')[0].toLowerCase();
 const which=req=>{const h=hostOf(req);return h===HOST?'app':h===PREVIEW_HOST?'preview':null};
 // who may open it: admins while Code is being finished
 const allowed=uid=>{const U=users();const u=uid&&U.byId(uid);return u&&U.isAdmin(u)?u:null};
 const page=(res,code,title,text)=>{res.writeHead(code,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#0b0c10"><div style="max-width:420px;text-align:center"><h1 style="font-size:20px">${title}</h1><p style="color:#646875">${text}</p><p><a href="${HOME}/#/code/code" target="_top" style="color:#0158cb">Open Code in aqeelOS</a></p></div>`)};
 function pass(req,res,target){const [host,port]=target.split(':');const h={...req.headers};delete h.cookie;h.host=target;
  if(h.origin)h.origin='http://'+target;if(h.referer)h.referer=h.referer.replace(/^https?:\/\/[^/]+/,'http://'+target);
  delete h['x-forwarded-host'];delete h['x-forwarded-for'];delete h['x-real-ip'];
  const up=httpRequest({host,port:Number(port),method:req.method,path:req.url,headers:h},r=>{const out={...r.headers};
   if(out.location)out.location=String(out.location).replace('http://'+APP,scheme+HOST).replace('http://'+PREVIEW,scheme+PREVIEW_HOST);
   res.writeHead(r.statusCode||502,out);r.pipe(res)});
  up.on('error',()=>{if(!res.headersSent)page(res,502,'Code online is not running','The online copy of aqeelOS Code on the AI box did not answer. It starts again by itself; try again in a minute.');else res.end()});
  req.pipe(up)}
 // true when the request was for one of Code online's addresses (and is now answered)
 function handle(req,res){const w=which(req);if(!w)return false;const url=new URL(req.url,'http://x');
  // Code exists only inside aqeelOS: opened as a page of its own (typed in the address bar, a link, a new tab), it goes to
  // Code in aqeelOS instead. Inside aqeelOS it loads as a frame, which browsers mark as Sec-Fetch-Dest: iframe.
  if(req.method==='GET'&&req.headers['sec-fetch-dest']==='document'){res.writeHead(302,{location:HOME+'/#/code/code','cache-control':'no-store'});res.end();return true}
  if(url.pathname==='/aqeelos-login'){const uid=readTicket(url.searchParams.get('t'));if(!allowed(uid)){page(res,403,'This link has expired','Open Code again from aqeelOS.');return true}
   if(w==='app'){const to=url.searchParams.get('to')||'/?embed=aqeelos';const back=scheme+HOST+(to.startsWith('/')&&!to.startsWith('//')?to:'/');
    res.writeHead(303,{location:scheme+PREVIEW_HOST+'/aqeelos-login?t='+encodeURIComponent(ticket(uid))+'&back='+encodeURIComponent(back),'set-cookie':'aqc='+cookie(uid)+attrs,'cache-control':'no-store','referrer-policy':'no-referrer'});return res.end(),true}
   const back=url.searchParams.get('back')||'';res.writeHead(303,{location:back.startsWith(scheme+HOST+'/')?back:scheme+HOST+'/','set-cookie':'aqc='+cookie(uid)+attrs,'cache-control':'no-store','referrer-policy':'no-referrer'});return res.end(),true}
  if(!allowed(readCookie(req))){if(w==='preview'&&req.method==='GET'){page(res,401,'Sign in to see this preview','Previews of online projects open from Code in aqeelOS.');return true}
   if(req.method==='GET'&&!url.pathname.startsWith('/api/')){page(res,401,'Open Code from aqeelOS','Online projects are behind your aqeelOS sign-in.');return true}
   res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:'Open Code from aqeelOS first.'}));return true}
  pass(req,res,w==='app'?APP:PREVIEW);return true}
 return {handle,ticket,url:(uid,to)=>scheme+HOST+'/aqeelos-login?t='+encodeURIComponent(ticket(uid))+(to?'&to='+encodeURIComponent(to):'')}}
