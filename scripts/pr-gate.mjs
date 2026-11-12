// The merge gate a pull request cannot weaken (security audit CR-9, 12 Nov 2026).
//
// Run by .github/workflows/fixer-gate.yml on `pull_request_target`: GitHub takes that workflow, this script and
// .github/fixer-gate.json from MAIN, never from the pull request, and this script never runs the pull request's code. It
// reads the pull request through the API (changed files, author, reviews) and answers:
//   auto   a small change inside the allow-list by a fixer: may merge by itself once the tests pass
//   owner  anything else: waits until the owner has approved exactly this commit
// "Small" and the allow-list are in .github/fixer-gate.json. An existing test may not be edited or deleted by an
// unapproved change (a new test file may be added), so the tests that gate a fix are main's own.
import {readFile,appendFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';

export const DEFAULTS={owner:'',fixerBranches:['claude/','fix/'],reviewAllUntil:'',maxLines:400,maxFiles:15,
 allow:['app/**','scripts/*.test.mjs','engine/patches/**'],
 // inside the allow-list, yet never without the owner: the fixers themselves, sign-in, sessions, rights, the update path
 never:['app/cloud-fixer.mjs','app/issues.mjs','app/fixer-git.mjs','app/fixer-watch.mjs','app/untrusted.mjs','app/users.mjs','app/account-auth.mjs','app/proxy-agent.mjs','app/agent-settings.mjs','app/agent-access.mjs','app/client-ip.mjs','app/install.mjs','app/install-routes.mjs','app/local-owner.mjs','app/secret-links.mjs','app/code.mjs','app/backup.mjs','app/live.mjs','app/apply-on-start.mjs']};
const rx=g=>new RegExp('^'+g.split('**').map(p=>p.split('*').map(x=>x.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*')+'$');
const any=(list,f)=>(list||[]).some(g=>rx(g).test(f));
// files: [{filename, status, additions, deletions, previous_filename}] as the GitHub API gives them
export function decide({files=[],author='',headRef='',headSha='',reviews=[],now=Date.now(),config={}}={}){
 const c={...DEFAULTS,...config},why=[],names=files.flatMap(f=>[f.filename,f.previous_filename].filter(Boolean));
 const fixer=c.fixerBranches.some(b=>String(headRef).startsWith(b))||/\[bot\]$/.test(String(author))||!c.owner||String(author).toLowerCase()!==String(c.owner).toLowerCase();
 for(const f of files){const n=f.filename,isTest=/^scripts\/[^/]+\.test\.mjs$/.test(n);
  if(f.previous_filename&&!any(c.allow,f.previous_filename)||!any(c.allow,n))why.push(n+' is outside what a fix may change by itself');
  else if(any(c.never,n)||f.previous_filename&&any(c.never,f.previous_filename))why.push(n+' is sign-in, rights, fixer or update code');
  else if(isTest&&f.status!=='added')why.push(n+' is an existing test ('+f.status+')');
  else if(f.previous_filename&&/^scripts\/[^/]+\.test\.mjs$/.test(f.previous_filename))why.push(f.previous_filename+' is an existing test (renamed)')}
 const lines=files.reduce((a,f)=>a+(f.additions||0)+(f.deletions||0),0);
 if(files.length>c.maxFiles)why.push(files.length+' files changed (at most '+c.maxFiles+')');if(lines>c.maxLines)why.push(lines+' lines changed (at most '+c.maxLines+')');
 if(!files.length)why.push('no changed files could be read');
 if(c.reviewAllUntil&&now<Date.parse(c.reviewAllUntil+'T23:59:59Z'))why.push('every fix is reviewed by the owner until '+c.reviewAllUntil);
 // the owner's own pull request from their own branch needs no second person (GitHub lets nobody approve their own)
 if(!fixer)return {ok:true,kind:'own',why:[],files:names.length,lines};
 if(!why.length)return {ok:true,kind:'auto',why:[],files:names.length,lines};
 // the owner's last word on exactly this commit
 const mine=reviews.filter(r=>String(r.user?.login||'').toLowerCase()===String(c.owner).toLowerCase()&&['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state)).sort((a,b)=>String(a.submitted_at).localeCompare(String(b.submitted_at))).at(-1);
 const approved=!!c.owner&&mine?.state==='APPROVED'&&mine.commit_id===headSha;
 return {ok:approved,kind:'owner',approved,why,files:names.length,lines}}

async function main(){const env=process.env,repo=env.GITHUB_REPOSITORY,n=env.PR_NUMBER,tok=env.GITHUB_TOKEN;if(!repo||!n)throw Error('GITHUB_REPOSITORY and PR_NUMBER are needed');
 const here=path.dirname(fileURLToPath(import.meta.url));const config=JSON.parse(await readFile(path.join(here,'..','.github','fixer-gate.json'),'utf8'));
 const api=async p=>{const out=[];for(let page=1;page<=30;page++){const r=await fetch('https://api.github.com/repos/'+repo+p+(p.includes('?')?'&':'?')+'per_page=100&page='+page,{headers:{accept:'application/vnd.github+json',...(tok?{authorization:'Bearer '+tok}:{})}});
   if(!r.ok)throw Error('GitHub answered '+r.status+' for '+p);const j=await r.json();if(!Array.isArray(j))return j;out.push(...j);if(j.length<100)break}return out};
 const pr=await api('/pulls/'+n),files=await api('/pulls/'+n+'/files'),reviews=await api('/pulls/'+n+'/reviews');
 if(pr.changed_files!==files.length)throw Error('GitHub lists '+files.length+' of '+pr.changed_files+' changed files: too large to check');
 const d=decide({files,author:pr.user?.login,headRef:pr.head?.ref,headSha:pr.head?.sha,reviews,config});
 const text=d.kind==='own'?'The owner\'s own pull request.':d.kind==='auto'?'A small fix inside app/, new tests and engine/patches ('+d.files+' files, '+d.lines+' lines): it may merge by itself once the tests pass.'
  :(d.approved?'Approved by the owner for this commit.':'Waits for the owner to approve this commit ('+String(pr.head?.sha).slice(0,8)+').')+'\n\nWhy it does not merge by itself:\n'+d.why.map(w=>'- '+w).join('\n');
 console.log(text);if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,'### Fixer gate\n\n'+text+'\n');if(env.GITHUB_OUTPUT)await appendFile(env.GITHUB_OUTPUT,'kind='+d.kind+'\nok='+d.ok+'\n');
 process.exit(d.ok?0:1)}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('fixer gate: '+e.message);process.exit(1)});
