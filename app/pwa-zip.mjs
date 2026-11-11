// Published (Live) apps get a home-screen icon and manifest too (12 Nov 2026). A published app is a zip of its project that goes to the
// server, so this works on the zip before it is sent: whatever the app already has (manifest, favicon, apple-touch-icon, theme colour) is
// left alone; what is missing is added, drawn from the app's OWN logo (manifest icon, SVG favicon or logo file, an inline SVG logo in its
// page, or a big enough PNG logo), never from a font and never invented. With no real logo the icons are the plain colour tile and the
// result says so (needsLogo), so the owner is asked once for the mark.
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {crc32} from './png.mjs';
import {buildIcons} from './icons.mjs';
import {shortName} from './pwa.mjs';

const MAX_TOTAL=400*1024*1024;
// ---- zip reading / writing (no zip64, no encryption: those come back unchanged) ----
export function readZip(buf){let e=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-22-65535);i--)if(buf.readUInt32LE(i)===0x06054b50){e=i;break}
 if(e<0)throw Error('not a zip');const n=buf.readUInt16LE(e+10),cdSize=buf.readUInt32LE(e+12),cdOff=buf.readUInt32LE(e+16);if(n===0xffff||cdOff===0xffffffff)throw Error('zip64');
 const out=[];let p=cdOff;for(let i=0;i<n;i++){if(buf.readUInt32LE(p)!==0x02014b50)throw Error('bad zip');const flags=buf.readUInt16LE(p+8),method=buf.readUInt16LE(p+10),crc=buf.readUInt32LE(p+16),cs=buf.readUInt32LE(p+20),us=buf.readUInt32LE(p+24),nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),ext=buf.readUInt32LE(p+38),lho=buf.readUInt32LE(p+42);
  if(flags&1)throw Error('encrypted');const name=buf.toString('utf8',p+46,p+46+nl),ln=buf.readUInt16LE(lho+26),le=buf.readUInt16LE(lho+28),ds=lho+30+ln+le;
  out.push({name,method,crc,cs,us,madeBy:buf.readUInt16LE(p+4),ext,time:buf.readUInt16LE(p+12),date:buf.readUInt16LE(p+14),raw:buf.subarray(ds,ds+cs),dir:name.endsWith('/')});p+=46+nl+el+cl}
 void cdSize;return out}
export const dataOf=en=>en.data||(en.method===0?en.raw:zlib.inflateRawSync(en.raw));
export function writeZip(entries){const parts=[],cd=[];let off=0;const now=new Date(),dosT=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),dosD=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
 for(const en of entries){let raw=en.raw,method=en.method,crc=en.crc,us=en.us;if(en.data){raw=zlib.deflateRawSync(en.data);method=8;crc=crc32(en.data);us=en.data.length;if(raw.length>=us){raw=en.data;method=0}}
  const nm=Buffer.from(en.name,'utf8'),lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(0x800,6);lh.writeUInt16LE(method,8);lh.writeUInt16LE(en.time??dosT,10);lh.writeUInt16LE(en.date??dosD,12);lh.writeUInt32LE(crc>>>0,14);lh.writeUInt32LE(raw.length,18);lh.writeUInt32LE(us,22);lh.writeUInt16LE(nm.length,26);
  const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(en.madeBy??0x031e,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(0x800,8);ch.writeUInt16LE(method,10);ch.writeUInt16LE(en.time??dosT,12);ch.writeUInt16LE(en.date??dosD,14);ch.writeUInt32LE(crc>>>0,16);ch.writeUInt32LE(raw.length,20);ch.writeUInt32LE(us,24);ch.writeUInt16LE(nm.length,28);ch.writeUInt32LE(en.ext??(en.dir?(0o40755<<16)>>>0:(0o100644<<16)>>>0),38);ch.writeUInt32LE(off,42);
  parts.push(lh,nm,raw);cd.push(ch,nm);off+=30+nm.length+raw.length}
 const cdb=Buffer.concat(cd),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cdb.length,12);end.writeUInt32LE(off,16);
 return Buffer.concat([...parts,cdb,end])}

const SKIP=/(^|\/)(node_modules|\.git|\.next|vendor|__pycache__)\//;
const ext=n=>(/\.([a-z0-9]+)$/i.exec(n)||[])[1]?.toLowerCase()||'';
const base=n=>n.split('/').pop();
const T={svg:'image/svg+xml',png:'image/png'};
const hue=name=>{const h=parseInt(createHash('sha1').update(String(name).toLowerCase()).digest('hex').slice(0,6),16)%360,c=.5*(1-Math.abs(2*.38-1)),x=c*(1-Math.abs((h/60)%2-1)),m=.38-c/2,[r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('')};
const attr=(tag,k)=>new RegExp('\\b'+k+'\\s*=\\s*["\']([^"\']*)["\']','i').exec(tag)?.[1];

// where public files go: the folders that already serve static files, else public/ (Node and framework apps) or the root (a plain site)
function destinations(names){const has=d=>names.some(n=>n.startsWith(d+'/')),d=new Set();
 for(const k of ['public','static','dist','build','www'])if(has(k)&&(names.includes(k+'/index.html')||k==='public'||k==='static'))d.add(k);
 if(names.includes('index.html'))d.add('');if(!d.size)d.add(names.includes('package.json')?'public':'');return [...d]}

// the app's real logo, in order: manifest icons, SVG files named like a logo or icon, an inline SVG logo in its page, PNG logos
function findMarks(entries,dests){const by=new Map(entries.filter(e=>!e.dir&&!SKIP.test(e.name)).map(e=>[e.name,e]));const out=[];const get=n=>{const e=by.get(n);if(!e||e.us>8*1024*1024)return null;try{return dataOf(e)}catch{return null}};
 // 1 manifest icons (svg first, else the biggest png)
 for(const n of by.keys())if(/(^|\/)(manifest\.webmanifest|manifest\.json|site\.webmanifest)$/i.test(n)){let m;try{m=JSON.parse(get(n).toString('utf8'))}catch{continue}const dir=n.includes('/')?n.slice(0,n.lastIndexOf('/')+1):'';
  const ics=(m.icons||[]).map(i=>({src:String(i.src||''),size:parseInt(String(i.sizes||'0').split(' ').pop())||0,type:String(i.type||'')})).filter(i=>i.src&&!/^https?:/.test(i.src));ics.sort((a,b)=>(/svg/.test(b.type)||/\.svg$/.test(b.src)?1e5:0)+b.size-((/svg/.test(a.type)||/\.svg$/.test(a.src)?1e5:0)+a.size));
  for(const i of ics){const clean=i.src.split('?')[0].replace(/^\.?\//,'');for(const p of [dir+clean,...dests.map(d=>(d?d+'/':'')+clean),clean]){const d=get(p);if(d){out.push({file:p+' (a manifest icon)',type:T[ext(p)]||'',data:d,from:'manifest'});break}}}}
 // 2 svg files that look like a logo
 const score=n=>{const b=base(n).toLowerCase();if(ext(n)!=='svg')return 0;let s=0;if(/^(logo|mark|brand|favicon|icon|app-?icon|symbol)/.test(b))s+=10;else if(/(logo|mark|brand|favicon)/.test(b))s+=5;else return 0;if(/(white|light|inverse|mono|wordmark|text|full)/.test(b))s-=3;if(/(^|\/)(public|static|assets|images?|img|src|brand|branding)\//.test(n))s+=2;return s-n.split('/').length*.1};
 for(const n of [...by.keys()].map(n=>[n,score(n)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).map(x=>x[0]).slice(0,6)){const d=get(n);if(d)out.push({file:n,type:T.svg,data:d,from:'svg'})}
 // 3 an inline svg logo in a page
 for(const n of by.keys())if(/\.html?$/i.test(n)&&by.get(n).us<2*1024*1024){const h=get(n)?.toString('utf8')||'';const header=/<header[\s\S]*?<\/header>/i.exec(h)?.[0]||'';
  for(const m of h.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)){const before=h.slice(Math.max(0,m.index-300),m.index);if(!(/logo|brand|mark/i.test(before)||header.includes(m[0])))continue;if(m[0].length>40000||!/viewBox/i.test(m[0]))continue;
   const withNs=/xmlns=/.test(m[0])?m[0]:m[0].replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"');out.push({file:n+' (the inline SVG logo)',type:T.svg,data:Buffer.from(withNs),from:'inline'});break}}
 // 4 png logos
 for(const n of [...by.keys()].filter(n=>ext(n)==='png'&&/(^|\/)(logo|mark|brand|icon|favicon|apple-touch-icon)/i.test(base(n))&&!/white|light|dark/i.test(base(n)))){const d=get(n);if(d)out.push({file:n,type:T.png,data:d,from:'png'})}
 return out}

const themeOf=(entries,dests)=>{for(const e of entries){if(/(^|\/)(manifest\.webmanifest|manifest\.json)$/i.test(e.name)&&!SKIP.test(e.name)){try{const m=JSON.parse(dataOf(e).toString('utf8'));const c=m.theme_color||m.background_color;if(/^#[0-9a-f]{6}$/i.test(c||''))return c.toLowerCase()}catch{}}}
 for(const e of entries)if(/(^|\/)index\.html?$/i.test(e.name)&&!SKIP.test(e.name)&&e.us<2*1024*1024){const m=/<meta[^>]*name=["']theme-color["'][^>]*content=["'](#[0-9a-f]{6})["']/i.exec(dataOf(e).toString('utf8'));if(m)return m[1].toLowerCase()}return ''};

// -> {zip, added:[paths], kept:[what the app already had], source, needsLogo}. Anything unreadable returns the zip as it came.
export function brandApp(zip,{name,mono=false}){const res={zip,added:[],kept:[],source:'',needsLogo:false,skipped:''};
 try{const entries=readZip(zip);if(entries.reduce((s,e)=>s+e.us,0)>MAX_TOTAL){res.skipped='project too large to add icons';return res}
  const live=entries.filter(e=>!e.dir&&!SKIP.test(e.name)),names=live.map(e=>e.name),dests=destinations(names);
  const html=live.filter(e=>/\.html?$/i.test(e.name)&&e.us<2*1024*1024&&dests.some(d=>d===''?!e.name.includes('/')||/^src\//.test(e.name):e.name.startsWith(d+'/')));
  const htmlText=new Map(html.map(e=>[e.name,dataOf(e).toString('utf8')]));const anyHtml=s=>[...htmlText.values()].some(t=>s.test(t));
  const hasManifest=names.some(n=>/(^|\/)(manifest\.webmanifest|manifest\.json|site\.webmanifest)$/i.test(n))||anyHtml(/rel=["']manifest/i);
  const hasIcon=names.some(n=>/(^|\/)(favicon\.(ico|svg|png)|icon(-\d+)?\.(png|svg))$/i.test(n))||anyHtml(/rel=["'](shortcut )?icon/i);
  const hasApple=names.some(n=>/(^|\/)apple-touch-icon[\w-]*\.png$/i.test(n))||anyHtml(/rel=["']apple-touch-icon/i);
  const hasTheme=anyHtml(/name=["']theme-color/i);
  if(hasManifest)res.kept.push('manifest');if(hasIcon)res.kept.push('favicon');if(hasApple)res.kept.push('apple-touch-icon');
  if(hasManifest&&hasIcon&&hasApple)return res;   // everything is the app's own
  const marks=findMarks(entries,dests),theme=themeOf(entries,dests);
  const set=buildIcons({name,colour:theme||hue(name),defaultColour:'',accent:'',mono:!!mono,custom:null,markCands:marks});
  res.source=set.source.file?set.source.file+(set.source.recoloured?' ('+set.source.recoloured+')':''):'';res.needsLogo=set.needsLogo;res.why=set.source.why||'';
  const add=(dir,f,type,data)=>{const p=(dir?dir+'/':'')+f;if(names.includes(p))return;entries.push({name:p,data,method:8,dir:false});names.push(p);res.added.push(p)};
  for(const d of dests){
   if(!hasIcon){add(d,'favicon.svg','',set.files['favicon.svg'].data);add(d,'favicon.ico','',set.files['favicon.ico'].data);add(d,'favicon-32.png','',set.files['favicon-32.png'].data)}
   if(!hasApple)add(d,'apple-touch-icon.png','',set.files['apple-touch-icon.png'].data);
   if(!hasManifest){for(const f of ['icon-192.png','icon-512.png','icon-maskable-192.png','icon-maskable-512.png'])add(d,f,'',set.files[f].data);
    if(set.files['icon-mono-512.png'])add(d,'icon-mono-512.png','',set.files['icon-mono-512.png'].data);
    const mf={name,short_name:shortName(name),start_url:'/',scope:'/',id:'/',display:'standalone',orientation:'any',background_color:set.colour,theme_color:set.colour,
     icons:[['icon-192.png','192x192','any'],['icon-512.png','512x512','any'],['icon-maskable-192.png','192x192','maskable'],['icon-maskable-512.png','512x512','maskable'],...(set.files['icon-mono-512.png']?[['icon-mono-512.png','512x512','monochrome']]:[])].map(([f,s,p])=>({src:'/'+f,sizes:s,type:'image/png',purpose:p}))};
    add(d,'manifest.webmanifest','',Buffer.from(JSON.stringify(mf)))}}
  // the head tags, only for what the page lacks, in every page of the static folders
  const esc=s=>String(s).replace(/[<>&"]/g,c=>'&#'+c.charCodeAt(0)+';');
  for(const e of html){let t=htmlText.get(e.name);if(!/<head[\s>]/i.test(t))continue;const has=r=>r.test(t);let tg='';
   if(!has(/rel=["'](shortcut )?icon/i)&&!hasIcon)tg+='<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="shortcut icon" href="/favicon.ico">';
   if(!has(/rel=["']apple-touch-icon/i)&&!hasApple)tg+='<link rel="apple-touch-icon" href="/apple-touch-icon.png">';
   if(!has(/rel=["']manifest/i)&&!hasManifest)tg+='<link rel="manifest" href="/manifest.webmanifest">';
   if(!has(/name=["']theme-color/i)&&!hasTheme)tg+='<meta name="theme-color" content="'+set.colour+'">';
   if(!has(/apple-mobile-web-app-title/i))tg+='<meta name="apple-mobile-web-app-title" content="'+esc(shortName(name))+'">';
   if(!has(/name=["']mobile-web-app-capable/i))tg+='<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">';
   if(!tg)continue;t=t.replace(/<head[^>]*>/i,m=>m+tg).replace(/(<meta[^>]*name=["']viewport["'][^>]*content=["'])([^"']*)/i,(m,a,c)=>/viewport-fit/.test(c)?m:a+c+',viewport-fit=cover');
   const i=entries.findIndex(x=>x.name===e.name);entries[i]={...entries[i],data:Buffer.from(t),raw:undefined};res.added.push(e.name+' (head tags)')}
  if(!res.added.length)return res;res.zip=writeZip(entries);return res}
 catch(e){res.skipped=e.message;return res}}
