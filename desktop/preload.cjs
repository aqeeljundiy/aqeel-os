// Runs in aqeelOS (the window) and in Code's frame inside it. aqeelOS says where Code's frame is; Code says where its
// browser area is and whether it shows; the app puts the real browser tab exactly there.
const {contextBridge,ipcRenderer}=require('electron');
const code=/^http:\/\/(127\.0\.0\.1|localhost):43\d\d$/.test(location.origin);
const box=r=>({x:+r.x||0,y:+r.y||0,width:+r.width||0,height:+r.height||0});
const rect=r=>r&&{...box(r),visible:Boolean(r.visible),overlays:Array.isArray(r.overlays)?r.overlays.slice(0,30).map(box):[]};
if(code)contextBridge.exposeInMainWorld('cbaDesktop',{stage:r=>ipcRenderer.send('aq:stage',rect(r)),info:()=>ipcRenderer.invoke('aq:info')});
else contextBridge.exposeInMainWorld('aqDesktop',{frame:r=>ipcRenderer.send('aq:frame',rect(r)),info:()=>ipcRenderer.invoke('aq:info')});
