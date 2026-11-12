// One backup in its own process (audit H2, 12 Nov 2026). backup.mjs starts this detached, in its own session, so an app restart (every deploy)
// does not stop a backup that takes over an hour. What to do comes in AQ_BACKUP_JOB; progress and the result go to DATA/backup-job.json,
// which the app follows. This process never writes backups.json.
import {createBackups} from './backup.mjs';

const raw=process.env.AQ_BACKUP_JOB;if(!raw){console.error('backup-job: started without a job');process.exit(2)}
delete process.env.AQ_BACKUP_JOB;const o=JSON.parse(raw);
process.on('SIGHUP',()=>{});   // the terminal it was started from going away is not a reason to stop
const b=createBackups({DATA:o.DATA,HOME:o.HOME,HERMES_HOME:o.HERMES_HOME,TMP:o.TMP,LOCALDIR:o.LOCALDIR,...(o.MIN?{MIN:o.MIN}:{}),tz:()=>o.tz||'',ENV_ACCOUNT:o.ENV_ACCOUNT||'',readOnly:true});
const end=await b.job({why:o.why,at:o.at,name:o.name});
process.exit(end?.last?0:1);
