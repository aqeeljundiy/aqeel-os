// "ok" that did nothing (12 Nov 2026). Continue Threads' comment runner was allowed to post run after run, every run ended "ok",
// and not one post was recorded for hours: the engine had loaded the agent's aqeelOS tools before its posting limits were
// switched on, so record_post was not in its tool list; the agent said so in its answer and stopped. Nothing looked broken.
// The check: SILENT_RUNS runs in a row that were allowed to post, with no post recorded since, is ONE Health item with the
// real reason (silentPosting). The parts here only decide; posting-limits.mjs feeds them and files the item.

export const SILENT_RUNS=6,SILENT_RUNS_PLAIN=12,LOOK_MS=36*3600e3;

const stamp=t=>new Date(t).toISOString().slice(0,16).replace('T',' ')+' UTC';

// The tool list the engine loaded for an agent's tool server: the last "MCP server '<server>' (HTTP): registered N tool(s): a, b"
// line of its agent.log. null when the log says nothing (then nobody blames the tool list).
export function engineToolList(logText,server='aqeelos-notify',tool='record_post'){
 const mark="MCP server '"+server+"' (",out={at:null,count:0,has:false};let found=false;
 for(const l of String(logText||'').split('\n')){const i=l.indexOf(mark);if(i<0)continue;const m=/\): registered (\d+) tool\(s\)(?::\s*(.*))?$/.exec(l.slice(i+mark.length-1).trim());if(!m)continue;
  found=true;out.at=(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/.exec(l)||[])[1]||null;out.count=+m[1];out.has=(m[2]||'').split(/,\s*/).some(n=>n===tool||n.endsWith('__'+tool))}
 return found?out:null}

// gates: [{at, allow, n}], one per run the posting gate answered; entries: the posts recorded; tools: engineToolList() or null;
// answer: what the last run said, for the plain case. Returns {kind, text, detail} or null.
export function silentPosting({gates=[],entries=[],tools=null,answer='',now=Date.now(),stopped=false}={}){
 const lastPost=entries.reduce((m,e)=>Math.max(m,e.at||0),0),from=Math.max(lastPost,now-LOOK_MS);
 const runs=gates.filter(g=>g.allow&&g.n>0&&g.at>from);if(stopped||runs.length<SILENT_RUNS)return null;
 const n=runs.length,since=lastPost?'since the last recorded post ('+stamp(lastPost)+')':'in the last '+Math.round(LOOK_MS/3600e3)+' hours',head=n+' runs since '+stamp(runs[0].at)+' were allowed to post and none recorded a post '+since+'. ';
 if(tools&&tools.has===false)return {kind:'tool',text:'Posting runs end "ok" but cannot post: record_post is missing',
  detail:head+'The engine loaded this agent\'s aqeelOS tools ('+tools.count+', at '+(tools.at||'a time it did not record')+') without record_post, so each run is told to call a tool that is not there and stops. Restart this agent\'s engine so it reads the tool list again; aqeelOS lists record_post for every agent now, so it does not come back after that.'};
 if(n<SILENT_RUNS_PLAIN)return null;
 return {kind:'idle',text:'Allowed to post for '+n+' runs, nothing posted',
  detail:head+'record_post is available, so the agent chose not to post or posts without calling it.'+(answer?' Its last answer: "'+String(answer).replace(/\s+/g,' ').slice(0,200)+'"':'')+' Look at its last runs on Schedules.'}}
