#!/usr/bin/env node
// "Is this month-end close stage due?" without a model (12 Nov 2026). The Elkiya Close stages 2 and 3 woke a model every day on days 1-10 only to
// open the Dashboard tab AI RUN STATUS and say [SILENT]. The tab has one row per work month + revision + stage with a Status (Pending / In progress /
// Verified / Blocked). Stage N is due for a revision when every earlier stage is Verified for it and stage N is not. This prints one line per due
// revision and nothing when none is due, for run-check.mjs --cmd "node scripts/close-stage-due.mjs --stage 2" --cmd-once (the same line twice is
// not work twice: a blocker already reported stays quiet until something changes).
// Usage: node close-stage-due.mjs --stage 2|3 [--sheet <id>] [--tab "AI RUN STATUS"] [--account elkiya] [--month YYYY-MM] [--gapi ~/.hermes/scripts/gapi.py]
// Reads only. Exit 0 always except when the sheet cannot be read (exit 1, so the run goes ahead).
import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// the work month a close started on day 1-10 is about: the month before the current one, in Jakarta
export function workMonth(now=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
 let y=+p.year,m=+p.month-1;if(m<1){m=12;y--}return y+'-'+String(m).padStart(2,'0')}
const stageNo=s=>{const m=/^\s*(\d)\b/.exec(String(s||''));return m?+m[1]:null};
// rows: the tab as a list of lists, the header first. Returns the lines to print.
export function dueLines(rows,{stage,month}){const h=(rows[0]||[]).map(x=>String(x||'').trim().toLowerCase());
 const col=n=>h.findIndex(x=>x.startsWith(n)),iM=col('work month'),iR=col('revision'),iS=col('stage'),iT=col('status');if([iM,iR,iS,iT].some(i=>i<0))throw Error('the tab does not have the columns Work month, Revision, Stage, Status');
 const by=new Map();for(const r of rows.slice(1)){if(String(r[iM]||'').trim()!==month)continue;const rev=String(r[iR]||'').trim(),n=stageNo(r[iS]);if(!rev||!n)continue;
  const m=by.get(rev)||new Map();m.set(n,String(r[iT]||'').trim());by.set(rev,m)}
 const out=[];for(const [rev,m] of [...by].sort((a,b)=>a[0].localeCompare(b[0],'en',{numeric:true}))){
  let before=true;for(let n=1;n<stage;n++)if(m.get(n)!=='Verified')before=false;if(!before)continue;
  const st=m.get(stage)||'none';if(st!=='Verified')out.push('stage '+stage+' is due for '+month+' '+rev+' (now '+st+')')}
 return out}

const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d};
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 const stage=+opt('stage'),sheet=opt('sheet','1RhAw0544B7BwqqjccnRGwUtKg6I3jJLiwkxS1mzwRcA'),tab=opt('tab','AI RUN STATUS'),account=opt('account','elkiya'),month=opt('month',workMonth()),
  gapi=opt('gapi',path.join(homedir(),'.hermes','scripts','gapi.py'));
 if(![2,3].includes(stage)){console.error('--stage 2 or 3');process.exit(2)}
 execFile('python3',[gapi,'--account',account,'call','sheets','v4','spreadsheets.values.get','--params',JSON.stringify({spreadsheetId:sheet,range:tab+'!A1:L300'})],{timeout:25000,maxBuffer:4e6},(e,out)=>{
  try{if(e)throw e;const rows=JSON.parse(out).values||[];const l=dueLines(rows,{stage,month});if(l.length)console.log(l.join('\n'))}
  catch(x){console.error('close-stage-due: '+String(x.message||x).slice(0,200));process.exit(1)}})}
