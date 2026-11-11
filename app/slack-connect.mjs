// Set up Slack in the app (11 Nov 2026). Slack runs an official MCP server (https://mcp.slack.com/mcp) with its own
// sign-in, but it lets no app register itself: every install needs one Slack app of its own (free, internal to the
// workspace). So the owner does this once: "Create the Slack app" opens Slack with the app already filled in (a
// manifest with the user scopes the Slack MCP needs and this install's return address), they install it and paste
// its Client ID and Client Secret here. After that anyone connects their own Slack for their agent with one click:
// the agent gets the Slack MCP with this app's client, and the engine's sign-in (the same one connect_mcp_tool uses)
// opens Slack's Allow page. The secret is kept in HERMES_HOME/slack_client.json (0600) and never logged or sent back.
// An agent whose Slack already has a client of its own (an older own app) is left as it is.
import {readFile,writeFile,mkdir,rename,unlink,chmod,stat} from 'node:fs/promises';
import path from 'node:path';

export const MCP_URL='https://mcp.slack.com/mcp';
// every user scope the official Slack MCP's tools ask for (docs.slack.dev/ai/slack-mcp-server, 11 Nov 2026)
export const USER_SCOPES=['search:read.public','search:read.private','search:read.mpim','search:read.im','search:read.files','search:read.users',
 'files:read','files:write','emoji:read','chat:write','channels:history','groups:history','mpim:history','im:history',
 'channels:read','groups:read','im:read','mpim:read','channels:write','groups:write','im:write','mpim:write',
 'reactions:read','reactions:write','canvases:read','canvases:write','users:read','users:read.email','lists:read','lists:write'];
const NEW_APP='https://api.slack.com/apps?new_app=1&manifest_json=';
export const hostOf=u=>{try{return new URL(String(u)).host.toLowerCase()}catch{return ''}};
export const isSlackUrl=u=>hostOf(u)==='mcp.slack.com';

// what people paste: the Client ID (digits.digits) and the Client Secret (32 hex), from Basic Information › App Credentials
export function parseClient(b={}){const id=String(b.client_id||'').trim(),secret=String(b.client_secret||'').trim();
 if(!id)throw Error('Paste the Client ID first.');
 if(!/^\d{6,}\.\d{6,}$/.test(id))throw Error(/^A[0-9A-Z]{6,}$/.test(id)?'That is the App ID. Copy the Client ID, the line under it.':'That does not look like a Slack Client ID. It is two long numbers with a dot between them, under Basic Information › App Credentials.');
 if(!secret)throw Error('Paste the Client Secret too (press Show next to it in Slack first).');
 if(!/^[0-9a-f]{32}$/i.test(secret))throw Error(/^\*+$/.test(secret)||/•/.test(secret)?'The secret is still hidden. Press Show next to Client Secret in Slack, then copy it.':'That does not look like a Slack Client Secret. It is 32 letters and digits, under Client ID.');
 return {client_id:id,client_secret:secret.toLowerCase()}}

// the app as Slack's "Create New App" reads it; only https addresses (Slack refuses others)
export function manifest({name='aqeelOS',redirects=[]}={}){const urls=[...new Set(redirects.map(String).filter(u=>/^https:\/\/[^\s]+$/i.test(u)))];
 return {display_information:{name:String(name).slice(0,35)||'aqeelOS',description:'Lets your aqeelOS agents use Slack as you: search, read and send messages.',background_color:'#111111'},
  oauth_config:{...(urls.length?{redirect_urls:urls}:{}),scopes:{user:[...USER_SCOPES]}},
  settings:{org_deploy_enabled:false,socket_mode_enabled:false,token_rotation_enabled:false}}}
export const manifestUrl=m=>NEW_APP+encodeURIComponent(JSON.stringify(m));

export function createSlackConnect({HERMES_HOME,redirectFor,readConfig,setKey,prepareSignin,startSignin,homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),appName=()=>'aqeelOS',fetchImpl=fetch,now=()=>Date.now(),log=()=>{}}){
 const CLIENT=path.join(HERMES_HOME,'slack_client.json');
 const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};
 const put=async(f,v)=>{await mkdir(path.dirname(f),{recursive:true});const t=f+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(v,null,2),{mode:0o600});await chmod(t,0o600).catch(()=>{});await rename(t,f)};
 async function client(){const j=await readJson(CLIENT);if(!j)return null;try{return parseClient(j)}catch{return null}}
 // this install's app now and the ones it replaced: an agent with one of these is "ours", never "its own app"
 async function ourIds(){const j=await readJson(CLIENT)||{};return new Set([j.client_id,...(j.previous||[])].filter(Boolean))}
 // the Slack MCP on one agent: its name there (any name, found by address), whether it has its own app, signed in
 async function slackOf(agent){const c=await readConfig(agent).catch(()=>null)||{};const all=Object.entries(c.mcp_servers||{});
  const hit=all.find(([,e])=>e&&isSlackUrl(e.url));
  if(!hit){const taken=all.some(([n])=>n==='slack');return {agent,name:taken?'slack-mcp':'slack',has:false}}
  const [name,e]=hit,cid=String(e.oauth?.client_id||''),ours=await ourIds();
  const signedIn=await stat(path.join(homeOf(agent),'mcp-tokens',name+'.json')).then(()=>true,()=>false);
  // own: a client that is neither this install's app nor a ${SETTING} (an older app someone made by hand)
  return {agent,name,has:true,on:e.enabled!==false,own:!!cid&&!/^\$\{/.test(cid)&&!ours.has(cid),signedIn}}
 // the return addresses Slack must know: one per name the agents use for Slack (usually just "slack")
 async function redirects(agents=[]){const names=new Set(['slack']);for(const a of agents){const s=await slackOf(a).catch(()=>null);if(s?.has&&!s.own)names.add(s.name)}return [...names].map(n=>redirectFor(n))}
 async function info(agents=[]){const c=await client(),urls=await redirects(agents),m=manifest({name:appName(),redirects:urls});
  return {client:c?{id:c.client_id.slice(0,4)+'…'+c.client_id.slice(-4)}:null,redirects:urls,https:urls.every(u=>/^https:\/\//i.test(u)),manifest:JSON.stringify(m,null,2),createUrl:manifestUrl(m),scopes:USER_SCOPES.length}}
 // Slack says whether the ID and secret belong together (a made-up code: "invalid_code" means the pair is right)
 async function verify(c){try{const r=await fetchImpl('https://slack.com/api/oauth.v2.user.access',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,code:'aqeelos-check'}).toString(),signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));if(j.error==='invalid_client_id')return 'Slack does not know that Client ID. Copy it again from Basic Information › App Credentials.';
  if(j.error==='bad_client_secret')return 'The Client Secret does not belong to that Client ID. Press Show next to Client Secret and copy it again (not the Signing Secret).';return ''}catch{return ''}}
 async function saveClient(body,agents){const c=parseClient(body);const why=await verify(c);if(why)throw Error(why);
  const old=await readJson(CLIENT);await put(CLIENT,{...c,previous:[...new Set([old?.client_id,...(old?.previous||[])].filter(x=>x&&x!==c.client_id))].slice(0,5),saved_at:new Date(now()).toISOString()});log('slack: app client saved ('+c.client_id.split('.')[0]+'…)');return info(agents)}
 async function removeClient(agents){await unlink(CLIENT).catch(()=>{});log('slack: app client removed');return info(agents)}
 // used by every sign-in (Connections, connect_mcp_tool): a Slack MCP with no client of its own gets this install's app
 async function fallback(block){if(!block||!isSlackUrl(block.url))return null;const c=await client();return c?{id:c.client_id,secret:c.client_secret}:null}
 // Connect Slack for one agent: the Slack MCP is added if missing (with this app), then the sign-in starts
 async function connect(agent){const c=await client();if(!c)throw Error('Slack is not set up on this aqeelOS yet. An admin does it once (step 1).');
  const s=await slackOf(agent),redirect=redirectFor(s.name);
  if(!s.has){const r=await setKey(agent,'mcp_servers.'+s.name,{url:MCP_URL,auth:'oauth',oauth:{client_id:c.client_id,client_secret:c.client_secret,redirect_uri:redirect},enabled:true});
   if(!r?.ok)throw Error('Could not add Slack to this agent ('+String(r?.err||'the engine said no').split('\n').pop()+').');log('slack: added the Slack MCP to '+agent+' as '+s.name);await new Promise(r=>setTimeout(r,2500))}
  else{const pr=await prepareSignin(agent,s.name,redirect,s.own?null:{id:c.client_id,secret:c.client_secret});if(pr?.changed)await new Promise(r=>setTimeout(r,2500))}
  const f=await startSignin(agent,s.name);const url=f.authorization_url||f.auth_url||f.url;
  if(!url)throw Error(f.error||f.detail||'Slack did not give a sign-in page. Try again in a minute.');
  if(!/^https:\/\//i.test(url))throw Error('That sign-in link does not look right, so it was not opened.');
  return {agent,name:s.name,url,flow:f.flow_id||f.id||'',own:s.own}}
 return {info,client,saveClient,removeClient,slackOf,connect,fallback,redirects}}
