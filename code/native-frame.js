// Inside code by aqeel.exe (WebView2) the page is the whole window: its top bar drags the window and carries
// the minimise / maximise / close buttons, like Claude's desktop app. In a normal browser this does nothing.
(()=>{const host=window.chrome&&window.chrome.webview;if(!host)return;
 const root=document.documentElement;root.classList.add('native-frame');
 const ICONS={min:'<path d="M5 12h14"/>',max:'<rect x="6" y="6" width="12" height="12" rx="1.5"/>',restore:'<rect x="5" y="8" width="11" height="11" rx="1.5"/><path d="M8 8V6.5A1.5 1.5 0 0 1 9.5 5H17.5A1.5 1.5 0 0 1 19 6.5V14.5A1.5 1.5 0 0 1 17.5 16H16"/>',close:'<path d="M6 6l12 12M18 6 6 18"/>'};
 const button=(cmd,label)=>{const b=document.createElement('button');b.type='button';b.className='wc-'+cmd;b.setAttribute('aria-label',label);b.title=label;b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS[cmd]+'</svg>';b.addEventListener('click',()=>host.postMessage(cmd));return b};
 const max=button('max','Maximize');
 const mount=()=>{const bar=document.querySelector('.topbar')||document.querySelector('body>header');if(!bar||bar.querySelector('.window-controls'))return;
  const box=document.createElement('div');box.className='window-controls';box.append(button('min','Minimize'),max,button('close','Close'));bar.append(box)};
 host.addEventListener('message',e=>{const maximized=e.data==='maximized';root.classList.toggle('window-maximized',maximized);max.querySelector('svg').innerHTML=maximized?ICONS.restore:ICONS.max;max.setAttribute('aria-label',maximized?'Restore':'Maximize');max.title=maximized?'Restore':'Maximize'});
 // the window background follows the theme so resizing never flashes the wrong colour
 const theme=()=>host.postMessage(root.classList.contains('dark')?'dark':'light');
 new MutationObserver(theme).observe(root,{attributes:true,attributeFilter:['class']});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();theme();host.postMessage('ready')});else{mount();theme();host.postMessage('ready')}})();
