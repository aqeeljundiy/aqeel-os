// aqeelOS's own posts in an agent's Telegram group (HANDOFF, PAID ORDER, NO REPLY SENT, posting-limit notes), sent with the agent's
// bot, and kept in that topic's conversation (owner, 14 Nov 2026: "sometimes it feels like it doesn't really know the context on
// the other topics"). Telegram never shows a bot its own messages, so these posts were in no topic's history: the agent saw a
// team member's answer in the Questions topic without the handoff it answered, and the other topics' digest (engine patch
// 2026-11-11-telegram-cross-topic-digest) could not show them either. After Telegram confirms a post, it is added to the topic's
// session with the engine's own mirror (gateway/mirror.py mirror_to_session), as a user-role note marked as aqeelOS's, the way
// the engine mirrors its own deliveries. A topic with no conversation yet gets nothing (the engine starts it with the next message);
// a mirror that fails never fails the post.
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {homeOf as agentHome} from './agentops.mjs';

export const MIRROR_LABEL='[Posted in this topic by aqeelOS, for the team; you did not write it]';
// runs in the engine's own Python, with the agent's home as HERMES_HOME so the agent's own session store is used
export const MIRROR_PY=`import json,os,sys
d=json.loads(sys.stdin.read())
os.environ['HERMES_HOME']=d['home']
sys.path.insert(0,d['src'])
from gateway.mirror import mirror_to_session
ok=mirror_to_session('telegram',str(d['chat']),d['text'],source_label='aqeelos',thread_id=(str(d['thread']) if d.get('thread') not in (None,'') else None),role='user')
print('mirrored' if ok else 'no-session')`;

export function createTeamPost({HERMES_HOME,homeOf=agentHome,live=true,python=async()=>null,fetchFn=(...a)=>fetch(...a),run=execFile,log=m=>console.log(m)}){
 const token=async a=>{const t=await readFile(path.join(HERMES_HOME,'profiles',a,'.env'),'utf8').catch(()=>'');return (/^TELEGRAM_BOT_TOKEN=["']?([^"'\s]+)/m.exec(t)||[])[1]||''};
 // into the topic's conversation; resolves 'mirrored', 'no-session' or 'failed', never throws
 async function mirror(a,chatId,threadId,text){try{const py=await python();if(!py)return 'failed';
  const input=JSON.stringify({home:homeOf(a),src:path.join(HERMES_HOME,'hermes-agent'),chat:String(chatId),thread:threadId??null,text:MIRROR_LABEL+'\n'+String(text||'').slice(0,4000)});
  const out=await new Promise(res=>{const c=run(py,['-I','-c',MIRROR_PY],{timeout:30000,maxBuffer:1e6},(e,o,er)=>res(e?'failed: '+String(er||e.message).trim().split('\n').slice(-1)[0]:String(o||'').trim().split('\n').pop()));c?.stdin?.end(input)});
  if(!/^(mirrored|no-session)$/.test(out))log('team post: not kept in the topic\'s conversation for '+a+' ('+String(out).slice(0,160)+')');return /^(mirrored|no-session)$/.test(out)?out:'failed'}
  catch(e){log('team post: not kept in the topic\'s conversation for '+a+' ('+e.message+')');return 'failed'}}
 // the post; its message id once Telegram confirmed it (false when not sent). preview:false turns link previews off.
 async function send(a,chatId,threadId,text,{preview=true}={}){const tok=await token(a);if(!tok||!live)return false;
  const r=await fetchFn('https://api.telegram.org/bot'+tok+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({chat_id:chatId,...(threadId?{message_thread_id:Number(threadId)}:{}),text:String(text).slice(0,4000),...(preview?{}:{disable_web_page_preview:true})}),signal:AbortSignal.timeout(30000)}).catch(()=>null);
  const j=r&&r.ok?await r.json().catch(()=>({})):{};if(!j.ok)return false;
  mirror(a,chatId,threadId,text);   // not awaited: the post is done; keeping it in the conversation follows
  return j.result?.message_id||true}
 return {send,mirror}}
