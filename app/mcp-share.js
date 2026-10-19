// Sign-in notices for connected apps (sharing between agents: access.js).
// A connected app whose sign-in ran out: admins get one notice per app, with a Sign in button that opens its page.
const Signins={shown:new Set(),async check(){if(!S.signedIn||S.me?.admin===false||document.hidden)return;let d;try{d=await UI('/ui/mcp/signins')}catch{return}
 for(const x of d.items||[]){const k=x.agent+'|'+x.name;if(this.shown.has(k))continue;this.shown.add(k);
  Notices.show({key:'signin|'+k,kind:'warn',icon:'key',life:600000,title:x.name+' needs signing in again',text:x.agentName+' can’t use '+x.name+' until you sign in ('+x.why+').',
   actions:[{label:'Sign in',primary:true,run:async()=>{const w=window.open('about:blank','_blank');try{const r=await post(UI,'/ui/mcp/start-signin',{agent:x.agent,name:x.name});const u=r.authorization_url||r.auth_url||r.url;if(!u)throw new Error(r.error||'No sign-in page came back.');if(w)w.location=u;else window.open(u,'_blank');toast('Finish signing in on the page that opened')}catch(e){w?.close();fail(e)}}}]})}}};
setTimeout(()=>Signins.check(),20000);setInterval(()=>Signins.check(),15*60e3);
