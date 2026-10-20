// aqeelOS desktop app (Windows and Mac). Opens your aqeelOS in its own window and runs Code's engine on this
// computer. In Code's browser area it places a real browser: one native Chromium view per tab, drawn by the app
// (sharp, real cookies, history and sign-ins, kept per project in the project's .aqeelos/browser folder). Code's
// engine drives those tabs over the DevTools protocol, the same way it drives any Chrome, through a small control
// channel on 127.0.0.1 that only it knows the key to.
const {app,BrowserWindow,WebContentsView,session,ipcMain,shell,dialog,Tray,Menu}=require('electron');
const path=require('node:path'),fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto'),{spawn}=require('node:child_process');

const CODE_PORT=Number(process.env.CBA_PORT||4321);
const DEV=!app.isPackaged;
// Code's files: the repo (while developing) or a writable copy of the bundled files (so Code can update itself)
const BUNDLED=DEV?path.resolve(__dirname,'..'):path.join(process.resourcesPath,'code');
const CODE_DIR=DEV?BUNDLED:path.join(app.getPath('userData'),'code');
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const HOME_URL=(process.env.AQEELOS_URL||read(path.join(BUNDLED,'aqeelos.json'),{}).aqeelos?.base||'https://ai.elkiya.com').replace(/\/$/,'');

// one window only
if(!app.requestSingleInstanceLock()){app.quit()}
// the DevTools port Code's engine uses to drive the browser tabs (this computer only)
const DEBUG_PORT=9400+Math.floor(Math.random()*400);
app.commandLine.appendSwitch('remote-debugging-port',String(DEBUG_PORT));
app.commandLine.appendSwitch('remote-allow-origins','http://127.0.0.1:'+DEBUG_PORT);

let win=null,server=null;
const CTL_KEY=crypto.randomBytes(24).toString('hex');

// ---------- Code's engine ----------
function copyBundled(){if(DEV)return;const mark=path.join(CODE_DIR,'.app-version');
 // the bundled copy goes in on first run and after the app itself was updated; between those, Code updates itself
 if(fs.existsSync(path.join(CODE_DIR,'server.mjs'))&&(()=>{try{return fs.readFileSync(mark,'utf8')===app.getVersion()}catch{return false}})())return;
 fs.mkdirSync(CODE_DIR,{recursive:true});fs.cpSync(BUNDLED,CODE_DIR,{recursive:true,force:true,filter:src=>!/[\\/]data([\\/]|$)/.test(src.slice(BUNDLED.length))});fs.writeFileSync(mark,app.getVersion())}
const up=()=>new Promise(r=>{const q=http.get({host:'127.0.0.1',port:CODE_PORT,path:'/api/status?quick',timeout:1500},res=>{res.resume();r(res.statusCode===200)});q.on('error',()=>r(false));q.on('timeout',()=>{q.destroy();r(false)})});
async function startCode(){if(await up())return;copyBundled();
 server=spawn(process.execPath,[path.join(CODE_DIR,'server.mjs')],{cwd:CODE_DIR,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',HUB_PORT:String(CODE_PORT),CBA_DESKTOP:'1'},stdio:'ignore',windowsHide:true});
 server.on('exit',code=>{server=null;if(!app.isQuitting)setTimeout(()=>startCode().then(attach).catch(()=>{}),code===0?500:3000)});   // updates exit with 0: start the new version
 for(let i=0;i<60&&!(await up());i++)await new Promise(r=>setTimeout(r,250))}
// tell Code's engine where the app's browser is (it then uses these tabs instead of a Chrome of its own)
async function attach(){try{const s=await getJson('/api/session');await postJson('/api/workspace/desktop-attach',{ctl:'http://127.0.0.1:'+ctlPort+'/'+CTL_KEY,debugPort:DEBUG_PORT},s.token)}catch(e){console.warn('attach:',e.message)}}
const getJson=p=>new Promise((res,rej)=>http.get({host:'127.0.0.1',port:CODE_PORT,path:p},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej));
const postJson=(p,body,token)=>new Promise((res,rej)=>{const q=http.request({host:'127.0.0.1',port:CODE_PORT,path:p,method:'POST',headers:{'content-type':'application/json','x-local-token':token}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>r.statusCode<300?res(b):rej(Error(b)))});q.on('error',rej);q.end(JSON.stringify(body))});

// ---------- the browser tabs ----------
const tabs=new Map();   // targetId -> {view, wc}
let active=null,profile=null,ses=null,downloads=null,frameRect=null,stageRect=null,shown=false;
function sessionFor(dir){let s;try{s=session.fromPath?session.fromPath(dir):null}catch{}if(!s)s=session.fromPartition('persist:code-'+crypto.createHash('sha1').update(dir).digest('hex').slice(0,16));
 // a plain Chrome to sites (Electron's own name left out of the user agent)
 s.setUserAgent(s.getUserAgent().replace(/\s(Electron|aqeelOS|aqeelos-desktop)\/\S+/gi,''));
 // microphone, camera, location and notifications: Code asks the person first in its own bar (see browser.mjs) and
 // remembers the answer per site in the project's browser-permissions.json; only a site the person said yes to gets
 // them here, everything else (and reading the clipboard) is refused, never granted silently
 s.setPermissionRequestHandler((wc,perm,cb,d)=>cb(sitePermit(wc,perm,d||{})));
 s.setPermissionCheckHandler((wc,perm,origin,d)=>sitePermit(wc,perm,{...(d||{}),requestingUrl:(d&&d.requestingUrl)||origin,mediaTypes:d&&d.mediaType?[d.mediaType]:undefined}));
 s.on('will-download',(e,item)=>{if(!downloads)return;fs.mkdirSync(downloads,{recursive:true});let to=path.join(downloads,item.getFilename()),n=2;while(fs.existsSync(to)){const x=path.parse(item.getFilename());to=path.join(downloads,x.name+' ('+(n++)+')'+x.ext)}item.setSavePath(to)});
 return s}
function sitePermit(wc,perm,d){if(perm==='fullscreen'||perm==='clipboard-sanitized-write')return true;
 const kinds=perm==='media'?((d.mediaTypes&&d.mediaTypes.length?d.mediaTypes:['audio','video']).map(t=>t==='audio'?'audioCapture':t==='video'?'videoCapture':'').filter(Boolean)):perm==='geolocation'?['geolocation']:perm==='notifications'?['notifications']:null;
 if(!kinds||!kinds.length||!profile)return false;let origin='';try{origin=new URL(d.requestingUrl||(wc&&wc.getURL())||'').origin}catch{return false}
 const saved=read(path.join(path.dirname(profile),'browser-permissions.json'),{})[origin]||{};return kinds.every(k=>saved[k]==='granted')}
async function targetOf(wc){wc.debugger.attach('1.3');try{return (await wc.debugger.sendCommand('Target.getTargetInfo')).targetInfo.targetId}finally{try{wc.debugger.detach()}catch{}}}
async function newTab(url){if(!ses)ses=sessionFor(profile||path.join(app.getPath('userData'),'browser'));
 const view=new WebContentsView({webPreferences:{session:ses,contextIsolation:true,sandbox:true}});const wc=view.webContents;
 // links that would open a new window open in this tab (one view per tab, like Code's browser)
 wc.setWindowOpenHandler(({url:u})=>{wc.loadURL(u).catch(()=>{});return {action:'deny'}});
 win.contentView.addChildView(view);view.setVisible(false);const id=await targetOf(wc);tabs.set(id,{view,wc});
 await wc.loadURL(url&&url!=='about:blank'?url:'about:blank').catch(()=>{});if(!active)show(id);return id}
function show(id){if(!tabs.has(id))return;active=id;for(const [k,t] of tabs)t.view.setVisible(k===id&&shown);place()}
function close(id){const t=tabs.get(id);if(!t)return;tabs.delete(id);win.contentView.removeChildView(t.view);try{t.wc.close()}catch{}if(active===id){active=null;const next=[...tabs.keys()][0];if(next)show(next)}}
function closeAll(){for(const id of [...tabs.keys()])close(id)}
// where the tab goes: Code's browser area, inside Code's frame, inside aqeelOS
function place(){const t=active&&tabs.get(active);if(!t)return;if(!shown||!stageRect||!frameRect){t.view.setVisible(false);return}
 const fx=frameRect.x,fy=frameRect.y,b={x:Math.round(fx+stageRect.x),y:Math.round(fy+stageRect.y),width:Math.max(1,Math.round(stageRect.width)),height:Math.max(1,Math.round(stageRect.height))};
 const hit=o=>o.width>0&&o.height>0&&o.x<b.x+b.width&&o.x+o.width>b.x&&o.y<b.y+b.height&&o.y+o.height>b.y;
 const covered=(frameRect.overlays||[]).some(hit)||(stageRect.overlays||[]).some(o=>hit({...o,x:o.x+fx,y:o.y+fy}));
 if(t.radius!==(stageRect.radius||0)){t.radius=stageRect.radius||0;try{t.view.setBorderRadius(t.radius)}catch{}}
 t.view.setVisible(!covered);move(t,b)}
// a size switch (Desktop, Tablet, Mobile…) glides to the new bounds; small changes (dragging the window) follow at once
function move(t,b){const from=t.bounds,same=from&&from.x===b.x&&from.y===b.y&&from.width===b.width&&from.height===b.height;if(same)return;
 const big=from&&(Math.abs(from.width-b.width)>from.width*.08||Math.abs(from.height-b.height)>from.height*.08);clearTimeout(t.tween);t.bounds=b;
 if(!big||!t.view.getVisible?.()){t.view.setBounds(b);return}
 const start=Date.now(),cur=t.view.getBounds(),ease=k=>1-Math.pow(1-k,3),lerp=(a,z,k)=>Math.round(a+(z-a)*k);
 const step=()=>{const k=Math.min(1,(Date.now()-start)/240),e=ease(k);t.view.setBounds({x:lerp(cur.x,b.x,e),y:lerp(cur.y,b.y,e),width:lerp(cur.width,b.width,e),height:lerp(cur.height,b.height,e)});if(k<1)t.tween=setTimeout(step,12)};step()}
ipcMain.on('aq:frame',(e,r)=>{frameRect=r&&r.visible?r:null;if(!frameRect){for(const t of tabs.values())t.view.setVisible(false);return}place()});                       // aqeelOS: where Code's frame is in the window
ipcMain.on('aq:stage',(e,r)=>{stageRect=r&&r.width>0?r:null;shown=Boolean(r&&r.visible);for(const [k,t] of tabs)t.view.setVisible(k===active&&shown);place()});   // Code: its browser area
ipcMain.handle('aq:info',()=>({desktop:true,platform:process.platform,version:app.getVersion()}));

// the control channel for Code's engine: profile, tabs (127.0.0.1, with the key)
let ctlPort=0;
const ctl=http.createServer(async(req,res)=>{const send=(c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
 if(!req.url.startsWith('/'+CTL_KEY+'/'))return send(403,{error:'no'});const route=req.url.slice(CTL_KEY.length+2);let b='';for await(const c of req)b+=c;let d={};try{d=JSON.parse(b||'{}')}catch{}
 try{if(route==='info')return send(200,{port:DEBUG_PORT,tabs:[...tabs.keys()],active});
  if(route==='debug'){const t=active&&tabs.get(active);return send(200,{shown,stageRect,frameRect,active,bounds:t?.view.getBounds(),visible:t?.view.getVisible?.(),url:t?.wc.getURL()})}
  if(route==='profile'){downloads=d.downloads||downloads;if(d.dir&&d.dir!==profile){closeAll();profile=d.dir;fs.mkdirSync(profile,{recursive:true});ses=sessionFor(profile)}return send(200,{ok:true})}
  if(route==='new'){const id=await newTab(d.url);return send(200,{id})}
  if(route==='show'){show(d.id);return send(200,{ok:true})}
  if(route==='close'){close(d.id);return send(200,{ok:true})}
  return send(404,{error:'Unknown.'})}catch(e){return send(500,{error:e.message})}});

// ---------- the window ----------
// started at login with --background: the window is made but stays hidden until you open aqeelOS (Start menu, Dock or tray)
const BACKGROUND=process.argv.includes('--background');
async function open(){win=new BrowserWindow({width:1440,height:920,show:!BACKGROUND,minWidth:900,minHeight:600,title:'aqeelOS',backgroundColor:'#ffffff',autoHideMenuBar:true,
  icon:path.join(BUNDLED,'assets',process.platform==='win32'?'icon.ico':'icon-512.png'),
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegrationInSubFrames:true,sandbox:false,additionalArguments:['--cba-port='+CODE_PORT]}});
 win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'}});
 win.on('resize',place);
 // closing the window keeps aqeelOS running in the background (Code keeps working for agents and other browsers); Quit is in the tray
 win.on('close',e=>{if(!app.isQuitting){e.preventDefault();win.hide()}});
 await win.loadURL(HOME_URL+'/#/code/code')}

app.whenReady().then(async()=>{await new Promise(r=>ctl.listen(0,'127.0.0.1',()=>{ctlPort=ctl.address().port;if(DEV)console.log('control: http://127.0.0.1:'+ctlPort+'/'+CTL_KEY+'/');r()}));
 if(!DEV)app.setLoginItemSettings({openAtLogin:true,args:['--background']});makeTray();
 await open();try{await startCode();await attach()}catch(e){dialog.showErrorBox('aqeelOS','Code could not start: '+e.message)}});
const showWin=()=>{if(!win)return;if(win.isMinimized())win.restore();win.show();win.focus()};
// aqeelos://code links (from the website when Code is opened in a normal browser) bring this app forward on Code
if(!DEV)app.setAsDefaultProtocolClient('aqeelos');
const openLink=u=>{showWin();if(win&&/^aqeelos:\/\/code/i.test(String(u||'')))win.webContents.executeJavaScript("location.hash='#/code/code'").catch(()=>{})};
app.on('second-instance',(e,argv)=>openLink(argv.find(x=>/^aqeelos:/i.test(x))));app.on('open-url',(e,u)=>{e.preventDefault();openLink(u)});app.on('activate',showWin);
let tray=null;
function makeTray(){try{tray=new Tray(path.join(BUNDLED,'assets',process.platform==='win32'?'icon.ico':'icon-180.png'));tray.setToolTip('aqeelOS');
 tray.setContextMenu(Menu.buildFromTemplate([{label:'Open aqeelOS',click:showWin},{type:'separator'},{label:'Quit aqeelOS',click:()=>{app.isQuitting=true;app.quit()}}]));tray.on('click',showWin)}catch(e){console.warn('tray:',e.message)}}
app.on('before-quit',()=>{app.isQuitting=true;try{server?.kill()}catch{}});
app.on('window-all-closed',()=>app.quit());

// ---------- the basics of a desktop app: keyboard shortcuts and a right-click menu ----------
app.whenReady().then(()=>{
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform==='darwin'?[{role:'appMenu'}]:[]),
  {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'pasteAndMatchStyle'},{role:'selectAll'}]},
  {label:'View',submenu:[{role:'reload'},{role:'forceReload'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'},{role:'toggleDevTools'}]},
  {role:'windowMenu'}]));
 const menuFor=(wc,p,inTab)=>{const items=[];
  if(p.linkURL){items.push({label:'Open link in your browser',click:()=>shell.openExternal(p.linkURL)},{label:'Copy link',click:()=>require('electron').clipboard.writeText(p.linkURL)},{type:'separator'})}
  if(p.isEditable)items.push({role:'undo',enabled:p.editFlags.canUndo},{role:'redo',enabled:p.editFlags.canRedo},{type:'separator'},{role:'cut',enabled:p.editFlags.canCut},{role:'copy',enabled:p.editFlags.canCopy},{role:'paste',enabled:p.editFlags.canPaste},{role:'selectAll'});
  else if(p.selectionText)items.push({role:'copy'},{role:'selectAll'});
  if(inTab){if(items.length)items.push({type:'separator'});items.push({label:'Back',enabled:wc.navigationHistory.canGoBack(),click:()=>wc.navigationHistory.goBack()},{label:'Forward',enabled:wc.navigationHistory.canGoForward(),click:()=>wc.navigationHistory.goForward()},{label:'Reload',click:()=>wc.reload()})}
  if(items.length)Menu.buildFromTemplate(items).popup()};
 app.on('web-contents-created',(e,wc)=>wc.on('context-menu',(ev,p)=>menuFor(wc,p,[...tabs.values()].some(t=>t.wc===wc))));
});

// ---------- the app updates itself: aqeelOS says which version is current; the installer comes with your sign-in ----------
const newer=(a,b)=>{const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)}return false};
let offered='';
async function checkAppUpdate(){if(DEV||!win)return;try{
 const v=await win.webContents.executeJavaScript("fetch('/ui/code/app-version',{headers:{'x-hui':'1'},credentials:'same-origin'}).then(r=>r.ok?r.json():{}).catch(()=>({}))");
 const want=v?.[process.platform==='darwin'?'mac':'windows'];if(!want||!newer(want,app.getVersion())||offered===want)return;offered=want;
 const r=await dialog.showMessageBox(win,{type:'info',buttons:['Restart and update','Later'],defaultId:0,cancelId:1,title:'aqeelOS',message:'aqeelOS '+want+' is ready',detail:'It takes about a minute. Your projects and chats stay as they are.'});
 if(r.response!==0)return;
 const to=path.join(app.getPath('temp'),process.platform==='darwin'?'aqeelOS.dmg':'aqeelOS-Setup.exe');
 win.webContents.session.once('will-download',(e,item)=>{item.setSavePath(to);item.once('done',(ev,state)=>{if(state!=='completed'){dialog.showErrorBox('aqeelOS','The update did not download. Try again later.');offered='';return}
  if(process.platform==='win32'){spawn(to,['/S','--force-run'],{detached:true,stdio:'ignore'}).unref();app.isQuitting=true;app.quit()}else shell.openPath(to)})});
 win.webContents.downloadURL(HOME_URL+'/ui/code/download/'+(process.platform==='darwin'?'mac':'windows'))}catch(e){console.warn('app update:',e.message)}}
app.whenReady().then(()=>{setTimeout(checkAppUpdate,90000);setInterval(checkAppUpdate,6*3600e3)});
