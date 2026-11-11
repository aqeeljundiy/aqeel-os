/* How aqeelOS stops the engine (Hermes gateway). One command for every caller (restart, restore, Stop).
   The engine's own `gateway stop` sends SIGTERM and waits only 10 s; a busy engine needs 30 to 45 s to close its
   channels, kill tool processes and close the session database (7 Nov 2026: "total teardown 38.50s"). The old
   wait of 30 s then ran `tmux kill-session`, which killed the engine mid-teardown: 22 of 32 starts in a day were
   "previous unclean exit". So we wait until the process is really gone (up to `wait` seconds) and only then close
   its tmux window. The command prints FORCED when the engine was still running when the wait ran out.
   11 Nov 2026 (Elkiya): the engine can unlink gateway.pid while it keeps running, so the pid in its own
   gateway_state.json (kind hermes-gateway, state running) is followed too; without it the wait ended at once and the
   window was closed on a running engine. */
export const STOP_WAIT_S=150;
// p1: the pid in ~/.hermes/gateway_state.json when it names the gateway and says it is running (written compact or spaced)
export const STATE_PID=String.raw`s=$(cat ~/.hermes/gateway_state.json 2>/dev/null); p1=""; if printf %s "$s" | grep -Eq '"kind": *"hermes-gateway"' && printf %s "$s" | grep -Eq '"gateway_state": *"running"'; then p1=$(printf %s "$s" | grep -oE '"pid": *[0-9]+' | head -1 | grep -oE '[0-9]+$'); fi`;
export function stopGatewayCmd({wait=STOP_WAIT_S,dashboard=false,yes=true}={}){
 const w=Math.max(1,Math.round(Number(wait)||STOP_WAIT_S));
 return ['p0=$(grep -o "[0-9]*" ~/.hermes/gateway.pid 2>/dev/null | head -1)',
  // the engine's own state file: its pid, only while it says it is the gateway and running
  STATE_PID,
  'hermes -p default gateway stop'+(yes?' --yes':'')+' >/dev/null 2>&1',
  // the engine may have removed its pid file while the process still tears down: follow the pid we saw first too
  'for i in $(seq 1 '+w+'); do p=$(grep -o "[0-9]*" ~/.hermes/gateway.pid 2>/dev/null | head -1); a=""; for x in $p $p0 $p1; do kill -0 "$x" 2>/dev/null && a=1; done; [ -z "$a" ] && break; sleep 1; done',
  'for x in $p $p0 $p1; do kill -0 "$x" 2>/dev/null && echo FORCED; done',
  'tmux kill-session -t "=gateway" 2>/dev/null'+(dashboard?'; tmux kill-session -t "=dashboard" 2>/dev/null':''),
  'sleep 1; true'].join('; ')}
// Agents that run their own gateway (12 Nov 2026): where the default gateway serves every agent (the engine's "multiplexer") there
// are none, and restarting the default one reloads them all. Where an agent still has a gateway process of its own (`hermes gateway
// list` shows another pid for it), stopping only the default one left that agent on the old engine code (the engine patches never
// reached it). Lines of the list: "  ✓ name (current)  — PID 123".
export function parseGatewayList(out){const r=[];for(const l of String(out||'').split(/\r?\n/)){const m=/^\s*\S+\s+([A-Za-z0-9][\w.-]*)(?:\s+\(current\))?\s*[—–-]+\s*PID\s+(\d+)/u.exec(l);if(m)r.push({name:m[1],pid:+m[2]})}return r}
// the agents whose gateway is a process of its own (not the default one's)
export const ownGateways=list=>{const d=(list||[]).find(x=>x.name==='default');return d?list.filter(x=>x.name!=='default'&&x.pid&&x.pid!==d.pid).map(x=>x.name):[]};
const NAME=/^[A-Za-z0-9][\w.-]{0,63}$/;
export const stopOwnGatewayCmd=(name,{wait=60}={})=>NAME.test(name)?'hermes -p '+name+' gateway stop --yes >/dev/null 2>&1; for i in $(seq 1 '+wait+'); do hermes gateway list 2>&1 | grep -Eq "^[^A-Za-z0-9]*'+name+'( |$).*PID" || break; sleep 1; done; tmux kill-session -t "=gateway-'+name+'" 2>/dev/null; true':'true';
// started again the way it was set up: as the installed service when there is one, else in its own tmux window like the default one
export const startOwnGatewayCmd=name=>NAME.test(name)?'hermes -p '+name+' gateway start >/dev/null 2>&1 || tmux has-session -t "=gateway-'+name+'" 2>/dev/null || tmux new-session -d -s "gateway-'+name+'" "cd ~; env -u DISPLAY hermes -p '+name+' gateway 2>&1 | tee -a /tmp/gateway-'+name+'.log"; true':'true';
// shx's own time limit must cover the wait, or node kills the shell mid-wait and the restart goes on anyway
export const stopTimeoutMs=(wait=STOP_WAIT_S)=>((Number(wait)||STOP_WAIT_S)+60)*1000;
