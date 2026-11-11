// Local owner channel (12 Nov 2026): answer "Needs you" items from a terminal on the box, without a browser session.
// /local/* only from the loopback socket, no proxy header, and header x-aqeel-local = DATA/local-owner.key. Acts as the owner.
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';import {readFile,writeFile,chmod} from 'node:fs/promises';import path from 'node:path';
const LOOP=/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/;
export const keyFile=DATA=>path.join(DATA,'local-owner.key');
export async function ensureKey(DATA){const f=keyFile(DATA);try{const k=(await readFile(f,'utf8')).trim();if(/^[0-9a-f]{64}$/.test(k))return k}catch{}
 const k=randomBytes(32).toString('hex');await writeFile(f,k+'\n',{mode:0o600});await chmod(f,0o600).catch(()=>{});return k}
// pure: may this request use /local/*?  The public proxy forwards from loopback, so any forwarding header means no.
export function localAllowed({remote,headers={},key}){if(!key||!LOOP.test(String(remote||'')))return false;
 if(headers['x-forwarded-for']!=null||headers['cf-connecting-ip']!=null||headers['forwarded']!=null||headers['x-real-ip']!=null)return false;
 const got=headers['x-aqeel-local'];if(typeof got!=='string'||!got)return false;
 const h=s=>createHash('sha256').update(s).digest();return timingSafeEqual(h(got),h(String(key)))}
// the list the CLI shows: what needsFor gives, plus the choices with their keys
export function choicesOf(x){if(x.kind==='conflict')return (x.sides||[]).map(s=>({key:s.key,label:s.label,text:s.text||'',value:s.value??null}));
 if(x.kind==='question'){const c=(x.options||[]).map(o=>({key:o.key,label:o.label,text:o.effect||'',recommended:!!o.recommended}));if(x.allowOther)c.push({key:'other',label:'Something else',text:'give --text'});return c}
 if(x.kind==='cadence')return [{key:'check',label:'Add the standard check',text:''},{key:'keep',label:'Keep it as it is',text:''}];return []}
export const viewOf=x=>({id:x.id,kind:x.kind,title:x.title,text:x.text||x.detail||'',agent:x.agent||null,choices:choicesOf(x),...(choicesOf(x).length?{}:{health:(x.action&&x.action.label)||x.label||'Open it on Health'})});
// pure-ish dispatch over the existing handlers; throws Error with .status
export async function answerItem({items,id,choice,value,text,conflicts,questions,runGates,by='owner (local)'}){const x=items.find(i=>i.id===id);const bad=(m,s=409)=>Object.assign(Error(m),{status:s});
 if(!x)throw bad('That one is already gone.',404);
 if(x.kind==='conflict'){const a=await conflicts.decide(x.cid,{choice:String(choice||''),value,text},by);return {ok:true,id,applied:a.answered?.applied}}
 if(x.kind==='question'){const a=await questions.answer(x.qid,{choice:String(choice||''),text},by);return {ok:true,id,answer:a.answered?.text}}
 if(x.kind==='cadence'){const jobs=(x.jobs||[]).filter(j=>value==null||j.job===value||j.id===value);if(!jobs.length)throw bad('No such schedule.');const out=[];for(const j of jobs)out.push(await runGates.decide(x.agent,j.job||j.id,String(choice||'')));return {ok:true,id,results:out}}
 throw bad('Do this one on Health: '+((x.action&&x.action.label)||x.label||'open the item there')+'.')}
