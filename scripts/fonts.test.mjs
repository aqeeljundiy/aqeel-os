// Fonts (12 Nov 2026): the app font is Plus Jakarta Sans, the digits 0-9 come from Google Sans Flex (owner's instruction).
// The digits are a second @font-face under the SAME family name with unicode-range:U+30-39. It must carry exactly the same
// style and weight descriptors as the text face, or the browser picks one face and all text falls back to the system font.
// This reads every tracked CSS/HTML/JS/MJS/CJS file and checks that rule, that each font file a face points at is in the repo,
// that the extension ships the digits file (and lists it as web accessible), and that the digits file has the tnum feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';
import path from 'node:path';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tracked=execFileSync('git',['ls-files','-z'],{cwd:ROOT,maxBuffer:1<<26}).toString().split('\0').filter(f=>/\.(css|html|m?js|cjs)$/.test(f)&&!/(^|\/)(vendor|node_modules)\//.test(f)&&f!=='scripts/fonts.test.mjs');
const FONT_DIRS=['assets','code/assets','extension'];
const DIGITS='U+30-39';
const read=f=>readFileSync(path.join(ROOT,f),'utf8');

// every @font-face block in a file, with its descriptors (a missing style counts as normal, a missing weight as 400)
export function faces(text){
 const out=[];
 for(const m of text.matchAll(/@font-face\s*\{((?:[^{}]|\$\{[^}]*\})*)\}/g)){
  const b=m[1],d=n=>(new RegExp('(?:^|[;{\\s])'+n+'\\s*:\\s*([^;]+)').exec(b)||[])[1]?.trim().replace(/\s+/g,' ');
  const fam=(d('font-family')||'').replace(/["'\\]/g,'');
  out.push({family:fam,style:d('font-style')||'normal',weight:d('font-weight')||'400',range:(d('unicode-range')||'').replace(/\s/g,'').toUpperCase(),src:d('src')||'',at:m.index})}
 return out}
const fileOf=src=>(/([\w.-]+\.woff2?)/.exec(src)||[])[1]||'';
const isDynamic=src=>/__|\$\{|'\s*\+|\+\s*'/.test(src); // copied or composed at run time (preview folders, template parts)

const jakarta=[];
for(const f of tracked){const t=read(f);if(!t.includes('@font-face'))continue;
 const fs=faces(t).filter(x=>x.family==='Plus Jakarta Sans');if(fs.length)jakarta.push({f,fs})}

test('the scan finds the app faces (so the test cannot go quiet)',()=>{
 assert.ok(jakarta.length>=9,'found only '+jakarta.length+' files: '+jakarta.map(x=>x.f).join(', '));
 for(const f of ['assets/brand.css','extension/popup.html','code/style.css','code/studio.css','code/planning.css','app/server.mjs'])assert.ok(jakarta.some(x=>x.f===f),f+' not scanned')});

test('every Plus Jakarta Sans text face has a digits face with identical style and weight',()=>{
 for(const {f,fs} of jakarta){
  const text=fs.filter(x=>!x.range),dig=fs.filter(x=>x.range);
  assert.ok(text.length,f+': only a digits face, no text face');
  assert.equal(dig.length,text.length,f+': '+text.length+' text face(s) but '+dig.length+' digits face(s)');
  for(const d of dig){assert.equal(d.range,DIGITS,f+': digits face has range '+d.range);assert.match(d.src,/google-sans-flex-digits|__cba-digits|__digits/,f+': digits face points at '+d.src)}
  text.forEach((t,i)=>{const d=dig[i];
   assert.equal(d.style,t.style,f+': digits font-style differs from the text face');
   assert.equal(d.weight,t.weight,f+': digits font-weight differs from the text face ('+d.weight+' vs '+t.weight+')')})}});

test('every font file a face points at is in the repo',()=>{
 for(const {f,fs} of jakarta)for(const x of fs){
  const file=fileOf(x.src);assert.ok(file,f+': no font file in '+x.src);
  if(isDynamic(x.src))continue; // written at run time from the repo files checked below
  assert.ok(FONT_DIRS.some(d=>existsSync(path.join(ROOT,d,file))),f+' points at '+file+', which is not in '+FONT_DIRS.join(', '))}
 for(const d of ['assets','code/assets'])for(const n of ['plus-jakarta-sans.woff2','google-sans-flex-digits.woff2'])assert.ok(existsSync(path.join(ROOT,d,n)),d+'/'+n+' missing')});

test('the Code server and its preview folders serve the digits file next to the text file',()=>{
 const s=read('code/server.mjs');
 assert.ok(s.includes("'/assets/google-sans-flex-digits.woff2':'assets/google-sans-flex-digits.woff2'"),'no static route');
 assert.ok(s.includes('google-sans-flex-digits\\.woff2'),'not in the phone-pairing allow-list');
 assert.match(read('code/workspace-api.mjs'),/__cba-digits\.woff2/);assert.match(read('code/outputs.mjs'),/__digits\.woff2/)});

test('the extension bundles the digits file, lists it as web accessible, and its page and overlay load it',()=>{
 const man=JSON.parse(read('extension/manifest.json'));
 const res=man.web_accessible_resources.flatMap(r=>r.resources);
 for(const n of ['plus-jakarta-sans.woff2','google-sans-flex-digits.woff2']){assert.ok(existsSync(path.join(ROOT,'extension',n)),'extension/'+n+' missing');assert.ok(res.includes(n),n+' not web accessible')}
 const ov=read('extension/overlay.js');
 assert.match(ov,/google-sans-flex-digits\.woff2/);assert.match(ov,/unicodeRange:'U\+30-39'/);
 assert.ok(!man.content_security_policy,'the extension sets a CSP; check it allows font-src for the bundled files')});

test('the text font is preloaded together with the digits file',()=>{
 for(const f of tracked.filter(x=>x.endsWith('.html'))){const t=read(f);
  if(/rel="preload"[^>]*plus-jakarta-sans\.woff2/.test(t))assert.match(t,/rel="preload"[^>]*google-sans-flex-digits\.woff2/,f+' preloads the text font but not the digits')}});

// the digits font keeps the tnum feature (read from its GSUB table), so font-variant-numeric:tabular-nums works on numbers
test('the digits font has tabular figures (tnum)',()=>{
 const b=readFileSync(path.join(ROOT,'assets/google-sans-flex-digits.woff2'));let o=48;const n=b.readUInt16BE(12);
 const known=['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca','prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF','GPOS','GSUB'];
 const rv=()=>{let v=0;for(let i=0;i<5;i++){const c=b[o++];v=(v<<7)|(c&127);if(!(c&128))break}return v>>>0};
 const ts=[];for(let i=0;i<n;i++){const fl=b[o++],t=fl&63;let tag;if(t===63){tag=b.toString('latin1',o,o+4);o+=4}else tag=known[t]||'?';const tr=(fl>>6)&3;const len=rv();if((tag==='glyf'||tag==='loca')?tr!==3:tr!==0)rv();ts.push({tag,len})}
 const data=zlib.brotliDecompressSync(b.subarray(o,o+b.readUInt32BE(20)));let p=0;for(const t of ts){t.off=p;p+=t.len}
 const g=ts.find(t=>t.tag==='GSUB');assert.ok(g,'no GSUB table in the digits font');
 const d=data.subarray(g.off,g.off+g.len),fl=d.readUInt16BE(6),nf=d.readUInt16BE(fl),tags=[];
 for(let i=0;i<nf;i++)tags.push(d.toString('latin1',fl+2+i*6,fl+6+i*6));
 assert.ok(tags.includes('tnum'),'features: '+tags.join(','))});
