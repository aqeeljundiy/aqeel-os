// Connect: you are signed in to aqeelOS in this browser, so it hands this extension its own key (no password here).
const $=id=>document.getElementById(id);
const VER=chrome.runtime.getManifest().version;
// the address of the aqeelOS this copy was downloaded from (config.json comes with the download)
const DEF=(async()=>{try{return (await (await fetch(chrome.runtime.getURL('config.json'))).json()).base||'https://ai.elkiya.com'}catch{return 'https://ai.elkiya.com'}})();
const newer=(a,b)=>{const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)}return false};
async function show(){const {base,token}=await chrome.storage.local.get(['base','token']);const b=base||await DEF;$('base').value=b;$('ver').textContent='Version '+VER;
 const s=await chrome.runtime.sendMessage('status').catch(()=>({}));const on=!!(token&&s?.connected);
 const busy=on&&['work','need','fail','control'].includes(s.mode);
 $('st').className='st'+(on?' on':'')+(busy?' '+s.mode:'');
 $('stt').textContent=!on?(s?.replaced?'Another Chrome is connected':token?'Not connected right now':'Not connected yet'):{work:'The agent is working',need:'The agent needs you',fail:'A step failed',control:'You have control'}[s.mode]||'Connected';
 $('doing').textContent=busy?s.text:(!on&&s?.replaced?'aqeelOS is using the extension in another Chrome window or profile. Press Use this Chrome to switch here.':'');$('off').style.display=token?'':'none';$('go').textContent=s?.replaced?'Use this Chrome':token?'Reconnect':'Connect';
 // a newer extension on aqeelOS: say so, with the download
 try{const r=await fetch(b+'/ui/local-browser/version',{credentials:'include',headers:{'x-hui':'1'}});const j=await r.json();
  if(j.latest&&newer(j.latest,VER)){$('upd').style.display='block';$('upd').innerHTML='Version '+j.latest+' is ready. <a href="'+b+'/ui/local-browser/extension.zip" target="_blank">Download it</a>, unzip it over this folder, then press Reload on chrome://extensions.'}}catch{}}
$('go').onclick=async()=>{const go=$('go');if(go.disabled)return;go.disabled=true;go.textContent='Connecting…';$('err').textContent='';const base=$('base').value.trim().replace(/\/+$/,'')||await DEF;
 try{const r=await fetch(base+'/ui/local-browser/pair',{method:'POST',credentials:'include',headers:{'x-hui':'1','content-type':'application/json'},body:'{}'});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status===401?'Sign in to aqeelOS in this browser first, then press Connect again.':(j.error||'aqeelOS said no ('+r.status+').'));
  await chrome.storage.local.set({base,token:j.token});await chrome.runtime.sendMessage('connect');setTimeout(()=>{go.disabled=false;show()},800)}catch(e){$('err').textContent=e.message;go.disabled=false;show()}};
$('off').onclick=async()=>{await chrome.storage.local.remove('token');await chrome.runtime.sendMessage('connect');show()};
$('panel').onclick=async()=>{const w=await chrome.windows.getCurrent();await chrome.sidePanel.open({windowId:w.id});window.close()};
show();
