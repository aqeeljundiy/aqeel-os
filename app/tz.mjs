// The box's time zone, never one owner's (7 Nov 2026, open source). The engine's config "timezone" wins; without one the
// system's own zone (TZ, /etc/localtime), else UTC.
export const sysTz=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch{return 'UTC'}};
const ok=tz=>{try{new Intl.DateTimeFormat('en',{timeZone:tz});return true}catch{return false}};
export const zoneOr=tz=>tz&&ok(tz)?tz:sysTz();
// a time's local date (YYYY-MM-DD), hour and weekday (0 = Sunday) in a zone
export function localParts(t,tz){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zoneOr(tz),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false,weekday:'short'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
 return {day:p.year+'-'+p.month+'-'+p.day,hour:+p.hour%24,weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)}}
// the zone's short name people know (WIB, CET, EST) where the platform has one, else the city
export function zoneName(tz){tz=zoneOr(tz);try{const n=new Intl.DateTimeFormat('en-US',{timeZone:tz,timeZoneName:'short'}).formatToParts(new Date()).find(x=>x.type==='timeZoneName')?.value||'';
 if(n&&!/^GMT[+-]/.test(n))return n;if(tz==='Asia/Jakarta')return 'WIB';if(tz==='Asia/Makassar')return 'WITA';if(tz==='Asia/Jayapura')return 'WIT';return tz.split('/').pop().replace(/_/g,' ')}catch{return tz}}
