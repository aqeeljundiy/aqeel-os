// Quiet Slack channels, per Slack workspace (7 Nov 2026, the owner: "this rule is only for pixelandprofits Slack").
// Each workspace (Slack team id) has its own prefix, empty by default: an agent's Slack bot stays silent in channels of
// ITS workspace whose name starts with that prefix, and answers normally everywhere else, other workspaces included.
// Kept in DATA/slack-quiet.json as {v:2, teams:{<team id>:{prefix,name}}, was:<the old prefix for every workspace>}.
// The engine is told through each agent's SLACK_IGNORED_CHANNELS (channel ids, unique to a workspace).
import {readFile,writeFile,rename,copyFile} from 'node:fs/promises';
import path from 'node:path';

export const TEAM=/^[TE][A-Z0-9]{4,20}$/;
export const cleanPrefix=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,21);

/* The one-time move from the old setting (one prefix for every workspace). When the install has a single Slack workspace,
   it keeps the old prefix there; with several, nobody can say which one meant it, so all start empty (logged) and the
   owner sets each one. The old file is copied to slack-quiet.json.bak-<time> first. */
export function migrate(old,teams,log=()=>{}){const was=old&&typeof old.prefix==='string'?cleanPrefix(old.prefix):'';const ids=[...new Map(teams.map(t=>[t.id,t])).values()];
 const out={v:2,teams:{},was};if(was&&ids.length===1)out.teams[ids[0].id]={prefix:was,name:ids[0].name||''};
 else if(was&&ids.length>1)log('slack quiet: '+ids.length+' workspaces and one old prefix ('+was+'); each workspace starts with none, set it per workspace under Channels');
 return out}

/* What an agent's quiet list becomes: channels of its workspace that start with the prefix are added; ones that started with
   the prefix used before (and not with the new one) are taken off. Channels put there some other way stay. */
export function plan({have,channels,pre,oldPre}){const by=new Map(channels.map(c=>[c.id,String(c.name||'')]));const starts=(n,p)=>!!p&&n.startsWith(p);
 const remove=[...have].filter(id=>by.has(id)&&starts(by.get(id),oldPre)&&!starts(by.get(id),pre));
 const add=channels.filter(c=>starts(String(c.name||''),pre)&&!have.has(c.id)).map(c=>c.id);
 const next=[...[...have].filter(id=>!remove.includes(id)),...add];return {add,remove,next}}

export function createSlackQuiet({DATA,teamsNow,legacy=async()=>'',log=console.log}){
 const F=path.join(DATA,'slack-quiet.json');let db=null,backedUp=false;
 const save=async()=>{await writeFile(F+'.tmp',JSON.stringify(db,null,1));await rename(F+'.tmp',F)};
 async function load(){if(db)return db;let j=null;try{j=JSON.parse(await readFile(F,'utf8'))}catch{}
  if(j?.v===2){db={teams:{},...j};return db}
  if(j&&!backedUp){backedUp=true;await copyFile(F,F+'.bak-'+Date.now()).catch(()=>{})}else if(!j){const l=await legacy().catch(()=>'');if(l)j={prefix:l}}   // no file yet: agents that kept ext- quiet before count as that choice
  const teams=j?await teamsNow().catch(()=>[]):[];
  // an old prefix but no workspace answered (Slack down, a network blip): nothing is moved or changed yet; asked again next time
  if(j?.prefix&&!teams.length){log('slack quiet: no Slack workspace answered; the move waits');return {pending:true,teams:{},was:''}}
  db=migrate(j,teams,log);await save().catch(()=>{});if(j)log('slack quiet: moved to per workspace',JSON.stringify(db.teams));return db}
 const prefixOf=async team=>(await load()).teams[team]?.prefix||'';
 async function set(team,prefix,name){if(!TEAM.test(String(team||'')))throw Error('Unknown Slack workspace.');if((await load()).pending)throw Error('Slack is not answering right now. Try again in a minute.');const p=cleanPrefix(prefix);
  db.teams[team]={prefix:p,name:String(name||db.teams[team]?.name||'').slice(0,80)};await save();return db.teams[team]}
 return {load,prefixOf,set,get:async()=>(await load()).teams,was:async()=>(await load()).was||''}}
export {plan as slackQuietPlan};
