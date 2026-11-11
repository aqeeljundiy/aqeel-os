// The maintenance window (owner, 12 Nov 2026): with this many schedules the box is never idle, so updates and restarts
// that can wait no longer wait for a quiet moment. They happen inside one window a night, 00:00 to 01:00 Jakarta time
// unless the install sets its own (install.json "maintenance": {from,to,tz}; System › Settings › This install), and
// whatever was in progress is continued afterwards (resume.mjs). Pure rules, tested in scripts/maintenance.test.mjs;
// scripts/auto-update.mjs, restart-later.mjs and the server ask them.
export const DEFAULT_WINDOW={from:'00:00',to:'01:00',tz:'Asia/Jakarta'};
const HM=/^([01]?\d|2[0-3]):([0-5]\d)$/;
const okTz=tz=>{try{new Intl.DateTimeFormat('en',{timeZone:tz});return true}catch{return false}};
const pad=s=>{const m=HM.exec(String(s||'').trim());return m?m[1].padStart(2,'0')+':'+m[2]:''};
const mins=s=>{const m=HM.exec(s);return +m[1]*60+ +m[2]};
// a person's entry made safe; throws with a plain reason
export function cleanWindow(w){const from=pad(w?.from),to=pad(w?.to),tz=String(w?.tz||'').trim();
 if(!from||!to)throw Error('Give the start and end as hours and minutes, like 00:00 and 01:00.');
 if(from===to)throw Error('The window needs a start and an end that differ.');
 if(!tz||!okTz(tz))throw Error('Pick a time zone from the list.');
 const len=(mins(to)-mins(from)+1440)%1440;if(len<30)throw Error('The window must be at least 30 minutes, so an update has time to start.');
 return {from,to,tz}}
// the install's window: its own setting when it is valid, else the default
export function windowOf(settings){try{return cleanWindow({...DEFAULT_WINDOW,...(settings?.maintenance||{})})}catch{return {...DEFAULT_WINDOW}}}
// minutes since midnight at `date` in the window's zone
export function minuteIn(date,tz){try{const p=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return (+p.find(x=>x.type==='hour').value%24)*60+ +p.find(x=>x.type==='minute').value}catch{return date.getUTCHours()*60+date.getUTCMinutes()}}
// inside the window? The end is not part of it; a window may pass midnight (23:30 to 00:30)
export function inWindow(date,w=DEFAULT_WINDOW){const a=mins(w.from),b=mins(w.to),m=minuteIn(date,w.tz);return a<b?m>=a&&m<b:m>=a||m<b}
export const windowText=w=>w.from+' to '+w.to+' ('+w.tz.split('/').pop().replace(/_/g,' ')+' time)';
// how long an interrupted chat or run is still continued (install.json "resumeMaxHours", default 2)
export const resumeMaxMs=settings=>{const h=Number(settings?.resumeMaxHours);return (Number.isFinite(h)&&h>=0.25&&h<=24?h:2)*3600e3};
// How a restart in the window goes (owner, 12 Nov 2026): it first waits gently for what is running to finish (agents at work, background
// tasks; no new schedule runs start meanwhile), for at most this long (install.json "restartGraceMinutes", default 10, 0 = no waiting, at
// most 60); then it restarts with --interrupt, and whatever that cut off is continued afterwards (resume.mjs). One rule for every restart
// that waits for the window (agents' and aqeelOS's own changes, the nightly one). Restarts outside the window are not affected.
export const restartGraceMs=settings=>{const m=Number(settings?.restartGraceMinutes);return (Number.isFinite(m)&&m>=0&&m<=60?m:10)*60e3};
export const RESTART_POLL_MS=5000;
// {go: restart now, interrupt: the gentle time is over and work is still running (so it is cut off and continued later)}; waited/grace in ms
export const windowRestartStep=({busy,waited=0,grace})=>busy?(waited>=grace?{go:true,interrupt:true}:{go:false}):{go:true,interrupt:false};
// the gentle wait as a number of polls of the engine's own restart wait (server.mjs restartGateway)
export const restartWaitPolls=grace=>Math.max(0,Math.ceil(grace/RESTART_POLL_MS));
// the half hour before the window opens (the nightly batch of the cloud fixer sends what still waits, shortly before the update)
export function beforeWindow(date,w=DEFAULT_WINDOW,lead=30){const d=(mins(w.from)-minuteIn(date,w.tz)+1440)%1440;return d>0&&d<=lead}

// The night's browser page checks (12 Nov 2026): the four checks that used to run at every deploy on the box that also runs the agents
// (pages, fast switching, buttons and tabs, My browser; scripts/box-check.sh BROWSER_ONLY=1) run once a night instead, inside the window,
// after the nightly update had its turn. A failure goes on Health as one item; it never undoes a deploy. Pure rules, tested in
// scripts/maintenance.test.mjs; app/browser-checks.mjs runs them.
// when the window that contains `date` opened
export function windowOpened(date,w=DEFAULT_WINDOW){const d=(minuteIn(date,w.tz)-mins(w.from)+1440)%1440;return new Date(date.getTime()-d*60e3-date.getUTCSeconds()*1e3-date.getUTCMilliseconds())}
// {due, why}. last = {at, ok, sha} of the latest run; sha = the version live now; updating = an update is running; running = a check is
export function browserChecksDue({now=new Date(),w=DEFAULT_WINDOW,last=null,sha='',updating=false,running=false,sameVersionDays=7}={}){
 if(!inWindow(now,w))return {due:false,why:'outside the maintenance window'};
 if(running)return {due:false,why:'already running'};if(updating)return {due:false,why:'an update is running'};
 const open=windowOpened(now,w),len=(mins(w.to)-mins(w.from)+1440)%1440,wait=Math.min(25,Math.floor(len/2));
 if(now-open<wait*60e3)return {due:false,why:'the nightly update goes first ('+wait+' minutes into the window)'};
 if(last&&last.at>=open.getTime())return {due:false,why:'already ran in this window'};
 if(last&&last.ok&&sha&&last.sha===sha&&now.getTime()-last.at<sameVersionDays*864e5)return {due:false,why:'this version already passed'};
 return {due:true,why:'once a night, after the update'}}
