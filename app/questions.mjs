// Questions (12 Nov 2026, owner: "when something needs a decision, ask me with a few choices I can tap, don't send me somewhere").
// Anything can file one: the fixer (an issue that needs a choice between approaches), an agent (ask_owner, like file_conflict),
// or the app itself. One plain question, 2-4 options each with a one-line effect, one marked recommended, optionally
// "Something else" with words. It shows as the Bottlenecks kind 'question' (Health › Needs you, the bell, the popup).
// The answer is stored once and handed back to whoever asked: the fixer continues its issue with it (onAnswer), an agent gets it
// in its next turn (contextLines, like conflict answers) until it calls question_done. Same shape as rule-conflicts.mjs
// (file / open / answer / answersFor / ack / contextLines), kept in its own file and store (questions.json).
// Telegram: the app sends owner alerts as plain text (relay.sendAs has no inline buttons), so a question is not sent there.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const clip=(s,n)=>String(s??'').trim().slice(0,n);
// {question, options:[{label,effect,recommended}], allowOther} → the clean one, or throws what is wrong (said to the asker)
export function cleanQuestion(o){const question=clip(o?.question,240);if(!question)throw Error('Say the question in one plain sentence.');
 const raw=Array.isArray(o?.options)?o.options:[];const options=raw.map(x=>({label:clip(x?.label,40),effect:clip(x?.effect,160),recommended:!!x?.recommended})).filter(x=>x.label);
 if(options.length<2)throw Error('Give 2 to 4 options, each with a short label and a one-line effect.');if(options.length>4)options.length=4;
 if(options.some(x=>!x.effect))throw Error('Every option needs a one-line effect: what happens if it is chosen.');
 const rec=options.findIndex(x=>x.recommended);options.forEach((x,i)=>{x.key=String.fromCharCode(97+i);x.recommended=i===rec});
 return {question,options,allowOther:o?.allowOther!==false}}

export function createQuestions({DATA,names=a=>a,now=()=>Date.now(),log=m=>console.log(m),onAnswer=async()=>{}}){
 const FILE=path.join(DATA,'questions.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.items||=[]}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 // asker: {kind:'fixer'|'agent'|'app', agent, issue}. The same open question from the same asker is one (asked once)
 async function file(asker,o){await load();const c=cleanQuestion(o),a=asker||{};
  const have=db.items.find(x=>x.state==='open'&&x.kind===(a.kind||'app')&&(x.agent||'')===(a.agent||'')&&(x.issue||'')===(a.issue||'')&&norm(x.question)===norm(c.question));
  if(have){have.updated=now();have.count=(have.count||1)+1;await save();return have}
  const q={qid:'q'+randomBytes(6).toString('hex'),kind:a.kind||'app',agent:a.agent||'',issue:a.issue||'',...c,state:'open',created:now(),updated:now(),count:1};
  db.items.unshift(q);db.items=db.items.filter(x=>x.state==='open'||now()-(x.answered?.at||0)<30*864e5).slice(0,200);await save();return q}
 // open ones as Bottlenecks items
 async function open(mayUse=()=>true,admin=true){await load();
  return db.items.filter(q=>q.state==='open'&&(admin||q.agent&&mayUse(q.agent))).map(q=>({id:'question|'+q.qid,kind:'question',qid:q.qid,agent:q.agent||undefined,agentName:q.agent?names(q.agent):undefined,title:q.question,text:'',options:q.options,allowOther:q.allowOther,created:q.created,from:null}))}
 const byIssue=async issue=>{await load();return db.items.find(q=>q.issue===issue&&q.state==='open')||null}
 // the answer: a choice's key, or 'other' with words. Once: a second answer is refused
 async function answer(qid,{choice,text}={},by=''){await load();const q=db.items.find(x=>x.qid===qid);if(!q)throw Error('That question is gone.');if(q.state!=='open')throw Error('That one was already answered.');
  let label,effect='';if(choice==='other'){if(!q.allowOther)throw Error('Pick one of the choices.');label=clip(text,400);if(!label)throw Error('Say what should happen instead.')}
  else{const o=q.options.find(x=>x.key===choice);if(!o)throw Error('Pick one of the choices.');label=o.label;effect=o.effect}
  q.state='answered';q.answered={choice,text:label,effect,by:clip(by,80),at:now()};q.acked=q.kind!=='agent';await save();log('question '+qid+' answered by '+by+': '+label);
  try{await onAnswer(q)}catch(e){log('question '+qid+': hand-back failed: '+e.message)}return q}
 async function answersFor(agent){await load();return db.items.filter(q=>q.kind==='agent'&&q.agent===agent&&q.state==='answered'&&!q.acked)}
 async function ack(agent,qid){await load();const q=db.items.find(x=>x.qid===qid&&x.agent===agent&&x.state==='answered');if(!q)throw Error('No such answered question.');q.acked=true;await save();return q}
 async function mine(agent){await load();return db.items.filter(q=>q.kind==='agent'&&q.agent===agent).slice(0,20)}
 // the lines added to the agent's turn only when it has an answer it has not used yet
 async function contextLines(agent){const l=await answersFor(agent).catch(()=>[]);if(!l.length)return [];
  return ['','## Answers to your questions','',...l.map(q=>'- "'+q.question+'": the owner chose "'+q.answered.text+'"'+(q.answered.effect?' ('+q.answered.effect+')':'')+' (question '+q.qid+'). Carry on with it, then call question_done with '+q.qid+'.')]}
 return {file,open,answer,answersFor,ack,mine,contextLines,byIssue,list:async()=>(await load()).items}}
