// The routes that sign a person in before they have a session: password (/auth/login), the two-step code (/auth/code) and the invite
// (/auth/invite, /auth/accept). They used to sit in server.mjs. Two limits apply to each: the per-address one (limited/miss/clear, server.mjs)
// and the per-account one (signin-guard.mjs). A waiting account answers EXACTLY like a wrong password: same status, same words, same work.
// The owner's own browser (a valid session cookie for that account) is never held up by the wait; see signin-guard.mjs.
import {burn} from './signin-guard.mjs';
export function createSignInRoutes({users,guard,send,readBody,clientIp,ownerCheck,signIn,limited,miss,clear,needEmail=()=>false}){
 const TOO_MANY={error:'Too many attempts. Try again in a few minutes.'};
 const body=async req=>{try{return JSON.parse(await readBody(req,4096))}catch{return {}}};
 return async function handle(req,res,p,url){
  if(p==='/auth/login'&&req.method==='POST'){
   const ip=clientIp(req);if(limited(ip))return send(res,429,TOO_MANY),true;
   const b=await body(req),nm=String(b.name||'').trim();
   const wrong=()=>send(res,401,{error:!nm?'Enter your email.':!nm.includes('@')&&users.emailOnly()?'Sign in with your email address.':'That email and password do not match.'});
   // per account, whatever the address: while it waits the password is not even looked at, and the answer is the wrong-password one
   const lk=await users.loginKey(b.name);
   if(guard.wait(lk,{signIn:true})){burn();miss(ip);return wrong(),true}
   const u=await users.login(b.name,b.password||'',ownerCheck);
   if(!u){guard.fail(lk,{signIn:true});miss(ip);return wrong(),true}
   const note=users.loginNote(u,b.name);
   clear(ip);guard.ok(lk);
   // two-step: the password was right; now a code goes to their confirmed email
   if(u.twoStep&&u.emailVerified){try{return send(res,200,{needCode:true,key:await users.loginCode(u),to:u.email.replace(/^(.).*(@.*)$/,'$1•••$2'),note}),true}catch(e){return send(res,502,{error:'Your sign-in code could not be sent: '+e.message}),true}}
   return send(res,200,{ok:true,note},signIn(u.id)),true}
  if(p==='/auth/code'&&req.method==='POST'){const ip=clientIp(req);if(limited(ip))return send(res,429,TOO_MANY),true;
   const b=await body(req),v=users.finishLogin(b.key,b.code);
   if(v.error){miss(ip);return send(res,401,{error:v.error}),true}
   return send(res,200,{ok:true},signIn(v.user.id)),true}
  // Invite links: /#invite/<code> asks for a name and password, then signs the new person in. A code that matches nothing counts toward one shared
  // bucket (there is no account yet); while it waits even a right code answers "expired".
  if(p==='/auth/invite'&&req.method==='GET'){const gone=()=>send(res,404,{error:GONE});if(guard.wait('invite:any'))return gone(),true;
   const i=await users.inviteInfo(url.searchParams.get('code')||'');if(!i){guard.fail('invite:any');return gone(),true}return send(res,200,i),true}
  if(p==='/auth/accept'&&req.method==='POST'){const ip=clientIp(req);if(limited(ip))return send(res,429,TOO_MANY),true;
   const b=await body(req);
   // the live app needs their email (they sign in with it); a test copy's checks may leave it out
   if(needEmail()&&!String(b.email||'').trim())return send(res,400,{error:'Enter your email address. You sign in with it.'}),true;
   if(guard.wait('invite:any')){miss(ip);return send(res,400,{error:GONE}),true}
   try{const u=await users.accept(String(b.code||''),b.name,b.password,b.username,b.email);return send(res,200,{ok:true,name:u.name},signIn(u.id)),true}
   catch(e){miss(ip);if(e.message===GONE)guard.fail('invite:any');return send(res,400,{error:e.message}),true}}
  return false}}
const GONE='This invite link has expired or was already used.';
