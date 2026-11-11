// What may run while a restore copies the agents' files (1 Nov 2026, second review). Small on purpose, so the rules are
// tested (scripts/busy.test.mjs) and server.mjs only asks them.

// the agents may start or restart unless a restore is running; the restore's own start at its end is the one exception
export const mayStartAgents=({restoring,forRestore=false})=>!restoring||forRestore;

// /healthz "busy": deploy.sh waits while this is above 0 before it restarts aqeelOS (a restart mid-restore would cut the
// copy off and services.sh would start the agents on half-copied files)
export const busyTotal=({live=0,setups=0,ops=0,relay=0,gwRestarting=false,engineUpdate=false,restore=false}={})=>live+setups+ops+relay+(gwRestarting?1:0)+(engineUpdate?1:0)+(restore?1:0);

// the automations guard waits (no repairs, no config writes) while the engine updates, restarts or is being restored
export const guardPaused=({engineUpdate=false,gwRestarting=false,restore=false}={})=>engineUpdate||gwRestarting||restore;

// /healthz "hold" (12 Nov 2026): what a deploy or update still waits for. Replies and runs in progress are no longer
// waited for (they are continued afterwards, resume.mjs); an agent being set up, a settings change, an engine restart or
// update and a restore cannot be continued, so those still finish first.
export const holdTotal=o=>busyTotal({...o,live:0});
