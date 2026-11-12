// What one fixer run used (11 Nov 2026, the owner: see what the fixer costs): the engine's own record of that run's session (state.db of the
// run's agent), found by its time and the issue id in its prompt. Read only; null when not found. 12 Nov 2026: also the number of model calls
// and tool calls of the run (newer columns; an older engine database still gives the tokens and the cost), so a run's cost per call is visible.
import {execFile} from 'node:child_process';
import path from 'node:path';

export const RUN_USAGE_PY=`import sqlite3,sys,json
db,a,b,iss=sys.argv[1],float(sys.argv[2]),float(sys.argv[3]),sys.argv[4]
c=sqlite3.connect('file:'+db+'?mode=ro',uri=True)
q="select s.model,s.input_tokens,s.output_tokens,s.cache_read_tokens,s.cache_write_tokens,s.estimated_cost_usd%s from sessions s where s.source='tool' and s.started_at between ? and ? and exists(select 1 from messages m where m.session_id=s.id and m.role='user' and m.content like ?) order by s.started_at desc limit 1"
try:
  r=c.execute(q%',s.api_call_count,s.tool_call_count',(a,b,'%ISSUE '+iss+'%')).fetchone()
except sqlite3.Error:
  r=c.execute(q%'',(a,b,'%ISSUE '+iss+'%')).fetchone()
print(json.dumps(r))`;
export const usageFromRow=v=>v?{model:v[0]||null,input:v[1]||0,output:v[2]||0,cacheRead:v[3]||0,cacheWrite:v[4]||0,cost:Math.round((Number(v[5])||0)*1e5)/1e5,calls:v[6]||0,tools:v[7]||0}:null;
export const createFixerRunUsage=({HERMES_HOME})=>async r=>{if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(r.agent||''))||!/^[\w-]{1,40}$/.test(String(r.issue||'')))return null;
 const db=r.agent==='default'?path.join(HERMES_HOME,'state.db'):path.join(HERMES_HOME,'profiles',r.agent,'state.db');
 const out=await new Promise(res=>execFile('python3',['-I','-c',RUN_USAGE_PY,db,String(r.at/1000-15),String((r.done||Date.now())/1000+15),String(r.issue)],{timeout:20000},(e,so)=>res(e?'':String(so))));
 let v=null;try{v=JSON.parse(out.trim()||'null')}catch{}
 return usageFromRow(v)};
