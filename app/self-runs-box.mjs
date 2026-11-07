// The box side of "run myself" (self-runs.mjs): starting and stopping a run, finding the chat a tool call came from,
// finding a trusted-person code someone sent, and keeping the tool off WhatsApp and webhooks where it must not show.
import {readFile,open,stat,mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn,execFile} from 'node:child_process';
import path from 'node:path';
import {userInfo} from 'node:os';
// The real login home (from the user database), not $HOME: a server started from a tool shell can carry a different HOME.
const homedir=()=>{try{return userInfo().homedir}catch{return process.env.HOME}};
import {LOCK_WAIT} from './self-runs.mjs';

// (source "tool": the engine accepts only its own labels, and keeps these chats out of chat lists; run_self judges
// a "tool" chat as one inside a run, so a run cannot start another)
// the run, in its own session (so Stop reaches everything it started): wait for the lock on fd 3 when there is one,
// then the agent's own engine with the prompt read from a file (never through a shell), its exit code in <dir>/exit
const SCRIPT=`set -u
dir="$1"; agent="$2"; secs="$3"; budget="$4"; lockwait="$5"; haslock="$6"; bin="$7"
fin(){ printf '%s' "$1" > "$dir/exit.tmp"; mv -f "$dir/exit.tmp" "$dir/exit"; }
if [ "$haslock" = 1 ]; then flock -w "$lockwait" 3 || { echo "aqeelOS: the lock stayed taken for $lockwait seconds"; fin 75; exit 75; }; fi
date +%s > "$dir/started"
# GNU timeout where there is one (Linux); elsewhere (macOS) the same limit with perl's alarm
if command -v timeout >/dev/null; then limit(){ timeout -k 20 "$@"; }; else limit(){ local t=$1; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$t" "$@"; }; fi
limit "$secs" "$bin" -p "$agent" chat --query-file "$dir/prompt.txt" -Q --source tool --run-budget "$budget" < /dev/null 3>&-
fin "$?"`;

// the waiting run_self calls in an agent's chat database (the engine saves a tool call before running it), and for
// each the chat it is in plus the chats that started it
const LOOKUP=`import sqlite3,sys,json,time
db,tool=sys.argv[1],sys.argv[2]
c=sqlite3.connect('file:'+db+'?mode=ro',uri=True,timeout=5)
out=[]
for sid,tc in c.execute("select session_id,tool_calls from messages where role='assistant' and coalesce(active,1)=1 and tool_calls like ? and timestamp>? order by id desc limit 80",('%'+tool+'%',time.time()-1800)).fetchall():
  try: calls=json.loads(tc) or []
  except Exception: continue
  for x in calls:
    f=x.get('function') or {}; n=str(f.get('name') or ''); cid=x.get('id') or x.get('call_id')
    # the call itself, or inside the engine's helper that runs deferred tools (tool_call {"calls":[{name, arguments}]})
    inner=[]
    if n.endswith('__'+tool) and 'aqeelos_self' in n: inner=[f.get('arguments') or '']
    else:
      try: a=json.loads(f.get('arguments') or '{}')
      except Exception: a={}
      for y in (a.get('calls') if isinstance(a,dict) and isinstance(a.get('calls'),list) else []):
        yn=str((y or {}).get('name') or '')
        if yn.endswith('__'+tool) and 'aqeelos_self' in yn: inner.append(y.get('arguments') if isinstance(y.get('arguments'),str) else json.dumps(y.get('arguments') or {}))
    if not inner: continue
    if c.execute("select 1 from messages where session_id=? and role='tool' and tool_call_id=? limit 1",(sid,cid)).fetchone(): continue
    for args in inner: out.append({'session':sid,'call':cid,'args':args})
cols='id,source,user_id,chat_id,chat_type,thread_id,display_name,origin_json,title,parent_session_id'
chains={}
for m in out:
  sid=m['session']; ch=[]; seen=set()
  while sid and sid not in seen and len(ch)<8:
    seen.add(sid); r=c.execute('select '+cols+' from sessions where id=?',(sid,)).fetchone()
    if not r: ch.append({'id':sid,'source':'missing'}); break
    d=dict(zip(cols.split(','),r)); o={}
    try: o=json.loads(d.pop('origin_json') or '{}') or {}
    except Exception: pass
    d['platform']=o.get('platform'); d['user_name']=o.get('user_name')
    ch.append(d); sid=d.get('parent_session_id')
  chains[m['session']]=ch
print(json.dumps({'calls':out,'chains':chains}))`;

// messages people sent any agent that hold a trusted-person code, since the oldest code still open
const CODES=`import sqlite3,sys,json
since=float(sys.argv[1]); out=[]
for db in sys.argv[2:]:
  try:
    c=sqlite3.connect('file:'+db+'?mode=ro',uri=True,timeout=5)
    for content,src,uid,oj in c.execute("select m.content,s.source,s.user_id,s.origin_json from messages m join sessions s on s.id=m.session_id where m.role='user' and m.timestamp>? and m.content like '%TRUST-%' order by m.id desc limit 50",(since,)).fetchall():
      o={}
      try: o=json.loads(oj or '{}') or {}
      except Exception: pass
      out.append({'db':db,'text':str(content)[:2000],'source':src,'platform':o.get('platform') or src,'uid':uid,'name':o.get('user_name')})
  except Exception: pass
print(json.dumps(out))`;

const run=(c,a,t=20000)=>new Promise(res=>execFile(c,a,{timeout:t,maxBuffer:8e6},(e,o,er)=>res({ok:!e,out:String(o||''),err:String(er||e?.message||'')})));

export function createSelfRunsBox({HERMES_HOME,DATA,python,bin=path.join(homedir(),'.local','bin','aqeelos')}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const dirOf=id=>path.join(DATA,'self-runs',id);
 async function launch({id,agent,dir,minutes,lockPath}){const secs=minutes*60,budget=Math.max(60,secs-60);
  const out=await open(path.join(dir,'out.txt'),'w',0o600);let lock=null;
  try{// the lock is opened here without following a shortcut at its end (safeLock checked the folders already)
   if(lockPath)lock=await open(lockPath,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o660);
   // a temp folder of the run's own: the engine's ssh terminal keeps one shared connection per temp folder and closes
   // it when a chat ends, so runs side by side in one /tmp cut each other's commands off (exit 255)
   const tmp=path.join(dir,'tmp');await mkdir(tmp,{recursive:true,mode:0o700});
   const env={TMPDIR:tmp,HOME:homedir(),USER:process.env.USER||'claude',LOGNAME:process.env.USER||'claude',PATH:path.join(homedir(),'.local','bin')+':/usr/local/bin:/usr/bin:/bin',LANG:process.env.LANG||'C.UTF-8',TERM:'dumb',HERMES_HOME,AQEELOS_SELF_RUN:id};
   const p=spawn('bash',['-c',SCRIPT,'aqeelos-self-run-'+id,dir,agent,String(secs),String(budget),String(LOCK_WAIT),lock?'1':'0',bin],{detached:true,cwd:homedir(),env,stdio:['ignore',out.fd,out.fd,...(lock?[lock.fd]:[])]});
   await new Promise((res,rej)=>{p.once('spawn',res);p.once('error',rej)});p.unref();return {pid:p.pid}}
  finally{await out.close().catch(()=>{});if(lock)await lock.close().catch(()=>{})}}
 // still our run: the process is there and its command line names this run
 async function alive(r){if(!r.pid)return false;try{process.kill(r.pid,0)}catch{return false}const c=await readFile('/proc/'+r.pid+'/cmdline','utf8').catch(()=>null);return c===null?true:c.includes('aqeelos-self-run-'+r.id)}
 async function kill(r){if(!r.pid||!await alive(r))return;await run('pkill',['-TERM','-s',String(r.pid)]);setTimeout(()=>{alive(r).then(up=>{if(up)run('pkill',['-KILL','-s',String(r.pid)])})},15000).unref()}
 async function readExit(r){const d=dirOf(r.id);const code=await readFile(path.join(d,'exit'),'utf8').then(x=>parseInt(x,10),()=>null);const s=await readFile(path.join(d,'started'),'utf8').then(x=>parseInt(x,10)*1000,()=>null);
  return code==null&&!s?null:{code:Number.isFinite(code)?code:null,started:s||null}}
 async function readOut(r){const f=path.join(dirOf(r.id),'out.txt');const st=await stat(f).catch(()=>null);if(!st)return '';const h=await open(f,'r');try{const n=Math.min(st.size,12000),b=Buffer.alloc(n);await h.read(b,0,n,st.size-n);
  return b.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').replace(/\r/g,'').trim().slice(-6000)}finally{await h.close()}}
 // the chats a waiting call (tool, with these arguments) is in: [{session, call, args, chain}]
 async function lookup(agent,tool){const p=await python();if(!p)throw Error('aqeelOS could not read the chat database.');
  const r=await run(p,['-c',LOOKUP,path.join(home(agent),'state.db'),tool],30000);if(!r.ok)throw Object.assign(Error('aqeelOS could not read the chat database.'),{detail:r.err.trim().split('\n').slice(-2).join(' ').slice(0,300)});
  const j=JSON.parse(r.out);return j.calls.map(c=>({...c,chain:j.chains[c.session]||[]}))}
 // trusted-person codes in messages to any agent since `since` (ms)
 async function findCodes(agents,since){const p=await python();if(!p)return [];const dbs=[];for(const a of agents){const f=path.join(home(a),'state.db');if(await stat(f).catch(()=>null))dbs.push(f)}
  if(!dbs.length)return [];const r=await run(p,['-c',CODES,String(since/1000),...dbs],30000);if(!r.ok)return [];
  return JSON.parse(r.out).map(x=>({...x,agent:x.db===path.join(HERMES_HOME,'state.db')?'default':path.basename(path.dirname(x.db))}))}
 return {launch,alive,kill,readExit,readOut,lookup,findCodes,home}}

// the platform_toolsets list that keeps aqeelos-self off a channel (hide) or lets it back on. servers: the agent's enabled
// MCP servers; cur: the list now; managed: aqeelOS wrote this list itself. Returns {want, managed} (want null: no change).
// A list naming MCP servers makes the engine take only those, so hiding lists every other server (kept in step).
export function placement({pf,cur,servers,hide,managed}){const base=pf==='webhook'?['hermes-webhook']:['hermes-'+pf];cur=[].concat(cur||[]).map(String);
 const known=new Set([...servers,'aqeelos-self']),isMcp=x=>known.has(x)||x.startsWith('mcp-')&&known.has(x.slice(4)),nonMcp=cur.filter(x=>!isMcp(x)),explicit=cur.some(isMcp);
 const others=servers.filter(n=>n!=='aqeelos-self');let want=null,m=managed;
 if(hide){if(explicit&&!managed)want=cur.filter(x=>x!=='aqeelos-self'&&x!=='mcp-aqeelos-self');else{want=[...(nonMcp.length?nonMcp:base),...others];m=true}}
 else if(managed){want=nonMcp.length?nonMcp:base;m=false}
 else if(explicit&&servers.includes('aqeelos-self')&&!cur.includes('aqeelos-self'))want=[...cur,'aqeelos-self'];
 if(want&&JSON.stringify(want)===JSON.stringify(cur))want=null;return {want,managed:m}}
