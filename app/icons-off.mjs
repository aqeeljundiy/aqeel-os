// Icon drawing off the main thread, with a time limit (audit C2, 12 Nov 2026: one malformed logo SVG spun the single thread for ever, at
// every start). The drawing code is synchronous and reads files people and agents upload, so it runs in a worker that is stopped when it
// takes too long or uses too much memory. The caller then uses the plain tile and says so once on Health.
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';

export const ICON_MS=20000;
// Buffers cross to and from the worker as plain byte arrays: make them Buffers again (the drawing code calls .toString('utf8') on them)
const revive=v=>{if(v instanceof Uint8Array)return Buffer.isBuffer(v)?v:Buffer.from(v.buffer,v.byteOffset,v.byteLength);
 if(Array.isArray(v))return v.map(revive);if(v&&typeof v==='object'){for(const k of Object.keys(v))v[k]=revive(v[k])}return v};
const JOBS={buildIcons:async a=>(await import('./icons.mjs')).buildIcons(...a),brandApp:async a=>(await import('./pwa-zip.mjs')).brandApp(...a)};

// run(job, args) → the job's result, or rejects with {iconFail:'slow'|'crash'} after `ms`, on a throw, or when the worker dies
export function runOff(job,args,{ms=ICON_MS,file=fileURLToPath(import.meta.url)}={}){return new Promise((res,rej)=>{let done=false;
 const w=new Worker(file,{workerData:{job,args},resourceLimits:{maxOldGenerationSizeMb:768}});
 const end=(f,v)=>{if(done)return;done=true;clearTimeout(t);w.terminate().catch(()=>{});f(v)};
 const t=setTimeout(()=>end(rej,Object.assign(Error('Drawing the icons took longer than '+Math.round(ms/1000)+' seconds and was stopped.'),{iconFail:'slow'})),ms);
 w.once('message',m=>m.ok?end(res,revive(m.v)):end(rej,Object.assign(Error(m.error),{iconFail:'crash',unsupported:!!m.unsupported})));
 w.once('error',e=>end(rej,Object.assign(Error(e.message),{iconFail:'crash'})));
 w.once('exit',c=>end(rej,Object.assign(Error('The icon drawing stopped (code '+c+').'),{iconFail:'crash'})))})}
export const buildIconsOff=(spec,o)=>runOff('buildIcons',[spec],o);
export const brandAppOff=(zip,opts,o)=>runOff('brandApp',[zip,opts],o);

if(!isMainThread&&workerData?.job){const {job,args}=workerData;
 Promise.resolve().then(()=>JOBS[job](revive(args))).then(v=>parentPort.postMessage({ok:true,v}),e=>parentPort.postMessage({ok:false,error:String(e?.message||e),unsupported:!!e?.unsupported}))}
