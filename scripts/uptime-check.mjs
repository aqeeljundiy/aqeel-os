// SYS-50: is aqeelOS up? Run from outside the server by .github/workflows/uptime.yml (a server that is off cannot report itself).
//   AQEELOS_URLS  comma separated list of sites (a repository variable); AQEELOS_URL (one site) is the fallback; neither set = skip quietly
// A site is down only after 2 failed tries 30 s apart; its login page (the site's address with a slash) must answer 200.
// A down site fails the run (GitHub emails the owner on a failed scheduled workflow) and opens or updates ONE issue labelled `uptime`;
// the issue is closed with a comment when the site answers again. This repository is public, so neither an issue nor the log names
// the address: a site is called by a short code of its address (the same code every run), the list stays in the repository variable.
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const LABEL='uptime',TRIES=2,GAP_MS=30000,TIMEOUT_MS=20000;
export const parseUrls=(text)=>[...new Set(String(text||'').split(',').map(x=>x.trim().replace(/\/+$/,'')).filter(x=>/^https?:\/\/[^\s/]+/i.test(x)))];
export const siteCode=(url)=>createHash('sha256').update(String(url).toLowerCase()).digest('hex').slice(0,8);
export const issueTitle=(url)=>'aqeelOS is not answering (site '+siteCode(url)+')';

// up = the login page answered 200 within the timeout, at least once in `tries` tries `gap` ms apart
export async function isUp(url,{fetch:f=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),tries=TRIES,gap=GAP_MS,timeout=TIMEOUT_MS}={}){
 let last='';
 for(let i=1;i<=tries;i++){
  try{const r=await f(url+'/',{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'aqeelos-uptime-check'}});
   if(r.status===200)return {up:true,tries:i};last='answered '+r.status}
  catch(e){last=e?.name==='TimeoutError'?'no answer in '+timeout/1000+' s':'no connection'}
  if(i<tries)await sleep(gap)}
 return {up:false,tries,why:last}}

// the issue side: one open issue per site, found by its title among the open issues labelled `uptime`
export function createIssues({fetch:f=globalThis.fetch,repo,token,api='https://api.github.com'}){
 const call=async(method,p,body)=>{const r=await f(api+'/repos/'+repo+p,{method,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','content-type':'application/json','user-agent':'aqeelos-uptime-check'},body:body?JSON.stringify(body):undefined});
  if(!r.ok)throw Error('GitHub '+method+' '+p+' answered '+r.status);return r.status===204?null:r.json()};
 const text=(url,why)=>'The outside check could not reach this site: its login page did not answer 200 in 2 tries 30 s apart ('+why+').'+'\n\nThe site is listed in the repository variable AQEELOS_URLS (code '+siteCode(url)+'). Check the server host panel: if the server says Stopped, start it. The check closes this issue itself when the site answers again.';
 const open=async title=>{const l=await call('GET','/issues?state=open&labels='+LABEL+'&per_page=100');return (l||[]).find(i=>!i.pull_request&&i.title===title)||null};
 return {
  async down(url,why,now=new Date()){const title=issueTitle(url),have=await open(title),body=text(url,why)+'\n\nLast checked not answering: '+now.toISOString()+'.';
   if(have){await call('PATCH','/issues/'+have.number,{body});return {issue:have.number,created:false}}
   const c=await call('POST','/issues',{title,labels:[LABEL],body});
   return {issue:c.number,created:true}},
  async up(url,now=new Date()){const have=await open(issueTitle(url));if(!have)return {closed:null};
   await call('POST','/issues/'+have.number+'/comments',{body:'The site answers again ('+now.toISOString()+'). Closing.'});
   await call('PATCH','/issues/'+have.number,{state:'closed',state_reason:'completed'});return {closed:have.number}}}}

// the whole run; returns {down:[codes],skipped}. Exit code is the caller's: 1 when anything is down.
export async function run({env=process.env,fetch:f=globalThis.fetch,sleep,gap,log=console.log}={}){
 const urls=parseUrls(env.AQEELOS_URLS||env.AQEELOS_URL);
 if(!urls.length){log('::notice::Uptime check skipped: set the repository variable AQEELOS_URLS (comma separated site addresses).');return {down:[],skipped:true}}
 const issues=env.GITHUB_TOKEN&&env.GITHUB_REPOSITORY?createIssues({fetch:f,repo:env.GITHUB_REPOSITORY,token:env.GITHUB_TOKEN}):null;
 if(!issues)log('::warning::No GITHUB_TOKEN here: the job fails when a site is down, but no issue is opened.');
 const results=await Promise.all(urls.map(async u=>({u,code:siteCode(u),...await isUp(u,{fetch:f,sleep,gap})})));
 const down=[];
 for(const r of results){
  if(r.up){log('site '+r.code+' is up');if(issues)await issues.up(r.u).then(x=>{if(x.closed)log('site '+r.code+': issue #'+x.closed+' closed')},e=>log('::warning::site '+r.code+': '+e.message));continue}
  down.push(r.code);log('::error::site '+r.code+' is not answering ('+r.why+' after '+r.tries+' tries)');
  if(issues)await issues.down(r.u,r.why).then(x=>log('site '+r.code+': issue #'+x.issue+(x.created?' opened':' updated')),e=>log('::warning::site '+r.code+': '+e.message))}
 return {down,skipped:false}}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=await run();process.exit(r.down.length?1:0)}
