// The gate in front of online Code when it runs in its own container (next to the AI box, without the agents' keys
// or files). Every request needs an aqeelOS sign-in: aqeelOS hands the browser a short ticket signed with
// CODE_GATE_SECRET, the gate turns it into its own cookie, and only then passes the request to Code inside this
// container (127.0.0.1:4321, previews on :4322) as if it came from here. Code only ever loads inside aqeelOS: opened as
// a page of its own, it goes back to Code in aqeelOS. The signed-in person travels along as X-AQ-User.
import http from 'node:http';
import {createHmac,timingSafeEqual} from 'node:crypto';

const SECRET=process.env.CODE_GATE_SECRET||'';if(SECRET.length<32){console.error('CODE_GATE_SECRET is missing or too short');process.exit(1)}
const HOST=process.env.CODE_HOST||'code.elkiya.com',PREVIEW_HOST=process.env.CODE_PREVIEW_HOST||'code-preview.elkiya.com';
const HOME=(process.env.AQEELOS_PUBLIC||'https://ai.elkiya.com').replace(/\/$/,'');const PORT=Number(process.env.GATE_PORT||80);
const sig=s=>createHmac('sha256',SECRET).update(s).digest('base64url').slice(0,32);
const same=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&timingSafeEqual(a,b)};
// ticket: user.role.expires.signature (two minutes); cookie: the same for seven days
const read=(t,kind)=>{const [uid,role,exp,s]=String(t||'').split('.');if(!uid||!exp||Number(exp)<Date.now()||!same(s,sig(kind+':'+uid+'.'+role+'.'+exp)))return null;return {uid,role}};
const cookieFor=(uid,role)=>{const exp=Date.now()+7*86400e3;return [uid,role,exp,sig('code-cookie:'+uid+'.'+role+'.'+exp)].join('.')};
const ticketFor=(uid,role)=>{const exp=Date.now()+120000;return [uid,role,exp,sig('code-ticket:'+uid+'.'+role+'.'+exp)].join('.')};
const fromCookie=req=>{const m=/(?:^|;\s*)aqc=([^;]+)/.exec(req.headers.cookie||'');return m?read(decodeURIComponent(m[1]),'code-cookie'):null};
const attrs='; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure';
const hostOf=req=>String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim().split(':')[0].toLowerCase();
const page=(res,code,title,text)=>{res.writeHead(code,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#0b0c10"><div style="max-width:420px;text-align:center"><h1 style="font-size:20px">${title}</h1><p style="color:#646875">${text}</p><p><a href="${HOME}/#/code/code" target="_top" style="color:#0158cb">Open Code in aqeelOS</a></p></div>`)};
function pass(req,res,port,who){const target='127.0.0.1:'+port;const h={...req.headers};delete h.cookie;delete h['x-aq-user'];delete h['x-aq-role'];delete h['x-aq-act'];h.host=target;h['x-aq-user']=who.uid;h['x-aq-role']=who.role;
 if(h.origin)h.origin='http://'+target;if(h.referer)h.referer=h.referer.replace(/^https?:\/\/[^/]+/,'http://'+target);delete h['x-forwarded-host'];delete h['x-forwarded-for'];delete h['x-real-ip'];
 const up=http.request({host:'127.0.0.1',port,method:req.method,path:req.url,headers:h},r=>{const out={...r.headers};if(out.location)out.location=String(out.location).replace('http://127.0.0.1:4321','https://'+HOST).replace('http://127.0.0.1:4322','https://'+PREVIEW_HOST);res.writeHead(r.statusCode||502,out);r.pipe(res)});
 up.on('error',()=>{if(!res.headersSent)page(res,502,'Code online is starting','It starts by itself; try again in a minute.');else res.end()});req.pipe(up)}
http.createServer((req,res)=>{const h=hostOf(req);const w=h===HOST?'app':h===PREVIEW_HOST?'preview':null;const url=new URL(req.url,'http://x');
 if(url.pathname==='/healthz'){res.writeHead(200,{'content-type':'text/plain'});return res.end('ok')}
 if(!w){res.writeHead(404);return res.end()}
 // only inside aqeelOS
 if(req.method==='GET'&&req.headers['sec-fetch-dest']==='document'){res.writeHead(302,{location:HOME+'/#/code/code','cache-control':'no-store'});return res.end()}
 if(url.pathname==='/aqeelos-login'){const t=read(url.searchParams.get('t'),'code-ticket');if(!t)return page(res,403,'This link has expired','Open Code again from aqeelOS.');
  if(w==='app'){const to=url.searchParams.get('to')||'/?embed=aqeelos';const back='https://'+HOST+(to.startsWith('/')&&!to.startsWith('//')?to:'/');
   res.writeHead(303,{location:'https://'+PREVIEW_HOST+'/aqeelos-login?t='+encodeURIComponent(ticketFor(t.uid,t.role))+'&back='+encodeURIComponent(back),'set-cookie':'aqc='+cookieFor(t.uid,t.role)+attrs,'cache-control':'no-store','referrer-policy':'no-referrer'});return res.end()}
  const back=url.searchParams.get('back')||'';res.writeHead(303,{location:back.startsWith('https://'+HOST+'/')?back:'https://'+HOST+'/','set-cookie':'aqc='+cookieFor(t.uid,t.role)+attrs,'cache-control':'no-store','referrer-policy':'no-referrer'});return res.end()}
 const who=fromCookie(req);if(!who){if(req.method==='GET'&&!url.pathname.startsWith('/api/'))return page(res,401,'Open Code from aqeelOS','Online projects are behind your aqeelOS sign-in.');res.writeHead(401,{'content-type':'application/json'});return res.end(JSON.stringify({error:'Open Code from aqeelOS first.'}))}
 pass(req,res,w==='app'?4321:4322,who)}).listen(PORT,()=>console.log('online gate on :'+PORT));
