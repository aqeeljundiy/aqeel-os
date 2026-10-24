// Which skills reach which agents (decided 24 Oct 2026). Every skill the main agent has goes to every agent, except the
// ones listed here: those go only to the agents named (the main agent and its extra numbers always keep everything).
// Skills are instructions only; the owner's signed-in accounts are never handed out by any of this.
import {mkdir,rename,access} from 'node:fs/promises';
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
export const allowed=(key,agent)=>{if(REMOVED.includes(key))return false;const r=RESTRICTED[key];return !r||r.includes(baseOf(agent))};

// Moves the skills this agent must not have out of its skills folder into backupDir (nothing is deleted); returns what moved.
export async function trim(skillsDir,agent,backupDir){const moved=[];
 for(const key of [...REMOVED,...Object.keys(RESTRICTED)]){if(allowed(key,agent))continue;
  const src=path.join(skillsDir,key);if(await access(src).then(()=>false,()=>true))continue;
  let dst=path.join(backupDir,key);if(await access(dst).then(()=>true,()=>false))dst+='-'+Date.now();
  await mkdir(path.dirname(dst),{recursive:true});await rename(src,dst);moved.push(key)}
 return moved}
