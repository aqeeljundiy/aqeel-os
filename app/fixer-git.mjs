// The fixer ships through GitHub (GIT-2, 12 Nov 2026). Until now it edited the live code folder: the next deploy put the old
// file back, and nobody reviewed the change. Now a fix to aqeelOS's own code is made in a git checkout of its own, on a
// branch per issue (fix/<issue id>), proven on the test copy (:4402) and with the tests, committed here, then pushed with
// a GitHub token that may open pull requests (never push to main) and opened as a pull request. A person merges it; the
// normal deploy ships it. With no token yet the branch stays committed in the checkout ("waiting"), the live folder is
// still never touched, and the first time a token exists the waiting branches are pushed and their pull requests opened.
//   checkout  ~/apps/aqeel-os-src (the deploys' own copy; the repo and its branches live there)
//   work dir  ~/apps/aqeel-os-fixer/<issue id>  (a git worktree of that repo, so a deploy that checks out another commit in
//             ~/apps/aqeel-os-src never pulls the files from under a fix run)
// The token: AQEELOS_FIXER_GITHUB_TOKEN in the app's env, or the one line in DATA/fixer-github-token. Never logged.
import {execFile} from 'node:child_process';
import {mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_REPO='https://github.com/aqeeljundiy/aqeel-os.git';
const ID=/^[\w-]{1,40}$/;
export const branchOf=id=>{if(!ID.test(String(id||'')))throw Error('Unknown issue.');return 'fix/'+id};
// "owner/name" of a GitHub address (https or ssh)
export const repoSlug=u=>(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(u||''))||[]).slice(1,3).join('/')||'';
// files a fixer branch may never carry: keys, data, installed packages
export const unsafeFile=f=>/(^|\/)(\.env(?!\.example$)[^/]*|[^/]*\.pem|id_rsa[^/]*|[^/]*\.key|node_modules)(\/|$)|^data\//.test(String(f||''));
// the token goes in an environment header, so it is never in a command line (ps) or in a stored remote address
const authEnv=tok=>tok?{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+Buffer.from('x-access-token:'+tok).toString('base64')}:{};

export function createFixerGit({DATA,home,token=null,repo=()=>process.env.AQ_REPO||'',api='https://api.github.com',fetchFn=(...a)=>fetch(...a),log=()=>{}}){
 const src=path.join(home,'apps','aqeel-os-src'),workDir=id=>path.join(home,'apps','aqeel-os-fixer',id);
 const tokenOf=token||(async()=>(process.env.AQEELOS_FIXER_GITHUB_TOKEN||(await readFile(path.join(DATA,'fixer-github-token'),'utf8').catch(()=>''))).trim());
 const scrub=(s,tok)=>{s=String(s||'');return (tok?s.split(tok).join('***'):s).slice(0,600)};
 const git=(args,{cwd=src,tok=''}={})=>new Promise(res=>execFile('git',args,{cwd,env:{...process.env,GIT_TERMINAL_PROMPT:'0',...authEnv(tok)},timeout:180e3,maxBuffer:16e6},
  (e,out,err)=>res({ok:!e,out:String(out||'').trim(),err:scrub(err||e?.message,tok)})));
 const exists=f=>stat(f).then(()=>true,()=>false);
 const hasToken=async()=>!!await tokenOf().catch(()=>'');
 const originUrl=async()=>(await git(['config','--get','remote.origin.url'])).out||repo()||DEFAULT_REPO;
 // the checkout: made when it is not there yet (a private repo needs the token; without it, the checkout has to exist already)
 async function ensure(){const tok=await tokenOf().catch(()=>'');
  if(!await exists(path.join(src,'.git'))){await mkdir(path.dirname(src),{recursive:true});const c=await git(['clone','-q',repo()||DEFAULT_REPO,src],{cwd:path.dirname(src),tok});
   if(!c.ok)return {ok:false,why:'no checkout at '+src+' and it could not be made: '+c.err}}
  await git(['fetch','-q','origin','main'],{tok});   // best effort: a box that cannot reach GitHub still works from what it has
  const base=await git(['rev-parse','--verify','-q','origin/main^{commit}']);if(!base.out)return {ok:false,why:'the checkout has no main'};
  return {ok:true,base:base.out}}
 // a clean work dir on branch fix/<id>, cut from origin/main; whatever an earlier try left there is dropped
 async function prepare(id){const branch=branchOf(id),dir=workDir(id),e=await ensure();if(!e.ok)return e;
  await git(['worktree','remove','--force',dir]);await rm(dir,{recursive:true,force:true});await git(['worktree','prune']);
  await mkdir(path.dirname(dir),{recursive:true});const w=await git(['worktree','add','-q','-B',branch,dir,e.base]);
  return w.ok?{ok:true,dir,branch,base:e.base}:{ok:false,why:'the work dir could not be made: '+w.err}}
 const dirty=async id=>!!(await git(['status','--porcelain'],{cwd:workDir(id)})).out;
 // commit what the fixer left in the work dir (and the engine patch files, which go to engine/patches in the same pull request)
 async function finish(id,{message,engine=[]}){const dir=workDir(id);if(!await exists(dir))return {ok:false,why:'the work dir is gone'};
  for(const f of engine){if(!/^[\w.-]+\.patch$/.test(f.name))continue;await mkdir(path.join(dir,'engine','patches'),{recursive:true});await writeFile(path.join(dir,'engine','patches',f.name),f.text)}
  await git(['add','-A'],{cwd:dir});const names=(await git(['diff','--cached','--name-only','-z'],{cwd:dir})).out.split('\0').filter(Boolean);
  if(!names.length)return {ok:true,empty:true,files:[]};
  const bad=names.filter(unsafeFile);if(bad.length){await git(['reset','-q'],{cwd:dir});return {ok:false,why:'the change touches files a fix never may: '+bad.slice(0,4).join(', ')}}
  const c=await git(['-c','user.name=aqeelOS fixer','-c','user.email=fixer@aqeelos.invalid','commit','-q','-m',String(message||'aqeelOS fixer')],{cwd:dir});if(!c.ok)return {ok:false,why:'commit failed: '+c.err};
  const sha=(await git(['rev-parse','HEAD'],{cwd:dir})).out;await git(['worktree','remove','--force',dir]);   // the branch stays in the repo
  return {ok:true,sha,files:names}}
 // push the branch and open the pull request. state: waiting (no token), pr, error (retried later)
 async function publish(id,{title,body}){const branch=branchOf(id),tok=await tokenOf().catch(()=>'');if(!tok)return {state:'waiting'};
  const slug=repoSlug(await originUrl());if(!slug)return {state:'error',why:'the checkout\'s origin is not a GitHub address'};
  const p=await git(['push','-q','--force','origin','refs/heads/'+branch+':refs/heads/'+branch],{tok});if(!p.ok)return {state:'error',why:'push failed: '+p.err};
  const H={Authorization:'Bearer '+tok,Accept:'application/vnd.github+json','User-Agent':'aqeelos-fixer','X-GitHub-Api-Version':'2022-11-28'};
  try{const r=await fetchFn(api+'/repos/'+slug+'/pulls',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({title:String(title||branch).slice(0,200),head:branch,base:'main',body:String(body||'').slice(0,60000)}),signal:AbortSignal.timeout(30000)});
   const j=await r.json().catch(()=>({}));if(r.status===201)return {state:'pr',url:j.html_url,number:j.number};
   if(r.status===422){const q=await fetchFn(api+'/repos/'+slug+'/pulls?state=open&head='+encodeURIComponent(slug.split('/')[0]+':'+branch),{headers:H,signal:AbortSignal.timeout(30000)});const l=await q.json().catch(()=>[]);
    if(Array.isArray(l)&&l[0]?.html_url)return {state:'pr',url:l[0].html_url,number:l[0].number}}
   return {state:'error',why:'GitHub said '+r.status+': '+scrub(j.message||'',tok)}}
  catch(e){return {state:'error',why:scrub(e.message,tok)}}}
 // a merged pull request whose title starts with the issue id (the cloud fixer's, cloud-fixer.mjs); sha is short, as in .deployed-commits
 async function mergedPr(id){const tok=await tokenOf().catch(()=>''),slug=repoSlug(await originUrl());if(!tok||!slug||!ID.test(String(id||'')))return null;
  const r=await fetchFn(api+'/repos/'+slug+'/pulls?state=closed&sort=updated&direction=desc&per_page=50',{headers:{Authorization:'Bearer '+tok,Accept:'application/vnd.github+json','User-Agent':'aqeelos-fixer','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(30000)});
  const l=await r.json().catch(()=>[]),x=Array.isArray(l)&&l.find(y=>y.merged_at&&String(y.title||'').startsWith(id));return x?{url:x.html_url,number:x.number,sha:String(x.merge_commit_sha||'').slice(0,7)}:null}
 // the change as a diff against main, for the Health "View" button
 async function diff(id){const t=(await git(['diff','origin/main...'+branchOf(id)])).out;return t.length>400e3?t.slice(0,400e3)+'\n… (cut; the whole branch is in the checkout)':t}
 return {src,workDir,hasToken,mergedPr,ensure,prepare,dirty,finish,publish,diff}}
