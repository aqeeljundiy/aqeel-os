// Engine updates (25 Oct 2026): the decisions only, no files, no commands, so each one can be tested on its own
// (scripts/engine-updates.test.mjs). engine-updates.mjs gathers the facts and acts on the answers.
// Why: on 24 Oct an update from v0.22.2 to v0.22.5 stopped WhatsApp chats routed to another agent for hours. Updates now
// run in the quietest two hours of the night, only to a stable release that has been out for 3 days, and are checked
// afterwards; when a check fails, the engine goes back to the version it had before.

export const MODES=['off','ask','adaptive'];
export const STABLE=/^v(\d+)\.(\d+)\.(\d+)$/;   // releases only: never canary, rc or abandoned tags
const pad=n=>String(n).padStart(2,'0');

// the clock in the box's time zone (the engine's config "timezone", Asia/Jakarta here)
export function local(ms,tz){const p={};for(const x of new Intl.DateTimeFormat('en-GB',{timeZone:tz||'UTC',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short'}).formatToParts(new Date(ms)))p[x.type]=x.value;
 return {date:p.year+'-'+p.month+'-'+p.day,h:+p.hour%24,min:+p.minute,dow:p.weekday}}
export const clock=(ms,tz)=>{const l=local(ms,tz);return pad(l.h)+':'+pad(l.min)};

/* The quietest block of `hours` hours in the day. buckets: [[hour number since 1970 (UTC), user messages]], the last 4
   weeks of every agent. Each is counted at its hour of the day in the box's time zone; the block may cross midnight.
   With no messages at all it is 01:00-03:00 (what the history showed on 25 Oct). A tie goes to the earliest start. */
export function quietWindow(buckets,tz,{hours=2}={}){const by=Array(24).fill(0);let total=0;
 for(const [i,n] of buckets||[]){const c=Number(n)||0;if(!c)continue;by[local(Number(i)*3600e3,tz).h]+=c;total+=c}
 let start=1;if(total){let best=Infinity;for(let s=0;s<24;s++){let sum=0;for(let k=0;k<hours;k++)sum+=by[(s+k)%24];if(sum<best){best=sum;start=s}}}
 const end=(start+hours)%24;return {start,end,hours,byHour:by,total,label:pad(start)+':00-'+pad(end)+':00'}}

// minutes since the window began tonight, or -1 outside it
export function minutesIn(ms,win,tz){const l=local(ms,tz),m=((l.h-win.start+24)%24)*60+l.min;return m<win.hours*60?m:-1}
// an update starts only in the first part of the window, so it is finished (about 25 min) and checked before the window ends
export const mayStart=(ms,win,tz,{tail=30}={})=>{const m=minutesIn(ms,win,tz);return m>=0&&m<win.hours*60-tail};
// one night = the date the window started on (a window from 23:00 to 01:00 is one night)
export const nightOf=(ms,win,tz)=>{const m=minutesIn(ms,win,tz);return local(ms-Math.max(0,m)*60e3,tz).date};
// the morning message goes out from 07:00 until 21:00
export const isDaytime=(ms,tz)=>{const h=local(ms,tz).h;return h>=7&&h<21};

// A schedule that runs more often than every hour (Pixel's every-2 and every-30 minute jobs) may run into an update: it
// runs again a few minutes later anyway. Others must not be cut off.
export function frequent(job){const s=job?.schedule||{};
 if(s.kind==='interval')return (Number(s.minutes)||0)>0&&Number(s.minutes)<60;
 if(s.kind!=='cron'||!s.expr)return false;const min=String(s.expr).trim().split(/\s+/)[0]||'';
 if(min==='*')return true;const step=/^(?:\*|\d+-\d+)\/(\d+)$/.exec(min);if(step)return +step[1]<60;
 return min.split(',').length>1||/^\d+-\d+$/.test(min)}
// the schedules that stop an update now: running, or due within `ahead` (or just overdue), except the frequent ones
export function blockingJobs(jobs,now,{ahead=45*60e3,tz}={}){const out=[];
 for(const j of jobs||[]){if(j.enabled===false||/^(paused|completed)$/.test(j.state||'')||frequent(j))continue;const name=j.name||'A schedule';
  if(j.state==='running'||j.running){out.push({...j,why:name+' is running'});continue}
  const t=Date.parse(j.next_run_at||'');if(t&&t>=now-5*60e3&&t<=now+ahead)out.push({...j,why:name+' is due at '+clock(t,tz)})}
 return out}

// release tags from the engine checkout ([{name,at (ms),sha}]): stable ones only, newest first
export const cmpVer=(a,b)=>{const x=STABLE.exec(a),y=STABLE.exec(b);for(let i=1;i<4;i++){const d=(+x[i])-(+y[i]);if(d)return d}return 0};
export function stableTags(tags){return (tags||[]).filter(t=>STABLE.test(String(t.name||''))&&t.sha).sort((a,b)=>(b.at||0)-(a.at||0)||cmpVer(b.name,a.name))}

/* Where the engine's own update would go, and whether it may go there now.
   engine: its update check (update_available, source_version, rollback_to). The engine's update only ever moves to the
   newest published stable release, so that is the target; the git tags give its commit and its date.
   forward: the target descends from what runs now. manual: the person asked for it, so the 3-day wait does not apply. */
export function pickTarget({engine,tags,head,forward,now,minAgeDays=3,manual=false}){
 if(!engine||engine.behind==null&&!engine.update_available)return {ok:false,reason:'the update check did not answer'};
 if(!engine.update_available)return {ok:false,none:true,reason:'already on the newest release'};
 if(engine.rollback_to)return {ok:false,reason:'the engine would move back to v'+engine.rollback_to};
 const want='v'+String(engine.source_version||'').replace(/^v/,'');
 if(!STABLE.test(want))return {ok:false,reason:(engine.source_version?want:'the target')+' is not a stable release'};
 const t=stableTags(tags).find(x=>x.name===want);if(!t)return {ok:false,tag:want,reason:want+' is not in the engine checkout yet'};
 if(t.sha===head)return {ok:false,none:true,tag:want,reason:'already on '+want};
 if(forward===false)return {ok:false,tag:want,reason:want+' is older than the version running now'};
 const days=(now-(t.at||0))/864e5;
 if(!manual&&days<minAgeDays){const d=Math.max(0,Math.floor(days));return {ok:false,young:true,tag:want,sha:t.sha,reason:want+' came out '+(d?d+' day'+(d>1?'s':''):'today')+' ago; updates wait until a release is '+minAgeDays+' days old'}}
 return {ok:true,tag:want,sha:t.sha,at:t.at}}

/* Every condition for starting tonight, in order; the first that fails is the reason (tried again the next night).
   busy: aqeelOS's own count of work in progress (/healthz busy). lastUserAt: the newest message from a person. */
export function conditions({now,win,tz,target,busy,lastUserAt,jobs,quietMin=20}){
 if(!mayStart(now,win,tz))return {ok:false,wait:true,reason:'outside the quiet hours ('+win.label+')'};
 if(!target?.ok)return {ok:false,reason:target?.reason||'no release to update to'};
 if(busy>0)return {ok:false,reason:'aqeelOS was busy ('+busy+' job'+(busy>1?'s':'')+' in progress)'};
 if(lastUserAt&&now-lastUserAt<quietMin*60e3)return {ok:false,reason:'someone sent a message '+Math.max(1,Math.round((now-lastUserAt)/60e3))+' min before'};
 const b=blockingJobs(jobs,now,{tz});if(b.length)return {ok:false,reason:b[0].why+(b.length>1?' (and '+(b.length-1)+' more)':'')};
 return {ok:true}}

// agent.log lines in a time span: errors, and the "profile_mismatch" refusals behind the 24 Oct problem
export function countLog(text,from,to){let errors=0,mismatch=0;
 for(const l of String(text||'').split('\n')){const m=/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)[,.]\d+ (\w+) /.exec(l);if(!m)continue;const t=Date.parse(m[1].replace(' ','T')+'Z');if(!(t>=from&&t<to))continue;
  if(m[2]==='ERROR'||m[2]==='CRITICAL')errors++;if(l.includes('profile_mismatch'))mismatch++}
 return {errors,mismatch,minutes:Math.max(1,(to-from)/60e3)}}
// a spike: refusals that were not there before, or errors at three times the earlier rate (and at least 5)
export function logProblems(before,after){const out=[],rate=(x,k)=>x[k]/x.minutes;
 if(after.mismatch>0&&rate(after,'mismatch')>2*rate(before,'mismatch'))out.push(after.mismatch+' chat'+(after.mismatch>1?'s were':' was')+' refused with profile_mismatch');
 if(after.errors>=5&&rate(after,'errors')>Math.max(0.2,3*rate(before,'errors')))out.push(after.errors+' errors in the engine log in '+Math.round(after.minutes)+' min (before: '+before.errors+' in '+Math.round(before.minutes)+' min)');
 return out}

const mask=id=>{const s=String(id);return s==='None'?'any chat':s.length>6?'…'+s.slice(-4).replace(/@.*/,'')+(s.includes('@lid')?' (LID)':''):s};
/* The route check, before and after: every profile_routes entry, per engine home it was tested under, maps each form of its
   chat ID (number, JID, LID) to an agent. Only what reached its agent before and does not now counts: some forms never
   worked under some homes, and that is not the update's doing. */
export function routeProblems(before,after){const out=[],seen=new Set();
 const key=(home,r,id)=>home+'|'+r.name+'|'+id;const ok=new Map();
 for(const run of before||[])for(const r of run.routes||[])for(const [id,got] of Object.entries(r.got||{}))ok.set(key(run.home,r,id),got===r.profile);
 for(const run of after||[])for(const r of run.routes||[])for(const [id,got] of Object.entries(r.got||{})){if(got===r.profile||!ok.get(key(run.home,r,id)))continue;const k=r.name+'|'+run.label;if(seen.has(k))continue;seen.add(k);
  out.push('route '+r.name+' no longer reaches '+r.profile+' for '+mask(id)+' (checked as '+(run.label||run.home)+')')}
 // a route that was there and is gone from the check
 const names=run=>new Set((run.routes||[]).map(r=>r.name));const was=new Set((before||[]).flatMap(run=>[...names(run)])),now=new Set((after||[]).flatMap(run=>[...names(run)]));
 for(const n of was)if(!now.has(n)&&(after||[]).length)out.push('route '+n+' is no longer read by the engine');
 return out}

/* The self-check after an update (and after a rollback). before: what was true just before. after: what is true now.
   ok only when nothing is on the list. */
export function verdict(before,after){const out=[];
 if(!after.gatewayUp)out.push('the engine did not come back');
 for(const c of before.channels||[])if(after.channels?.[c]!=='connected')out.push(c.replace(':',' › ')+' did not reconnect'+(after.channels?.[c]?' ('+after.channels[c]+')':''));
 if(before.routes&&!before.routes.error){if(after.routes?.error)out.push('the route check could not run: '+after.routes.error);else out.push(...routeProblems(before.routes.runs,after.routes?.runs))}
 if(before.log&&after.log)out.push(...logProblems(before.log,after.log));
 if(!after.healthOk)out.push('aqeelOS did not answer its health check');
 return {ok:!out.length,problems:out}}

/* After a failed check: go back or not. receipt: the engine's own record of the update (pre_update.sha is where it came
   from). knowsRuntime: the earlier version understands the chat history the new one wrote (the engine refuses older ones). */
export function rollbackPlan({check,receipt,head,knowsRuntime}){
 if(check?.ok)return {rollback:false};
 const pre=receipt?.pre_update||{};if(!/^[0-9a-f]{40}$/.test(pre.sha||''))return {rollback:false,reason:'the update left no record of the earlier version'};
 if(pre.sha===head)return {rollback:false,reason:'the engine is still on the earlier version, so the update did not cause it'};
 if(knowsRuntime===false)return {rollback:false,reason:'the earlier version cannot read the new chat history; it needs a restore by hand'};
 return {rollback:true,to:pre.sha,version:pre.version||pre.short_sha||pre.sha.slice(0,8)}}

// the one message for the owner the next morning
export function ownerText(e,tz){const at=clock(e.at,tz),v=x=>x?'v'+String(x).replace(/^v/,''):'the new version';
 if(e.kind==='updated')return 'Updated the engine to '+v(e.to)+' at '+at+', all checks passed.'+(e.fixed?.length?' Fixed by itself after it: '+e.fixed.join(', ')+'.':'');
 if(e.kind==='rolled-back')return 'Rolled back: '+(e.problems||[]).slice(0,3).join('; ')+'. The engine is on '+v(e.from)+' again'+(e.after?.length?', but some checks still fail: '+e.after.slice(0,2).join('; '):', and the checks pass')+'.';
 if(e.kind==='check-failed')return 'Updated the engine to '+v(e.to)+' at '+at+', but checks failed: '+(e.problems||[]).slice(0,3).join('; ')+'. Not rolled back: '+e.reason+'.';
 if(e.kind==='failed')return 'The engine update to '+v(e.to)+' did not finish: '+e.reason+'. The engine is still on '+v(e.from)+'.';
 return 'Skipped the engine update'+(e.to?' to '+v(e.to):'')+': '+e.reason+'.'}
