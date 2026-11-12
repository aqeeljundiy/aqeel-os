// Sign-in limits per ACCOUNT, independent of the caller's address (audit of 12 Nov 2026: the only limit was 5 wrong passwords per
// address per 10 minutes, so an attacker with many addresses could guess one account's password, its two-step code or the
// owner's recovery code without end). Each kind of guess has its own key per account: "pw:<id>", "code:<id>", "verify:<id>",
// "recover:owner". After FREE wrong tries in a row the account waits STEP seconds, doubling with every further wrong try, up to
// MAX. The count starts over after a right answer, and after QUIET of calm. A person who is locked out is not told whether
// the account exists (the caller keys unknown names too), and the right answer is not even looked at while the wait runs.
import {timingSafeEqual,createHash} from 'node:crypto';

// compare two secrets in constant time (hashing first, so different lengths take the same time)
export function safeEq(a,b){const h=s=>createHash('sha256').update(String(s??'')).digest();return timingSafeEqual(h(a),h(b))&&String(a??'').length===String(b??'').length}

export function createAccountLimiter({now=()=>Date.now(),free=4,step=30,max=3600,quiet=6*3600}={}){
 const m=new Map();   // key → {n, until, last}
 const sweep=()=>{if(m.size<=5000)return;const t=now();for(const [k,v] of m)if(t-v.last>quiet*1000)m.delete(k);if(m.size>5000)for(const k of [...m.keys()].slice(0,1000))m.delete(k)};
 // seconds still to wait (0 = go ahead)
 function wait(key){const v=m.get(key);if(!v)return 0;const t=now();if(t-v.last>quiet*1000){m.delete(key);return 0}return v.until>t?Math.ceil((v.until-t)/1000):0}
 // a wrong try: returns the seconds the account now waits (0 while the free tries last)
 function fail(key){sweep();const t=now();let v=m.get(key);if(!v||t-v.last>quiet*1000)v={n:0,until:0,last:t};
  v.n++;v.last=t;const over=v.n-free;v.until=over>0?t+Math.min(max,step*2**(over-1))*1000:0;m.set(key,v);return wait(key)}
 const ok=key=>{m.delete(key)};
 const text=s=>'Too many wrong tries for this account. Try again in '+(s>=120?Math.ceil(s/60)+' minutes':s+' seconds')+'.';
 return {wait,fail,ok,text,size:()=>m.size}}
