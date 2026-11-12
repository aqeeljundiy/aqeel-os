// Agents' instructions (SOUL.md) with a history (owner brief item 11, 5 Nov 2026).
// The problem it fixes: rules were appended as "override" sections on top of each other, the same decision sat in a
// decisions file, a sheet and the instructions, and memory once disagreed with them. Now:
//   - every change to an agent's instructions is a version: who made it (a person in aqeelOS, the agent itself through
//     change_instructions, or something on the box that wrote the file directly), when, why and in whose words; any
//     version can be brought back. Old SOUL.md.bak-* files become the first versions.
//   - the agent changes a rule where it is written (change_instructions: exact old text -> new text, or a rewrite). Every
//     change applies at once and can be undone; nobody approves it (owner, 7 Nov 2026).
//   - contradictions are flagged: "override" sections stacked on each other, and (checked by the engine's small helper
//     model, quotes verified against the text) one rule with two values across the instructions and memory.
// The history with its reasons is each agent's decisions log: one place, visible in Agents › Edit agent › History.
import {writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename,readdir,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';


export function lineDiff(a,b){
 const A=String(a).split('\n'),B=String(b).split('\n');
 // trim the shared head and tail, LCS on the middle (instructions are a few hundred lines)
 let s=0;while(s<A.length&&s<B.length&&A[s]===B[s])s++;
 let e=0;while(e<A.length-s&&e<B.length-s&&A[A.length-1-e]===B[B.length-1-e])e++;
 const a1=A.slice(s,A.length-e),b1=B.slice(s,B.length-e),n=a1.length,m=b1.length;const out=A.slice(0,s).map(x=>[' ',x]);
 if(n*m>4e6){out.push(...a1.map(x=>['-',x]),...b1.map(x=>['+',x]))}
 else{const L=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=a1[i]===b1[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  let i=0,j=0;while(i<n||j<m){if(i<n&&j<m&&a1[i]===b1[j]){out.push([' ',a1[i]]);i++;j++}else if(j<m&&(i===n||L[i][j+1]>=L[i+1][j])){out.push(['+',b1[j]]);j++}else{out.push(['-',a1[i]]);i++}}}
 out.push(...A.slice(A.length-e).map(x=>[' ',x]));return out}
const counts=d=>({added:d.filter(x=>x[0]==='+').length,removed:d.filter(x=>x[0]==='-').length});
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();

export function createInstructions({DATA,HERMES_HOME,DASH,DASH_TOKEN,python,root,names=a=>a,live=false,onProposal=async()=>{}}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const soulFile=a=>path.join(home(a),'SOUL.md');
 const dir=a=>path.join(DATA,'instructions',a);
 const ok=a=>/^[a-z0-9][a-z0-9_-]{0,63}$/.test(a)&&!a.includes('--');
 const sha=t=>createHash('sha1').update(String(t)).digest('hex');
 const dbs=new Map(),locks=new Map();
 const lock=(a,fn)=>{const p=(locks.get(a)||Promise.resolve()).then(fn,fn);locks.set(a,p.catch(()=>{}));return p};
 async function load(a){if(!ok(a))throw Error('Unknown agent.');if(dbs.has(a))return dbs.get(a);let db;try{db=JSON.parse(await readFile(path.join(dir(a),'index.json'),'utf8'))}catch{db={}}
  db.versions||=[];db.proposals||=[];db.flags||=null;dbs.set(a,db);return db}
 async function save(a){const db=dbs.get(a);await mkdir(dir(a),{recursive:true});const f=path.join(dir(a),'index.json');await writeStore(f,JSON.stringify(db,null,1))}
 const readSoul=a=>readFile(soulFile(a),'utf8').catch(()=>null);
 async function addVersion(a,content,meta){const db=await load(a);const h=sha(content),last=db.versions[db.versions.length-1];if(last&&last.hash===h)return last;
  const v=(last?.v||0)+1;await mkdir(dir(a),{recursive:true});await writeFile(path.join(dir(a),'v'+v+'.md'),content);
  const prev=last?await readFile(path.join(dir(a),'v'+last.v+'.md'),'utf8').catch(()=>''):'';const c=counts(lineDiff(prev,content));
  const x={v,at:meta.at||Date.now(),kind:meta.kind,by:String(meta.by||'').slice(0,80),why:String(meta.why||'').slice(0,600),said:String(meta.said||'').slice(0,120),...(meta.approvedBy?{approvedBy:String(meta.approvedBy).slice(0,80)}:{}),hash:h,size:content.length,...c};
  db.versions.push(x);await save(a);return x}
 // the first look at an agent: its old backup files become the first versions (oldest first), then what it has now
 async function ensure(a){const db=await load(a);if(db.versions.length)return db;
  const names_=await readdir(home(a)).catch(()=>[]);const baks=[];
  for(const n of names_.filter(n=>/^SOUL\.md\.(bak|orig|old)/i.test(n))){const f=path.join(home(a),n);const st=await stat(f).catch(()=>null);if(st?.isFile())baks.push({n,f,t:st.mtimeMs})}
  baks.sort((x,y)=>x.t-y.t);
  for(const b of baks){const t=await readFile(b.f,'utf8').catch(()=>null);if(t!==null)await addVersion(a,t,{kind:'import',at:Math.round(b.t),by:'Old backup file',why:'Saved before history started ('+b.n+')'})}
  const cur=await readSoul(a);if(cur!==null)await addVersion(a,cur,{kind:'start',by:'aqeelOS',why:'As it was when history started'});return db}
 // anything that wrote SOUL.md without aqeelOS (the agent editing the file, a script) becomes a version too
 async function sync(a){return lock(a,async()=>{await ensure(a);const cur=await readSoul(a);if(cur===null)return null;
  return addVersion(a,cur,{kind:'box',by:names(a)+' or a script',why:'Changed on the box, not through aqeelOS'})})}
 const dash=(p,opt={})=>fetch(DASH+'/api'+p,{...opt,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},signal:AbortSignal.timeout(20000)});
 async function write(a,content,meta){if(typeof content!=='string'||!content.trim())throw Error('Instructions cannot be empty.');if(content.length>200e3)throw Error('Instructions are too long.');
  await sync(a);   // an edit made on the box meanwhile is kept as its own version first
  return lock(a,async()=>{const r=await dash('/profiles/'+encodeURIComponent(a)+'/soul',{method:'PUT',body:JSON.stringify({content})});if(!r.ok)throw Error('Could not save the instructions ('+r.status+').');
   const x=await addVersion(a,content,meta);recheck(a);return x})}
 async function content(a,v){const db=await ensure(a);const x=db.versions.find(y=>y.v===+v);if(!x)throw Error('No such version.');return readFile(path.join(dir(a),'v'+x.v+'.md'),'utf8')}
 async function version(a,v){const db=await ensure(a);const i=db.versions.findIndex(y=>y.v===+v);if(i<0)throw Error('No such version.');
  const now=await content(a,v),prev=i>0?await content(a,db.versions[i-1].v):'';return {...db.versions[i],content:now,diff:lineDiff(prev,now)}}
 async function history(a){await sync(a).catch(()=>{});const db=await load(a);
  return {versions:db.versions.slice().reverse().map(({hash,...x})=>x),proposals:db.proposals.filter(p=>p.state==='open').map(({content,...p})=>p),flags:db.flags?.items||[],checkedAt:db.flags?.at||null,checking:checking.has(a)}}
 async function restore(a,v,by){const t=await content(a,v);return write(a,t,{kind:'restore',by,why:'Brought back version '+v})}

 // proposals: a before/after a person drafts in the app (an agent's own change never waits, see change())
 async function propose(a,{content:t,why,said,by}){await sync(a);if(typeof t!=='string'||!t.trim())throw Error('Give the whole new text.');
  return lock(a,async()=>{const db=await load(a);const base=db.versions[db.versions.length-1];
   const p={id:'p'+randomBytes(5).toString('hex'),at:Date.now(),by:String(by||'').slice(0,80),why:String(why||'').slice(0,600),said:String(said||'').slice(0,120),baseV:base?.v||0,baseHash:base?.hash||'',state:'open',...counts(lineDiff(base?await content(a,base.v):'',t))};
   await mkdir(dir(a),{recursive:true});await writeFile(path.join(dir(a),p.id+'.md'),t);
   db.proposals=db.proposals.filter(x=>!(x.state==='open'&&x.by===p.by&&p.by!==''))   // a newer proposal from the same author replaces its older one
   db.proposals.push(p);db.proposals=db.proposals.slice(-50);await save(a);onProposal(a,p).catch(()=>{});return p})}
 async function proposal(a,id){const db=await ensure(a);const p=db.proposals.find(x=>x.id===id);if(!p)throw Error('No such proposal.');
  const t=await readFile(path.join(dir(a),p.id+'.md'),'utf8');const cur=await readSoul(a)??'';return {...p,content:t,changedSince:sha(cur)!==p.baseHash,diff:lineDiff(cur,t)}}
 async function decide(a,id,yes,by){const p=await proposal(a,id);if(p.state!=='open')throw Error('This proposal was already '+p.state+'.');let x=null;
  if(yes)x=await write(a,p.content,{kind:'approved',by:p.by||by,why:p.why,said:p.said||'',approvedBy:by});
  await lock(a,async()=>{const db=await load(a);const q=db.proposals.find(y=>y.id===id);q.state=yes?'approved':'declined';q.decidedBy=by;q.decidedAt=Date.now();if(x)q.v=x.v;await save(a)});
  return {state:yes?'approved':'declined',version:x}}

 // closest section of the current text to an old_text that did not match, so the agent can copy the exact wording
 function closest(t,o){const w=x=>new Set(String(x).toLowerCase().match(/[a-z0-9]+/g)||[]);const ow=w(o);if(!ow.size)return '';
  let best='',sc=0;for(const p of t.split(/\n\s*\n/)){const pw=w(p);let k=0;for(const x of ow)if(pw.has(x))k++;const v=k/ow.size;if(v>sc){sc=v;best=p}}
  return sc>=0.3?'\nThe closest part of your current instructions is (copy old_text exactly from it):\n'+best.slice(0,3000):'\nCall change_instructions with read: true to see your full current instructions.'}
// the agent's own tool: change a rule where it is written
 async function change(a,args,{by}){const why=String(args.why||'').trim(),said=String(args.said_by||'').trim();
  // 10 Nov 2026 (id051b007): an agent can read its own current instructions, so old_text can be copied exactly
  if(args.read===true||args.read==='true'){await sync(a);const c=await readSoul(a);return c===null?{isError:true,text:'Your instructions could not be read.'}:{text:'Your current instructions, exactly as written (copy old_text from here):\n\n'+c}}
  if(!why)return {isError:true,text:'Say in why what the change is and why (for the history).'};
  await sync(a);const cur=await readSoul(a);if(cur===null)return {isError:true,text:'Your instructions could not be read.'};
  // 7 Nov 2026 (owner): an agent's own instruction change applies at once, whatever its size; it is a version with
  // its reason and can be undone, and nobody is asked to approve it
  if(typeof args.rewrite==='string'&&args.rewrite.trim()){if(/\boverrid(e|es|ing)\b[^\n]*(earlier|previous|above|every|section|rule)/i.test(args.rewrite))return {isError:true,text:'Do not add "overrides …" wording. Change the rule itself where it is written, so it is said once. Nothing was changed.'};
   const x=await write(a,args.rewrite,{kind:'agent',by,why,said});
   return {text:'Saved as version '+x.v+' of your instructions ('+x.added+' lines added, '+x.removed+' removed). It applies from your next message, is in your history with your reason, and can be undone. Nobody needs to approve it.'}}
  const edits=Array.isArray(args.edits)?args.edits:[];if(!edits.length)return {isError:true,text:'Give edits (exact old_text and new_text for each place), or rewrite with the whole new text.'};
  let t=cur,chars=0;
  for(const [i,e] of edits.entries()){const o=String(e?.old_text||''),nw=String(e?.new_text??'');if(!o)return {isError:true,text:'Edit '+(i+1)+': old_text is empty. Change a rule where it is written; to add one, give a nearby line as old_text and that line plus the new rule as new_text.'};
   const n=t.split(o).length-1;if(n!==1)return {isError:true,text:'Edit '+(i+1)+': old_text '+(n?'appears '+n+' times; make it longer so it is unique':'was not found; copy it exactly from your instructions')+'. Nothing was changed.'+(n?'':closest(t,o))};
   t=t.replace(o,()=>nw);chars+=Math.max(o.length,nw.length)}
  if(/\boverrid(e|es|ing)\b[^\n]*(earlier|previous|above|every|section|rule)/i.test(edits.map(e=>e.new_text).join('\n')))return {isError:true,text:'Do not add "overrides …" wording. Change the rule itself where it is written, so it is said once. Nothing was changed.'};
  const x=await write(a,t,{kind:'agent',by,why,said});
  return {text:'Saved as version '+x.v+' of your instructions ('+x.added+' lines added, '+x.removed+' removed). It applies from your next message, is in your history with your reason, and can be undone. Nobody needs to approve it.'}}

 // contradiction flags
 const checking=new Set(),timers=new Map();
 const ask=(system,user)=>new Promise(async res=>{const py=python&&await python();if(!py)return res(null);const c=execFile(py,[path.join(root,'scripts','aux-llm.py'),path.join(HERMES_HOME,'hermes-agent')],{timeout:150000,maxBuffer:4e6,cwd:HERMES_HOME},(err,out)=>res(err?null:String(out)));c.stdin.end(JSON.stringify({system,user,max_tokens:2500}))});
 const decisionFiles=t=>String(t).split('\n').filter(l=>/\b[\w.-]*DECISIONS[\w.-]*\.(md|txt|json)\b|\bdecisions (tab|sheet)\b/i.test(l)).map(l=>l.trim().slice(0,240));
 const overrides=t=>{const out=[];String(t).split('\n').forEach((l,i)=>{if(/\boverrid(e|es|ing)\b/i.test(l)&&/^(#|\s*-|\s*\*|\d)/.test(l)||/^#+ .*\boverrid/i.test(l))out.push(l.trim().slice(0,240))});return out};
 async function check(a,{force=false}={}){if(checking.has(a))return;checking.add(a);try{
  const soul=await readSoul(a)??'';const mem=(await Promise.all(['MEMORY.md','USER.md'].map(f=>readFile(path.join(home(a),'memories',f),'utf8').catch(()=>'')))).join('\n§\n');
  const h=sha(soul+'\u0000'+mem),db=await load(a);if(!force&&db.flags?.hash===h)return;
  const items=[];const ov=overrides(soul);
  // decisions kept in a separate file (DECISIONS.md, a sheet tab) instead of here: a second place for the same rules
  const sep=decisionFiles(soul);if(sep.length)items.push({kind:'decisions-file',title:'Decisions are also kept in a separate file',detail:'These instructions send the agent to another file for decisions. Move each rule from it into the instructions (change_instructions), where its history is kept, then drop the pointer, so every rule is in one place.',quotes:sep.slice(0,6).map(q=>({where:'instructions',quote:q}))});
  if(ov.length>1)items.push({kind:'override',title:ov.length+' sections say they override earlier rules',detail:'Rules stacked on top of each other. Change each rule where it is written instead, so it is said once.',quotes:ov.slice(0,12).map(q=>({where:'instructions',quote:q}))});
  const out=await ask('You check an AI agent\'s standing instructions for contradictions. Answer only with JSON.',
   'Below are an agent\'s INSTRUCTIONS and its MEMORY notes. List every rule that is given two or more DIFFERENT values or answers, for example two different daily caps, two different hourly limits, a word that is banned in one place and allowed in another, or two places that each claim to win. Only real contradictions about the same rule, not rules that are merely related. For each value quote the exact words (copied verbatim, at most 25 words) and say where they are (instructions or memory).\n'+
   'Answer with a JSON array only: [{"rule":"short name of the rule","values":[{"value":"the value in a few words","where":"instructions|memory","quote":"exact words"}]}]. If there are none, answer [].\n\nINSTRUCTIONS:\n'+soul.slice(0,90000)+'\n\nMEMORY:\n'+mem.slice(0,20000));
  const m=/\[[\s\S]*\]/.exec(out||'');let arr=[];try{arr=m?JSON.parse(m[0]):[]}catch{}
  const src={instructions:norm(soul),memory:norm(mem)};
  for(const c of Array.isArray(arr)?arr:[]){const vals=(Array.isArray(c?.values)?c.values:[]).filter(v=>v&&v.quote&&(src[v.where]||src.instructions).includes(norm(v.quote).slice(0,160)));
   if(new Set(vals.map(v=>norm(v.value))).size<2)continue;   // a value the model could not quote from the text is dropped
   items.push({kind:vals.some(v=>v.where==='memory')?'memory':'conflict',title:String(c.rule||'A rule').slice(0,120)+': '+vals.length+' different values',quotes:vals.slice(0,8).map(v=>({where:v.where==='memory'?'memory':'instructions',value:String(v.value).slice(0,120),quote:String(v.quote).slice(0,300)}))})}
  await lock(a,async()=>{db.flags={hash:h,at:Date.now(),items,model:out!==null};await save(a)})}
  finally{checking.delete(a)}}
 function recheck(a){clearTimeout(timers.get(a));timers.set(a,setTimeout(()=>check(a).catch(e=>console.warn('instructions check',a,e.message)),5000))}
 async function tick(list){for(const a of list){await sync(a).catch(()=>{});await check(a).catch(e=>console.warn('instructions check',a,e.message))}}
 async function openProposals(list){const out=[];for(const a of list){const db=await load(a).catch(()=>null);for(const p of db?.proposals||[])if(p.state==='open')out.push({a,p})}return out}
 return {history,version,proposal,write,restore,propose,decide,change,check,sync,tick,openProposals,lineDiff}}
