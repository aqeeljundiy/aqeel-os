// Skill check (6 Nov 2026): skills that point to files that are not there. A skill that says "read references/x.md" or
// "run python3 ~/.hermes/scripts/y.py" while that file is gone fails the agent halfway through the job, silently.
// Only what a skill depends on is checked, not example paths in its text:
//   - its own files: references/…, templates/…, assets/… (and relative markdown links) next to its SKILL.md;
//   - absolute scripts it tells the agent to run (python3/bash/sh/node <path>), outside scratch and /tmp.
// Each problem is shown on System › Health under the agent that has the skill (agent-health.mjs).
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';

const OWN=/(?<![\w/.~-])((?:references|templates|assets)\/[\w.\-/]+\.\w+)/g;
const LINK=/\]\((?!https?:|mailto:|#|\/|~)([^)\s]+\.\w+)\)/g;
const RUN=/(?:python3?|bash|sh|node)\s+(?:-\S+\s+)*((?:~|\/home\/[\w.-]+)\/[\w.\-/]+\.(?:py|sh|mjs|js))/g;
// the files one skill text depends on: {own:[relative], run:[absolute, ~ kept]}
export function skillRefs(text){const t=String(text||''),own=new Set(),run=new Set();
 for(const re of [OWN,LINK])for(const m of t.matchAll(re))if(!/[<>*$]/.test(m[1]))own.add(m[1].replace(/^\.\//,''));
 for(const m of t.matchAll(RUN))if(!/[<>*$]/.test(m[1])&&!/\/(cache\/scratch|tmp)\//.test(m[1]))run.add(m[1]);
 return {own:[...own],run:[...run]}}

// every SKILL.md under a skills folder (symlinked folders followed once)
async function skillFiles(root,depth=0,out=[]){if(depth>5)return out;const ents=await readdir(root,{withFileTypes:true}).catch(()=>[]);
 for(const e of ents){if(e.name.startsWith('.'))continue;const p=path.join(root,e.name);
  if(e.name==='SKILL.md')out.push(p);else if(e.isDirectory()||e.isSymbolicLink()&&(await stat(p).catch(()=>null))?.isDirectory())await skillFiles(p,depth+1,out)}return out}

// one agent's skills with missing files: [{skill, missing:[path]}]
export async function checkSkills(skillsDir,{home}){const out=[],exists=p=>stat(p).then(()=>true,()=>false);
 for(const f of await skillFiles(skillsDir)){const text=await readFile(f,'utf8').catch(()=>null);if(text==null)continue;
  const dir=path.dirname(f),{own,run}=skillRefs(text),missing=[];
  for(const r of own)if(!await exists(path.join(dir,r)))missing.push(r);
  for(const r of run)if(!await exists(r.replace(/^~/,home)))missing.push(r);
  if(missing.length)out.push({skill:path.relative(skillsDir,dir),missing})}
 return out}
