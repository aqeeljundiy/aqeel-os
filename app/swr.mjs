// Last-known answers for slow status reads (stale-while-revalidate). A key's answer is used as is while it is younger
// than `fresh`; older, it is still answered at once and read again behind the scenes (one read per key at a time). Only a
// key with no answer yet waits, and with `partial` given at most `cap` ms: then partial() answers while the read finishes
// for the next ask. drop() forgets a key (or every key) and moves its stamp on, so a read that started before a change
// never stores what it saw; the next ask waits for a new read.
export function swr({fresh=30000,cap=3000}={}){
 const m=new Map(),gen=new Map();let all=0;const stamp=k=>all+':'+(gen.get(k)||0),LATE=Symbol('late');
 function load(k,fn){const e=m.get(k),s=stamp(k);if(e?.p&&e.ps===s)return e.p;
  const p=Promise.resolve().then(fn).then(v=>{if(stamp(k)===s)m.set(k,{t:Date.now(),v});return v},
   err=>{const n=m.get(k);if(n?.p===p){if('v' in n)m.set(k,{t:n.t,v:n.v});else m.delete(k)}throw err});
  m.set(k,{...(e&&'v' in e?{t:e.t,v:e.v}:{}),p,ps:s});p.catch(()=>{});return p}   // a read nobody waits for any more never crashes the server
 async function get(k,fn,{force=false,partial}={}){const e=m.get(k);
  if(!force&&e&&'v' in e){if(Date.now()-e.t>=fresh&&!e.p)load(k,fn);return e.v}
  const p=load(k,fn);if(!partial||!cap)return p;let tm;
  const v=await Promise.race([p,new Promise(r=>{tm=setTimeout(()=>r(LATE),cap)})]).finally(()=>clearTimeout(tm));return v===LATE?partial():v}
 const drop=k=>{if(k===undefined){all++;m.clear()}else{gen.set(k,(gen.get(k)||0)+1);m.delete(k)}};
 return {get,drop,peek:k=>m.get(k)}}
// at most n at once (per-agent reads that each hit the engine or a service), in the order asked
export function limiter(n){let on=0;const q=[];const next=()=>{if(on>=n||!q.length)return;on++;const [fn,ok,no]=q.shift();Promise.resolve().then(fn).then(ok,no).finally(()=>{on--;next()})};
 return fn=>new Promise((ok,no)=>{q.push([fn,ok,no]);next()})}
