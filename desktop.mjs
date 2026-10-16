// Computer use for every AI in the app: list app windows, look at one, click, type, press keys and scroll.
// Windows uses a long-lived PowerShell helper (desktop-win.ps1); macOS uses osascript and screencapture
// (the app needs Accessibility and Screen Recording permission in System Settings › Privacy & Security).
import {spawn,execFile} from 'node:child_process';
import {readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {isWindows,isMac} from './platform.mjs';

// apps an AI may never drive: this app itself (it would approve its own actions) and password managers
export const BLOCKED=/code by aqeel|keepass|1password|bitwarden|lastpass|dashlane|keychain access|credential manager/i;
export const appKey=a=>String(a.name||'').toLowerCase();

// "ctrl+shift+s", "enter", "alt+f4" → SendKeys syntax (^+s, {ENTER}, %{F4})
const SK={enter:'{ENTER}',return:'{ENTER}',tab:'{TAB}',esc:'{ESC}',escape:'{ESC}',backspace:'{BACKSPACE}',delete:'{DEL}',del:'{DEL}',insert:'{INS}',up:'{UP}',down:'{DOWN}',left:'{LEFT}',right:'{RIGHT}',home:'{HOME}',end:'{END}',pageup:'{PGUP}',pagedown:'{PGDN}',space:' '};
export function sendKeysCombo(combo){const parts=String(combo).toLowerCase().split('+').map(s=>s.trim()).filter(Boolean);if(!parts.length)throw Error('Name a key, like enter or ctrl+s.');
 let mods='';const key=parts.pop();for(const m of parts){if(m==='ctrl'||m==='control')mods+='^';else if(m==='shift')mods+='+';else if(m==='alt'||m==='option')mods+='%';else if(m==='win'||m==='cmd'||m==='meta')throw Error('The Windows key cannot be pressed.');else throw Error('Unknown modifier '+m+'.')}
 let k=SK[key]||(/^f([1-9]|1[0-2])$/.test(key)?'{'+key.toUpperCase()+'}':key.length===1?escapeSendKeys(key):null);if(!k)throw Error('Unknown key '+key+'.');return mods+k}
export const escapeSendKeys=t=>String(t).replace(/[+^%~(){}[\]]/g,c=>'{'+c+'}').replace(/\r?\n/g,'{ENTER}');

// macOS: AppleScript key codes and modifiers
const MAC_CODES={enter:36,return:36,tab:48,esc:53,escape:53,backspace:51,delete:117,up:126,down:125,left:123,right:124,home:115,end:119,pageup:116,pagedown:121,space:49,f1:122,f2:120,f3:99,f4:118,f5:96,f6:97,f7:98,f8:100,f9:101,f10:109,f11:103,f12:111};
export function macCombo(combo){const parts=String(combo).toLowerCase().split('+').map(s=>s.trim()).filter(Boolean);const key=parts.pop();const mods=parts.map(m=>({ctrl:'control down',control:'control down',shift:'shift down',alt:'option down',option:'option down',cmd:'command down',meta:'command down'})[m]||(()=>{throw Error('Unknown modifier '+m+'.')})());
 const using=mods.length?' using {'+mods.join(', ')+'}':'';if(MAC_CODES[key]!==undefined)return 'key code '+MAC_CODES[key]+using;if(key?.length===1)return 'keystroke "'+key.replace(/["\\]/g,'\\$&')+'"'+using;throw Error('Unknown key '+key+'.')}
const osa=(script,lang)=>new Promise((res,rej)=>execFile('osascript',[...(lang?['-l',lang]:[]),'-e',script],{timeout:20000},(e,out,err)=>e?rej(Error((err||e.message).trim().slice(-300))):res(out.trim())));
const macProc=pid=>'(first process whose unix id is '+Number(pid)+')';
// bring the app forward and refuse to act if something else stays in front
const macFront=pid=>'set frontmost of '+macProc(pid)+' to true\ndelay 0.2\nif unix id of (first process whose frontmost is true) is not '+Number(pid)+' then error "Could not bring that app to the front. Ask the user to click its window once."';

export class Desktop{
 constructor({root}){this.root=root;this.helper=null;this.queue=Promise.resolve();this.scale=new Map()}
 supported(){return isWindows||isMac}
 // one request at a time to the Windows helper
 win(req){const job=this.queue.then(()=>new Promise((resolve,reject)=>{
  if(!this.helper||this.helper.exitCode!==null){this.helper=spawn('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.root,'desktop-win.ps1')],{windowsHide:true});this.helper.buf='';this.helper.waiting=[];
   this.helper.stdout.on('data',d=>{this.helper.buf+=d;let i;while((i=this.helper.buf.indexOf('\n'))>=0){const line=this.helper.buf.slice(0,i).trim();this.helper.buf=this.helper.buf.slice(i+1);if(!line)continue;const w=this.helper.waiting.shift();if(!w)continue;try{const r=JSON.parse(line);r.ok?w.resolve(r):w.reject(Error(r.error||'Desktop action failed.'))}catch{w.reject(Error('Desktop helper sent an unreadable reply.'))}}});
   this.helper.on('exit',()=>{for(const w of this.helper?.waiting||[])w.reject(Error('Desktop helper stopped.'))});this.helper.stdin.on('error',()=>{})}
  const t=setTimeout(()=>reject(Error('The desktop action took too long.')),30000);this.helper.waiting.push({resolve:r=>{clearTimeout(t);resolve(r)},reject:e=>{clearTimeout(t);reject(e)}});this.helper.stdin.write(JSON.stringify(req)+'\n')}));
  this.queue=job.catch(()=>{});return job}
 stop(){try{this.helper?.kill()}catch{}this.helper=null}

 async apps(){if(isWindows)return (await this.win({op:'list'})).apps.filter(a=>!BLOCKED.test(a.title+' '+a.name));
  const out=await osa("const se=Application('System Events');JSON.stringify(se.applicationProcesses.whose({backgroundOnly:false})().map(p=>({pid:p.unixId(),name:p.name(),title:(p.windows().length?p.windows[0].name():'')||p.name()})))",'JavaScript');return JSON.parse(out).filter(a=>!BLOCKED.test(a.title+' '+a.name))}
 async find(pid){const a=(await this.apps()).find(x=>x.pid===Number(pid));if(!a)throw Error('That app is not open, or it cannot be controlled. List apps again.');return a}
 // screenshot of the app window, at most 1280px wide; later coordinates are in this image's pixels
 async shot(pid){if(isWindows){const r=await this.win({op:'shot',pid,max:1280});this.scale.set(Number(pid),r.scale||1);return {png:r.png,width:r.width,height:r.height}}
  const info=JSON.parse(await osa("ObjC.import('CoreGraphics');const l=ObjC.deepUnwrap($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll,0))||[];const w=l.find(x=>x.kCGWindowOwnerPID==="+Number(pid)+"&&x.kCGWindowLayer===0&&x.kCGWindowBounds.Width>50);JSON.stringify(w?{id:w.kCGWindowNumber,b:w.kCGWindowBounds}:null)",'JavaScript'));if(!info)throw Error('That app has no window to capture.');
  const {X:x,Y:y,Width:w,Height:h}=info.b;const file=path.join(os.tmpdir(),'cba-shot-'+Date.now()+'.png');await new Promise((res,rej)=>execFile('screencapture',['-x','-o','-l',String(info.id),file],e=>e?rej(Error('Screen Recording permission is needed: System Settings › Privacy & Security › Screen Recording.')):res()));
  const scale=Math.min(1,1280/Math.max(w,h));if(scale<1)await new Promise(r=>execFile('sips',['-Z',String(Math.round(Math.max(w,h)*scale)),file],()=>r()));const png=(await readFile(file)).toString('base64');await unlink(file).catch(()=>{});this.scale.set(Number(pid),{scale,x,y});return {png,width:Math.round(w*scale),height:Math.round(h*scale)}}
 // convert screenshot pixels back to window pixels
 point(pid,x,y){const s=this.scale.get(Number(pid));if(s===undefined)throw Error('Take a screenshot of the app first, then use its coordinates.');const k=typeof s==='number'?s:s.scale;return {x:Math.round(x/k),y:Math.round(y/k),ox:typeof s==='object'?s.x:0,oy:typeof s==='object'?s.y:0}}
 async click(pid,x,y,{button='left',double=false}={}){const p=this.point(pid,x,y);if(isWindows)return this.win({op:'click',pid,x:p.x,y:p.y,button,double});
  await osa('tell application "System Events"\n'+macFront(pid)+'\nclick at {'+(p.ox+p.x)+', '+(p.oy+p.y)+'}'+(double?'\nclick at {'+(p.ox+p.x)+', '+(p.oy+p.y)+'}':'')+'\nend tell')}
 async type(pid,text){if(typeof text!=='string'||!text||text.length>5000)throw Error('Type between 1 and 5,000 characters.');if(isWindows)return this.win({op:'keys',pid,keys:escapeSendKeys(text)});
  await osa('tell application "System Events"\n'+macFront(pid)+'\nkeystroke "'+text.replace(/["\\]/g,'\\$&')+'"\nend tell')}
 async key(pid,combo){if(isWindows)return this.win({op:'keys',pid,keys:sendKeysCombo(combo)});await osa('tell application "System Events"\n'+macFront(pid)+'\n'+macCombo(combo)+'\nend tell')}
 async scroll(pid,x,y,clicks){const p=this.point(pid,x,y);clicks=Math.max(-20,Math.min(20,Math.round(clicks)||0));if(isWindows)return this.win({op:'scroll',pid,x:p.x,y:p.y,clicks});
  for(let i=0;i<Math.abs(clicks);i++)await this.key(pid,clicks>0?'pagedown':'pageup')}
}
