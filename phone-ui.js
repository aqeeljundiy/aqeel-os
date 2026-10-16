// "Phone" dialog: turn phone access on/off, show the address and a pairing code, manage paired devices.
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

export function openPhoneDialog(ctx){
 const d=el('dialog','kit-dialog phone-dialog');document.body.append(d);let state=null,timer=null;
 const close=()=>{clearInterval(timer);d.close();setTimeout(()=>d.remove(),180)};d.addEventListener('cancel',e=>{e.preventDefault();close()});
 async function act(action,extra={}){try{state=await ctx.api('/remote',{action,...extra},true);render()}catch(e){ctx.notify(e.message)}}
 function render(){d.replaceChildren();const h=el('h2','','Use on your phone');
  const intro=el('p','kit-message','Open code by aqeel on your iPhone over your home Wi-Fi. Your computer still does the work; the phone shows chats, approvals and previews.');
  const toggle=el('label','switch-row');const box=el('input');box.type='checkbox';box.setAttribute('role','switch');box.checked=state.enabled;box.addEventListener('change',()=>act(box.checked?'enable':'disable'));toggle.append(box,el('span','',state.enabled?'Phone access is on':'Phone access is off'));
  d.append(h,intro,toggle);
  if(state.enabled){
   const steps=el('ol','phone-steps');
   const s1=el('li');s1.append(el('strong','','On your phone, open '));const urls=state.addresses.length?state.addresses:[{url:'(no network found)',name:''}];
   for(const a of urls){const u=el('code','phone-url',a.url);s1.append(u,el('small','',a.tailscale?' Tailscale (works away from home)':' '+a.name))}steps.append(s1);
   const s2=el('li');s2.append(el('strong','','Enter this pairing code'));
   if(state.code){const code=el('div','pair-code',state.code.value.replace(/(\d{3})(\d{3})/,'$1 $2'));const left=el('small','pair-left');const tick=()=>{const s=Math.max(0,Math.round((state.code.expires-Date.now())/1000));left.textContent=s?'Expires in '+Math.floor(s/60)+':'+String(s%60).padStart(2,'0'):'Expired';if(!s)clearInterval(timer)};clearInterval(timer);timer=setInterval(tick,1000);tick();s2.append(code,left)}
   else{const b=el('button','primary','Show pairing code');b.type='button';b.addEventListener('click',()=>act('code'));s2.append(b)}steps.append(s2);
   steps.append(el('li','','Optional: in Safari tap Share › Add to Home Screen to open it like an app.'));d.append(steps);
   d.append(el('p','kit-message small-print','Windows may ask to allow Node.js on private networks: allow it. Traffic on your Wi-Fi is not encrypted; for use away from home, install Tailscale on both devices.'));
   const list=el('div','device-list');list.append(el('h3','','Paired devices'));
   if(!state.devices.length)list.append(el('p','kit-message','No devices yet.'));
   for(const dev of state.devices){const row=el('div','device-row');row.append(el('span','',dev.name+' · last seen '+new Date(dev.lastSeen).toLocaleString()));const r=el('button','','Revoke');r.type='button';r.addEventListener('click',()=>act('revoke',{id:dev.id}));row.append(r);list.append(row)}
   d.append(list)}
  const actions=el('div','dialog-actions');const done=el('button','primary','Done');done.type='button';done.addEventListener('click',close);actions.append(done);d.append(actions)}
 ctx.api('/remote',null,true).then(s=>{state=s;render();d.showModal()}).catch(e=>{ctx.notify(e.message);d.remove()});
}
