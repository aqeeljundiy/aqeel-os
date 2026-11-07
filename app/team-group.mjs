// Team group (owner's brief item 8, 5 Nov 2026): per agent, the Telegram group and topics its team works in. One home
// for it: DATA/team-groups.json. Agents read it from the system (the aqeelOS block in their AGENTS.md and the
// team_group tool), never from their prompt, and change it with that tool when the owner says so in chat; each change
// is shown in the bell. Kirimdev handoffs and drafts go to its Questions topic.
//   { "<agent>": { name, chatId, topics: { questions, orders, log, own }, mention, at, by } }
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export const ROLES=[['questions','Questions','questions it cannot answer, handoffs and drafts to approve'],['orders','Orders','every new order'],['log','Log','what it did (sends, changes)'],['own','Own topic','where it talks with the team and takes instructions']];
const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const topicOf=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(String(v).trim());if(!Number.isInteger(n)||n<1||n>1e9)throw Error('A topic is the topic number (message_thread_id), e.g. 3.');return n};

// what the person or the agent sent, made safe and complete; fields left out keep their value
export function cleanGroup(cur,patch){const g={name:'',chatId:null,topics:{},mention:'',...(cur||{})};g.topics={...(g.topics||{})};const p=patch||{};
 if('name' in p)g.name=String(p.name||'').trim().slice(0,80);
 if('chatId' in p){const s=String(p.chatId??'').trim();if(s&&!/^-?\d{5,16}$/.test(s))throw Error('The group id is a number like -1001234567890.');g.chatId=s?Number(s):null}
 for(const [k] of ROLES){if(p.topics&&k in p.topics)g.topics[k]=topicOf(p.topics[k]);if(k in p)g.topics[k]=topicOf(p[k])}
 if('mention' in p)g.mention=String(p.mention||'').trim().slice(0,200);
 for(const k of Object.keys(g.topics))if(!ROLES.some(r=>r[0]===k))delete g.topics[k];
 return g}

// the lines agents read, in their AGENTS.md
export function contextLines(g){if(!g?.chatId)return ['No team group is set for you yet. When the owner names one, save it with the team_group tool (from aqeelos-notify).'];
 return ['Your team works in the Telegram group '+(g.name?'"'+g.name+'" ':'')+'(chat id '+g.chatId+'). Use these topics, and only these:',
  ...ROLES.map(([k,l,what])=>'- '+l+': '+(g.topics?.[k]?'topic '+g.topics[k]:'not set')+' ('+what+')'),
  ...(g.mention?['- When you need a person there, mention '+g.mention+'.']:[]),
  'This comes from aqeelOS (Channels page, Team group), not from your prompt: when an older note, memory or decision names another group or topic, this one wins. When the owner tells you in chat to use another group or topic, change it with the team_group tool, then use the new one.']}

export function createTeamGroups({DATA,tell=async()=>{}}){const F=path.join(DATA,'team-groups.json');
 const all=async()=>{try{return JSON.parse(await readFile(F,'utf8'))}catch{return {}}};
 const get=async a=>AGENT.test(a)?(await all())[a]||null:null;
 let chain=Promise.resolve();
 // by: who changed it (a person's name, or "<agent> (asked in chat)")
 function set(a,patch,by){if(!AGENT.test(a))return Promise.reject(Error('Unknown agent.'));const p=chain.then(async()=>{const db=await all();const before=db[a]||null;
  const g=cleanGroup(before,patch);g.at=Date.now();g.by=String(by||'').slice(0,80);db[a]=g;await mkdir(DATA,{recursive:true});
  const t=F+'.'+randomUUID().slice(0,8)+'.tmp';await writeFile(t,JSON.stringify(db,null,1),{mode:0o644});await rename(t,F);
  await tell(a,before,g).catch(()=>{});return g});chain=p.catch(()=>{});return p}
 return {all,get,set}}
