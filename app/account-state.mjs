// One verdict per AI account, so Models > Accounts, Health > Needs you, Bottlenecks and the priority list can never disagree (UI audit 13:
// Health said a ChatGPT sign-in had stopped working while Models said Connected: Models only looked at "the engine lists it", Health at an
// agent's old report). Every reader gets its state from here; the page only turns a state into words.
//   checking      the first read of the account is not back yet
//   needs-signin  signed out: the account is gone from the engine's sign-ins, or Claude says it is not signed in
//   dead          the login is there but the provider refuses it (the engine marked it dead: 401 / revoked) or refuses the key
//   limit         signed in and working, but a limit that counts is used up (session / week at 100 %) or there is no credit left
//   connected     none of the above
// Order matters: a refused login is dead even if an old usage reading says 100 %; a dead or signed-out account is never "at its limit".
export function accountState({checking=false,signedIn=true,dead=false,key='',used=null}={}){
 if(checking)return 'checking';
 if(!signedIn)return 'needs-signin';
 if(dead||key==='rejected')return 'dead';
 if(key==='credit'||Number.isFinite(used)&&used>=100)return 'limit';
 return 'connected'}
// does this account need a person to sign in or paste a key (a button "Sign in", "Reconnect")?
export const needsPerson=s=>s==='needs-signin'||s==='dead';
// the highest "account" window in percent (what counts for switching), or null when there is none
export const worstUsed=ws=>{const a=(ws||[]).filter(w=>(w.scope||'account')==='account'&&Number.isFinite(Number(w.used))).map(w=>Number(w.used));return a.length?Math.max(...a):null};
// states of every account from what one read already has: {claude:[{key,v:{signedIn,partial,usage}}], prov:[{key,dead,windows}], keys:{key:{state}}, gone:[key]}
export function accountStates({claude=[],prov=[],keys={},gone=[]}={}){const out={};
 for(const {key,v} of claude){const u=v?.usage||{};out[key]=accountState({checking:!!v?.partial,signedIn:!!v?.signedIn,used:worstUsed([u.session,u.week].filter(Boolean).map(w=>({used:w.used})))})}
 for(const p of prov)out[p.key]=accountState({dead:!!p.dead,key:keys[p.key]?.state,used:worstUsed(p.windows)});
 for(const k of gone)if(!(k in out))out[k]='needs-signin';
 return out}
