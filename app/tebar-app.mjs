// Tebar in the catalog (owner, 11 Nov 2026: "learn all its features and documentation, we want this in our OS").
// Tebar (tebar.app) is an Indonesian social media scheduler: Threads, Instagram, Facebook Page, TikTok, YouTube,
// LinkedIn, X, Telegram, Discord and Pinterest, with a comments inbox, Instagram DMs and automations, insights, a media
// library, ideas, short links and profiles. Its MCP server answers the MCP sign-in discovery (checked 11 Nov 2026:
// /.well-known/oauth-protected-resource names https://api.tebar.app, scopes read and write), so one click signs in.
// The second entry is the same server with a pasted API key (tb_live_..., read-only or read-write) for people who
// would rather not sign in. API and MCP need a paid Tebar plan (Starter and up, or the 14-day Pro trial).
//
// This is a data block on its own so the catalog file can take it as is. The entries use the shape of APPS in
// app/app-catalog.mjs (branch w-catalog): when that lands, import TEBAR_APPS there and add ...TEBAR_APPS to APPS, then
// drop the withTebar() line in server.mjs (/hapi/mcp/catalog), since merge() there does the same.
export const TEBAR_MCP='https://api.tebar.app/mcp';
export const TEBAR_APPS=[
 {name:'tebar',title:'Tebar',description:'Schedule and publish posts to Threads, Instagram, Facebook, TikTok, YouTube, LinkedIn, X, Telegram, Discord and Pinterest; comments, Instagram DMs, insights.',
  url:TEBAR_MCP,auth:'oauth',domain:'tebar.app',docs:'https://docs.tebar.app/tools',plan:'Needs a paid Tebar plan (Starter and up) or the 14-day Pro trial'},
 {name:'tebar-key',title:'Tebar (API key)',description:'Tebar with a pasted API key instead of signing in. A read-only key gives only the read tools.',
  url:TEBAR_MCP,auth:'key',domain:'tebar.app',docs:'https://docs.tebar.app/api',plan:'Make the key in the Tebar dashboard (paid plan); read-only or read-write',
  key:{name:'TEBAR_API_KEY',prompt:'Tebar API key (starts with tb_live_)',help:'https://docs.tebar.app/api'}}];

// in the shape the engine's catalog answer uses (the same as toEntry() in app/app-catalog.mjs)
export function tebarEntry(a){return {name:a.name,title:a.title,description:a.description,url:a.url,transport:'http',auth_type:a.auth==='key'?'api_key':'oauth',source:a.docs,logo_domain:a.domain,
 required_env:a.key?[{name:a.key.name,prompt:a.key.prompt,required:true,secret:true,help:a.key.help}]:[],plan:a.plan,native:true,installed:false,enabled:false}}

// is this app config Tebar's server (by its address, whatever it was named)
export const isTebar=s=>{try{return new URL(String(s?.url||'')).hostname==='api.tebar.app'}catch{return false}};

// the engine's catalog answer with the Tebar entries first; both show Added once the agent has any Tebar server
export function withTebar(d,config){const eng=Array.isArray(d?.entries)?d.entries:[],names=new Set(TEBAR_APPS.map(a=>a.name));
 const mine=Object.entries(config?.mcp_servers||{}),has=mine.some(([n,s])=>names.has(n)||isTebar(s)),on=mine.some(([n,s])=>(names.has(n)||isTebar(s))&&s?.enabled!==false);
 return {...(d||{}),entries:[...TEBAR_APPS.map(a=>({...tebarEntry(a),installed:has,enabled:on})),...eng.filter(e=>!names.has(e?.name))]}}
