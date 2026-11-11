// What the engine itself recorded about an interrupted chat or schedule run (resume.mjs asks before it continues
// anything). Read-only: the chat's messages from the agent's state.db, the run from its cron/executions.db (the engine's
// own ledger of every attempt: claimed, running, completed, failed, unknown) and cron/jobs.json.
import {execFile} from 'node:child_process';
import path from 'node:path';
import {NOTE_START} from './resume.mjs';

// one chat since the person's message: was it stored, answered, did the person write again, which tools ran, is a call
// still without its result, when was the last sign of life
const CHAT_PY=`import sqlite3,sys,json
db,sid,since,note=sys.argv[1],sys.argv[2],float(sys.argv[3]),sys.argv[4]
try: c=sqlite3.connect('file:'+db+'?mode=ro',uri=True,timeout=5)
except Exception: print('null'); sys.exit()
if not c.execute("select 1 from sessions where id=?",(sid,)).fetchone(): print(json.dumps({'missing':True})); sys.exit()
rows=c.execute("select role,content,tool_calls,tool_call_id,timestamp from messages where session_id=? and timestamp>=? order by id",(sid,since)).fetchall()
o={'stored':False,'answered':False,'personAfter':False,'tools':[],'openCall':False,'posted':False,'partial':False,'lastAt':0}
calls=set();seen=False
for role,content,tc,tcid,ts in rows:
    o['lastAt']=max(o['lastAt'],int(ts*1000));text=content if isinstance(content,str) else ''
    if role=='user':
        if text.startswith(note): seen=True;o['stored']=True;o['answered']=False; continue
        if seen: o['personAfter']=True
        seen=True;o['stored']=True;o['answered']=False;continue
    if not seen: continue
    if role=='assistant':
        names=[]
        try:
            for x in json.loads(tc or '[]') or []:
                n=(x.get('function') or {}).get('name') or x.get('name') or '';names.append(n)
                if x.get('id'): calls.add(x.get('id'))
        except Exception: pass
        o['tools']+=names
        if 'record_post' in ' '.join(names) or 'record_post' in (tc or ''): o['posted']=True
        o['answered']=bool(text.strip()) and not names
        if text.strip() and names: o['partial']=True
    elif role=='tool':
        calls.discard(tcid);o['answered']=False
o['openCall']=bool(calls);o['tools']=sorted(set(o['tools']))[:40]
print(json.dumps(o))`;

// every attempt the engine has in progress, for each agent home given as "name=home"
const RUNS_PY=`import sqlite3,sys,json,os
out=[]
for a in sys.argv[1:]:
    name,home=a.split('=',1);db=os.path.join(home,'cron','executions.db')
    if not os.path.exists(db): continue
    names={}
    try:
        d=json.load(open(os.path.join(home,'cron','jobs.json')));names={j.get('id'):j.get('name') for j in (d.get('jobs') if isinstance(d,dict) else d) or []}
    except Exception: pass
    try:
        c=sqlite3.connect('file:'+db+'?mode=ro',uri=True,timeout=5)
        for i,job,at in c.execute("select id,job_id,claimed_at from executions where status in ('claimed','running')"):
            out.append({'kind':'schedule','agent':name,'exec':i,'job':job,'name':names.get(job) or job,'since':at})
    except Exception: print('null'); sys.exit()
print(json.dumps(out))`;

// one attempt now: its state, whether its process lives, whether the job ran again since, whether the result went out
const RUN_PY=`import sqlite3,sys,json,os
home,eid,job=sys.argv[1],sys.argv[2],sys.argv[3]
o={'missing':True,'jobKnown':False,'enabled':None}
try:
    d=json.load(open(os.path.join(home,'cron','jobs.json')))
    for j in (d.get('jobs') if isinstance(d,dict) else d) or []:
        if j.get('id')==job: o['jobKnown']=True;o['enabled']=bool(j.get('enabled',True)) and j.get('state')!='paused'
except Exception: pass
try: c=sqlite3.connect('file:'+os.path.join(home,'cron','executions.db')+'?mode=ro',uri=True,timeout=5)
except Exception: print('null'); sys.exit()
cols=[r[1] for r in c.execute("pragma table_info(executions)")]
r=c.execute("select status,pid,claimed_at,error"+(",delivery_outcome" if 'delivery_outcome' in cols else ",null")+" from executions where id=?",(eid,)).fetchone()
if r:
    o['missing']=False;o['status']=r[0];o['error']=r[3] or '';o['delivered']=str(r[4] or '').lower() in ('delivered','sent','ok','success')
    try: os.kill(int(r[1]),0);o['ownerLive']=True
    except Exception: o['ownerLive']=False
    o['newer']=bool(c.execute("select 1 from executions where job_id=? and claimed_at>? limit 1",(job,r[2])).fetchone())
print(json.dumps(o))`;

export function createResumeEngine({python,homeOf,agents=async()=>['default'],gatewayPid=async()=>0,posted=async()=>false}){
 const py=async(code,args,ms=20000)=>{const bin=await python();return new Promise((res,rej)=>execFile(bin,['-c',code,...args],{timeout:ms,maxBuffer:4e6},(e,o)=>{if(e)return rej(Error('the engine’s record did not open ('+(e.code??e.signal)+')'));try{res(JSON.parse(String(o||'null')))}catch{rej(Error('the engine’s record was not readable'))}}))};
 // e.at - 30 s: the engine stores the person's message a moment after aqeelOS passes it on, never before
 async function probeChat(e){const p=await py(CHAT_PY,[path.join(homeOf(e.agent),'state.db'),e.session,String((e.at-30e3)/1000),NOTE_START]);if(!p||p.missing)return p;
  const pid=await gatewayPid().catch(()=>0);p.engineSame=!!(pid&&e.gw&&pid===e.gw);return p}
 // null when a ledger could not be read: the caller then leaves its journal as it is
 async function runsNow(){const l=await agents();return py(RUNS_PY,l.map(a=>a+'='+homeOf(a)))}
 async function probeRun(e){const p=await py(RUN_PY,[homeOf(e.agent),e.exec,e.job]);if(!p)return p;
  // a post the agent recorded during the run already went out: the run is not started again
  if(!p.delivered&&p.status!=='completed')p.posted=await posted(e.agent,Date.parse(e.since)||e.at,e.cutAt||Date.now()).catch(()=>false);return p}
 return {probeChat,runsNow,probeRun}}
