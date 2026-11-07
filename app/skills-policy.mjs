// Which skills reach which agents (decided 24 Oct 2026). Every skill the main agent has goes to every agent, except the
// ones listed here: those go only to the agents named (the main agent and its extra numbers always keep everything).
// Skills are instructions only; the owner's signed-in accounts are never handed out by any of this.
import {mkdir,rename,access,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

// The list is this box's own data, not code (7 Nov 2026, open source): DATA/skills-policy.json, or the file named by
// AQEELOS_SKILLS_POLICY. {"restricted":{"<category>/<skill>":["agent", ...]}, "removed":["<category>/<skill>"]}.
// No file = every skill goes to every agent. Read again when the file changes (checked at most every 30 seconds).
import {readFileSync,statSync} from 'node:fs';
const policyFile=()=>process.env.AQEELOS_SKILLS_POLICY||path.join(path.resolve(process.env.UI_DATA_DIR||path.join(path.dirname(new URL(import.meta.url).pathname),'..','..','hermes-ui-data')),'skills-policy.json');
let pol={restricted:{},removed:[]},polAt=0,polM=-1;
function policy(){const now=Date.now();if(now-polAt<30e3)return pol;polAt=now;let m=-2;const POLICY_FILE=policyFile();try{m=statSync(POLICY_FILE).mtimeMs}catch{}
 if(m!==polM){polM=m;try{const j=m<0?{}:JSON.parse(readFileSync(POLICY_FILE,'utf8'));pol={restricted:j.restricted&&typeof j.restricted==='object'?j.restricted:{},removed:Array.isArray(j.removed)?j.removed.map(String):[]}}catch(e){console.warn('skills policy: '+POLICY_FILE+' is not readable JSON; nothing restricted',e.message);pol={restricted:{},removed:[]}}}
 return pol}
export const RESTRICTED=new Proxy({},{get:(_,k)=>policy().restricted[k],ownKeys:()=>Reflect.ownKeys(policy().restricted),getOwnPropertyDescriptor:(_,k)=>k in policy().restricted?{enumerable:true,configurable:true,value:policy().restricted[k]}:undefined,has:(_,k)=>k in policy().restricted});
export const REMOVED={some:f=>policy().removed.some(f)};

// Abilities › Skills › "Only these agents" (admins): one skill's rule, written to the policy file and read at once.
// agents: a list of agent names (the main agent is always added), or null for every agent.
export async function setRule(key,agents){key=String(key||'').trim();if(!/^\w[\w.-]*(\/\w[\w.-]*)?$/.test(key))throw Error('Unknown skill.');
 const f=policyFile();let j={};try{j=JSON.parse(readFileSync(f,'utf8'))}catch(e){if(e.code!=='ENOENT')throw Error('The skills policy file could not be read, so nothing was changed.')}
 j.restricted=j.restricted&&typeof j.restricted==='object'?j.restricted:{};
 // a rule set before under another category for the same skill name is replaced, not kept beside it
 for(const k of Object.keys(j.restricted))if(nameOf(k)===nameOf(key))delete j.restricted[k];
 if(Array.isArray(agents))j.restricted[key]=[...new Set(['default',...agents.map(baseOf).filter(a=>/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(a))])].sort();
 await mkdir(path.dirname(f),{recursive:true});await writeFile(f+'.tmp',JSON.stringify(j,null,1));await rename(f+'.tmp',f);polAt=0;polM=-1;return policy()}
export const rules=()=>({restricted:{...policy().restricted},removed:[...policy().removed]});
export const baseOf=a=>String(a).split('--')[0];   // an extra number ("default--whatsapp-2") is the same agent
// a rule matches the skill's own name too, so a copy in another category is still covered (not a renamed copy: share.mjs refuses those)
const nameOf=k=>String(k).split('/').pop();
const ruleFor=key=>RESTRICTED[key]||Object.entries(RESTRICTED).find(([k])=>nameOf(k)===nameOf(key))?.[1];
export const removedKey=key=>REMOVED.some(k=>k===key||nameOf(k)===nameOf(key));
export const restricted=key=>removedKey(key)||!!ruleFor(key);
export const allowed=(key,agent)=>{if(removedKey(key))return false;const r=ruleFor(key);return !r||r.includes(baseOf(agent))};
export const allowedNames=key=>ruleFor(key)||[];

// Moves the skills this agent must not have out of its skills folder into backupDir (nothing is deleted); returns what moved.
// Every skill in the folder is checked (<category>/<skill>, or a skill right at the top), not only the listed keys, so a
// copy under another category or one installed from the hub is caught by its name too.
export async function trim(skillsDir,agent,backupDir){const moved=[],keys=[];
 const isSkill=d=>access(path.join(d,'SKILL.md')).then(()=>true,()=>false);
 for(const e of await readdir(skillsDir,{withFileTypes:true}).catch(()=>[])){if(!e.isDirectory()||e.name.startsWith('.'))continue;const d=path.join(skillsDir,e.name);
  if(await isSkill(d)){keys.push(e.name);continue}
  for(const f of await readdir(d,{withFileTypes:true}).catch(()=>[]))if(f.isDirectory()&&!f.name.startsWith('.'))keys.push(e.name+'/'+f.name)}
 for(const key of keys){if(allowed(key,agent))continue;
  const src=path.join(skillsDir,key);
  let dst=path.join(backupDir,key);if(await access(dst).then(()=>true,()=>false))dst+='-'+Date.now();
  await mkdir(path.dirname(dst),{recursive:true});await rename(src,dst);moved.push(key)}
 return moved}
