// Which agent a proxied engine call acts on (12 Nov 2026, security audit CR-1 / H-1).
//
// The rights check and the engine must agree on the agent, so it is decided HERE, once, from the selectors the engine
// itself honours, and the forwarded request is rewritten so no other selector is left:
//
//   route                          the engine reads the agent from          what is forwarded
//   /gapi/p/<agent>/...            the /p/<agent>/ path prefix only         path kept; ?profile= and ?agent= removed
//   /gapi/...                      nothing: always the main agent           the same
//   /hapi/profiles/<agent>[/...]   the path                                 ?profile= (if any) and body.profile (if any) set to <agent>
//   /hapi/... (everything else)    JSON body "profile", else ?profile=,     both set to the one checked agent; ?agent= removed
//                                  else the main agent
//
// (Engine: gateway/platforms/api_server.py _resolve_request_profile reads request.match_info only; the dashboard's
// routers use `body.profile or profile`. Neither reads ?agent= or a header.) The app's own handlers read the same
// rewritten query, so they cannot disagree either.
export const AGENT_NAME=/^[a-z0-9][a-z0-9_-]{0,63}(?:--[a-z0-9][a-z0-9_-]{0,63})?$/;
const BAD={error:'That is not an agent name.'};
const name=s=>{let a;try{a=decodeURIComponent(s)}catch{return null}return AGENT_NAME.test(a)?a:null};
const isObj=b=>!!b&&typeof b==='object'&&!Array.isArray(b);

// p: the path as the browser sent it; q: URLSearchParams; body: the parsed JSON body when there is one.
// Returns {agent, via} or {error}. agent 'all' is only ever the schedule list across agents (the caller filters it).
export function decide(p,q,body){
 if(p==='/gapi'||p.startsWith('/gapi/')){
  if(!/^\/gapi\/p(\/|$)/.test(p))return {agent:'default',via:'none'};
  const m=/^\/gapi\/p\/([^/]+)\//.exec(p),a=m&&name(m[1]);return a?{agent:a,via:'path'}:BAD}
 if(p.startsWith('/hapi/')){
  const m=/^\/hapi\/profiles\/([^/]+)/.exec(p);if(m){const a=name(m[1]);return a?{agent:a,via:'path'}:BAD}
  const has=isObj(body)&&body.profile!=null&&body.profile!=='',bp=has?body.profile:null,qp=q.get('profile');
  if(has&&typeof bp!=='string')return BAD;
  const a=bp||qp||'default';if(a==='all')return has?BAD:{agent:'all',via:'query'};
  return AGENT_NAME.test(a)?{agent:a,via:has?'body':qp?'query':'none'}:BAD}
 return {agent:null,via:'none'}}

// Leaves exactly one agent in the request: mutates q, returns the body to forward (a new object when it changed, else
// the one given) and whether it changed.
export function rewrite(p,q,body,agent){
 q.delete('agent');let changed=false;
 if(p==='/gapi'||p.startsWith('/gapi/')){q.delete('profile');return {body,changed}}
 if(p.startsWith('/hapi/')){
  const byPath=/^\/hapi\/profiles\/[^/]+/.test(p),had=q.has('profile');
  if(isObj(body)){const named=body.profile!=null&&body.profile!=='';
   // a named agent in the body is overwritten; without one the body gets the address's agent, as it always did
   if(named?body.profile!==agent:(!byPath&&had&&agent!=='all')){body={...body,profile:agent};changed=true}}
  if(had||(!byPath&&agent!=='default'))q.set('profile',agent)}
 return {body,changed}}
