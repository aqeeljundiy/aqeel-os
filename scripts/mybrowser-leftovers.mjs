// The "My browser" check's throwaway agents (scripts/mybrowser-check.mjs), OPS-16 (11 Nov 2026): Elkiya had 8 left
// and P&P 1. Each name is 'mb-' plus the last 5 base-36 digits of the time it was made in ms, so its age is known from the
// name alone (the digits wrap every 36^5 ms, about 16.8 hours: an older one only waits for a later run).
export const NAME=/^mb-[0-9a-z]{5}$/;
const WRAP=36**5;
export const nameFor=(now=Date.now())=>'mb-'+now.toString(36).slice(-5);
export function ageOf(name,now=Date.now()){if(!NAME.test(String(name)))return null;
 const made=parseInt(name.slice(3),36),cur=parseInt(now.toString(36).slice(-5),36);return ((cur-made)%WRAP+WRAP)%WRAP}
// names of check agents made more than maxAge ago (a run takes under 8 minutes, so a running one is never picked)
export const stale=(names,now=Date.now(),maxAge=3600e3,keep='')=>[...new Set(names)].filter(n=>n!==keep&&ageOf(n,now)>maxAge);
// the test-agents list (~/.hermes/.aqeelos-test-agents) without these names; every other line stays as it was
export const withoutNames=(text,names)=>{const drop=new Set(names);return String(text||'').split('\n').filter(l=>!drop.has(l.trim())).join('\n')};
