// aqeelOS in Chrome's side panel. While it is open, the agent's tab opens in this same window, next to the chat.
(async()=>{const {base}=await chrome.storage.local.get('base');document.getElementById('app').src=(base||'https://ai.elkiya.com')+'/?panel=1';
 const w=await chrome.windows.getCurrent();chrome.runtime.connect({name:'panel:'+w.id})})();
