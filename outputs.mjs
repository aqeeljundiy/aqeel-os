// Outputs: what the AI makes besides apps (decks, documents, designs, reports, dashboards, media).
// Each lives in <project>/outputs/<slug>/ with an output.json {kind, title, entry}. This module knows the kinds,
// lists outputs, keeps design systems, and exports (PPTX, DOCX, PDF, PNG).
import {readFile,readdir,stat,writeFile,mkdir,rm,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {deckDocument,DEFAULT_DS,LAYOUTS,ratioOf,iconSvg} from './deck-render.js';
import {parse,inline,toHtml,headings} from './md-lite.mjs';
// width and height from a PNG, JPEG, GIF or WebP header (to place images in Word at the right shape)
function imageSize(b){try{if(b[0]===0x89)return {w:b.readUInt32BE(16),h:b.readUInt32BE(20)};if(b[0]===0x47)return {w:b.readUInt16LE(6),h:b.readUInt16LE(8)};
 if(b.toString('ascii',8,12)==='WEBP'){const t=b.toString('ascii',12,16);if(t==='VP8X')return {w:1+b.readUIntLE(24,3),h:1+b.readUIntLE(27,3)};if(t==='VP8 ')return {w:b.readUInt16LE(26)&0x3fff,h:b.readUInt16LE(28)&0x3fff};return {w:1+((b[22]|b[23]<<8)&0x3fff),h:1+(((b[23]>>6)|(b[24]<<2)|(b[25]<<10))&0x3fff)}}
 let i=2;while(i<b.length){if(b[i]!==0xff)break;const m=b[i+1],len=b.readUInt16BE(i+2);if(m>=0xc0&&m<=0xc3)return {h:b.readUInt16BE(i+5),w:b.readUInt16BE(i+7)};i+=2+len}}catch{}return {}}
import {findBrowser} from './platform.mjs';

export const KINDS=['app','task','deck','doc','design','research','data','media'];
// Do a task: nothing is made; files the task collects go to the results folder, sorted by type
export const RESULT_TYPES=[['Images',/\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|heic|ico)$/i],['Videos',/\.(mp4|mov|webm|mkv|avi|m4v)$/i],['Audio',/\.(mp3|wav|m4a|ogg|flac|aac)$/i],['Documents',/\.(pdf|docx?|pptx?|txt|md|rtf|odt|html?)$/i],['Spreadsheets and data',/\.(xlsx?|csv|tsv|json|xml|ods|parquet|sqlite|db)$/i],['Archives',/\.(zip|rar|7z|tar|gz|tgz)$/i]];
export function taskInstructions(dir){return `\n\nThe user wants a task done, not something made: do it with the browser tools, files and the other tools, and do not build an app, page or document unless asked.\nNever open windows, folders, files or apps on the person's screen (explorer, Invoke-Item, start, open) unless they ask: Code shows them the folder when they want it.\nSave every file the task collects or produces into this results folder: ${dir}\nSort them into subfolders by type: ${RESULT_TYPES.map(t=>t[0]).join(', ')} and Other (make a subfolder only when it gets a file). Keep the original file names where you can, and never overwrite a different file with the same name (add -2, -3).\nWhen you are done, reply with what you did and a short list of what you saved, with where (for example: Images/hero.jpg).`}
const SLUG=/^[a-z0-9][a-z0-9-]{0,59}$/;
export const checkSlug=s=>{if(!SLUG.test(String(s||'')))throw Error('Unknown output.');return s};

// ---------- instructions the AI gets for each kind ----------
const COMMON=`Put what you make in outputs/<slug>/ where <slug> is a short lowercase-hyphen name (list outputs/ first; reuse a folder only to change that same output). Each output folder holds one kind: to make a different kind from an existing output (slides from a document, a document from a deck), create a NEW folder such as <slug>-slides, and never change or delete another output's files or output.json.
Also write outputs/<slug>/output.json: {"kind":"KIND","title":"<short title>","entry":"ENTRY"}.
As soon as the first version of the file exists, call the app tool show_output with the slug, so it opens in the user's Artifacts panel; it refreshes live as you write.
When you are done, call the app tool next_steps with a one or two sentence recap (what is now true, what is not done) and up to two suggested next actions.`;
const DECK=`Make the deck as outputs/<slug>/deck.json, valid JSON: {"title": string, "slides": [slide, ...]}.
Each slide has "layout" and "notes" (speaker notes; put the sources for facts here). Layouts and their fields:
title: eyebrow?, title, subtitle? · section: number, title, subtitle? · bullets: title, text?, bullets (3 to 5) · two-column: title, left {title, text?, bullets}, right {title, text?, bullets}
image: title, text?, bullets?, image (a path inside the output folder such as "images/cover.jpg"), imageAlt · quote: quote, by · big-number: eyebrow?, number (short: "3×", "48%"), text
chart: title, text?, chart {type: bar|line|pie, labels [], series [{name, values []}]} · table: title, table {head [], rows [[]]} (8 rows at most) · timeline: title, items [{title, text}] (6 at most)
team: title, items [{name, role, image?}] · closing: title, subtitle?, contact?
Start with a title slide and end with a closing slide. Keep text short: titles under 8 words, bullets under 12 words. Mix layouts so the deck is visual.
The app draws the slides with the design system, so never add colours, fonts or HTML. Rewrite the whole file each time you change it.`;
const KIND_TEXT={
 deck:{entry:'deck.json',text:DECK},
 doc:{entry:'index.md',text:'Write the document as outputs/<slug>/index.md in Markdown. For long documents, first write the outline with every ## section heading followed by a line _Writing…_, then fill the sections one by one (the user watches it fill in). Use one # title, ## sections, short paragraphs, lists, and tables where useful; > for callouts. If you use facts from sources, cite them as [1], [2] and list them under ## Sources at the end.'},
 research:{entry:'index.md',text:'Research first: search the web and read the most relevant sources with the browser tools (at least five good, recent sources). Then write the report as outputs/<slug>/index.md in Markdown: a short summary of the findings first, then ## sections. Cite every factual claim as [n] and list the sources (title and link) under ## Sources at the end.'},
 design:{entry:'index.html',text:'When the user asks for options, show each as its own frame named Option A, Option B and so on. To make a click-through prototype, link buttons to frames with data-goto="<frame name>". If the page should keep data (a tracker, a form), use await cbaData.load() and await cbaData.save(value); the app keeps it in store.json in the output folder. Make the design as one self-contained HTML file outputs/<slug>/index.html (inline CSS, no build step, images inside the output folder). Show each screen, post or ad as a frame: <section class="frame" data-name="Home, desktop" style="width:1440px;height:900px">. Put frames in a row with 64px gaps on a light grey canvas. Follow the design system colours and fonts, and load the fonts from Google Fonts with a <link> tag so they show everywhere.'},
 data:{entry:'index.html',text:'Analyse the data by running code in the project (Node or Python), never by guessing. Then make outputs/<slug>/index.html: a dashboard with the key numbers on top and clear charts below (inline SVG, or Chart.js from https://cdnjs.cloudflare.com). Explain each finding in one plain sentence. Use the design system colours, and load its fonts from Google Fonts with a <link> tag. Save cleaned data next to it as data.csv. Also write charts.json: [{"title":"…","type":"bar|line|pie","labels":[…],"series":[{"name":"…","values":[…]}],"note":"one plain sentence"}], and have index.html draw its charts from charts.json (fetch it), because the user can edit the charts in the app. Put each chart in an element with data-chart="N" (N = its index in charts.json) so the user can click a chart to edit it. Keep the raw table in a .csv file in the folder (the user edits it in a data grid).'},
 media:{entry:'index.html',text:'Make the images or videos with the connected image or video tools. Save every result into outputs/<slug>/ and list them in output.json as "files": [...]. Write outputs/<slug>/index.html as a simple gallery of them with captions.'},
};
export function kindInstructions(kind,ds){const k=KIND_TEXT[kind];if(!k)return '';
 const look=ds?`\nDesign system "${ds.name}": colours ${Object.entries(ds.colors||{}).map(([a,b])=>a+' '+b).join(', ')}; heading font ${ds.fonts?.heading||'Plus Jakarta Sans'}, body font ${ds.fonts?.body||'Plus Jakarta Sans'}; corner radius ${ds.radius??12}px.${ds.voice?' Tone of voice: '+ds.voice:''}`:'';
 return `\n\nThe user is making: ${({deck:'a slide deck',doc:'a document',research:'a research report',design:'a design',data:'data analysis with charts',media:'images or video'})[kind]}.\n${COMMON.replace('KIND',kind).replace('ENTRY',k.entry)}\n${k.text}${look}`}

// ---------- listing ----------
const entryKind=e=>e.endsWith('deck.json')?'deck':e.endsWith('.md')?'doc':'design';
export async function listOutputs(folder){const dir=path.join(folder,'outputs');let names=[];try{names=(await readdir(dir,{withFileTypes:true})).filter(d=>d.isDirectory()&&SLUG.test(d.name)).map(d=>d.name)}catch{return []}
 const out=[];for(const slug of names){const base=path.join(dir,slug);let meta={};try{meta=JSON.parse(await readFile(path.join(base,'output.json'),'utf8'))}catch{}
  let entry=typeof meta.entry==='string'&&!meta.entry.includes('..')?meta.entry.replace(/^\/+/,''):'';
  if(!entry)for(const c of ['deck.json','index.md','index.html']){try{await stat(path.join(base,c));entry=c;break}catch{}}
  if(!entry)continue;let mtime=0;try{mtime=(await stat(path.join(base,entry))).mtimeMs}catch{continue}
  const kind=KINDS.includes(meta.kind)&&meta.kind!=='app'?meta.kind:entryKind(entry);
  out.push({slug,kind,title:String(meta.title||slug.replace(/-/g,' ')).slice(0,80),entry,path:'outputs/'+slug+'/'+entry,mtime})}
 return out.sort((a,b)=>b.mtime-a.mtime)}

// ---------- design systems ----------
const BUILT_IN=[DEFAULT_DS,{id:'plain',name:'Plain',colors:{bg:'#ffffff',surface:'#f4f4f5',ink:'#18181b',muted:'#71717a',accent:'#18181b',accent2:'#52525b',onAccent:'#ffffff'},fonts:{heading:'Plus Jakarta Sans',body:'Plus Jakarta Sans'},radius:8,logo:''},
 {id:'midnight',name:'Midnight',colors:{bg:'#0f1420',surface:'#171e2e',ink:'#f2f5fb',muted:'#9aa6bd',accent:'#6ca9ff',accent2:'#a78bfa',onAccent:'#0b0c10'},fonts:{heading:'Plus Jakarta Sans',body:'Plus Jakarta Sans'},radius:16,logo:''}].map(d=>({...d,builtIn:true}));
const HEX=/^#[0-9a-f]{6}$/i;
export function cleanDS(d){const c=d?.colors||{},colors={};for(const k of Object.keys(DEFAULT_DS.colors)){const v=String(c[k]||'').trim();colors[k]=HEX.test(v)?v.toLowerCase():DEFAULT_DS.colors[k]}
 const font=n=>String(n||'').replace(/[^\w \-]/g,'').trim().slice(0,40)||'Plus Jakarta Sans';const logo=String(d?.logo||'');
 return {id:/^[\w-]{1,40}$/.test(d?.id||'')?d.id:randomUUID().slice(0,8),name:String(d?.name||'Untitled').trim().slice(0,40)||'Untitled',colors,fonts:{heading:font(d?.fonts?.heading),body:font(d?.fonts?.body)},radius:Math.max(0,Math.min(40,Math.round(Number(d?.radius)||0))),
  logo:/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(logo)&&logo.length<400000?logo:'',voice:String(d?.voice||'').slice(0,400),source:String(d?.source||'').slice(0,200)}}
export class DesignSystems{
 constructor(dataDir){this.dir=path.join(dataDir,'design-systems')}
 async list(){let own=[];try{for(const n of await readdir(this.dir))if(n.endsWith('.json'))try{own.push(JSON.parse(await readFile(path.join(this.dir,n),'utf8')))}catch{}}catch{}return [...BUILT_IN,...own.sort((a,b)=>a.name.localeCompare(b.name))]}
 async get(id){return (await this.list()).find(d=>d.id===id)||null}
 async save(d){const ds=cleanDS(d);if(BUILT_IN.some(b=>b.id===ds.id))ds.id=randomUUID().slice(0,8);await mkdir(this.dir,{recursive:true});await writeFile(path.join(this.dir,ds.id+'.json'),JSON.stringify(ds,null,1));return ds}
 async remove(id){if(BUILT_IN.some(b=>b.id===id))throw Error('Built-in design systems cannot be deleted.');if(!/^[\w-]{1,40}$/.test(id))throw Error('Unknown design system.');await rm(path.join(this.dir,id+'.json'),{force:true})}
}
// Read colours and fonts off a live page (run in the side browser). Returns raw candidates; cleanDS tidies them.
export const EXTRACT_SCRIPT=`(()=>{const rgb=c=>{const m=String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);if(!m||m[4]==='0')return null;return '#'+[m[1],m[2],m[3]].map(n=>(+n).toString(16).padStart(2,'0')).join('')};
 const g=e=>e?getComputedStyle(e):null,body=g(document.body),h=g(document.querySelector('h1,h2')),btn=[...document.querySelectorAll('a[class*=btn],button,.button,[class*=cta]')].map(g).find(s=>rgb(s.backgroundColor)&&rgb(s.backgroundColor)!==rgb(body.backgroundColor));
 const counts={};for(const e of [...document.querySelectorAll('a,button,h1,h2,h3,svg,[class*=accent],[class*=primary]')].slice(0,400)){const s=g(e);for(const c of [s.color,s.backgroundColor,s.fill]){const x=rgb(c);if(x&&!/^#(f{6}|0{6})$/.test(x))counts[x]=(counts[x]||0)+1}}
 const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);const fam=s=>s?s.fontFamily.split(',')[0].replace(/["']/g,'').trim():'';
 const icon=document.querySelector('link[rel~=icon]')?.href||'';
 return {name:(document.querySelector('meta[property="og:site_name"]')?.content||document.title||'').split(/[|\\-–·]/)[0].trim(),bg:rgb(body.backgroundColor)||'#ffffff',ink:rgb(body.color)||'#111111',accent:(btn&&rgb(btn.backgroundColor))||top[0]||'',accent2:top.find(c=>c!==((btn&&rgb(btn.backgroundColor))||top[0]))||'',heading:fam(h),body:fam(body),radius:parseFloat(btn?.borderRadius)||8,icon}})()`;
export function dsFromPage(raw,url){const lum=h=>{const n=parseInt(h.slice(1),16);return ((n>>16)*299+((n>>8)&255)*587+(n&255)*114)/1000};const dark=raw.bg&&lum(raw.bg)<100;
 return cleanDS({name:raw.name||new URL(url).hostname.replace(/^www\./,''),colors:{bg:raw.bg,surface:dark?'#1b2130':'#f5f6f8',ink:raw.ink,muted:dark?'#9aa6bd':'#646875',accent:raw.accent||'#0158cb',accent2:raw.accent2||raw.accent||'#2f7bff',onAccent:raw.accent&&lum(raw.accent)>160?'#0b0c10':'#ffffff'},fonts:{heading:raw.heading,body:raw.body},radius:Math.min(28,raw.radius),source:url})}

// ---------- exports ----------
const isLocal=f=>typeof f==='string'&&!/^[a-z]+:/i.test(f)&&!f.includes('..');
function chromeRun(args,timeout=45000){return new Promise(async(resolve,reject)=>{const exe=await findBrowser();if(!exe)return reject(Error('Exporting needs Chrome or Edge on this computer.'));
 const profile=await mkdtemp(path.join(os.tmpdir(),'cba-export-'));const child=spawn(exe,['--headless=new','--disable-gpu','--virtual-time-budget=3000','--run-all-compositor-stages-before-draw','--no-first-run','--no-default-browser-check','--hide-scrollbars','--user-data-dir='+profile,...args],{windowsHide:true,stdio:'ignore'});
 const t=setTimeout(()=>{try{child.kill()}catch{}reject(Error('The export took too long.'))},timeout);child.on('error',e=>{clearTimeout(t);reject(e)});child.on('close',()=>{clearTimeout(t);setTimeout(()=>rm(profile,{recursive:true,force:true}).catch(()=>{}),2000);resolve()})})}
async function printHtml(html,kind,{width=1920,height=1080}={}){const dir=await mkdtemp(path.join(os.tmpdir(),'cba-page-'));const page=path.join(dir,'page.html'),out=path.join(dir,kind==='pdf'?'out.pdf':'out.png');await writeFile(page,html);
 try{await chromeRun(kind==='pdf'?['--no-pdf-header-footer','--print-to-pdf='+out,pathToFileURL(page).href]:['--screenshot='+out,'--window-size='+width+','+height,pathToFileURL(page).href]);return await readFile(out)}
 catch(e){throw e.code==='ENOENT'?Error('The export did not produce a file.'):e}finally{setTimeout(()=>rm(dir,{recursive:true,force:true}).catch(()=>{}),3000)}}
export async function printUrl(url,kind,{width=1440,height=900}={}){const dir=await mkdtemp(path.join(os.tmpdir(),'cba-page-'));const out=path.join(dir,kind==='pdf'?'out.pdf':'out.png');
 try{await chromeRun(kind==='pdf'?['--no-pdf-header-footer','--print-to-pdf='+out,url]:['--screenshot='+out,'--window-size='+width+','+height,url]);return await readFile(out)}finally{setTimeout(()=>rm(dir,{recursive:true,force:true}).catch(()=>{}),3000)}}
const fontFace=async root=>`@font-face{font-family:'Plus Jakarta Sans';src:url('${pathToFileURL(path.join(root,'assets','plus-jakarta-sans.woff2')).href}') format('woff2');font-weight:200 800}`;
export async function deckFile(root,base,deck,ds,kind,only){const css=await readFile(path.join(root,'deck.css'),'utf8');const d=deck;
 const html=deckDocument(d,{css,ds,fontFaces:await fontFace(root),only,resolve:src=>isLocal(src)?pathToFileURL(path.join(base,src)).href:''});
 return printHtml(html,kind,{width:1920,height:Math.round(1920/ratioOf(d))})}
export async function docPdf(root,md,title,ds=DEFAULT_DS,base=null){const c={...DEFAULT_DS.colors,...ds.colors};
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>${String(title).replace(/</g,'')}</title><style>${await fontFace(root)}@page{size:A4;margin:22mm 20mm}body{font-family:'${ds.fonts?.body||'Plus Jakarta Sans'}','Plus Jakarta Sans',sans-serif;color:${c.ink};font-size:11pt;line-height:1.6}h1,h2,h3{font-family:'${ds.fonts?.heading||'Plus Jakarta Sans'}','Plus Jakarta Sans',sans-serif;line-height:1.2;letter-spacing:-.01em}h1{font-size:24pt;margin:0 0 12pt}h2{font-size:15pt;margin:20pt 0 6pt;color:${c.accent}}h3{font-size:12pt}a{color:${c.accent}}table{border-collapse:collapse;width:100%;margin:8pt 0}th,td{border-bottom:1px solid #ddd;padding:5pt 6pt;text-align:left;font-size:10pt}th{color:${c.accent}}blockquote{margin:10pt 0;padding:6pt 12pt;border-left:3pt solid ${c.accent};background:${c.surface}}pre{background:${c.surface};padding:8pt;border-radius:6pt;font-size:9pt;white-space:pre-wrap}figure{margin:10pt 0}figure img{max-width:100%;border-radius:6pt}.toc ul{list-style:none;padding:0}.toc-2{padding-left:12pt}.toc-3{padding-left:24pt}</style></head><body>${toHtml(md,{image:src=>base&&isLocal(src)?pathToFileURL(path.join(base,src)).href:''})}</body></html>`;
 return printHtml(html,'pdf')}

// PowerPoint with real text boxes, native charts and tables
export async function deckPptx(base,deck,ds=DEFAULT_DS){const {default:PptxGenJS}=await import('pptxgenjs');const p=new PptxGenJS();const ratio={'4:3':4/3,'1:1':1,'9:16':9/16}[deck.size];if(ratio){p.defineLayout({name:'CBA',width:13.333,height:13.333/ratio});p.layout='CBA'}else p.layout='LAYOUT_WIDE';p.title=deck.title||'Deck';
 const c=Object.fromEntries(Object.entries({...DEFAULT_DS.colors,...ds.colors}).map(([k,v])=>[k,v.replace('#','')]));const H=ds.fonts?.heading||'Plus Jakarta Sans',B=ds.fonts?.body||'Plus Jakarta Sans',W=13.333;
 const FMT=new Map();const fmt=(sl,key)=>{const o=sl.style?.[key];if(!o)return {};const r={};if(o.font)r.fontFace=o.font;if(Number(o.size))r.fontSize=Math.round(Number(o.size)*9.6);if(/^#[0-9a-f]{6}$/i.test(o.color||''))r.color=o.color.slice(1);if(typeof o.bold==='boolean')r.bold=o.bold;if(o.italic)r.italic=true;if(['left','center','right'].includes(o.align))r.align=o.align;const k=13.333/100;if(Number(o.dx))r.dxIn=Number(o.dx)*k;if(Number(o.dy))r.dyIn=Number(o.dy)*k;if(Number(o.w))r.w=Number(o.w)*k;if(Number(o.h))r.h=Number(o.h)*k;if(Number(o.rot))r.rotate=Number(o.rot);return r};
 const at=(sl,key,box)=>{const f=fmt(sl,key);return {...box,x:box.x+(f.dxIn||0),y:box.y+(f.dyIn||0),...(f.w?{w:f.w}:{}),...(f.h?{h:f.h}:{}),...(f.rotate?{rotate:f.rotate}:{})}};
 // free items: positions are cqw of the slide width (1cqw = 0.1333 in, line widths 9.6 pt per cqw)
 const items=(s,sl)=>{const k=13.333/100,col=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v.slice(1):null;for(const it of (Array.isArray(sl.items)?sl.items:[]).slice(0,60)){if(!it)continue;const box={x:(Number(it.x)||0)*k,y:(Number(it.y)||0)*k,w:Math.max(.05,(Number(it.w)||20)*k),h:Math.max(.02,(Number(it.h)||10)*k),...(Number(it.rot)?{rotate:Number(it.rot)}:{})};
  const line=col(it.line),lw=Math.max(.25,(Number(it.lw)||.15)*9.6);const f=it.fmt||{};
  if(it.type==='text')s.addText(String(it.text||''),{...box,fontFace:f.font||B,fontSize:Math.round((Number(f.size)||2.2)*9.6),color:col(f.color)||c.ink,bold:f.bold===true,italic:Boolean(f.italic),align:['left','center','right'].includes(f.align)?f.align:'left',valign:'top',margin:2,...(col(it.fill)?{fill:{color:col(it.fill)}}:{})});
  else if(it.type==='icon')s.addImage({data:'data:image/svg+xml;base64,'+Buffer.from(iconSvg(it.icon,'#'+(line||c.accent),1.8)).toString('base64'),...box});
  else if(it.type==='image'){if(isLocal(it.src)&&existsSync(path.join(base,it.src)))s.addImage({path:path.join(base,it.src),...box,sizing:{type:'cover',w:box.w,h:box.h}})}
  else if(it.type==='line'||it.type==='arrow')s.addShape(p.ShapeType.line,{x:box.x,y:box.y+box.h/2,w:box.w,h:0,...(box.rotate?{rotate:box.rotate}:{}),line:{color:line||c.ink,width:lw,...(it.type==='arrow'?{endArrowType:'triangle'}:{})}});
  else s.addShape(it.type==='ellipse'?p.ShapeType.ellipse:Number(it.r)?p.ShapeType.roundRect:p.ShapeType.rect,{...box,fill:{color:col(it.fill)||c.accent},line:line&&Number(it.lw)?{color:line,width:lw}:{type:'none'},...(Number(it.r)?{rectRadius:Math.min(.5,Number(it.r)*k/Math.min(box.w,box.h))}:{})})}};
 const T=(s,txt,o,key)=>{if(!txt)return;const f=key&&FMT.get(s)?fmt(FMT.get(s),key):{};const {dxIn,dyIn,...rest}=f;s.addText(String(txt),{fontFace:B,color:c.ink,valign:'top',margin:0,...o,...rest,x:(o.x||0)+(dxIn||0),y:(o.y||0)+(dyIn||0)})};
 const bullets=(s,items,o)=>{const list=(Array.isArray(items)?items:[]).filter(Boolean);if(list.length)s.addText(list.map(t=>({text:String(t),options:{bullet:{indent:18},paraSpaceAfter:8}})),{fontFace:B,color:c.ink,fontSize:20,valign:'top',margin:0,...o})};
 const image=(s,src,o)=>{if(isLocal(src)&&existsSync(path.join(base,src)))s.addImage({path:path.join(base,src),...o,sizing:{type:'cover',w:o.w,h:o.h}});else s.addShape(p.ShapeType.rect,{...o,fill:{color:c.surface},line:{color:c.muted,dashType:'dash'}})};
 (deck.slides||[]).forEach((sl,i)=>{const s=p.addSlide(),L=LAYOUTS.includes(sl.layout)?sl.layout:'bullets';FMT.set(s,sl);s.background={color:/^#[0-9a-f]{6}$/i.test(sl.bg||'')?sl.bg.slice(1):L==='title'?c.accent:L==='closing'?c.accent:L==='section'?c.surface:c.bg};if(sl.notes)s.addNotes(String(sl.notes));
  const head=(y=0.65)=>T(s,sl.title,{x:0.9,y,w:W-1.8,h:1,fontFace:H,fontSize:34,bold:true},'title');
  if(!['title','closing','section'].includes(L))T(s,(deck.title||'')+'   '+(i+1),{x:0.9,y:7,w:W-1.8,h:0.3,fontSize:10,color:c.muted,align:'right'});
  if(L==='title'){T(s,sl.eyebrow,{x:0.9,y:2.1,w:10,h:0.4,fontSize:14,bold:true,color:c.onAccent,charSpacing:4},'eyebrow');T(s,sl.title||deck.title,{x:0.9,y:2.6,w:10.5,h:2,fontFace:H,fontSize:54,bold:true,color:c.onAccent},'title');T(s,sl.subtitle,{x:0.9,y:4.7,w:9,h:1,fontSize:20,color:c.onAccent},'subtitle')}
  else if(L==='section'){T(s,String(sl.number||''),{x:0.9,y:2,w:4,h:1.6,fontFace:H,fontSize:88,bold:true,color:c.accent});T(s,sl.title,{x:0.9,y:3.7,w:11,h:1.2,fontFace:H,fontSize:40,bold:true});T(s,sl.subtitle,{x:0.9,y:4.9,w:10,h:0.8,fontSize:18,color:c.muted})}
  else if(L==='closing'){T(s,sl.title,{x:0.9,y:2.6,w:11,h:1.4,fontFace:H,fontSize:48,bold:true,color:c.onAccent});T(s,sl.subtitle,{x:0.9,y:4,w:10,h:0.8,fontSize:20,color:c.onAccent});T(s,sl.contact,{x:0.9,y:4.9,w:10,h:0.6,fontSize:18,bold:true,color:c.onAccent})}
  else if(L==='two-column'){head();['left','right'].forEach((k,j)=>{const x=0.9+j*5.9;T(s,sl[k]?.title,{x,y:1.9,w:5.4,h:0.6,fontFace:H,fontSize:22,bold:true,color:c.accent});T(s,sl[k]?.text,{x,y:2.6,w:5.4,h:0.9,fontSize:16});bullets(s,sl[k]?.bullets,{x,y:sl[k]?.text?3.5:2.6,w:5.4,h:3.2,fontSize:18})})}
  else if(L==='image'){T(s,sl.title,{x:0.9,y:1.2,w:5.6,h:1.4,fontFace:H,fontSize:32,bold:true});T(s,sl.text,{x:0.9,y:2.7,w:5.6,h:1.2,fontSize:17});bullets(s,sl.bullets,{x:0.9,y:sl.text?3.9:2.8,w:5.6,h:2.6,fontSize:18});image(s,sl.image,at(sl,'image',{x:7,y:1,w:5.4,h:5.4}))}
  else if(L==='quote'){T(s,'“'+(sl.quote||'')+'”',{x:1.3,y:1.9,w:10.5,h:3,fontFace:H,fontSize:36,bold:true});T(s,sl.by,{x:1.3,y:5,w:10,h:0.6,fontSize:18,color:c.muted});s.addShape(p.ShapeType.rect,{x:0.9,y:1.9,w:0.1,h:3,fill:{color:c.accent},line:{color:c.accent}})}
  else if(L==='big-number'){T(s,sl.eyebrow,{x:0.9,y:1.4,w:10,h:0.4,fontSize:14,bold:true,color:c.accent,charSpacing:4});T(s,sl.number,{x:0.9,y:1.9,w:11,h:2.6,fontFace:H,fontSize:150,bold:true,color:c.accent},'number');T(s,sl.text,{x:0.9,y:4.7,w:10,h:1.4,fontSize:24},'text')}
  else if(L==='chart'){head();const ch=sl.chart||{},type={bar:p.ChartType.bar,line:p.ChartType.line,pie:p.ChartType.pie}[ch.type]||p.ChartType.bar;const series=(ch.series||[]).slice(0,4).map(se=>({name:String(se.name||''),labels:(ch.labels||[]).map(String),values:(se.values||[]).map(Number)}));
   if(series.length)s.addChart(type,series,{...at(sl,'chart',{x:0.9,y:1.9,w:W-1.8,h:4.8}),chartColors:[0,1,2,3].map(k=>(Array.isArray(ch.colors)&&/^#[0-9a-f]{6}$/i.test(ch.colors[k]||'')?ch.colors[k].slice(1):[c.accent,c.accent2,c.muted,c.ink][k])),showLegend:series.length>1||type===p.ChartType.pie,legendPos:'r',catAxisLabelColor:c.muted,valAxisLabelColor:c.muted,barGapWidthPct:60,fontFace:B})}
  else if(L==='table'){head();const t=sl.table||{};const rows=[(t.head||[]).map(h=>({text:String(h),options:{bold:true,color:c.accent}})),...(t.rows||[]).slice(0,10).map(r=>r.map(x=>String(x)))];if(rows[0].length)s.addTable(rows,{...at(sl,'table',{x:0.9,y:1.9,w:W-1.8}),fontFace:B,fontSize:14,color:c.ink,border:{type:'solid',pt:0.5,color:'DDDDDD'}})}
  else if(L==='timeline'){head();const items=(sl.items||[]).slice(0,6),w=(W-1.8)/Math.max(1,items.length);s.addShape(p.ShapeType.line,{x:0.9,y:2.55,w:W-1.8,h:0,line:{color:c.accent,width:2}});items.forEach((it,j)=>{const x=0.9+j*w;s.addShape(p.ShapeType.ellipse,{x,y:2.4,w:0.3,h:0.3,fill:{color:c.accent},line:{color:c.accent}});T(s,it?.title,{x,y:3,w:w-0.3,h:0.6,fontFace:H,fontSize:18,bold:true});T(s,it?.text,{x,y:3.6,w:w-0.3,h:2,fontSize:14,color:c.muted})})}
  else if(L==='team'){head();const items=(sl.items||[]).slice(0,6),w=(W-1.8)/Math.max(1,items.length);items.forEach((it,j)=>{const x=0.9+j*w;if(isLocal(it?.image))s.addImage({path:path.join(base,it.image),x,y:2.1,w:1.8,h:1.8,rounding:true});else s.addShape(p.ShapeType.ellipse,{x,y:2.1,w:1.8,h:1.8,fill:{color:c.surface},line:{color:c.surface}});T(s,it?.name,{x,y:4.1,w:w-0.2,h:0.5,fontFace:H,fontSize:18,bold:true});T(s,it?.role,{x,y:4.6,w:w-0.2,h:0.5,fontSize:14,color:c.muted})})}
  else{head();T(s,sl.text,{x:0.9,y:1.9,w:10.5,h:1,fontSize:18});bullets(s,sl.bullets,{x:0.9,y:sl.text?2.9:1.9,w:10.5,h:4,fontSize:22})}
  items(s,sl)});
 return Buffer.from(await p.write({outputType:'arraybuffer'}))}

// Word document from the Markdown
export async function docDocx(md,title,ds=DEFAULT_DS,base=null){const d=await import('docx');const accent=(ds.colors?.accent||DEFAULT_DS.colors.accent).replace('#','');const font=ds.fonts?.body||'Plus Jakarta Sans';
 const runs=t=>inline(t).map(s=>s.link?new d.ExternalHyperlink({link:s.link,children:[new d.TextRun({text:s.text,style:'Hyperlink'})]}):new d.TextRun({text:s.cite?'['+s.text+']':s.text,bold:s.bold,italics:s.italic,superScript:Boolean(s.cite),font:s.code?'Consolas':undefined}));
 const children=[],toc=headings(md);for(const b of parse(md)){
  if(b.type==='toc'){children.push(new d.Paragraph({children:[new d.TextRun({text:'Contents',bold:true})],spacing:{after:80}}),...toc.map(h=>new d.Paragraph({children:[new d.TextRun(h.text)],indent:{left:(h.level-1)*360}})));continue}
  if(b.type==='img'){const file=base&&isLocal(b.src)?path.join(base,b.src):null;if(file&&existsSync(file)){const data=await readFile(file),ext=path.extname(file).slice(1).toLowerCase(),size=imageSize(data);const w=Math.min(600,size.w||600),h=Math.round(w*((size.h||400)/(size.w||600)));children.push(new d.Paragraph({children:[new d.ImageRun({type:ext==='jpeg'?'jpg':ext,data,transformation:{width:w,height:h},altText:{title:b.alt||'image',description:b.alt||'image',name:b.alt||'image'}})]}))}continue}
  if(b.type==='h')children.push(new d.Paragraph({heading:[d.HeadingLevel.HEADING_1,d.HeadingLevel.HEADING_2,d.HeadingLevel.HEADING_3,d.HeadingLevel.HEADING_4,d.HeadingLevel.HEADING_5,d.HeadingLevel.HEADING_6][b.level-1],children:runs(b.text)}));
  else if(b.type==='p')children.push(new d.Paragraph({children:runs(b.text),spacing:{after:160}}));
  else if(b.type==='ul'||b.type==='ol')for(const it of b.items)children.push(new d.Paragraph(b.type==='ul'?{bullet:{level:0},children:runs(it)}:{numbering:{reference:'num',level:0},children:runs(it)}));
  else if(b.type==='quote')children.push(new d.Paragraph({children:runs(b.text),indent:{left:480},border:{left:{style:d.BorderStyle.SINGLE,size:18,color:accent,space:12}}}));
  else if(b.type==='code')children.push(new d.Paragraph({children:[new d.TextRun({text:b.text,font:'Consolas',size:18})]}));
  else if(b.type==='hr')children.push(new d.Paragraph({border:{bottom:{style:d.BorderStyle.SINGLE,size:6,color:'DDDDDD',space:1}}}));
  else if(b.type==='table')children.push(new d.Table({width:{size:100,type:d.WidthType.PERCENTAGE},rows:[b.head,...b.rows].map((r,ri)=>new d.TableRow({children:r.map(cell=>new d.TableCell({children:[new d.Paragraph({children:ri?runs(cell):[new d.TextRun({text:cell,bold:true,color:accent})]})]}))}))}))}
 const doc=new d.Document({title:String(title||'Document'),styles:{default:{document:{run:{font,size:22}},heading1:{run:{font:ds.fonts?.heading||font,size:44,bold:true}},heading2:{run:{font:ds.fonts?.heading||font,size:30,bold:true,color:accent}}}},numbering:{config:[{reference:'num',levels:[{level:0,format:d.LevelFormat.DECIMAL,text:'%1.',alignment:d.AlignmentType.START}]}]},sections:[{children}]});
 return d.Packer.toBuffer(doc)}

// ---------- import ----------
// Text from PowerPoint (per slide, with notes) and Word (headings kept as Markdown), so the AI can restyle or continue them.
const xmlText=s=>s.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');
export async function officeText(buffer,ext){const X=await import('xlsx');const z=X.CFB.read(buffer,{type:'buffer'});
 const file=name=>{const i=z.FullPaths.findIndex(p=>p.endsWith('/'+name));return i<0?'':Buffer.from(z.FileIndex[i].content||[]).toString('utf8')};
 if(ext==='pptx'){const nums=z.FullPaths.map(p=>p.match(/\/ppt\/slides\/slide(\d+)\.xml$/)?.[1]).filter(Boolean).map(Number).sort((a,b)=>a-b);
  return nums.slice(0,80).map(n=>{const paras=(file('ppt/slides/slide'+n+'.xml').match(/<a:p>[\s\S]*?<\/a:p>/g)||[]).map(p=>xmlText((p.match(/<a:t>[^<]*<\/a:t>/g)||[]).join(''))).filter(Boolean);
   const notes=(file('ppt/notesSlides/notesSlide'+n+'.xml').match(/<a:t>[^<]*<\/a:t>/g)||[]).map(xmlText).join(' ').trim();return 'Slide '+n+':\n'+paras.map(p=>'- '+p).join('\n')+(notes?'\nNotes: '+notes:'')}).join('\n\n')}
 if(ext==='docx'){return (file('word/document.xml').match(/<w:p[ >][\s\S]*?<\/w:p>/g)||[]).map(p=>{const t=xmlText((p.match(/<w:t[^>]*>[^<]*<\/w:t>/g)||[]).join(''));const h=p.match(/<w:pStyle w:val="Heading(\d)"/)?.[1]||(/w:val="Title"/.test(p)?'1':null);const li=/<w:numPr>/.test(p);return t?(h?'#'.repeat(Number(h))+' ':li?'- ':'')+t:''}).filter(Boolean).join('\n\n')}
 return ''}

// ---------- share links ----------
// A share is a frozen copy: later edits do not change what people already received. Decks and documents
// become plain web pages; HTML outputs are copied with their files.
export async function shareSnapshot({root,base,output,ds=DEFAULT_DS,dir}){const {cp}=await import('node:fs/promises');await mkdir(dir,{recursive:true});
 await cp(base,dir,{recursive:true,filter:src=>!/[\/](store|output)\.json$/.test(src)});await cp(path.join(root,'assets','plus-jakarta-sans.woff2'),path.join(dir,'__font.woff2'));
 const face="@font-face{font-family:'Plus Jakarta Sans';src:url('__font.woff2') format('woff2');font-weight:200 800}";const title=String(output.title).replace(/[<>&"]/g,'');
 if(output.kind==='deck'){const deck=JSON.parse(await readFile(path.join(base,output.entry),'utf8'));const css=await readFile(path.join(root,'deck.css'),'utf8');
  const html=deckDocument(deck,{css,ds,fontFaces:face,resolve:src=>isLocal(src)?src:''}).replace('<style>','<meta name="viewport" content="width=device-width,initial-scale=1"><style>').replace('@page{size:1920px 1080px;margin:0}html,body{margin:0;background:#fff}.page{width:1920px;height:1080px;page-break-after:always;break-after:page;display:flex}.page .slide{width:1920px;height:1080px;border-radius:0;box-shadow:none}',
   'html,body{margin:0;background:#e9ebf0}body{padding:24px 16px 48px;display:grid;gap:20px;justify-items:center}.page{width:min(1100px,100%)}.page .slide{box-shadow:0 18px 50px -24px rgba(11,12,16,.35)}');
  await writeFile(path.join(dir,'index.html'),html)}
 else if(output.entry.endsWith('.md')){const md=await readFile(path.join(base,output.entry),'utf8');const c={...DEFAULT_DS.colors,...ds.colors};
  await writeFile(path.join(dir,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${face}body{margin:0;background:${c.surface};font:16px/1.7 'Plus Jakarta Sans',system-ui,sans-serif;color:${c.ink}}main{max-width:760px;margin:32px auto;background:${c.bg};padding:48px 56px;border-radius:14px;box-shadow:0 18px 50px -30px rgba(0,0,0,.3)}h1{font-size:32px;line-height:1.15}h2{color:${c.accent};margin-top:32px}a{color:${c.accent}}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:6px 10px;text-align:left}blockquote{margin:0;padding:8px 16px;border-left:3px solid ${c.accent};background:${c.surface}}@media(max-width:700px){main{margin:0;padding:28px 20px;border-radius:0}}</style></head><body><main>${toHtml(md)}</main></body></html>`)}
 else if(output.entry!=='index.html'){await writeFile(path.join(dir,'index.html'),`<!doctype html><meta http-equiv="refresh" content="0;url=${encodeURI(output.entry)}">`)}}
