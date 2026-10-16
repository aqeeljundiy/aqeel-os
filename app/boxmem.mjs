// The AI box's own memory: what its container uses against its limit (not the whole VPS, which also runs
// other sites), and what uses it, grouped so a person can read it. Cached for 10 seconds.
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';

const CG='/sys/fs/cgroup/';
const num=async f=>{const v=(await readFile(CG+f,'utf8').catch(()=>'')).trim();return v===''||v==='max'?null:Number(v)};
const GROUPS=[
 ['AdsPower browser',/SunBrowser/],
 ['AdsPower app',/adspower_global/],
 ['Agent screens and browsers',/chrome-linux64|chromium|Xvnc|Xvfb|xfce|xfwm|xfdesktop|fluxbox|x11vnc|websockify|agent-browser/],
 ['Engine (chats, channels, schedules)',/python3? -I -c import os, re, sys/],
 ['Tools and connectors',/npx|npm exec|mcp|adspower-bridge|browser_harness/],
 ['aqeelOS app',/hermes-ui\/app\/server\.mjs/],
];
let cache={t:0,v:null};
export async function boxMemory(){
 if(Date.now()-cache.t<10000&&cache.v)return cache.v;
 const [used,limit,peak,events]=await Promise.all([num('memory.current'),num('memory.max'),num('memory.peak'),readFile(CG+'memory.events','utf8').catch(()=>'')]);
 const kills=Number((/oom_kill (\d+)/.exec(events)||[])[1]||0);
 const ps=await new Promise(res=>execFile('ps',['-eo','rss=,args='],{maxBuffer:8e6},(e,o)=>res(e?'':String(o))));
 const sums=new Map();
 for(const line of ps.split('\n')){const m=/^\s*(\d+)\s+(.*)$/.exec(line);if(!m)continue;const g=(GROUPS.find(([,re])=>re.test(m[2]))||['Other'])[0];sums.set(g,(sums.get(g)||0)+Number(m[1])*1024)}
 // process sizes count shared memory more than once, so scale them to the real total
 const raw=[...sums.values()].reduce((a,b)=>a+b,0)||1,scale=used&&raw>used?used/raw:1;
 const parts=[...sums].map(([name,b])=>({name,bytes:Math.round(b*scale)})).filter(p=>p.bytes>20e6).sort((a,b)=>b.bytes-a.bytes);
 const pct=used&&limit?Math.round(used/limit*100):null;
 const level=pct==null?null:pct>=95?'critical':pct>=85?'elevated':'ok';
 cache={t:Date.now(),v:{memory:{used,limit,peak,pct,level,oom_kills:kills},parts}};return cache.v}
