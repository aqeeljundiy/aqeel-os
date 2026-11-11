// Audit C2 (12 Nov 2026): a logo whose path data had a number after Z ("M0 0L10 10Z 5") spun the app's one thread for ever, at every start.
// The path and SVG readers must end on ANY input: return, or throw {unsupported:true}. The fuzz runs in a worker with a time limit, so a
// reader that loops fails this test instead of hanging the run. Also: icons are drawn off the main thread with a limit (icons-off.mjs),
// and a logo that cannot be drawn gives the plain tile and one notice (pwa.mjs).
import test from 'node:test';import assert from 'node:assert/strict';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {parseSvg,pathSubs,renderSvg} from '../app/raster.mjs';
import {runOff,buildIconsOff} from '../app/icons-off.mjs';
import {createPwa} from '../app/pwa.mjs';
import {decodePng} from '../app/png.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const rng=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296};
const SVG=d=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="${d}"/></svg>`;
// ends: returns or throws an "unsupported" error; anything else (a TypeError, a RangeError) is a bug too
const ends=f=>{try{f();return 'ok'}catch(e){if(e&&e.unsupported)return 'refused';throw e}};

function fuzz(){const R=rng(20261112),pick=a=>a[Math.floor(R()*a.length)];let n=0,refused=0;
 const TOK=['M','m','L','l','H','h','V','v','C','c','S','s','Q','q','T','t','A','a','Z','z','Z','z',' ',',','0','1','5','10','-3','.5','1e2','1e','-','+','.','e','x','#','\n','\t','0 0','1 1 0 0 1','NaN','Infinity','9'.repeat(30)];
 // 1) random token soup
 for(let i=0;i<6000;i++){let d='';const len=1+Math.floor(R()*24);for(let k=0;k<len;k++)d+=pick(TOK)+(R()<.5?' ':'');n++;if(ends(()=>pathSubs(d))==='refused')refused++}
 // 2) every valid path with something appended after each command, the audit's shape first
 const GOOD=['M0 0L10 10Z','M1 1H9V9H1Z','M0 0C1 1 2 2 3 3S5 5 6 6','M0 0Q1 1 2 2T4 4','M5 5A3 3 0 1 1 2 2Z','m1 1l2 2z m3 3l1 1z'];
 for(const g of GOOD)for(const tail of [' 5','5',' 5 5',',','Z 5','z5z5','Z'.repeat(50),' Z 1 Z 1','-','e','1e',' .',' 0 0 0 0 0 0 0'])for(const at of [g.length,...[...g].map((c,i)=>/[A-Za-z]/.test(c)?i+1:-1).filter(i=>i>0)]){n++;if(ends(()=>pathSubs(g.slice(0,at)+tail+g.slice(at)))==='refused')refused++}
 // 3) whole documents: the real marks with characters dropped, doubled or swapped
 const docs=[readFileSync(path.join(here,'..','assets','elkiya-mark.svg'),'utf8'),SVG('M0 0L10 10Z'),'<svg viewBox="0 0 10 10"><g transform="rotate(45 5 5)"><rect x="1" y="1" width="8" height="8" rx="2" stroke="#111" stroke-width="1"/><circle cx="5" cy="5" r="2"/><polygon points="0,0 5,5 0,5"/></g></svg>'];
 for(const doc of docs)for(let i=0;i<400;i++){let s=doc;for(let k=0;k<1+Math.floor(R()*3);k++){const p=Math.floor(R()*s.length),w=R();s=w<.34?s.slice(0,p)+s.slice(p+1):w<.67?s.slice(0,p)+s[p]+s.slice(p):s.slice(0,p)+pick(TOK)+s.slice(p+1)}
  n++;if(ends(()=>{const d=parseSvg(s);renderSvg(null,16,{doc:d})})==='refused')refused++}
 return {n,refused}}
// the worker loads this same file: there it only runs the fuzz and answers (no tests are declared, or each worker would start its own)
if(!isMainThread){if(workerData?.fuzz)parentPort.postMessage(fuzz())}
else{

test('the audit input: a number after Z is refused at once, not read as Z again for ever',()=>{
 const t=Date.now();assert.throws(()=>parseSvg(SVG('M0 0L10 10Z 5')),e=>e.unsupported===true&&/path data/.test(e.message));assert.ok(Date.now()-t<1000);
 for(const d of ['Z 5','M0 0Z5','M0 0z 1 2','M0 0L1 1ZZZ 3'])assert.throws(()=>pathSubs(d),e=>e.unsupported===true,d);
 // what is valid stays valid: Z then another command, Z twice, Z then a relative move
 assert.equal(pathSubs('M0 0L10 10ZM1 1L2 2Z').length,2);assert.equal(pathSubs('M0 0L10 0L10 10ZZ').length,1);assert.equal(pathSubs('M0 0L1 1z m2 2 l1 1').length,2)});

test('fuzz: thousands of malformed paths and damaged SVGs all end (return or a plain refusal), inside a worker with a time limit',async()=>{
 const r=await new Promise((res,rej)=>{const w=new Worker(fileURLToPath(import.meta.url),{workerData:{fuzz:true}});
  const t=setTimeout(()=>{w.terminate();rej(Error('the reader did not end within 60 seconds: it loops on some input'))},60000);
  w.once('message',m=>{clearTimeout(t);res(m)});w.once('error',e=>{clearTimeout(t);rej(e)})});
 assert.ok(r.n>7000,'ran '+r.n);assert.ok(r.refused>1000,'malformed input is refused, not drawn as a guess: '+r.refused)});

test('icon drawing has a time limit: a job that never ends is stopped and reported, the main thread stays free',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'icons-off-')),hang=path.join(dir,'hang.mjs');writeFileSync(hang,'for(;;){}');
 let beats=0;const iv=setInterval(()=>beats++,10);const t=Date.now();
 await assert.rejects(runOff('buildIcons',[{}],{ms:400,file:hang}),e=>e.iconFail==='slow');clearInterval(iv);
 assert.ok(Date.now()-t<5000);assert.ok(beats>=5,'the main thread kept running while the worker spun ('+beats+' beats)');
 // a worker that dies is a failure too, not a wait
 const dead=path.join(dir,'dead.mjs');writeFileSync(dead,'process.exit(3)');await assert.rejects(runOff('buildIcons',[{}],{ms:5000,file:dead}),e=>e.iconFail==='crash')});

const PNP=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" rx="12" fill="none" stroke="#111111" stroke-width="12"/></svg>');
const spec=(o={})=>({name:'Acme',colour:'#224466',defaultColour:'',accent:'',mono:false,custom:null,markCands:[{file:'brand-logo.svg',type:'image/svg+xml',data:PNP}],v:1,...o});

test('off the main thread the icon set is the same set (bytes survive the trip)',async()=>{
 const set=await buildIconsOff(spec());assert.equal(set.hasMark,true);assert.ok(Buffer.isBuffer(set.files['icon-192.png'].data));assert.equal(decodePng(set.files['icon-192.png'].data).w,192);
 const {buildIcons}=await import('../app/icons.mjs');const here=buildIcons(spec());assert.equal(set.v,here.v);assert.ok(set.files['icon-512.png'].data.equals(here.files['icon-512.png'].data))});

test('a logo that cannot be drawn: the plain tile, one notice, no second try until the brand changes; a later good logo clears it',async()=>{
 let v=1,bad=true;const fails=[],sets=[];const brand={iconSpec:async()=>spec({v})};
 const p=createPwa({brand,make:async s=>{if(bad)throw Object.assign(Error('Drawing the icons took longer than 20 seconds and was stopped.'),{iconFail:'slow'});return buildIconsOff(s)},onFail:(e,s)=>fails.push(e.message),onSet:(set,s,failed)=>sets.push(!!failed)});
 const a=await p.current();assert.equal(a.set.hasMark,false);assert.match(a.set.failed,/took longer/);assert.equal(a.set.needsLogo,false,'no "upload a logo" question: there is one, it could not be drawn');
 assert.ok(a.set.files['icon-192.png'].data.length>100,'the plain tile is a real icon');assert.ok(a.set.files['favicon.ico']);
 await p.current();await p.info();assert.equal(fails.length,1);assert.deepEqual(sets,[true]);
 // pages still get their tags
 assert.match(await p.page('<html><head></head></html>'),/apple-touch-icon/);
 bad=false;v=2;const b=await p.current();assert.equal(b.set.hasMark,true);assert.equal(b.set.failed,undefined);assert.deepEqual(sets,[true,false]);assert.equal(fails.length,1)});

test('the first page never waits for the icons: tags are there before the set is drawn',async()=>{let open;const gate=new Promise(r=>open=r);
 const p=createPwa({brand:{iconSpec:async()=>spec()},make:async s=>{await gate;return buildIconsOff(s)}});
 const run=p.current();assert.match(p.headSync(),/manifest\.webmanifest/);open();await run;assert.match(p.headSync(),/\/pwa\/[0-9a-f]{10}\//)});
}
