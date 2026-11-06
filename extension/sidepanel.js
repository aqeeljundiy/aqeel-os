// aqeelOS in Chrome's side panel, as a compact chat. While it is open, the agent's tab opens in this same window, next to the chat.
(async()=>{const {base}=await chrome.storage.local.get('base');const f=document.getElementById('app');
 f.onload=()=>{f.classList.add('in');document.getElementById('wait').classList.add('out')};
 let def='http://localhost:4400';try{def=(await (await fetch(chrome.runtime.getURL('config.json'))).json()).base||def}catch{}
 f.src=(base||def)+'/?panel=1#/chat';
 const w=await chrome.windows.getCurrent();chrome.runtime.connect({name:'panel:'+w.id})})();
