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
// the half hour before the window opens (the nightly batch of the cloud fixer sends what still waits, shortly before the update)
export function beforeWindow(date,w=DEFAULT_WINDOW,lead=30){const d=(mins(w.from)-minuteIn(date,w.tz)+1440)%1440;return d>0&&d<=lead}
