// Answering in a group without being tagged (16 Nov 2026). The owner asked the main agent in a Telegram forum group to
// reply without a tag. It said "Got it" and changed nothing; then it read config.yaml, took the home channel's chat id for
// this group's, and said the group was "already set". It could not know better: it was never told the id of the chat it
// was answering in, and the engine strips "@bot" from the text, so tagged messages looked untagged to it.
// The engine's Telegram adapter drops an untagged group message (require_mention on) unless the chat is in
// free_response_chats or the chat:topic pair is in free_response_topics; it reads them when the gateway starts.
// This module: where the engine reads those lists, what they say for the chat a turn is in (told to the agent on every
// group message by agent-live.mjs), and the change the agent makes through its group_replies tool (engine plugin
// aqeelos-live): only the chat the engine says the turn is in (never an id from the model), the whole group, asked by a
// person who tagged the agent there; written as an agent version (undo), saved only once it reads back, then applied at once
// by a graceful engine restart, after which aqeelOS posts the confirmation in the chat with the agent's bot.
// Not an engine patch that reads the list live: one gateway serves every profile, so which config.yaml an adapter should
// re-read is not safe to guess, and a wrong patch would stop every deploy at engine-sim.
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {homeOf} from './agentops.mjs';

const at=(o,p)=>p.split('.').reduce((x,k)=>x&&typeof x==='object'?x[k]:undefined,o);
// the engine's precedence (gateway config loader): the authored extra block wins over the platform block, then the old top-level block
const PLACES=['platforms.telegram.extra','platforms.telegram','telegram'];
const KEYS={chat:'free_response_chats',topic:'free_response_topics'};
const ENV={chat:'TELEGRAM_FREE_RESPONSE_CHATS',topic:'TELEGRAM_FREE_RESPONSE_TOPICS',mention:'TELEGRAM_REQUIRE_MENTION',allowed:'TELEGRAM_ALLOWED_CHATS'};   // keys of the agent's own .env, not this app's
const yes=v=>v===true||/^(true|1|yes|on)$/i.test(String(v??'').trim());
// a list as the engine reads it: a YAML list, a JSON list in a string, or comma-separated text
export function ids(v){if(v==null||v==='')return [];if(typeof v==='string'){const s=v.trim();if(s.startsWith('['))try{const j=JSON.parse(s);if(Array.isArray(j))v=j}catch{}if(typeof v==='string')v=s.split(',')}
 return [].concat(v).map(x=>String(x).trim()).filter(Boolean)}
// the list the engine uses, and the config key to write so the change is the one it reads
export function freeList(conf,kind){const k=KEYS[kind];for(const pl of PLACES){const v=at(conf,pl+'.'+k);if(v!==undefined&&v!==null)return {key:pl+'.'+k,list:ids(v),raw:v}}
 return {key:'platforms.telegram.'+k,list:[],raw:null}}
// the topic entry the engine checks: <chat id>:<topic id>, General = 1
export const topicEntry=(chat,thread)=>String(chat)+':'+(String(thread||'').trim()||'1');
export function envLines(text){const o={};for(const l of String(text||'').split('\n')){const m=/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);if(m)o[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2')}return o}
function requireMention(conf,env){if(env[ENV.mention]!==undefined)return yes(env[ENV.mention]);
 for(const p of ['platforms.telegram.extra.require_mention','platforms.telegram.require_mention','telegram.require_mention','require_mention']){const v=at(conf,p);if(v!==undefined&&v!==null)return yes(v)}return false}
// what the agent's settings say for one Telegram group chat (and topic): pure, tested
export function mode(conf,env,chat,thread){chat=String(chat||'');const t=thread?String(thread):'';const c=freeList(conf,'chat'),tp=freeList(conf,'topic');
 const envChats=env[ENV.chat]!==undefined?ids(env[ENV.chat]):null,envTopics=env[ENV.topic]!==undefined?ids(env[ENV.topic]):null;
 const chats=envChats||c.list,topics=envTopics||tp.list;
 const allowed=ids(at(conf,'platforms.telegram.extra.allowed_chats')??at(conf,'platforms.telegram.allowed_chats')??at(conf,'telegram.allowed_chats')??env[ENV.allowed]);
 return {requireMention:requireMention(conf,env),chat:chats.includes(chat),topic:topics.includes(topicEntry(chat,t)),allowed:!allowed.length||allowed.includes(chat),
  envChats:envChats!==null,envTopics:envTopics!==null,chatKey:c.key,topicKey:tp.key}}
// one sentence for the agent's context: whether a message here needs a tag, checked now against this chat's id
export function modeWords(m,{topic}={}){
 if(!m.allowed)return 'This group is not on your allowed_chats list, so only messages that tag you get through here.';
 if(!m.requireMention)return 'You get every message in this group, tagged or not (require_mention is off for you).';
 if(m.chat)return 'This group is on your free-response list: you get its messages without a tag.';
 if(m.topic)return 'This topic is on your free-response list: you get its messages without a tag (other topics of the group still need one).';
 return 'Not on your free-response list: here you only get messages that tag you or reply to you'+(topic?' (not for this group, not for this topic)':'')+'.'}

const PY=String.raw`
import json,sqlite3,sys
a=json.loads(sys.argv[1])
c=sqlite3.connect('file:'+a['db']+'?mode=ro',uri=True,timeout=10)
r=c.execute('select source,chat_type,chat_id,thread_id,user_id from sessions where id=?',(a['id'],)).fetchone()
print(json.dumps(dict(zip(('source','chat_type','chat_id','thread_id','uid'),r)) if r else None))
`;

export function createGroupReplies({readConfig,setKey,versions,restartNow,pid=async()=>0,python,mirror=null,nameOf=a=>a,run=null,readEnv=null,fetchFn=(...x)=>fetch(...x),later=f=>{Promise.resolve().then(f)},log=m=>console.log(m)}){
 const envOf=readEnv||(async a=>envLines(await readFile(path.join(homeOf(a),'.env'),'utf8').catch(()=>'')));
 // the chat a turn is in, from the engine's own session row, never from the model's arguments
 const sessionOf=run||(async(a,id)=>{const p=await python();if(!p)throw Error('no engine python');return new Promise((res,rej)=>execFile(p,['-I','-c',PY,JSON.stringify({db:path.join(homeOf(a),'state.db'),id})],{timeout:20000},(e,o,er)=>e?rej(Error(String(er||e.message).slice(-200))):res(JSON.parse(o||'null'))))});
 async function status(a,chat,thread){const [conf,env]=await Promise.all([readConfig(a).catch(()=>null),envOf(a)]);return mode(conf||{},env,chat,thread)}
 // the confirmation, posted with the agent's own bot once the restart is done and the list still says so (kept in the topic's
 // conversation through the engine's mirror, so the agent knows it was said)
 async function confirm(a,chat,thread,on){const m=await status(a,chat,thread);if(m.chat!==on){log('group-replies: '+a+' '+chat+' not confirmed: the list changed again');return false}
  const tok=(await envOf(a)).TELEGRAM_BOT_TOKEN;if(!tok)return false;
  const text=on?'Done: I now answer everyone in this group without being tagged. To switch back, tag me and ask.':'Done: in this group I answer again only when someone tags me or replies to me.';
  const r=await fetchFn('https://api.telegram.org/bot'+tok+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,...(thread&&thread!=='1'?{message_thread_id:Number(thread)}:{}),text}),signal:AbortSignal.timeout(30000)}).then(x=>x.json()).catch(()=>null);
  if(!r?.ok){log('group-replies: confirmation for '+a+' in '+chat+' not sent');return false}if(mirror)mirror(a,chat,thread||null,text);return true}
 // args: {action: status|add|remove, why}. turn: what the plugin saw of the message this turn answers: session (the engine's),
 // tagged (mention / reply / none), bot (the sender is a bot), who (the sender as the team policy knows them, or null).
 // Owner's rule (16 Nov 2026): a new group needs a tag; any person who tags the agent there may switch THE WHOLE GROUP to
 // answer without a tag, for everyone, at once (not at the night restart); switching back works the same way.
 async function call(a,{session,tagged='',bot=false,who=null},args={}){const action=String(args.action||'status');
  if(!['status','add','remove'].includes(action))return {error:'action is status, add or remove.'};
  if(!session)return {error:'This run has no chat behind it, so there is no group to change.'};
  const s=await sessionOf(a,String(session)).catch(()=>null);if(!s)return {error:'aqeelOS cannot find this chat in your sessions, so it changed nothing.'};
  if(String(s.source||'')!=='telegram')return {error:'This works for Telegram groups only; this chat is '+(s.source||'not a channel')+'. Nothing changed.'};
  if(!/group|supergroup|forum/i.test(String(s.chat_type||'')))return {error:'This is a private chat: you already get every message here. Only groups need this.'};
  const chat=String(s.chat_id||''),thread=s.thread_id==null?'':String(s.thread_id);if(!chat)return {error:'This chat has no id in your session, so nothing changed.'};
  const here={chat_id:chat,topic_id:thread||null};
  let m=await status(a,chat,thread);const said=()=>({...here,...m,words:modeWords(m,{topic:!!thread})});
  if(action==='status')return {ok:true,...said()};
  if(bot)return {error:'This message is from a bot; only a person can switch this. Nothing changed.',...here};
  if(action==='add'&&!['mention','reply'].includes(String(tagged)))return {error:'Only a person who tags you (or replies to you) in this group can switch it to answer without a tag. This message did not, so nothing changed.',...here};
  if(!m.allowed)return {error:'This group is not on your allowed_chats list; a person adds it there first (Edit agent › Channels). Nothing changed.',...here};
  if(m.envChats)return {error:'Your list is set in your .env file ('+ENV.chat+'), which wins over config.yaml; a person changes it there. Nothing changed.',...here};
  const conf=await readConfig(a).catch(()=>null);if(!conf)return {error:'Your config.yaml could not be read, so nothing changed.',...here};
  const cur=freeList(conf,'chat'),has=cur.list.includes(chat);
  if(action==='add'&&has||action==='remove'&&!has)return {ok:true,unchanged:true,...said(),text:'Already '+(has?'on':'off')+' the list ('+cur.key+'). Nothing changed.'};
  const next=action==='add'?[...cur.list,chat]:cur.list.filter(x=>x!==chat);
  const r=await setKey(a,cur.key,next).catch(e=>({ok:false,out:e.message}));if(!r?.ok)return {error:'Could not save it: '+String(r?.out||r?.err||'').trim().slice(-200)+'. Nothing changed.',...here};
  // saved only once the file reads back with it
  const back=freeList(await readConfig(a).catch(()=>null)||{},'chat');if(back.list.includes(chat)!==(action==='add'))return {error:'The change did not read back from config.yaml, so it is not in effect. Tell the owner (report_bottleneck).',...here};
  const asker=who?.name||'a person in the group';
  const what=(action==='add'?'Answer everyone without a tag in ':'Need a tag again in ')+'Telegram group '+chat;
  const v=await versions.record(a,{kind:'setting',target:cur.key,what,why:String(args.why||'asked by '+asker).slice(0,200),by:nameOf(a),before:{value:cur.raw??null},after:{value:next}}).catch(e=>{log('group-replies: version for '+a+': '+e.message);return null});
  log('group-replies: '+a+' '+what+' (asked by '+asker+')');
  // applied now: a graceful engine restart (it waits for the replies running, this one too), then the confirmation in the chat
  // a restart that was held (a build, a restore) leaves the same engine process: then nothing is confirmed, it applies at the next one
  later(async()=>{try{const was=await pid().catch(()=>0);await restartNow(a+': '+what.toLowerCase()+' (asked in the group)');const now=await pid().catch(()=>0);
   if(!now||now===was)return log('group-replies: '+a+' engine not restarted (held or down); '+chat+' applies at the next restart, nothing confirmed');
   await confirm(a,chat,thread,action==='add')}catch(e){log('group-replies: restart for '+a+': '+e.message)}});
  m=mode(await readConfig(a).catch(()=>null)||conf,await envOf(a),chat,thread);
  return {ok:true,saved:true,applied:false,change:v?.id||null,...said(),text:'Saved in '+cur.key+(v?.id?' as change '+v.id:'')+', for the whole group. aqeelOS now restarts you gracefully (once this reply and the others running are sent) and then posts the confirmation in this chat with your bot. So tell the person it is being switched '+(action==='add'?'on':'off')+' and that the confirmation follows; do not say it is already active. To switch back, call group_replies with action "'+(action==='add'?'remove':'add')+'".'}}
 return {status,call,confirm}}
