// Which skills reach which agents (decided 24 Oct 2026). Every skill the main agent has goes to every agent, except the
// ones listed here: those go only to the agents named (the main agent and its extra numbers always keep everything).
// Skills are instructions only; the owner's signed-in accounts are never handed out by any of this.
import {mkdir,rename,access,readdir} from 'node:fs/promises';
import path from 'node:path';

const CONTINUE=['default','cont-socmed'];                 // Continue's social media: only that agent (nothing Continue-related reaches PixelAgent)
const APPLE=['default','pixel-agent','husband-mode'];     // iMessage / Notes / Reminders
export const RESTRICTED={
 // the owner's own life and money
 'productivity/process-aqeel-statements':['default'],
 'productivity/aqeel-google-automations':['default'],
 'productivity/aqeel-task-hub':['default'],
 'productivity/teams-meeting-pipeline':['default'],
 // the main agent's coding / deployment work
 'software-development/admissionsight-dev':['default'],
 'devops/dokploy-previews':['default'],
 'devops/sdlc-review':['default'],
 // Continue social media
 'creative/continue-longevity-brand':CONTINUE,
 'creative/design-style-v1':CONTINUE,
 'creative/social-post-graphics':CONTINUE,
 'social-media/tiktok-content-posting':CONTINUE,
 'social-media/xurl':CONTINUE,
 // Pixel & Profits
 'pixel/pixel-ops':['default','pixel-agent'],
 // Apple apps
 'apple/apple-notes':APPLE,'apple/apple-reminders':APPLE,'apple/imessage':APPLE,
};
// removed for every agent, the main one too
export const REMOVED=['apple/findmy'];

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
