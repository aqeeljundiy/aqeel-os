// node --test scripts/proof-lean-screen.test.mjs
// LEAN-1 (12 Nov 2026), the two things nobody had looked at on a woken lean screen: "no wallpaper error box" and "the tabs come back".
// Proven here on a real X display with the real fluxbox and the real Chrome, started with exactly what scripts/agent-users.sh starts a lean
// screen with (its lean_wm_files, its fluxbox command line, its Chrome flags, read out of the script), in a throwaway folder and on a
// display of its own: no agent's screen is touched.
//  1. A lean screen's window manager comes up and no error box (xmessage, from fbsetbg finding no wallpaper setter) is on the display.
//  2. Chrome with two pages open is ended the way a screen goes to sleep (chrome_graceful: TERM), started again the way a wake starts it,
//     and both pages are open again.
// Needs Linux with Xvfb, fluxbox, xwininfo and the box's Chrome; anywhere else it is skipped (the rules themselves are in lean-screen.test.mjs).
import test from 'node:test';import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';import {mkdtempSync,readFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createServer} from 'node:http';

const SCRIPT=path.join(path.dirname(fileURLToPath(import.meta.url)),'agent-users.sh'),SRC=readFileSync(SCRIPT,'utf8');
const has=c=>process.platform==='linux'&&spawnSync('sh',['-c','command -v '+c],{encoding:'utf8'}).status===0;
const val=n=>new RegExp('^'+n+'="?([^"\\n]+)"?$','m').exec(SRC)?.[1]||'';
const CHROME=val('CHROME'),CHROME_MEM=val('CHROME_MEM'),CHROME_LEAN=val('CHROME_LEAN');
const X=has('Xvfb')&&has('fluxbox')&&has('xwininfo'),C=X&&!!CHROME&&existsSync(CHROME);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// a display of its own: Xvfb picks a free number and says which
async function display(){const p=spawn('Xvfb',['-displayfd','1','-screen','0','1280x800x24','-nolisten','tcp'],{stdio:['ignore','pipe','ignore']});let out='';p.stdout.on('data',d=>out+=d);
 for(let i=0;i<100&&!/\d+\n/.test(out);i++)await sleep(100);assert.match(out,/^\d+\n/,'Xvfb did not start');return {p,disp:':'+out.trim()}}
const tree=disp=>spawnSync('xwininfo',['-root','-tree'],{encoding:'utf8',env:{...process.env,DISPLAY:disp}}).stdout||'';

test('what this proof starts is what agent-users.sh starts for a lean screen',()=>{
 assert.match(SRC,/lean-fluxbox\) as_user "\$u" bash -c "\$\(declare -f lean_wm_files\); lean_wm_files \\"\\\$1\\"" bash "\$sd" <\/dev\/null\n\s+desk="\( HOME='\$sd\/fb' PATH='\$sd\/fluxbox\/bin':\$PATH fluxbox -rc '\$sd\/fluxbox\/init' -no-slit -no-toolbar >>/);
 assert.match(SRC,/\{ \[ "\$cport" != "\$cdp" \] \|\| \[ -n "\$lean" \]; \} && open="--restore-last-session"/,'every lean screen starts Chrome with its last tabs');
 assert.match(SRC,/chrome_loop '\$sd' '\$CHROME' --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check --user-data-dir='\$ws\/\.browser' --remote-debugging-address=127\.0\.0\.1 --remote-debugging-port=\$cport --window-size=1280,800 --start-maximized \$CHROME_MEM \$lean \$open/);
 assert.match(SRC,/chrome_graceful\(\)\{[\s\S]{0,400}kill -TERM "\$pid"/,'a sleep ends Chrome with TERM, so it writes its session');
 assert.ok(CHROME_LEAN.includes('--hide-crash-restore-bubble'));assert.ok(CHROME_MEM.length>0)});

test('a lean screen: the window manager is up and there is no error box on the display',{skip:!X&&'needs Linux with Xvfb, fluxbox and xwininfo'},async()=>{
 const d=mkdtempSync(path.join(tmpdir(),'aq-lean-')),sd=d+'/sd';mkdirSync(sd,{recursive:true});const {p:xv,disp}=await display();let fb;
 try{
  const r=spawnSync('bash',['-c',`export AQ_AGENT_USERS_LIB=1 AQEELOS_HOME='${d}' AQ_RESTARTS='${d}/rst' AQ_SEEN='${d}/seen' AQ_WAKE='${d}/wake'; source '${SCRIPT}'; lean_wm_files '${sd}'`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  fb=spawn('fluxbox',['-rc',sd+'/fluxbox/init','-no-slit','-no-toolbar'],{env:{...process.env,DISPLAY:disp,HOME:sd+'/fb',PATH:sd+'/fluxbox/bin:'+process.env.PATH},stdio:'ignore'});
  await sleep(4000);assert.equal(fb.exitCode,null,'fluxbox is running');
  const t=tree(disp);assert.ok(t.length>50,'the display answered');assert.doesNotMatch(t,/xmessage|fbsetbg/i,'an error box is on the screen:\n'+t);
  const kids=(t.match(/^\s+0x[0-9a-f]+ "[^"]*"/gm)||[]).map(l=>l.trim());assert.ok(!kids.some(k=>/error|warning/i.test(k)),'a window that looks like an error: '+kids.join(' | '));
  // the control, said but not judged (it depends on what the box has installed): the same window manager WITHOUT the lean files, on a display
  // of its own. On Elkiya, 12 Nov 2026, this is where the box is: a window "xmessage", 636x136, in the middle of the screen.
  fb.kill('SIGTERM');mkdirSync(d+'/plain',{recursive:true});const c=await display(),plain=spawn('fluxbox',['-no-slit'],{env:{...process.env,DISPLAY:c.disp,HOME:d+'/plain'},stdio:'ignore'});await sleep(4000);
  console.log('# control: a plain fluxbox (no lean files) on this box '+(/xmessage/i.test(tree(c.disp))?'DOES put an xmessage error box on the screen; the lean screen above has none':'shows no error box either (a wallpaper setter is installed here)'));
  plain.kill('SIGTERM');c.p.kill('SIGTERM');   // the display going away takes its error box with it
 }finally{fb?.kill('SIGTERM');xv.kill('SIGTERM');await sleep(300);rmSync(d,{recursive:true,force:true})}});

test('a lean screen: Chrome ended the way a sleep ends it comes back with the pages that were open',{skip:!C&&'needs Linux with Xvfb, fluxbox and the box\'s Chrome ('+(CHROME||'not named')+')',timeout:120000},async()=>{
 const d=mkdtempSync(path.join(tmpdir(),'aq-lean-')),ws=d+'/ws';mkdirSync(ws,{recursive:true});const {p:xv,disp}=await display();
 const web=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<title>'+req.url+'</title><p>page '+req.url)});await new Promise(r=>web.listen(0,'127.0.0.1',r));const site='http://127.0.0.1:'+web.address().port;
 const free=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
 const args=['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--user-data-dir='+ws+'/.browser','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+free,'--window-size=1280,800','--start-maximized',...CHROME_MEM.split(' '),...CHROME_LEAN.split(' '),'--window-position=0,0','--restore-last-session'];
 const start=()=>spawn(CHROME,args,{env:{...process.env,DISPLAY:disp,HOME:ws},stdio:'ignore'});
 const pages=async()=>{const r=await fetch('http://127.0.0.1:'+free+'/json').catch(()=>null);return r&&r.ok?(await r.json()).filter(t=>t.type==='page').map(t=>t.url):null};
 const up=async()=>{for(let i=0;i<150;i++){const p=await pages();if(p)return p;await sleep(200)}throw new Error('Chrome did not answer on its port')};
 const ended=c=>new Promise(r=>{if(c.exitCode!==null||c.signalCode)return r(true);c.once('exit',()=>r(true));setTimeout(()=>r(false),10000)});
 let chrome;
 try{chrome=start();await up();
  for(const p of ['/orders','/inbox'])assert.equal((await fetch('http://127.0.0.1:'+free+'/json/new?'+encodeURIComponent(site+p),{method:'PUT'})).status,200);
  for(let i=0;i<50;i++){const p=await pages();if(p.includes(site+'/orders')&&p.includes(site+'/inbox'))break;await sleep(200)}
  assert.ok((await pages()).includes(site+'/inbox'),'the pages are open');await sleep(2500);
  // asleep: Chrome is ended gracefully (chrome_graceful), nothing answers on its port
  chrome.kill('SIGTERM');assert.equal(await ended(chrome),true,'Chrome ended within the time a sleep gives it');assert.equal(await pages(),null);
  // woken: the same start again
  const t0=Date.now();chrome=start();await up();let back=[];for(let i=0;i<75;i++){back=await pages();if(back.includes(site+'/orders')&&back.includes(site+'/inbox'))break;await sleep(200)}
  assert.ok(back.includes(site+'/orders')&&back.includes(site+'/inbox'),'the tabs did not come back: '+JSON.stringify(back));
  assert.doesNotMatch(tree(disp),/xmessage/i);console.log('# tabs back '+((Date.now()-t0)/1000).toFixed(1)+' s after the wake start: '+back.filter(u=>u.startsWith(site)).length+' of 2');
 }finally{chrome?.kill('SIGKILL');xv.kill('SIGTERM');web.close();await sleep(500);rmSync(d,{recursive:true,force:true})}});
