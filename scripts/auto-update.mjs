#!/usr/bin/env node
// Automatic updates (owner, 9 Nov 2026): every install takes GitHub's main by itself in its maintenance window, so a fix
// reaches everyone. System › Settings › This install switches it off and sets the window.
// The window (owner, 12 Nov 2026; app/maintenance.mjs): 00:00 to 01:00 Jakarta time unless the install sets its own. Inside
// it the update no longer waits for an idle box (with this many schedules there is none): it goes ahead, and what it cuts
// off is continued once the new version answers (app/resume.mjs).
// Only code travels: skills, memory, agents, keys and settings stay on each server.
//   node scripts/auto-update.mjs [--now]    --now skips the window and the switch (for a person running it by hand)
// Two kinds of install:
//   a Docker box (~/services.sh and .deployed-commit): runs scripts/box-deploy.sh from the new commit, the same path as a
//     deploy: checks on a test copy, go live, real-life test, previous version back by itself if it fails.
//   an installer install (a git clone with the aqeelos service): fast-forwards, restarts, and goes back if it stops answering.
// It never overwrites what it can't see on GitHub: a server running a commit GitHub doesn't have, or with edited files, is
// left alone and says so. A version that failed once is not tried again; the next one is.
// Result in DATA/auto-update.json; the live app shows it in Settings and raises a failure under Bottlenecks.
import {readFileSync,writeFileSync,mkdirSync,rmdirSync,statSync,existsSync,renameSync,readdirSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {windowOf,inWindow} from '../app/maintenance.mjs';

const APP=path.resolve(process.env.AQEELOS_APP||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const HOME=process.env.AQEELOS_HOME||homedir();
const DATA=path.resolve(process.env.UI_DATA_DIR||path.join(APP,'..','hermes-ui-data'));
const PORT=Number(process.env.UI_PORT)||4400;
const DEFAULT_REPO='https://github.com/aqeeljundiy/aqeel-os.git';
const NOW=process.argv.includes('--now');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const git=(args,cwd=APP)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:300000}).trim();
const tryGit=(args,cwd)=>{try{return git(args,cwd)}catch{return null}};

// a pure rule, tested in scripts/auto-update.test.mjs: may the update run now? s = the install's settings (install.json)
export const mayUpdateNow=(date,s={})=>inWindow(date,windowOf(s));
// the note the next start of the app reads: it was an update that restarted it (app/resume.mjs)
function noteUpdate(){try{const d=path.join(DATA,'resume');mkdirSync(d,{recursive:true});writeFileSync(path.join(d,'planned.json'),JSON.stringify({at:Date.now(),why:'update'}))}catch{}}

const read=(f,d)=>{try{return JSON.parse(readFileSync(f,'utf8'))}catch{return d}};
const STATE=path.join(DATA,'auto-update.json');
const state=read(STATE,{});
function save(){mkdirSync(DATA,{recursive:true});writeFileSync(STATE+'.tmp',JSON.stringify(state,null,1));renameSync(STATE+'.tmp',STATE)}
function record(result,why,from,to){state.last={at:Date.now(),result,why:why||'',from:from||'',to:to||''};delete state.running;save();console.log('auto-update: '+result+(why?': '+why:''))}
const short=s=>String(s||'').slice(0,8);

const boxKind=()=>existsSync(path.join(HOME,'services.sh'))&&existsSync(path.join(APP,'.deployed-commit'));
const repoUrl=()=>process.env.AQ_REPO||tryGit(['remote','get-url','origin'])||DEFAULT_REPO;

async function updateBox(repo,latest){
 const cur=readFileSync(path.join(APP,'.deployed-commit'),'utf8').trim();if(cur===latest)return record('current','',cur,latest);
 const R=path.join(HOME,'apps','aqeel-os-src');
 if(!existsSync(path.join(R,'.git')))git(['clone','-q',repo,R],HOME);
 git(['remote','set-url','origin',repo],R);git(['fetch','-q','origin','main'],R);
 // the same promise a deploy makes: never take the server back
 if(tryGit(['cat-file','-e',cur+'^{commit}'],R)===null||tryGit(['merge-base','--is-ancestor',cur,latest],R)===null)
  return record('refused','This server runs a version GitHub does not have ('+short(cur)+'). Put that work on GitHub first, or it would be lost.',cur,latest);
 const id='auto-'+Date.now();
 writeFileSync('/tmp/aq-deploy-'+id+'.sh',execFileSync('git',['show',latest+':scripts/box-deploy.sh'],{cwd:R}));
 writeFileSync('/tmp/box-pack-'+id+'.sh',execFileSync('git',['show',latest+':scripts/box-pack.sh'],{cwd:R}));
 state.running={at:Date.now(),to:latest,id};save();
 // detached: going live restarts the app that started this. A clean environment, as over ssh: the live app's settings
 // (its port, its live flag) would otherwise pass down to the test copy
 spawn('setsid',['nohup','bash','/tmp/aq-deploy-'+id+'.sh',latest,cur,'0','0',id],{detached:true,stdio:'ignore',env:{HOME,PATH:process.env.PATH,LANG:process.env.LANG||'C.UTF-8',AQ_REPO:repo}}).unref();
 const log='/tmp/aq-deploy-'+id+'.log',end=Date.now()+75*60000;
 while(Date.now()<end){await sleep(15000);let t='';try{t=readFileSync(log,'utf8')}catch{}
  if(/^AQ-DEPLOY DONE/m.test(t))return record('updated','',cur,latest);
  const m=/^AQ-DEPLOY FAILED (.*)$/m.exec(t);if(m){state.skip=latest;const tail=t.split('\n').filter(l=>/^(✗|↩)/.test(l)).slice(-2).join(' ');const kept=m[1]!=='go live'||/^↩/m.test(t);return record('failed','Stopped at "'+m[1]+'". '+tail+(kept?' The server kept its working version.':' See System › Health.'),cur,latest)}}
 state.skip=latest;record('failed','It did not finish within 75 minutes.',cur,latest)}

// the service restarts by itself (Restart=always), so ending its process is enough and needs no root
function restartService(){if(process.env.AQ_UPDATE_RESTART){execFileSync('sh',['-c',process.env.AQ_UPDATE_RESTART]);return}
 const pid=Number((/MainPID=(\d+)/.exec(execFileSync('systemctl',['show','-p','MainPID','aqeelos'],{encoding:'utf8'}))||[])[1]);if(!pid)throw Error('the aqeelos service is not running');process.kill(pid)}
async function answers(){for(let i=0;i<45;i++){await sleep(1000);try{const r=await fetch('http://127.0.0.1:'+PORT+'/healthz',{signal:AbortSignal.timeout(3000)});if(r.ok)return true}catch{}}return false}

async function updateClone(latest){
 const cur=git(['rev-parse','HEAD']);if(cur===latest)return record('current','',cur,latest);
 if(git(['status','--porcelain','--','app','scripts','engine','server.mjs']))return record('refused','Files were edited on this server, so it was left alone. Commit or undo them.',cur,latest);
 git(['fetch','-q','origin','main']);
 if(tryGit(['merge-base','--is-ancestor',cur,latest])===null)return record('refused','This server has commits GitHub does not have ('+short(cur)+').',cur,latest);
 git(['merge','-q','--ff-only',latest]);
 try{for(const f of readdirSync(path.join(APP,'app')))if(f.endsWith('.mjs'))execFileSync(process.execPath,['--check',path.join(APP,'app',f)],{stdio:'ignore'});noteUpdate();restartService();if(!await answers())throw Error('it did not answer after the restart')}
 catch(e){git(['reset','-q','--hard',cur]);let back=false;try{restartService();back=await answers()}catch{}state.skip=latest;
  return record('failed',e.message+'. '+(back?'The previous version is back and answers.':'Going back to the previous version did not bring it up: check the server.'),cur,latest)}
 record('updated','',cur,latest)}

async function main(){const s=read(path.join(DATA,'install.json'),{});
 if(!NOW&&s.autoUpdate===false)return;
 if(!NOW&&!mayUpdateNow(new Date(),s))return;
 mkdirSync(DATA,{recursive:true});const L=path.join(DATA,'auto-update.lock');
 try{mkdirSync(L)}catch{if(Date.now()-statSync(L).mtimeMs<90*60000)return;rmdirSync(L);mkdirSync(L)}
 try{const repo=repoUrl();const latest=execFileSync('git',['ls-remote',repo,'refs/heads/main'],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','ignore']}).split(/\s/)[0];
  if(!/^[0-9a-f]{40}$/.test(latest))throw Error('GitHub did not say which version is newest');
  if(state.skip===latest)return;
  await (boxKind()?updateBox(repo,latest):updateClone(latest))}
 catch(e){record('failed',String(e.message||e).split('\n')[0].slice(0,300))}
 finally{try{rmdirSync(L)}catch{}}}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
