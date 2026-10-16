// Live parity check (ACCESS-06): calls every Hermes endpoint the UI reads, plus one real chat turn,
// and reports pass/fail. Run on the AI box:  node --env-file=$HOME/.hermes/.env scripts/parity-check.mjs [--chat]
const DASH=process.env.HERMES_DASH||'http://127.0.0.1:9119';
const GATE=process.env.HERMES_API||'http://127.0.0.1:8642';
const dashH={'x-hermes-session-token':process.env.HERMES_DASHBOARD_SESSION_TOKEN||''};
const gateH={authorization:'Bearer '+(process.env.API_SERVER_KEY||'')};

// [feature ids, base, path, check(json) → true/false]
const isArr=k=>j=>Array.isArray(k?j[k]:j);
const READS=[
 ['SYS-01 SHELL-04','dash','/api/status',j=>typeof j.gateway_running==='boolean'],
 ['HIST-01','dash','/api/sessions?limit=5&offset=0&order=recent',isArr('sessions')],
 ['HIST-06','dash','/api/sessions/stats',j=>'total' in j],
 ['HIST-03','dash','/api/sessions/search?q=the',j=>j&&typeof j==='object'],
 ['HIST-05','dash','/api/sessions/empty/count',j=>'count' in j],
 ['CHAT-06','gate','/api/model/options',isArr('providers')],
 ['CHAT-10','dash','/api/chat/workspaces',j=>'default_cwd' in j],
 ['AUTO-01','dash','/api/cron/jobs?profile=all',isArr()],
 ['AUTO-02','dash','/api/cron/delivery-targets?profile=default',isArr('targets')],
 ['AUTO-09','dash','/api/cron/blueprints?profile=default',isArr('blueprints')],
 ['AUTO-05','dash','/api/messaging/platforms',isArr('platforms')],
 ['AUTO-04','dash','/api/webhooks',j=>'enabled' in j],
 ['AUTO-07','dash','/api/pairing',j=>Array.isArray(j.pending)],
 ['ABIL-01','dash','/api/skills',isArr()],
 ['ABIL-02','dash','/api/tools/toolsets',isArr()],
 ['ABIL-02','dash','/api/tools/toolsets/web/config',j=>Array.isArray(j.providers)],
 ['ABIL-03','dash','/api/skills/hub/search?q=seo&source=all&limit=2',isArr('results')],
 ['ABIL-04','dash','/api/dashboard/plugins/hub',isArr('plugins')],
 ['ABIL-04','dash','/api/dashboard/plugins/catalog',isArr('entries')],
 ['ABIL-05','dash','/api/mcp/servers',isArr('servers')],
 ['ABIL-06','dash','/api/mcp/catalog',isArr('entries')],
 ['ABIL-07','dash','/api/files',isArr('entries')],
 ['ABIL-08','dash','/api/memory',isArr('providers')],
 ['MODEL-01','dash','/api/model/info',j=>'model' in j],
 ['MODEL-01','dash','/api/model/auxiliary',isArr('tasks')],
 ['MODEL-02','dash','/api/providers/oauth',isArr('providers')],
 ['MODEL-03 SYS-04','dash','/api/config',j=>'agent' in j],
 ['SYS-04','dash','/api/config/schema',j=>'fields' in j],
 ['SYS-04','dash','/api/config/raw',j=>typeof j.yaml==='string'],
 ['MODEL-04','dash','/api/env',j=>j&&typeof j==='object'],
 ['MODEL-05','dash','/api/credentials/pool',isArr('providers')],
 ['MODEL-06','dash','/api/profiles',isArr('profiles')],
 ['MODEL-06','dash','/api/profiles/active',j=>'active' in j],
 ['SYS-02','dash','/api/analytics/usage?days=7',isArr('daily')],
 ['SYS-03','dash','/api/logs?file=agent&lines=5',isArr('lines')],
 ['SYS-05','dash','/api/system/stats',j=>'cpu_count' in j],
 ['SYS-05','dash','/api/hermes/update/check',j=>'current_version' in j],
 ['SYS-08','dash','/api/ops/checkpoints',j=>'total_bytes' in j],
 ['SYS-09','dash','/api/ops/hooks',isArr('hooks')],
 ['SYS-10','dash','/api/curator',j=>'paused' in j],
 ['SYS-11','dash','/api/portal',j=>'logged_in' in j],
 ['SYS-13','dash','/api/gateway/migrate/plan',j=>'eligible' in j],
 ['SYS-14','dash','/api/shared-metrics/consent',j=>'enabled' in j],
];

let pass=0,failed=0;
const row=(ok,ids,what,extra='')=>{ok?pass++:failed++;console.log(`${ok?'PASS':'FAIL'}  ${ids.padEnd(18)} ${what}${extra?'  — '+extra:''}`)};
for(const [ids,base,path,check] of READS){
 const t0=Date.now();
 try{const r=await fetch((base==='dash'?DASH:GATE)+path,{headers:base==='dash'?dashH:gateH,signal:AbortSignal.timeout(30000)});const j=await r.json().catch(()=>null);row(r.ok&&!!check(j),ids,'GET '+path,r.ok?`${Date.now()-t0} ms`:'HTTP '+r.status)}
 catch(e){row(false,ids,'GET '+path,e.message)}
}

// One real chat turn through the gateway, the way the UI sends it.
if(process.argv.includes('--chat')){
 try{
  const s=await (await fetch(GATE+'/api/sessions',{method:'POST',headers:{...gateH,'content-type':'application/json'},body:JSON.stringify({title:'Parity check'})})).json();
  const id=s.session?.id;const r=await fetch(GATE+`/api/sessions/${id}/chat/stream`,{method:'POST',headers:{...gateH,'content-type':'application/json'},body:JSON.stringify({message:'Reply with the single word: pong',model_options:{reasoning_effort:'low'}})});
  const text=await r.text();const events=[...text.matchAll(/^event: (\S+)/gm)].map(m=>m[1]);
  row(events.includes('run.started')&&events.includes('run.completed')&&/pong/i.test(text),'CHAT-01 CHAT-02','POST chat/stream',events.join(' → '));
  await fetch(DASH+'/api/sessions/'+encodeURIComponent(id),{method:'DELETE',headers:dashH});
 }catch(e){row(false,'CHAT-01','POST chat/stream',e.message)}
}
console.log(`\n${pass} passed · ${failed} failed`);process.exit(failed?1:0);
