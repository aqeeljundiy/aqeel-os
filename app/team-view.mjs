// Supervision: the main agent can review how the team uses aqeelOS (every person's chats, on every agent, private ones
// too). Off until an admin switches it on (System › Settings › This install); the team is told in the chat page while
// it is on. The tool (team_view, engine plugin aqeelos-live) exists on the main agent only, and each call is checked
// here against who is really talking to the main agent, taken from the engine's own session, never from the model:
//   a chat in the app counts when its signed-in owner is an admin; a channel (Telegram, Slack…) only in a private chat
//   with the owner in the team policy (a group session remembers who spoke first, and everyone there would read the answer). Anything else (schedules, untracked chats, team members) is refused.
// Every lookup is written to DATA/team-view-log.jsonl and listed for admins. Key values are masked in what comes back.
import {appendFile,readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {personOf} from './issues.mjs';

const AUTOMATED=['cron','subagent','tool','oneshot'];
const WEB=new Set(['api_server','webui','web','aqeelos','local','']);
const MAX_MESSAGES=200,MAX_TEXT=4000,MAX_TOTAL=60000;

// key-shaped text stays out of the main agent's context: supervision is about the work, not the credentials
export function mask(s){return String(s??'')
 .replace(/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AIza|ya29|hf|glpat|shpat|shpss)[-_.][A-Za-z0-9_\-.]{12,}/g,'[key hidden]')
 .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi,'Bearer [key hidden]')
 .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,'[key hidden]')
 .replace(/\b([\w-]*(?:api[_-]?key|secret|token|password|passwd)[\w-]*)(["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,'$1$2[key hidden]')}

const PY=String.raw`
import json,sqlite3,sys
a=json.loads(sys.argv[1]);out=[]
def db(p): return sqlite3.connect('file:'+p+'?mode=ro&immutable=0',uri=True,timeout=10)
if a['op']=='chain':
    c=db(a['db']);i=a['id'];n=0
    while i and n<30:
        r=c.execute('select id,parent_session_id,source,user_id,origin_json,chat_type from sessions where id=?',(i,)).fetchone()
        if not r: break
        out.append({'id':r[0],'source':r[2],'uid':r[3],'origin':r[4],'chat_type':r[5]});i=r[1];n+=1
elif a['op']=='list':
    for d in a['dbs']:
        try: c=db(d['path'])
        except Exception: continue
        marks=','.join('?' for _ in a['skip'])
        q='select id,source,user_id,chat_type,chat_id,thread_id,display_name,origin_json,parent_session_id,started_at,message_count,title from sessions where started_at>=? and coalesce(message_count,0)>0'
        v=[a['since']]
        if marks: q+=' and source not in ('+marks+')';v+=a['skip']
        if a.get('chat'): q+=' and id=?';v.append(a['chat'])
        if a.get('query'): q+=' and id in (select session_id from messages where content like ? and role in (\'user\',\'assistant\'))';v.append('%'+a['query']+'%')
        q+=' order by started_at desc limit 800'
        try: rows=c.execute(q,v).fetchall()
        except Exception: continue
        for r in rows: out.append(dict(zip(('id','source','uid','chat_type','chat','thread','name','origin','parent','at','messages','title'),r),agent=d['agent']))
elif a['op']=='read':
    c=db(a['db'])
    for r in c.execute('select role,content,timestamp,tool_name from messages where session_id=? order by timestamp,id limit ? offset ?',(a['id'],a['limit'],a['offset'])): out.append(dict(zip(('role','text','at','tool'),r)))
print(json.dumps(out))
`;

export function createTeamView({HERMES_HOME,DATA,python,users,policy,agents,isOn,MAIN='default',log=()=>{},run=null,now=()=>Date.now()}){
 const FILE=path.join(DATA,'team-view-log.jsonl');
 const home=a=>a===MAIN?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const dbOf=a=>path.join(home(a),'state.db');
 const py=run||(async arg=>{const p=await python();return new Promise((res,rej)=>execFile(p,['-I','-c',PY,JSON.stringify(arg)],{timeout:60000,maxBuffer:32e6},(e,o,er)=>e?rej(Error(String(er||e.message).slice(-200))):res(JSON.parse(o||'[]'))))});
 const originOf=x=>{try{return JSON.parse(x||'{}')||{}}catch{return {}}};
 const nameOfId=id=>id==='owner'?(users.byId('owner')?.name||'Owner'):(users.byId(id)?.name||id);

 // who is really asking: only the engine's session decides. Returns {ok,who} or {ok:false,why}
 async function asker({session}){
  if(!session)return {ok:false,why:'This run has no person behind it.'};
  const chain=await py({op:'chain',db:dbOf(MAIN),id:session}).catch(()=>[]);if(!chain.length)return {ok:false,why:'This chat is not one aqeelOS knows.'};
  const source=chain[0].source||'';if(AUTOMATED.includes(source))return {ok:false,why:'Schedules and background runs cannot look at the team\'s chats.'};
  if(WEB.has(source)){for(const c of chain){const id=users.sessionOwner(c.id);if(!id)continue;const u=users.byId(id);return u&&users.isAdmin(u)?{ok:true,who:u.name||id,id}:{ok:false,why:'Only admins can look at the team\'s chats.'}}return {ok:false,why:'This chat has no signed-in person, so nobody can be checked. Ask from the app.'}}
  if(chain[0].chat_type!=='dm')return {ok:false,why:'Ask in the app or in a private chat with the main agent: an answer here would be read by everyone in this group.'};
  const p=personOf(await policy().catch(()=>null),source,chain[0].uid);if(p?.owner)return {ok:true,who:p.name||'Owner',id:'owner'};
  return {ok:false,why:'Only an admin can do this. On this channel only the owner is known; other admins can ask from the chat in the app.'}}

 const personFor=(row,byId)=>{let r=row,n=0;while(r&&n++<30){const id=users.sessionOwner(r.id);if(id)return nameOfId(id);r=r.parent?byId.get(r.parent):null}
  const o=originOf(row.origin);return AUTOMATED.includes(row.source)?'(automatic)':o.user_name||row.uid||'(unknown)'};
 async function rows(a){const days=Math.min(365,Math.max(1,Number(a.days)||7)),names=await agents();
  const chosen=a.agent?names.filter(x=>x===a.agent||x.split('--')[0]===a.agent):names;
  const l=await py({op:'list',dbs:chosen.map(x=>({agent:x,path:dbOf(x)})),since:now()/1000-days*86400,skip:a.include_automated?[]:AUTOMATED,query:a.query?String(a.query).slice(0,120):undefined});
  const byId=new Map(l.map(x=>[x.id,x]));let out=l.map(x=>({...x,person:personFor(x,byId)}));
  if(a.person){const w=String(a.person).toLowerCase();out=out.filter(x=>String(x.person).toLowerCase().includes(w))}
  return {out,days}}
 const when=s=>new Date(Number(s)*1000).toISOString().slice(0,16).replace('T',' ');
 async function note(e){await mkdir(DATA,{recursive:true});await appendFile(FILE,JSON.stringify({at:new Date(now()).toISOString(),...e})+'\n',{mode:0o600});log('team view: '+e.who+' '+e.action+(e.person?' '+e.person:'')+(e.chat?' '+e.chat:''))}

 // the one entry point: ctx comes from the engine, args from the model
 async function call(ctx,args={}){
  if(!await isOn())return {error:'Team view is off on this install. An admin can switch it on in System › Settings › This install.'};
  const me=await asker(ctx);if(!me.ok)return {error:me.why};
  const action=['overview','list','read','where'].includes(args.action)?args.action:'overview';
  const entry={who:me.who,action,session:ctx.session,person:args.person?String(args.person).slice(0,80):undefined,agent:args.agent?String(args.agent).slice(0,80):undefined,chat:args.chat?String(args.chat).slice(0,120):undefined,query:args.query?String(args.query).slice(0,120):undefined};
  if(action==='where'){await note(entry);return {people:users.people().map(p=>({name:p.name,id:p.id,folder:p.id==='owner'?null:users.home(p)})),agents:(await agents()).map(a=>({agent:a,home:home(a),workspace:path.join(path.dirname(HERMES_HOME),'workspaces',a)})),note:'Read these with your own file tools. Never repeat what is in .env files or .secrets folders.'}}
  if(action==='read'){const a=String(args.agent||MAIN),id=String(args.chat||'');if(!id)return {error:'Give chat (an id from list) and its agent.'};if(!(await agents()).includes(a))return {error:'No agent called '+a+'.'};
   const limit=Math.min(MAX_MESSAGES,Math.max(1,Number(args.limit)||100)),offset=Math.max(0,Number(args.offset)||0);
   const l=(await py({op:'read',db:dbOf(a),id,limit,offset})).filter(m=>m.role==='user'||m.role==='assistant');let total=0;const messages=[];
   for(const m of l){const text=mask(String(m.text||'')).slice(0,MAX_TEXT);if(!text.trim())continue;total+=text.length;if(total>MAX_TOTAL)break;messages.push({role:m.role,at:when(m.at),text})}
   await note(entry);return {agent:a,chat:id,offset,messages,more:l.length===limit}}
  const {out,days}=await rows(args);await note(entry);
  if(action==='list')return {days,chats:out.slice(0,Math.min(200,Number(args.limit)||50)).map(x=>({person:x.person,agent:x.agent,chat:x.id,where:x.source,started:when(x.at),messages:x.messages,title:mask(x.title||x.name||'')})),total:out.length};
  const by=new Map();for(const x of out){const k=x.person;const p=by.get(k)||{person:k,chats:0,messages:0,agents:{},last:0};p.chats++;p.messages+=Number(x.messages)||0;p.agents[x.agent]=(p.agents[x.agent]||0)+1;p.last=Math.max(p.last,Number(x.at)||0);by.set(k,p)}
  return {days,people:[...by.values()].sort((a,b)=>b.messages-a.messages).map(p=>({...p,last:when(p.last)}))}}

 async function recent(n=20){const t=await readFile(FILE,'utf8').catch(()=>'');return t.trim().split('\n').filter(Boolean).slice(-n).reverse().map(l=>{try{const {session,...e}=JSON.parse(l);return e}catch{return null}}).filter(Boolean)}
 // the owner opening someone's chat in the app: once per chat in ten minutes (the page reloads it while open)
 const seen=new Map();async function opened(who,person,chat,agent){if(!await isOn())return;const k=who+'|'+chat,t=now();if(t-(seen.get(k)||0)<600e3)return;if(seen.size>2000)seen.clear();seen.set(k,t);await note({who,action:'opened',person,chat,agent:agent||undefined})}
 return {call,asker,recent,opened}}
