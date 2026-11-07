/* How aqeelOS stops the engine (Hermes gateway). One command for every caller (restart, restore, Stop).
   The engine's own `gateway stop` sends SIGTERM and waits only 10 s; a busy engine needs 30 to 45 s to close its
   channels, kill tool processes and close the session database (7 Nov 2026: "total teardown 38.50s"). The old
   wait of 30 s then ran `tmux kill-session`, which killed the engine mid-teardown: 22 of 32 starts in a day were
   "previous unclean exit". So we wait until the process is really gone (up to `wait` seconds) and only then close
   its tmux window. The command prints FORCED when the engine was still running when the wait ran out. */
export const STOP_WAIT_S=150;
export function stopGatewayCmd({wait=STOP_WAIT_S,dashboard=false,yes=true}={}){
 const w=Math.max(1,Math.round(Number(wait)||STOP_WAIT_S));
 return ['p0=$(grep -o "[0-9]*" ~/.hermes/gateway.pid 2>/dev/null | head -1)',
  'hermes -p default gateway stop'+(yes?' --yes':'')+' >/dev/null 2>&1',
  // the engine may have removed its pid file while the process still tears down: follow the pid we saw first too
  'for i in $(seq 1 '+w+'); do p=$(grep -o "[0-9]*" ~/.hermes/gateway.pid 2>/dev/null | head -1); a=""; for x in $p $p0; do kill -0 "$x" 2>/dev/null && a=1; done; [ -z "$a" ] && break; sleep 1; done',
  'for x in $p $p0; do kill -0 "$x" 2>/dev/null && echo FORCED; done',
  'tmux kill-session -t "=gateway" 2>/dev/null'+(dashboard?'; tmux kill-session -t "=dashboard" 2>/dev/null':''),
  'sleep 1; true'].join('; ')}
// shx's own time limit must cover the wait, or node kills the shell mid-wait and the restart goes on anyway
export const stopTimeoutMs=(wait=STOP_WAIT_S)=>((Number(wait)||STOP_WAIT_S)+60)*1000;
