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

// the list of channels a person sees: admins every row, anyone else the rows of agents they may edit
export function visibleChannels(data,{admin,mayEdit}){if(admin||!data)return data;
 return {...data,channels:(data.channels||[]).filter(r=>mayEdit(r.agent)),failed:(data.failed||[]).filter(a=>mayEdit(a)),...(data.loading?{loading:data.loading.filter(a=>mayEdit(a))}:{})}}
