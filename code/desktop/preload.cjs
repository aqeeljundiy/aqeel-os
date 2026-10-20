// Runs in aqeelOS (the window) and in Code's frame inside it. aqeelOS says where Code's frame is; Code says where its
// browser area is and whether it shows; the app puts the real browser tab exactly there.
const {contextBridge,ipcRenderer}=require('electron');
// main passes Code's port (CBA_PORT can move it off 4321)
const port=(process.argv.find(a=>a.startsWith('--cba-port='))||'').split('=')[1]||'4321';
const code=location.origin==='http://127.0.0.1:'+port||location.origin==='http://localhost:'+port;
const box=r=>({x:+r.x||0,y:+r.y||0,width:+r.width||0,height:+r.height||0});
const rect=r=>r&&{...box(r),radius:Math.min(60,Math.max(0,+r.radius||0)),visible:Boolean(r.visible),overlays:Array.isArray(r.overlays)?r.overlays.slice(0,30).map(box):[]};
if(code)contextBridge.exposeInMainWorld('cbaDesktop',{stage:r=>ipcRenderer.send('aq:stage',rect(r)),info:()=>ipcRenderer.invoke('aq:info')});
else contextBridge.exposeInMainWorld('aqDesktop',{frame:r=>ipcRenderer.send('aq:frame',rect(r)),info:()=>ipcRenderer.invoke('aq:info')});
