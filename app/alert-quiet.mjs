// When the owner is not alerted (6 Nov 2026): alerts about test agents and alerts during a planned build are noise.
//   - test agents: HERMES_HOME/.aqeelos-test-agents lists agent names (one per line, # comments), e.g. agents a check
//     makes and removes again. Their problems still show on System › Health; only the owner's alert is skipped.
//   - restart hold: while DATA/restart-hold.json {until,why} is active (a long build, see README "Restart hold"),
//     owner alerts are written to the log instead of sent. An expired hold is ignored.
// quiet(agent) → 'test' | 'hold' | null. Both files are read at most every 30 s.
import {readFileSync} from 'node:fs';
import path from 'node:path';
export function parseTestAgents(text){return new Set(String(text||'').split('\n').map(l=>l.replace(/#.*$/,'').trim()).filter(Boolean))}
export function holdActive(hold,now=Date.now()){return !!hold&&now<Number(hold.until||0)}
export function quietReason(agent,{tests=new Set(),hold=null,now=Date.now()}={}){const base=agent?String(agent).split('--')[0]:null;
 if(base&&tests.has(base))return 'test';if(holdActive(hold,now))return 'hold';return null}
export function createQuiet({DATA,HERMES_HOME,now=()=>Date.now(),every=30e3}){let at=0,tests=new Set(),hold=null;
 const read=()=>{if(now()-at<every&&at)return;at=now();
  try{tests=parseTestAgents(readFileSync(path.join(HERMES_HOME,'.aqeelos-test-agents'),'utf8'))}catch{tests=new Set()}
  try{hold=JSON.parse(readFileSync(path.join(DATA,'restart-hold.json'),'utf8'))}catch{hold=null}};
 return agent=>{read();return quietReason(agent,{tests,hold,now:now()})}}
