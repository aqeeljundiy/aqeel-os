// Phone access: off by default. When enabled the app also listens on the local network, and every
// non-local request must carry a paired device cookie. Pairing uses a short-lived 6-digit code shown on the computer.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes,randomInt,createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const hash=t=>createHash('sha256').update(t).digest('hex');
export const isLoopback=addr=>/^(127\.|::1$|::ffff:127\.)/.test(String(addr||''));

export class Remote{
 constructor(root){this.file=path.join(root,'data','remote.json');this.state={enabled:false,devices:[]};this.code=null;this.attempts=0}
 async init(){try{this.state=JSON.parse(await readFile(this.file,'utf8'))}catch{}return this}
 async save(){await writeFile(this.file+'.tmp',JSON.stringify(this.state,null,2));await rename(this.file+'.tmp',this.file)}
 addresses(port){const out=[];for(const [name,list] of Object.entries(os.networkInterfaces()))for(const a of list||[]){if(a.family==='IPv4'&&!a.internal)out.push({name,url:`http://${a.address}:${port}`,tailscale:/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)})}return out}
 view(port){return {enabled:this.state.enabled,addresses:this.state.enabled?this.addresses(port):[],devices:this.state.devices.map(({id,name,createdAt,lastSeen})=>({id,name,createdAt,lastSeen})),code:this.code&&this.code.expires>Date.now()?{value:this.code.value,expires:this.code.expires}:null}}
 async setEnabled(on){this.state.enabled=Boolean(on);if(!on)this.code=null;await this.save()}
 newCode(){this.code={value:String(randomInt(0,1e6)).padStart(6,'0'),expires:Date.now()+10*60*1000};this.attempts=0;return this.code}
 // returns a device token (store it in a cookie) or throws
 async pair(code,name){if(!this.state.enabled)throw Error('Phone access is turned off on the computer.');
  if(!this.code||this.code.expires<Date.now())throw Error('This code has expired. Show a new code on the computer.');
  if(++this.attempts>5){this.code=null;throw Error('Too many attempts. Show a new code on the computer.')}
  const a=Buffer.from(String(code||'').replace(/\D/g,'').padEnd(6,'x')),b=Buffer.from(this.code.value);if(a.length!==b.length||!timingSafeEqual(a,b))throw Error('That code is not right.');
  const token=randomBytes(32).toString('base64url');this.state.devices.push({id:randomUUID(),name:String(name||'Phone').slice(0,60),tokenHash:hash(token),createdAt:Date.now(),lastSeen:Date.now()});this.code=null;await this.save();return token}
 device(cookieHeader){const m=String(cookieHeader||'').match(/(?:^|;\s*)cba_device=([\w-]+)/);if(!m)return null;const h=hash(m[1]);const d=this.state.devices.find(d=>d.tokenHash===h);if(d&&Date.now()-d.lastSeen>60000){d.lastSeen=Date.now();this.save().catch(()=>{})}return d||null}
 async revoke(id){this.state.devices=this.state.devices.filter(d=>d.id!==id);await this.save()}
}

export function pairPage(error=''){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Pair · code by aqeel</title><meta name="theme-color" content="#0158cb"><link rel="apple-touch-icon" href="/assets/icon-180.png"><style>
@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;src:url('/assets/plus-jakarta-sans.woff2') format('woff2')}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0b0c10;background:linear-gradient(180deg,#cfe1fb 0,#eaf2ff 55%,#fff 100%)}
main{width:100%;max-width:380px;background:#fff;border:1px solid #e2e3e9;border-radius:24px;padding:28px;box-shadow:0 12px 40px -24px rgba(11,12,16,.18)}h1{font-size:26px;letter-spacing:-1px;margin:0 0 8px}p{color:#2e3038;line-height:1.55;margin:0 0 18px;font-size:15px}label{display:block;font-size:13px;font-weight:500;margin:0 0 6px;color:#2e3038}
input{width:100%;font:inherit;font-size:28px;letter-spacing:10px;text-align:center;padding:12px;border:1px solid #e2e3e9;border-radius:12px;margin-bottom:12px}input.name{font-size:16px;letter-spacing:0;text-align:left}input:focus{outline:2px solid rgba(1,88,203,.35);border-color:#0158cb}
button{width:100%;font:inherit;font-size:16px;font-weight:500;padding:14px;border:0;border-radius:9999px;color:#fff;background:linear-gradient(180deg,#2f7bff,#0158cb);box-shadow:0 8px 24px -10px rgba(1,88,203,.6)}.err{color:#b03c32;font-size:14px;margin:0 0 12px}</style></head>
<body><main><h1>Pair this phone</h1><p>On your computer, open aqeelOS Code › Phone and enter the 6-digit code shown there.</p>${error?`<p class="err" role="alert">${error.replace(/[<>&"]/g,'')}</p>`:''}
<form method="post" action="/pair"><label for="code">Pairing code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus><label for="name">Name for this device</label><input class="name" id="name" name="name" maxlength="60" value="iPhone"><button>Pair</button></form></main></body></html>`}
