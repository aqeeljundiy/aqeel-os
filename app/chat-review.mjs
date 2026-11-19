// Daily chat review (EN-12, owner 19 Nov 2026: "can you see all the sessions on Telegram that Donna or anyone is facing?").
// Once a day, in plain code (no model), every agent's chats of the last 24 h on people's channels are read from its engine
// state.db (read only) and four things are looked for: a person's message nobody answered, an engine "not processed" reply,
// a person saying something is wrong, and the same message stored twice. Each agent with any gets ONE Health item (a stable
// topic, so it updates instead of piling up) that the Fixer picks up like any other; an agent with none is cleared.
// Customer chats stay private: their text is never quoted, only counted; team chats get a few words of the message.
import {execFile} from 'node:child_process';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {readStore,writeStore} from './store.mjs';
import {SYSTEM_ROW} from './escalations.mjs';
import {oneCopy} from './one-copy.mjs';

const CHANNELS=['telegram','whatsapp','slack','discord','signal','email','matrix'];
const TEAM=new Set(['telegram','slack','discord']);   // where the people are the team; elsewhere they may be customers
// each message once: the engine keeps older copies after a context compression (one-copy.mjs, EN-13)
const Q=`import sqlite3,sys,json,time
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=5)
since=time.time()-float(sys.argv[2])*3600
out=[]
sql="select m.session_id,s.source,m.role,m.timestamp,m.content,s.chat_type from messages m join sessions s on s.id=m.session_id where m.timestamp>? and m.role in ('user','assistant') and s.source in (${CHANNELS.map(c=>"'"+c+"'").join(',')}) and ${oneCopy('timestamp>SINCE','m.id')} order by m.session_id,m.timestamp".replace('SINCE',repr(since))
for sid,src,role,ts,content,ct in c.execute(sql,(since,)):
  out.append([sid,src,role,ts,(content or '')[:600] if isinstance(content,str) else '',ct or ''])
print(json.dumps(out))`;

export const NOT_PROCESSED=/request (was|is) not processed|could not (be )?process|something went wrong|an error occurred|I hit an error/i;
export const UNHAPPY=/\b(wrong|broken|broke|ugly|not working|doesn'?t work|still not|you (removed|deleted|broke)|why did you|salah|rusak|(nggak|gak|ga|tidak) bisa|belum bisa|masih belum|kok (belum|gak|nggak|ga))\b/i;
// a person saying they got something wrong themselves is no complaint (20 Nov 2026: "aku salah pesan", I ordered the wrong size)
export const OWN_SLIP=/\b(?:aku|saya|gue|gw|i)\s+(?:yang\s+|was\s+|am\s+)?(?:salah|keliru|wrong)\b/gi;
const clean=t=>String(t||'').replace(/^Gateway message origin[^\n]*\n?(\{[^\n]*\}\s*)?[^\n]*?insufficient\.\s*/,'').replace(/^\[Replying to:[\s\S]*?"\]\s*/,'').replace(/\[aqeelOS\][\s\S]*$/,'').trim();
const compact=/^\[CONTEXT COMPACTION|^\[PRIOR CONTEXT/;

// rows: [[session, source, role, ts (s), text]] in session and time order. Returns {unanswered, notProcessed, unhappy, doubled, chats, examples}
export function reviewRows(rows,{now=Date.now()/1000,answerWithin=30*60}={}){const r={unanswered:0,notProcessed:0,unhappy:0,doubled:0,chats:new Set(),examples:[]};
 const ex=(src,kind,text)=>{if(r.examples.length<4)r.examples.push(kind+(TEAM.has(src)&&text?': "'+text.slice(0,70)+(text.length>70?'…':'')+'"':' ('+src+')'))};
 const by=new Map();for(const x of rows||[]){if(!by.has(x[0]))by.set(x[0],[]);by.get(x[0]).push(x)}
 for(const [sid,l] of by){r.chats.add(sid);let prev=null;
  for(let i=0;i<l.length;i++){const [,src,role,ts,raw,ct]=l[i];if(compact.test(raw))continue;
   if(role==='assistant'){if(NOT_PROCESSED.test(raw)){r.notProcessed++;ex(src,'not processed','')}prev=null;continue}
   if(SYSTEM_ROW.test(raw))continue;const t=clean(raw);if(!t)continue;
   if(prev&&prev.t===t&&Math.abs(ts-prev.ts)<=2){r.doubled++;continue}prev={t,ts};
   if(UNHAPPY.test(t.replace(OWN_SLIP,' '))){r.unhappy++;ex(src,'unhappy',t)}
   const answered=l.slice(i+1).some(y=>y[2]==='assistant'&&y[3]-ts<=answerWithin);
   // a group or channel where the agent is meant to stay quiet unless asked is not "unanswered"
   if(!/group|channel/i.test(ct||'')&&!answered&&now-ts>answerWithin&&!l.slice(i+1).some(y=>y[2]==='user')){r.unanswered++;ex(src,'unanswered',t)}}}
 return {...r,chats:r.chats.size}}

export function summary(name,r){const parts=[r.unanswered&&r.unanswered+' unanswered',r.notProcessed&&r.notProcessed+' "not processed"',r.unhappy&&r.unhappy+' unhappy',r.doubled&&r.doubled+' stored twice'].filter(Boolean);
 return parts.length?{title:name+'\'s chats yesterday: '+parts.join(', '),detail:'From '+r.chats+' chat'+(r.chats===1?'':'s')+' on people\'s channels in the last 24 h. '+r.examples.join('; ')+'. Read the chats, find the cause and fix it; a person\'s unanswered message may still need an answer.'}:null}

export function createChatReview({DATA,HERMES_HOME,python,listAgents,nameOf=a=>a,health,problem=(a,k,t,d)=>health.problem(a,k,t,{topic:k,fix:d}),ok=(a,k)=>health.ok(a,k),log=m=>console.log(m),hourUtc=21,run=null}){
 const F=path.join(DATA,'chat-review.json');
 const read=run||(async(db,hours)=>{const p=await python().catch(()=>null);if(!p)return [];
  return new Promise(res=>execFile(p,['-c',Q,db,String(hours)],{timeout:60000,maxBuffer:5e7},(e,o)=>{try{res(e?[]:JSON.parse(o))}catch{res([])}}))});
 async function once(){const agents=(await listAgents()).filter(a=>!String(a).includes('--')),out={};
  for(const a of agents){const db=a==='default'?path.join(HERMES_HOME,'state.db'):path.join(HERMES_HOME,'profiles',a,'state.db');
   const rows=await read(db,24).catch(()=>[]);const r=reviewRows(rows),s=summary(nameOf(a),r);out[a]={...r,examples:undefined};
   if(s)await problem(a,'chatreview',s.title,s.detail).catch(e=>log('chat review '+a+': '+e.message));else await ok(a,'chatreview').catch(()=>{})}
  await mkdir(DATA,{recursive:true});await writeStore(F,JSON.stringify({at:Date.now(),agents:out},null,1));log('chat review: '+Object.keys(out).length+' agents read');return out}
  // once a day after hourUtc (21 UTC = 04:00 WIB, the quiet hours); called by Health's 5-minute tick (server.mjs), no timer of its own
 async function tick(now=new Date()){if(now.getUTCHours()<hourUtc)return false;const last=(await readStore(F,{}).catch(()=>({})))?.at||0;
  if(new Date(last).toISOString().slice(0,10)===now.toISOString().slice(0,10))return false;await once();return true}
 return {once,tick}}
