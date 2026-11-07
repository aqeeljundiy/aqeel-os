// Getting into aqeelOS without editing a file (7 Nov 2026): the first-run owner account, "Forgot password" by email,
// and the owner's recovery code. Every route here is before sign-in, so each one counts toward the same per-address
// limit as a wrong password. The people data itself lives in users.mjs.
export function createAccountAuth({users,send,readBody,signIn,limited,miss,revoke,publicUrl}){
 const json=async req=>{try{return JSON.parse(await readBody(req,4096))}catch{return {}}};
 return async function handle(req,res,p,url){
  if(p==='/auth/setup'&&req.method==='GET')return send(res,200,{needed:await users.needsOwner()}),true;
  if(!/^\/auth\/(setup|forgot|reset|recover)$/.test(p)||req.method!=='POST'&&!(p==='/auth/reset'&&req.method==='GET'))return false;
  if(p==='/auth/reset'&&req.method==='GET'){const i=await users.resetInfo(url.searchParams.get('t')||'');send(res,i?200:404,i||{error:'This reset link has expired or was already used. Ask for a new one.'});return true}
  if(limited(req)){send(res,429,{error:'Too many attempts. Try again in a few minutes.'});return true}
  const b=await json(req);
  if(p==='/auth/setup'){try{const r=await users.createOwner(b.name,b.email,b.password);console.log('owner account made at first run:',r.user.username);send(res,200,{ok:true,recovery:r.recovery},signIn(r.user.id))}
   catch(e){if(e.status!==409)miss(req);send(res,e.status||400,{error:e.message})}return true}
  // the answer is the same whether or not the person exists; mail errors are only logged
  if(p==='/auth/forgot'){miss(req);await users.forgot(b.who,t=>publicUrl()+'/#reset/'+t).catch(e=>console.warn('password reset mail:',e.message));send(res,200,{ok:true});return true}
  if(p==='/auth/reset'){const r=await users.finishReset(String(b.t||''),b.password);if(r.error){miss(req);send(res,400,{error:r.error});return true}
   await revoke(r.user.id);console.log('password reset by email:',r.user.id);send(res,200,{ok:true},signIn(r.user.id));return true}
  if(p==='/auth/recover'){const r=await users.recoverOwner(b.code,b.password);if(r.error){if(!r.keep)miss(req);send(res,400,{error:r.error});return true}
   await revoke('owner');console.log('owner signed in with the recovery code; two-step is off');send(res,200,{ok:true,recovery:r.recovery},signIn('owner'));return true}
  return false}}
