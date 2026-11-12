// Runs inside noVNC's own page (/screen/vnc.html; app/screen-link.mjs puts it there), before noVNC starts. AUD-15 (13 Nov 2026):
// the screen's live connection needs a ticket that opens one connection, for this sign-in, within 30 s. noVNC cannot ask for one
// itself, so this does, through noVNC's own page: it writes the ticket into noVNC's "path" setting and presses Connect; when noVNC is
// about to reconnect it writes a fresh one; a connection that fails is tried again with a new ticket (up to 20 times, at most
// every 10 s). No access to that screen (401/403): it stops and says so. Works the same in the panel's frame and in its own tab.
(()=>{
 const q=new URLSearchParams(location.search),path=q.get('path')||'websockify',pq=new URLSearchParams(path.split('?')[1]||'');
 const agent=pq.get('agent')||'default',ads=pq.get('screen')==='ads';
 const base=path.split('?')[0]+'?agent='+encodeURIComponent(agent)+(ads?'&screen=ads':'');
 const root=document.documentElement,$=id=>document.getElementById(id);
 let tries=0,timer=null,stop=false,state=null;
 const style=document.createElement('style');style.textContent='#noVNC_connect_dlg{display:none!important}';document.head.append(style);
 function say(t){let el=$('aqTicketNote');if(!el){el=document.createElement('div');el.id='aqTicketNote';el.style.cssText='position:fixed;inset:auto 0 45% 0;text-align:center;color:#e8e8ea;font:600 15px system-ui,sans-serif;z-index:99';document.body.append(el)}el.textContent=t}
 async function ticket(){
  const r=await fetch('/ui/screens/'+encodeURIComponent(agent)+'/ticket'+(ads?'?screen=ads':''),{method:'POST',headers:{'x-hui':'1'},credentials:'same-origin'});
  if(r.status===401||r.status===403||r.status===404){stop=true;say(r.status===401?'Sign in again to see this screen.':'You do not have access to this screen.');return null}
  const j=await r.json().catch(()=>({}));return j.ticket||null}
 async function arm(){const t=await ticket().catch(()=>null),el=$('noVNC_setting_path');if(!t||!el)return false;
  el.value=base+'&ticket='+encodeURIComponent(t);el.dispatchEvent(new Event('change'));return true}
 async function connect(){if(stop)return;if(!await arm())return retry();$('noVNC_connect_button')?.click()}
 function retry(){clearTimeout(timer);if(stop||tries>=20)return;timer=setTimeout(connect,Math.min(10000,1500*++tries))}
 // noVNC's state is the class on <html>: noVNC_loading until it has started, then connecting, connected, reconnecting or none (disconnected)
 const now=()=>{const c=root.classList;return c.contains('noVNC_loading')?'loading':c.contains('noVNC_connected')?'up':c.contains('noVNC_reconnecting')?'re':c.contains('noVNC_connecting')?'connecting':c.contains('noVNC_disconnecting')?'closing':'idle'};
 new MutationObserver(()=>{const s=now();if(s===state)return;const was=state;state=s;
  if(s==='up')tries=0;else if(s==='re')arm();else if(s==='idle'){if(was==='loading')connect();else retry()}}).observe(root,{attributes:true,attributeFilter:['class']});
 state=now();
})();
