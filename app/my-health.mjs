// Health for an agent's owner (roles design RO-4, 19 Nov 2026): the agents they own or edit, each with its status and problems
// (the same rows System › Health shows admins), and the Fixer's items about those agents with their state, so a person who runs
// an agent sees what is wrong with it and what waits on them, without the install's own health. Never the main agent.
const ENDED=['fixed','declined','gone','closed','expired'],WEEK=7*864e5;
const STATE={queued:'In the Fixer\'s line',fixing:'Being fixed',applying:'Being fixed',verify:'Fixed, being checked',verifying:'Fixed, being checked',
 rollback:'Fix undone, trying again','reloaded-back':'Fix undone, trying again',needs_human:'Needs a person',stuck:'Stuck',stopped:'Stopped',open:'Open',
 deploy:'Waiting to go live',cloud:'Being fixed',cloud_wait:'In the Fixer\'s line',fixed:'Fixed',declined:'Declined',gone:'Gone by itself',closed:'Closed',expired:'Expired'};
export const stateText=s=>STATE[s]||String(s||'').replace(/_/g,' ');
export function mineView({view,issues=[],mayEdit,now=Date.now()}){
 const ok=a=>!!a&&a!=='default'&&mayEdit(String(a).split('--')[0]);
 const agents=(view?.agents||[]).filter(r=>ok(r.agent));
 const fixer=issues.filter(i=>!i.mergedInto&&!i.dupOf&&(ok(i.agent)||(i.affects||[]).some(ok))&&(!ENDED.includes(i.state)||now-(i.updated||i.created||0)<WEEK))
  .sort((a,b)=>ENDED.includes(a.state)-ENDED.includes(b.state)||(b.updated||b.created||0)-(a.updated||a.created||0)).slice(0,40)
  .map(i=>({id:i.id,agent:i.agent,agentName:i.agentName||i.agent,title:i.title||String(i.missing||'').slice(0,140),state:i.state,stateText:stateText(i.state),
   ended:ENDED.includes(i.state),needsYou:i.state==='needs_human'||i.state==='stuck'&&!!i.need,need:i.need||null,updated:i.updated||i.created||0}));
 return {agents,fixer,at:view?.at||now}}
