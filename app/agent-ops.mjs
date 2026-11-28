// What a support agent's own scripts may still do with Kirimdev once the key is out of its folder (audit 12 Nov 2026, H3).
// The key sat in workspaces/<agent>/.secrets, the same one for both brands, and .tools/kirim took any method and path: a shell run
// of either agent could message either brand's customers, read every chat of both lines, and skip the mode, the testers, the pause
// and the exit guard. Now the app keeps the key (HERMES_HOME/secrets/kirimdev.env, and DATA/agent-keys for the payment keys) and the
// scripts call this instead: POST http://127.0.0.1:<port>/agent-ops/<agent>/<signature>, from this box only, signed per agent like
// the Google files route. The body is {op, ...}:
//   {op:"kirim", method:"GET", path}              read only, and only this agent's OWN line: <its number id>/conversations…,
//                                                 /messages…, /contacts…, and labels. Another line's number id is refused.
//   {op:"kirim", method:"POST", path:"<id>/messages", body:{to, type:"text", text:{body}}}
//                                                 a text to a customer goes through kirimdev.reply(): its own line, 24 hours,
//                                                 Test = testers only, never in Draft, the exit guard, no repeat. Nothing else is sent.
//   {op:"label", conversationId, add, remove}     the line's allowed labels only (kirimdev.labelContact, source "agent")
//   {op:"whoami"}                                 which line this is, and that the agent holds no key
// Payments are not here on purpose: they are made only by create_payment inside a customer chat.
// The app writes the scripts that call it (ensureClients): .tools/kirim + kirim_cli.py (same commands as before) and .tools/label,
// for every line agent whose folder no longer holds the Kirimdev key. scripts/migrate-agent-keys.mjs takes the keys out.
// The ops agent (24 Nov 2026): it reads the packers' Telegram replies and has no line. Handing it both brands' signatures would undo the
// above, so it gets its own address that takes only two ops, and aqeelOS code (no agent, no AI) does the send:
//   {op:"resi", brand, phone, resi, courier}      the brand's fixed resi text, once per line, number and resi, on that brand's line,
//                                                 through reply()'s checks but never releasing a person's hold (kirimdev.sendResi)
//   {op:"whoami"}                                 {ops:true, brands}
// Box config, never in the repo: DATA/resi.json {"ops":["<agent>"],"brands":{"<brand>":{"agent":"<line agent>","text":"…{resi}…{courier}…"}}}.
// An agent with a line keeps the line ops above only, even when listed in "ops". .tools/resi is written for each ops agent.
import {readFile,writeFile,rename,stat,chmod} from 'node:fs/promises';
import path from 'node:path';
import {createToolBridge} from './tool-bridge.mjs';
import {readStore} from './store.mjs';
import {DATA_DIR} from './install.mjs';

const READ=/^(conversations|messages|contacts)(\/[\w.:-]+){0,3}$/;
// What the ops agent passes lands in the customer's WhatsApp: one tracking code (letters, digits, . and -, at least one digit,
// never something that reads as a web address) and a courier from this list, written its own way.
const RESI=/^[A-Za-z0-9][A-Za-z0-9.-]{3,59}$/,LINKY=/^(https?|www)\b|\.(com|id|co|ly|me|io|net|org|link|site|xyz|app|info|biz|to|gl|gg|my)$/i;
const COURIERS=['Paxel','JNE','J&T Express','SiCepat','AnterAja','Lion Parcel','GoSend','GrabExpress','TIKI','Pos Indonesia','Ninja Xpress','SAP Express','ID Express'];
export function createAgentOps({HERMES_HOME,WORK=HERMES_HOME&&path.join(path.dirname(HERMES_HOME),'workspaces'),DATA=DATA_DIR,PORT,sig,sign,relayKeys,kirimdev,enginePython,readConfig,googleTools,listAgents,log=m=>console.log(m)}){
 sig||=a=>sign('agent-ops:'+a).slice(0,32);
 // every agent's scripts call its connected tools (tool-bridge.mjs, 17 Nov 2026): /tool-call/<agent>/<sig>, helpers written with the Kirimdev ones
 // signed with the relay key like /google-files/ (17 Nov 2026: signed with the app secret, relay healing re-signed the helper with the relay key and every call was refused)
 const tools=relayKeys&&enginePython?createToolBridge({HERMES_HOME,WORK,PORT,sig:a=>relayKeys.sign('tool-call:',a),python:enginePython,readConfig,googleTools,log}):null;
 const url=a=>`http://127.0.0.1:${PORT}/agent-ops/${a}/${sig(a)}`;
 const fail=(status,error)=>({status,json:{error}}),no=(status,code,error)=>({status,json:{error,code}});
 const resiConf=async()=>{const c=await readStore(path.join(DATA,'resi.json'),{});
  return {ops:(Array.isArray(c?.ops)?c.ops:[]).map(String).filter(a=>/^[\w-]{1,64}$/.test(a)),brands:c?.brands&&typeof c.brands==='object'?c.brands:{}}};
 // the ops agent: no line of its own, only whoami and a brand's resi message (the code is what its script goes by)
 async function opsCall(a,req,{brands},L){const op=String(req?.op||'');
  if(op==='whoami')return {status:200,json:{ops:true,brands:Object.keys(brands),note:'aqeelOS sends a brand\'s fixed resi text on that brand\'s line; this agent holds no key and can send nothing else'}};
  if(op!=='resi')return fail(403,'This agent may only send a resi message (op resi) and ask whoami here.');
  const brand=String(req.brand||''),b=Object.hasOwn(brands,brand)?brands[brand]:null,agent=String(b?.agent||'');
  if(!b)return no(404,'unknown_brand','No brand "'+brand.slice(0,40)+'" in resi.json. Brands: '+(Object.keys(brands).join(', ')||'none')+'.');
  if(!L[agent]||!String(b.text||'').trim())return no(404,'unknown_brand','Brand '+brand+' is not set up: resi.json needs its line agent (one with a Kirimdev line) and its text.');
  const phone=String(req.phone||'').replace(/\D/g,'').replace(/^0/,'62').replace(/^8/,'628'),resi=String(req.resi||''),courier=COURIERS.find(c=>c.toLowerCase()===String(req.courier||'').trim().toLowerCase());
  if(!/^\d{8,15}$/.test(phone))return no(400,'bad_input','phone: the customer\'s WhatsApp number, like 62812…, 0812… or 812….');
  if(!RESI.test(resi)||!/\d/.test(resi)||LINKY.test(resi))return no(400,'bad_input','resi: one tracking number, 4 to 60 letters, digits, dots and dashes, with at least one digit, no spaces and no web address.');
  if(!courier)return no(400,'bad_input','courier: one of '+COURIERS.join(', ')+'.');
  const text=String(b.text).split('{resi}').join(resi).split('{courier}').join(courier);
  try{const r=await kirimdev.sendResi(agent,phone,resi,text,a,{check:req.check===true});return {status:200,json:r.already?{ok:true,sent:false,already:true}:r.check?{ok:true,sent:false,check:true}:{ok:true,sent:true}}}
  catch(e){const code=['not_live','not_tester','no_chat','outside_24h','bad_input','retry'].includes(e.code)?e.code:'guard';return no(code==='retry'?502:code==='bad_input'?400:403,code,e.message)}}
 async function call(agent,req){const a=String(agent).split('--')[0],L=await kirimdev.lines().catch(()=>({})),line=L[a];
  if(!line){const c=await resiConf();return c.ops.includes(a)?opsCall(a,req,c,L):fail(404,'This agent has no Kirimdev line.')}
  const pid=String(line.phoneNumberId),op=String(req?.op||'');
  if(op==='whoami')return {status:200,json:{line:pid,persona:line.persona||a,mode:line.mode||'test',note:'aqeelOS makes this agent\'s Kirimdev calls; the agent holds no key'}};
  if(op==='label'){try{const r=await kirimdev.labelContact(a,{conversationId:String(req.conversationId||''),phone:String(req.phone||'').replace(/\D/g,''),add:req.add,remove:req.remove,source:'agent',run:'ops'});return {status:200,json:r}}catch(e){return fail(403,e.message)}}
  // KD-14: every label off a tester's chat so a test run starts clean; a chat that is not a tester is refused (kirimdev.clearTesterLabels)
  if(op==='clear_labels'){try{const r=await kirimdev.clearTesterLabels(a,{conversationId:String(req.conversationId||''),phone:String(req.phone||'').replace(/\D/g,''),run:'ops'});return {status:200,json:r}}catch(e){return fail(403,e.message)}}
  if(op!=='kirim')return fail(400,'aqeelOS offers kirim (read your own line, send a text through the guards), label, clear_labels (a tester\'s chat only) and whoami here. Payments are made only with create_payment in a customer chat.');
  const method=String(req.method||'GET').toUpperCase(),raw=String(req.path||'').replace(/^\/+/,''),[p,qs='']=raw.split('?'),parts=p.replace(/\/+$/,'').split('/');
  if(method==='GET'){
   if(p==='labels'){}else if(parts[0]!==pid)return fail(403,/^\d+$/.test(parts[0])?'That is another Kirimdev line. You read only your own line ('+pid+'); another brand\'s chats are never yours.':'You can read your own line only: '+pid+'/conversations, '+pid+'/messages, '+pid+'/contacts, and labels.');
   else if(!READ.test(parts.slice(1).join('/')))return fail(403,'Reading '+parts.slice(1).join('/')+' is not offered. Allowed: conversations, messages, contacts, labels.');
   if(qs&&!/^[\w=&%.:+@,-]*$/.test(qs))return fail(400,'The query has characters that are not allowed.');
   try{const j=await kirimdev._api(p+(qs?'?'+qs:''));log('agent ops: '+a+' read '+parts.slice(1,2).join('')+(p==='labels'?'labels':''));return {status:200,json:j}}catch(e){return fail(e.status>=400&&e.status<600?e.status:502,e.message)}}
  if(method==='POST'&&parts[0]===pid&&parts[1]==='messages'&&parts.length===2){const b=req.body||{},text=b.type==='text'||b.text?String(b.text?.body||''):'';
   if(!text.trim())return fail(403,'Only a text message can be sent from a script, and it goes through aqeelOS\'s guards. Pictures, files and payments leave only inside a customer chat run.');
   try{const r=await kirimdev.reply(a,String(b.to||b.recipient||''),text);log('agent ops: '+a+' sent a text through the guards');return {status:200,json:{data:r[0]||null,sent:r.length,delivery_check:r[0]||null}}}catch(e){return fail(403,e.message)}}
  return fail(403,'Not offered: '+method+' '+p.replace(/\d{6,}/g,'…')+'. Scripts may read their own line and send a text through the guards; nothing else.')}
 // ---- the scripts in the agent's folder, same commands as the ones they replace
 const CLI=(u,a)=>`"""aqeelOS: this agent's Kirimdev calls go through aqeelOS (it holds no Kirimdev key). Written by aqeelOS; edits are replaced.
usage: kirim GET <path>            read your own line (conversations, messages, contacts, labels)
       kirim POST <id>/messages '<json>'   a text to a customer, through aqeelOS's guards (mode, testers, 24 hours, exit guard)"""
import json,sys,urllib.request,urllib.error
U=${JSON.stringify(u)}
def main():
    a=sys.argv[1:]
    if a and a[0]==${JSON.stringify(a)}:a=a[1:]
    if len(a)<2:print(json.dumps({"error":"usage: kirim GET <path> | kirim POST <id>/messages '<json>'"}));return 1
    req={"op":"kirim","method":a[0].upper(),"path":a[1]}
    if len(a)>2:req["body"]=json.loads(a[2])
    try:r=urllib.request.urlopen(urllib.request.Request(U,json.dumps(req).encode(),{"content-type":"application/json"}),timeout=90);t=r.read().decode();ok=True
    except urllib.error.HTTPError as x:t=x.read().decode();ok=False
    except Exception as x:t=json.dumps({"error":"aqeelOS could not be reached: "+str(x)});ok=False
    if ok:print(t);return 0
    print(t,file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
`;
 const KIRIM=a=>`#!/bin/bash
# aqeelOS: Kirimdev through aqeelOS (no key in this folder). Written by aqeelOS; edits are replaced.
exec python3 -I "$(dirname "$0")/kirim_cli.py" ${a} "$@"
`;
 const LABEL=u=>`#!/usr/bin/env python3
# aqeelOS: labels through aqeelOS (no key in this folder). Written by aqeelOS; edits are replaced.
# usage: label attach|detach <conversation id cnv_...> "<Label Name>"   (the line's allowed labels only)
#        label clear <conversation id cnv_...>                         (a tester's chat only: removes every label)
import json,sys,urllib.request,urllib.error
U=${JSON.stringify(u)}
a=sys.argv[1:]
if len(a)==2 and a[0]=='clear':req={"op":"clear_labels","conversationId":a[1]}
elif len(a)<3 or a[0] not in('attach','detach'):print('usage: label attach|detach <conversation id> "<Label Name>" | label clear <conversation id> (a tester only: removes every label)');sys.exit(1)
else:req={"op":"label","conversationId":a[1],("add" if a[0]=='attach' else "remove"):[a[2]]}
try:print(urllib.request.urlopen(urllib.request.Request(U,json.dumps(req).encode(),{"content-type":"application/json"}),timeout=90).read().decode())
except urllib.error.HTTPError as x:print(x.read().decode(),file=sys.stderr);sys.exit(1)
except Exception as x:print('aqeelOS could not be reached: '+str(x),file=sys.stderr);sys.exit(1)
`;
 const RESI_CLI=u=>`#!/usr/bin/env python3
# aqeelOS: a courier tracking number (resi) to a customer, on that brand's Kirimdev line, through aqeelOS (no key in this folder). Written by aqeelOS; edits are replaced.
# usage: resi '{"brand":"<brand>","phone":"<customer number>","resi":"<tracking number>","courier":"<courier>"}'
#        resi whoami                    (the brands this agent may send a resi for)
#        add "check":true to the json to run every check and send nothing: {"ok":true,"sent":false,"check":true} or the refusal
# prints aqeelOS's answer: {"ok":true,"sent":true} | {"ok":true,"sent":false,"already":true} | {"error":"...","code":"..."} (exit code 1)
import json,sys,urllib.request,urllib.error
U=${JSON.stringify(u)}
a=sys.argv[1:]
try:req={"op":"whoami"} if a==['whoami'] else {**json.loads(a[0]),"op":"resi"}
except Exception:print(json.dumps({"error":"usage: resi '<json with brand, phone, resi, courier>' | resi whoami","code":"bad_input"}));sys.exit(1)
try:print(urllib.request.urlopen(urllib.request.Request(U,json.dumps(req).encode(),{"content-type":"application/json"}),timeout=90).read().decode())
except urllib.error.HTTPError as x:print(x.read().decode());sys.exit(1)
except Exception as x:print(json.dumps({"error":"aqeelOS could not be reached: "+str(x)}));sys.exit(1)
`;
 // only for a line agent whose folder no longer holds the key (the migration ran): until then its own scripts are left alone; an ops agent
 // without a line of its own gets .tools/resi the same way
 async function ensureClients(){let n=0;const L=await kirimdev.lines().catch(()=>({}));
  for(const [a,files] of [...Object.keys(L).map(a=>[a,[['kirim_cli.py',CLI(url(a),a),0o664],['kirim',KIRIM(a),0o775],['label',LABEL(url(a)),0o775]]]),...(await resiConf()).ops.filter(a=>!L[a]).map(a=>[a,[['resi',RESI_CLI(url(a)),0o775]]])]){const dir=path.join(WORK,a,'.tools');
   if(!await stat(dir).catch(()=>null)||await stat(path.join(WORK,a,'.secrets','KIRIMDEV_API_KEY')).catch(()=>null))continue;
   for(const [name,want,mode] of files){const f=path.join(dir,name);if((await readFile(f,'utf8').catch(()=>''))===want)continue;
    const t=f+'.'+process.pid+'.tmp';await writeFile(t,want);await chmod(t,mode);await rename(t,f);n++}
   if(n)log('agent ops: Kirimdev helpers set for '+a)}
  if(tools&&listAgents)n+=await tools.ensureClients(await listAgents()).catch(e=>(log('tool bridge: '+e.message),0));
  return n}
 return {call,url,ensureClients,tools}}

// ---- the engine hook that hands a person's Telegram message in the team group to aqeelOS (audit H5). The engine's gateway runs
// hooks from <profile>/hooks/<name>/ (HOOK.yaml + handler.py) at "agent:start", with the platform, the sender's user id, the chat, the
// topic and the first 500 characters of the message. The handler only forwards; kirimdev.teamMessage decides (the team group, the
// approvers list, an exact approval). Written by aqeelOS for every line agent; loaded when the engine's gateway next starts.
export const TEAM_HOOK_YAML=`name: aqeelos-team
description: Hands a person's message in the team's Telegram group to aqeelOS, which checks who wrote it before a draft is sent.
events:
  - agent:start
`;
export const teamHookHandler=u=>`# aqeelOS: written by aqeelOS; edits are replaced. Forwards only; aqeelOS checks who wrote and what it means.
import json,urllib.request
U=${JSON.stringify(u)}
def handle(event_type,context):
    try:
        if event_type!='agent:start' or (context or {}).get('platform')!='telegram':return
        if (context.get('chat_type') or '') not in ('group','forum','supergroup'):return
        body={'userId':str(context.get('user_id') or ''),'chatId':str(context.get('chat_id') or ''),'threadId':str(context.get('thread_id') or ''),'text':str(context.get('message') or '')}
        urllib.request.urlopen(urllib.request.Request(U,json.dumps(body).encode(),{'content-type':'application/json'}),timeout=20).read()
    except Exception:
        pass
`;
export async function ensureTeamHook({HERMES_HOME,agent,url,log=()=>{}}){const {mkdir}=await import('node:fs/promises');const dir=path.join(HERMES_HOME,'profiles',agent,'hooks','aqeelos-team');let n=0;
 for(const [name,want] of [['HOOK.yaml',TEAM_HOOK_YAML],['handler.py',teamHookHandler(url)]]){const f=path.join(dir,name);if((await readFile(f,'utf8').catch(()=>''))===want)continue;await mkdir(dir,{recursive:true,mode:0o700});const t=f+'.'+process.pid+'.tmp';await writeFile(t,want,{mode:0o600});await rename(t,f);n++}
 if(n)log('team hook: set for '+agent+' (the engine loads it at its next gateway start)');return n}
