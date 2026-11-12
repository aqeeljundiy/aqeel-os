// Keeps every copy of the engine plugins this repo ships (engine/<name>/) the shipped version: the engine home and each agent's own copy.
// The work is app/plugin-sync.mjs (what it compares, what it never touches, the one backup, writing as the agent's own user); the app runs
// the same pass by itself. This is the same pass for a deploy (scripts/box-live.sh, once the new version passed its live test) and for the
// installer (scripts/install.sh, instead of its old "already there").
//   node scripts/plugin-sync.mjs                 update every copy that differs; a home without a plugin does not get it
//   node scripts/plugin-sync.mjs --check         change nothing; list the copies that differ (exit 1 when there are any)
//   node scripts/plugin-sync.mjs --ensure <name> also put that plugin into the engine home when it is not there yet (the installer)
// Env: HERMES_HOME (default ~/.hermes), UI_DATA_DIR (default the hermes-ui-data folder beside the app). It never fails a deploy: a copy it
// could not write is printed with the reason, and System › Health lists it until it is the shipped version.
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createPluginSync} from '../app/plugin-sync.mjs';import {DATA_DIR} from '../app/install.mjs';import {readConfig,pick} from '../app/agentops.mjs';
const arg=process.argv.slice(2),check=arg.includes('--check'),add={};
for(let i=0;i<arg.length;i++)if(arg[i]==='--ensure'&&arg[i+1])(add.default||=[]).push(arg[++i]);
const ps=createPluginSync({DATA:DATA_DIR,engineDir:path.join(path.dirname(fileURLToPath(import.meta.url)),'..','engine'),readConfig,pick});
const r=await ps.sync({add,check});
const n=k=>r.copies.filter(c=>c.status===k).length;
for(const c of r.copies)if(c.status!=='same')console.log((c.status==='differs'?'! ':'· ')+'plugin '+c.plugin+' of '+c.agent+': '+(c.status==='differs'?'differs from the shipped version ('+c.reason+'): ':c.status+' to '+(c.version||c.hash)+': ')+c.files.slice(0,4).join(', ')+(c.files.length>4?' and '+(c.files.length-4)+' more':''));
console.log('· engine plugins: '+r.copies.length+' copies, '+n('same')+' already the shipped version'+(n('updated')?', '+n('updated')+' updated (the engine loads them at its next restart; System › Health › Per agent shows it)':'')+(n('added')?', '+n('added')+' added':'')+(n('differs')?', '+n('differs')+' still differ':''));
if(check&&r.differs.length)process.exit(1);
