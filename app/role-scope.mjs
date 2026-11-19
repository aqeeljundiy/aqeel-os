// Roles: what you own decides what you can do (docs/roles-design.md, owner's yes 19 Nov 2026). An agent's owner, or someone it is
// shared with as Can edit, runs that agent's own things whatever their role; the install (and the main agent, whose channels
// restart everyone) stays with admins; a few guards need the owner's yes whoever asks.
// Owner's answers (19 Nov 2026): Kirimdev stays admin-only; only outside-facing channels need his OK to open to anyone; a
// Builder owns 5 agents; only the owner approves a guard.
//
// This file holds the pure rules, so the gate in users.mjs, the proxy in server.mjs and the tests share them.

// the engine's own channel routes an agent's editor may use for that agent (Channels › Connections and Who can message)
export const AGENT_CHANNEL_ROUTE=/^\/(messaging|pairing)(\/|$)/;
// channels people outside the team reach; a Slack bot lives inside the team's own workspace
export const OUTSIDE=new Set(['whatsapp','whatsapp_cloud','telegram','email','sms','signal','discord','matrix','webhook','api_server','line','wecom','dingtalk','irc']);

// May this person use the engine's channel routes for this agent? Admins always; anyone else on an agent they may edit,
// never the main agent (its channel changes restart every agent).
export function channelRouteOk({admin,level,agent}){if(admin)return true;return agent!=='default'&&(level==='edit'||level==='owner')}

// A channel opened to anyone: the change (env lines and settings of PUT /messaging/platforms/<id>) sets the DM policy to
// open or lets all users in. Returns the platform it opens, or ''. Only outside-facing platforms count.
export function opensToAnyone(path,body){const m=/^\/hapi\/messaging\/platforms\/([a-z_]+)/.exec(String(path||''));if(!m||!body||typeof body!=='object')return '';
 const pf=m[1];if(!OUTSIDE.has(pf))return '';
 const flat=[];(function walk(o,k=''){if(o&&typeof o==='object'){for(const [a,v] of Object.entries(o))walk(v,a)}else flat.push([String(k),o])})(body);
 const yes=v=>v===true||/^(1|true|yes|on)$/i.test(String(v));
 return flat.some(([k,v])=>/dm_policy$/i.test(k)&&/^open$/i.test(String(v).trim())||/allow_all(_users)?$/i.test(k)&&yes(v))?pf:''}

// An agent's keys (the engine's /env of that agent) for its owner or editor: secrets for outside services only. Names that wire
// the engine, the terminal, the network or who may message stay with admins: through them the Keys page would open a channel
// to anyone (around the guard above) or move the agent off its own Linux user (19 Nov 2026).
const KEY_ADMIN_ONLY=/^(HERMES_|TERMINAL_|GATEWAY_|API_SERVER_|BROWSER_|CDP_|AQEELOS_|CLAUDE_|ANTHROPIC_BASE|OPENAI_BASE)|(_DM_POLICY|_ALLOWED_USERS|_ALLOW_ALL_USERS|_ALLOW_FROM|_HOME_CHANNEL|_PROXY)$|^(HTTPS?_PROXY|ALL_PROXY|NO_PROXY|PATH|HOME|USER|SHELL|DISPLAY|XAUTHORITY|PYTHONPATH|NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|TZ)$/i;
export function keyNameOk(name){const n=String(name||'').trim();return /^[A-Z][A-Z0-9_]{1,80}$/i.test(n)&&!KEY_ADMIN_ONLY.test(n)}

// One check of a request body from someone who is not an admin, before it reaches the engine: an outside-facing channel opened
// to anyone (asks the owner) or a key name that wires the engine. {ask:platform} | {error} | null.
export function memberBody(path,body){const od=opensToAnyone(path,body);if(od)return {ask:od,error:'Opening '+od+' to anyone needs the owner OK; he was asked.'};
 if(/^\/hapi\/env(\/|$)/.test(String(path||''))&&body&&typeof body==='object'){const k=body.key??body.name;if(k!=null&&!keyNameOk(k))return {error:'"'+String(k).slice(0,60)+'" is an engine or channel setting, not a key; admins set it.'}}
 return null}

// A file path inside an agent's workspace (~/workspaces/<agent>/...), by its REAL location: the engine's file routes run as the
// box user, and an agent can put a link in its own workspace, so a link out of it never counts. Returns the agent or ''.
export function workspaceAgent(fp,{root,real}){const r=real(String(fp||''));const base=real(root);if(!r||!base||!r.startsWith(base+'/'))return '';
 const a=r.slice(base.length+1).split('/')[0];return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(a)?a:''}

// the list of channels a person sees: admins every row, anyone else the rows of agents they may edit
export function visibleChannels(data,{admin,mayEdit}){if(admin||!data)return data;
 return {...data,channels:(data.channels||[]).filter(r=>mayEdit(r.agent)),failed:(data.failed||[]).filter(a=>mayEdit(a)),...(data.loading?{loading:data.loading.filter(a=>mayEdit(a))}:{})}}
