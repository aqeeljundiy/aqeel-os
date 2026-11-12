// Editing an app (MCP server) that is already added (7 Nov 2026): its address, how it signs in and its key, or its
// command, arguments and settings. The engine's dashboard API only switches one on or off, so aqeelOS writes the
// server's entry in the agent's config.yaml (hermes config set) and its key in the agent's .env, the way the engine
// itself does: the key is MCP_<NAME>_API_KEY and the header is "Authorization: Bearer ${MCP_<NAME>_API_KEY}".
// Keys: every MCP_*_API_KEY of an agent is listed with what reads it. A key nothing reads is flagged, with why: the app
// signs in with the service instead (Notion), the app is gone, or the app does not use that key.

// the engine's own name for a server's key (hermes_cli/mcp_config.py _env_key_for_server)
export const keyFor=name=>'MCP_'+String(name).toUpperCase().replace(/[^A-Z0-9_]/g,'_').replace(/^_+|_+$/g,'')+'_API_KEY';
const KEY_RE=/^MCP_[A-Z0-9_]+_API_KEY$/;
const nice=n=>String(n).charAt(0).toUpperCase()+String(n).slice(1);
export const stripBearer=t=>String(t||'').trim().replace(/^bearer\s+/i,'').trim();
// the names of keys a server entry reads (${NAME} in its headers, url, args or env)
export function reads(entry){const s=JSON.stringify(entry||{});return [...new Set([...s.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(m=>m[1]))]}
export function authOf(entry){const h=entry?.headers||{};const a=Object.entries(h).find(([k])=>k.toLowerCase()==='authorization');if(a&&/^bearer\s/i.test(String(a[1])))return 'header';return entry?.auth==='oauth'?'oauth':'none'}
// the edit applied to a copy of the entry; throws a plain sentence when something is missing
export function edited(entry,b,{hasKey=false}={}){const e=structuredClone(entry||{}),name=b.name;
 if(e.url||b.url){if(b.url!=null){const u=String(b.url).trim();if(!/^https?:\/\/\S+$/i.test(u))throw Error('Type the address, starting with https://');e.url=u}
  const auth=b.auth||authOf(e);const h={...(e.headers||{})};for(const k of Object.keys(h))if(k.toLowerCase()==='authorization')delete h[k];delete e.auth;
  if(auth==='header'){if(!stripBearer(b.token)&&!hasKey)throw Error('Paste the key, or pick another way to sign in.');h.Authorization='Bearer ${'+keyFor(name)+'}'}
  else if(auth==='oauth')e.auth='oauth';
  if(Object.keys(h).length)e.headers=h;else delete e.headers}
 else{if(b.command!=null){const c=String(b.command).trim();if(!c)throw Error('Type the command that starts it, for example npx.');e.command=c}
  if(b.args!=null)e.args=(Array.isArray(b.args)?b.args:String(b.args).split(/\s+/)).map(String).filter(Boolean);
  if(b.env!=null){const env={};for(const [k,v] of Object.entries(b.env)){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))throw Error(k+' is not a setting name (letters, digits and _).');env[k]=String(v)}if(Object.keys(env).length)e.env=env;else delete e.env}}
 return e}
const envKeys=text=>String(text||'').split('\n').map(l=>/^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(m=>m&&KEY_RE.test(m[1])&&m[2].trim()).map(m=>m[1]);

export function createMcpEdit({readConfig,setKey,readEnv,editEnv,restart=()=>{},log=()=>{}}){
 const servers=async a=>(await readConfig(a).catch(()=>null))?.mcp_servers||{};
 // the server as the dialog shows it: never a key's value, only whether one is saved
 // aqeelOS's own tools (aqeelos-*) carry the agent's signature in their address: shown and changed by admins only
 const OWN=/^aqeelos-/;
 async function get(agent,name,{own=true}={}){const s0=(await servers(agent))[name];if(!s0)throw Object.assign(Error('That app is not on this agent any more. Reload the page.'),{status:404});const s=OWN.test(name)&&!own?{...s0,url:s0.url?'(aqeelOS\'s own tool)':s0.url,headers:undefined}:s0;
  const have=envKeys(await readEnv(agent));const k=keyFor(name);
  return {name,kind:s.url?'url':'command',url:s.url||'',auth:authOf(s),command:s.command||'',args:s.args||[],env:Object.fromEntries(Object.entries(s.env||{}).map(([x,v])=>[x,/^\$\{/.test(String(v))?String(v):''])),envSet:Object.keys(s.env||{}),
   key:k,hasKey:have.includes(k),reads:reads(s)}}
 async function save(agent,b,{mayRunCode=true,own=true,privateAddress=null,runsCodeMsg='Apps started by a command run code on the server: only for people allowed the terminal, file and code tools.'}={}){const name=String(b.name||'');const s=(await servers(agent))[name];if(!s)throw Object.assign(Error('That app is not on this agent any more. Reload the page.'),{status:404});
  const no=m=>Object.assign(Error(m),{status:403});
  if(OWN.test(name)&&!own)throw no('That is aqeelOS\'s own tool: only an admin changes it.');
  // an app started by a command runs as the server's own user: its command, arguments and settings are code
  if(!mayRunCode&&(!s.url||b.command!=null||b.args!=null||b.env!=null))throw no(runsCodeMsg);
  if(b.url!=null){if(/\$\{/.test(String(b.url)))throw Object.assign(Error('An address cannot contain ${...}.'),{status:400});if(privateAddress&&await privateAddress(String(b.url).trim()))throw no('Tools must use a public web address.')}
  const k=keyFor(name),hasKey=envKeys(await readEnv(agent)).includes(k);
  // settings left blank keep their saved value (the dialog never shows them)
  if(b.env&&s.env)for(const [x,v] of Object.entries(b.env))if(v===''&&x in s.env)b.env[x]=s.env[x];
  const e=edited(s,{...b,name},{hasKey});const tok=stripBearer(b.token);
  if(tok&&authOf(e)==='header'){if(/\s/.test(tok))throw Object.assign(Error('A key has no spaces. Paste only the key.'),{status:400});await editEnv(agent,cur=>[...cur.split('\n').filter(l=>!l.startsWith(k+'=')&&l!==''),k+'='+tok,''].join('\n'))}
  if(JSON.stringify(e)!==JSON.stringify(s)){const r=await setKey(agent,'mcp_servers.'+name,e);if(!r.ok)throw Error(r.err||'Could not save it.')}
  log('mcp: '+name+' changed on '+agent+(tok?' (new key)':''));restart('app '+name+' changed');return get(agent,name,{own})}
 // every MCP key of an agent, with whether something reads it and, if not, why
 async function keys(agent){const sv=await servers(agent),have=envKeys(await readEnv(agent));const used=new Set(Object.values(sv).flatMap(reads));
  return have.map(k=>{if(used.has(k))return {key:k,used:true,server:Object.keys(sv).find(n=>reads(sv[n]).includes(k))};
   const n=Object.keys(sv).find(x=>keyFor(x)===k);const s=n&&sv[n];
   if(s&&authOf(s)==='oauth')return {key:k,used:false,server:n,why:'oauth',text:nice(n)+' signs in with your account, so this key is not used. Open '+nice(n)+' and press Sign in, then remove the key.'};
   if(s)return {key:k,used:false,server:n,why:'notused',text:nice(n)+' does not use this key. Use Edit on '+nice(n)+' and pick Key to use it, or remove it.'};
   return {key:k,used:false,server:null,why:'gone',text:'No app on this agent uses this key any more. Remove it.'}})}
 async function removeKey(agent,k){if(!KEY_RE.test(k))throw Object.assign(Error('Only an app key (MCP_…_API_KEY) can be removed here.'),{status:400});
  if((await keys(agent)).find(x=>x.key===k)?.used)throw Object.assign(Error('An app still uses this key. Change that app first.'),{status:409});
  await editEnv(agent,cur=>cur.split('\n').filter(l=>!l.startsWith(k+'=')).join('\n'));log('mcp: key '+k+' removed from '+agent);return {ok:true}}
 return {get,save,keys,removeKey}}
