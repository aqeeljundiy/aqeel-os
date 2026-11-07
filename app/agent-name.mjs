// An agent as people read it (7 Nov 2026, owner: "use the formal names not this"): its display name, never its profile
// id; "default" is the main agent, never "aqeelOS"; an extra number says which one ("Dora AI · WhatsApp 2").
// The browser has the same rule in core.js (agentLabel); scripts/agent-name.test.mjs checks both.
const PF={whatsapp:'WhatsApp',telegram:'Telegram',slack:'Slack',discord:'Discord',signal:'Signal'};
export const prettyId=p=>String(p||'').split(/[-_]+/).filter(Boolean).map((w,i)=>i?w:w[0].toUpperCase()+w.slice(1)).join(' ');
export function agentNameFrom(names){return a=>{a=String(a||'');if(!a)return '';if(a==='aqeelOS')a='default';const [b,extra]=a.split('--');
 const n=String(names[b]||'').trim()||(b==='default'?'Main agent':prettyId(b));
 if(!extra)return n;const m=/^([a-z]+)-(\d+)$/i.exec(extra);return n+' · '+(m?(PF[m[1].toLowerCase()]||prettyId(m[1]))+' '+m[2]:prettyId(extra))}}
