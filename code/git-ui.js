// New-project pop-up (empty, open folder, clone from GitHub) and the git bar in the workspace header.
import {openMenu,confirmDialog,promptDialog} from './ui-kit.js';
import {diffFile} from './review.js';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

export function createGitUI(ctx){
 let state=null,pr=null;

 async function cloneDialog(){
  const d=el('dialog','kit-dialog clone-dialog');const form=el('form');form.append(el('h2','','Clone from GitHub'));
  const note=el('p','kit-message','Loading your repositories…');form.append(note);
  const pickLabel=el('label','','Your repositories');pickLabel.htmlFor='clone-pick';const pick=el('select');pick.id='clone-pick';pick.dataset.ddWidth='420';pick.append(new Option('Loading…',''));
  const urlLabel=el('label','','Or paste a repository link or owner/name');urlLabel.htmlFor='clone-url';const url=el('input');url.id='clone-url';url.placeholder='github.com/owner/repository';url.autocomplete='off';
  const where=el('p','kit-message small-print','');
  const actions=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button','primary','Clone');actions.append(cancel,ok);
  form.append(pickLabel,pick,urlLabel,url,where,actions);d.append(form);document.body.append(d);d.showModal();
  let busy=false;const close=()=>{if(!busy){d.close();setTimeout(()=>d.remove(),180)}};cancel.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});
  try{const {login,repos}=await ctx.api('/github/repos');note.textContent='Signed in to GitHub as '+login+'. Cloned projects are saved in Documents › aqeelOS Code.';{const sw=el('button','link-button','Switch account');sw.type='button';sw.onclick=()=>accountsDialog();note.append(' ',sw)}pick.replaceChildren(new Option('Choose a repository',''));
   for(const r of repos){const o=new Option(r.nameWithOwner+(r.isPrivate?' · private':''),r.nameWithOwner);if(r.description)o.dataset.desc=r.description;pick.append(o)}}
  catch(err){note.textContent=err.message;pick.replaceChildren(new Option('Not available',''));pick.disabled=true}
  pick.addEventListener('change',()=>{if(pick.value)url.value=''});url.addEventListener('input',()=>{if(url.value)pick.value=''});
  form.onsubmit=async e=>{e.preventDefault();const repo=url.value.trim()||pick.value;if(!repo){url.focus();return}
   busy=true;ok.disabled=cancel.disabled=true;ok.textContent='Cloning…';where.textContent='Cloning '+repo+'. Large repositories can take a minute.';
   try{const p=await ctx.api('/github/clone',{repo});busy=false;close();ctx.notify('Cloned '+repo+'.');await ctx.openProject(p.id)}catch(err){busy=false;ok.disabled=cancel.disabled=false;ok.textContent='Clone';where.textContent=err.message}};
 }

 // pick a branch from a list
 async function pickBranch(title,confirm,preferred){const {branches}=await ctx.api('/git/branches?projectId='+ctx.projectId());const others=branches.filter(b=>b!==state?.branch);if(!others.length){ctx.notify('There are no other branches.');return null}
  return new Promise(resolve=>{const d=el('dialog','kit-dialog');const form=el('form');form.append(el('h2','',title));const label=el('label','','Branch');label.htmlFor='branch-pick';const pick=el('select');pick.id='branch-pick';for(const b of others)pick.append(new Option(b,b));pick.value=others.includes(preferred)?preferred:others.find(b=>/^(origin\/)?(main|master)$/.test(b))||others[0];
   const actions=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button','primary',confirm);actions.append(cancel,ok);form.append(label,pick,actions);d.append(form);document.body.append(d);d.showModal();
   const done=v=>{d.close();setTimeout(()=>d.remove(),180);resolve(v)};cancel.onclick=()=>done(null);d.addEventListener('cancel',e=>{e.preventDefault();done(null)});form.onsubmit=e=>{e.preventDefault();done(pick.value)}})}

 async function compare(){const base=await pickBranch('Compare with a branch','Compare',state?.upstream);if(!base)return;const d=el('dialog','kit-dialog compare-branches');const head=el('div','compare-head');const title=el('h2','','Changes since '+base);const close=el('button','dialog-x','×');close.type='button';close.setAttribute('aria-label','Close');close.title='Close';head.append(title,close);
  const body=el('div','compare-body');body.append(el('p','diff-note','Loading…'));d.append(head,body);document.body.append(d);d.showModal();const shut=()=>{d.close();setTimeout(()=>d.remove(),180)};close.onclick=shut;d.addEventListener('cancel',e=>{e.preventDefault();shut()});
  try{const r=await ctx.api('/git/compare?projectId='+ctx.projectId()+'&base='+encodeURIComponent(base));const note=el('p','diff-note',r.total?r.total+(r.total>1?' files differ':' file differs')+' from '+base+' (merge base '+r.mergeBase+'), including uncommitted changes.'+(r.total>r.files.length?' Showing the first '+r.files.length+'.':''):'No differences from '+base+'.');
   const ask=el('button','','Ask the AI to review');ask.type='button';ask.onclick=()=>{shut();ctx.askAI('Review the changes on this branch compared with '+base+' (git diff '+base+'...HEAD plus uncommitted changes). Point out bugs, risky changes and missing tests. Do not modify files.')};
   body.replaceChildren(note,...(r.total?[ask]:[]),...r.files.map(diffFile))}catch(err){body.replaceChildren(el('p','diff-note',err.message))}}

 // open a pull request for the current branch (pushes it first when needed)
 async function createPR(){let branches=[];try{branches=(await ctx.api('/git/branches?projectId='+ctx.projectId())).branches.filter(b=>b.startsWith('origin/')).map(b=>b.slice(7)).filter(b=>b!==state.branch)}catch{}
  const d=el('dialog','kit-dialog');const form=el('form');form.append(el('h2','','Open a pull request'));const tl=el('label','','Title');tl.htmlFor='pr-title';const title=el('input');title.id='pr-title';title.maxLength=200;title.required=true;
  const bl=el('label','','Description');bl.htmlFor='pr-body';const body=el('textarea');body.id='pr-body';body.rows=5;const basel=el('label','','Merge into');basel.htmlFor='pr-base';const base=el('select');base.id='pr-base';for(const b of branches)base.append(new Option(b,b));base.value=branches.find(b=>/^(main|master)$/.test(b))||branches[0]||'';if(!branches.length)base.append(new Option('Repository default',''));
  const draftRow=el('label','kit-choice');const draft=el('input');draft.type='checkbox';const dt=el('span');dt.append(el('strong','','Draft'),el('small','','Not ready for review yet'));draftRow.append(draft,dt);
  const note=el('p','kit-message small-print',(state.upstream&&!state.ahead?'':'This pushes '+state.branch+' to GitHub first. ')+'The pull request is visible to everyone with access to '+(state.github||'the repository')+'.'+(state.changed?' Uncommitted changes are not included.':''));
  const ai=el('button','','Let the AI write it');ai.type='button';const actions=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button','primary','Push and open');actions.append(cancel,ok);form.append(tl,title,bl,body,basel,base,draftRow,note,ai,actions);d.append(form);document.body.append(d);d.showModal();title.focus();
  let busy=false;const close=()=>{if(!busy){d.close();setTimeout(()=>d.remove(),180)}};cancel.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});ai.onclick=()=>{close();ctx.askAI('Open a pull request for the current branch'+(base.value?' into '+base.value:'')+'. Read the commits and diff, write a clear title and description, and use gh pr create. Ask me before pushing.',{mode:'ask'})};
  form.onsubmit=async e=>{e.preventDefault();busy=true;ok.disabled=cancel.disabled=true;ok.textContent='Opening…';try{const r=await ctx.api('/git/pr/create',{projectId:ctx.projectId(),title:title.value,body:body.value,base:base.value,draft:draft.checked});busy=false;close();ctx.notify('Pull request opened.');if(r.url)window.open(r.url,'_blank','noopener');await refresh()}catch(err){busy=false;ok.disabled=cancel.disabled=false;ok.textContent='Push and open';note.textContent=err.message}}}

 // reviews and comments on the branch's pull request, with a hand-off to the AI
 async function reviewComments(){const d=el('dialog','kit-dialog compare-branches');const head=el('div','compare-head');head.append(el('h2','','Review comments · PR #'+pr.number));const x=el('button','dialog-x','×');x.type='button';x.setAttribute('aria-label','Close');x.title='Close';head.append(x);const body=el('div','compare-body');body.append(el('p','diff-note','Loading…'));d.append(head,body);document.body.append(d);d.showModal();const shut=()=>{d.close();setTimeout(()=>d.remove(),180)};x.onclick=shut;d.addEventListener('cancel',e=>{e.preventDefault();shut()});
  try{const r=await ctx.api('/git/pr/comments?projectId='+ctx.projectId());if(!r.items.length){body.replaceChildren(el('p','diff-note','No reviews or comments yet.'));return}
   const ask=el('button','primary','Ask the AI to address these');ask.type='button';ask.onclick=()=>{shut();ctx.askAI('Address the review feedback on pull request '+r.url+'. Feedback:\n'+r.items.map(i=>'- '+(i.path?i.path+(i.line?':'+i.line:'')+' ':'')+'('+i.author+(i.state?', '+i.state.toLowerCase().replace('_',' '):'')+'): '+i.body.replace(/\s+/g,' ').slice(0,800)).join('\n')+'\nMake the changes, commit them, and ask me before pushing.',{mode:'ask'})};
   body.replaceChildren(ask,...r.items.map(i=>{const c=el('div','pr-comment');const meta=el('small','',(i.author||'someone')+(i.state?' · '+i.state.toLowerCase().replace('_',' '):'')+(i.path?' · '+i.path+(i.line?':'+i.line:''):'')+(i.time?' · '+new Date(i.time).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''));c.append(meta,el('p','',i.body||'(no text)'));return c}))}catch(err){body.replaceChildren(el('p','diff-note',err.message))}}

 async function merge(){const branch=await pickBranch('Merge a branch into '+(state?.branch||'this branch'),'Merge',state?.upstream);if(!branch)return;if(state?.changed&&!(await confirmDialog({title:'Merge with uncommitted changes?',message:'Commit first if you can. git refuses merges that would overwrite uncommitted files.',confirm:'Merge anyway'})))return;run('merge',{branch},'Merged '+branch+'.')}

 // GitHub Pages: the AI does the work in Ask mode so every push and repository change waits for approval
 async function publish(){const gh=state?.git?state.github:null;if(!(await confirmDialog({title:'Publish this site to GitHub Pages?',message:(gh?'The AI will turn on GitHub Pages for '+gh+'.':'The AI will create a new GitHub repository for this project, push it and turn on GitHub Pages.')+' The site will be public on the internet. The chat switches to Ask mode, so you approve each command, including every push.',confirm:'Continue'})))return;
  ctx.askAI('Publish this project as a static website on GitHub Pages.\n1. '+(gh?'The repository is '+gh+'.':'This project has no GitHub repository yet. Ask me for a repository name, then create it with gh repo create (public, since Pages on free plans needs a public repository) and add it as origin.')+'\n2. If the site needs a build step (package.json build script), add a GitHub Actions workflow that builds it and deploys the output with actions/deploy-pages; otherwise publish the default branch root.\n3. Enable Pages with gh api (repos/OWNER/REPO/pages).\n4. Ask me before every push.\n5. Wait for the first deployment, then reply with the public URL.',{mode:'ask'})}

 async function openFolder(){if(ctx.online?.())return ctx.pickBoxFolder?.();try{ctx.notify('Choose a folder in the window that opened on your computer.');const p=await ctx.api('/project/open',{});if(p.cancelled)return;ctx.notify('Opened '+p.name+'.');await ctx.openProject(p.id)}catch(err){ctx.notify(err.message)}}
 // three ways to start, as cards in a centred pop-up
 function newProjectMenu(){
  const ICON={empty:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
   folder:'<path d="M3 18V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 18l2.6-6.2A2 2 0 0 1 7.4 10.5H21l-2.8 7A2 2 0 0 1 16.3 19H4a1 1 0 0 1-1-1z"/>',
   clone:'<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.2v7.6M18 10.2c0 4-6 3-10.5 6.3"/>',
   team:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>'};
  const choices=[['empty','Empty project','A fresh folder made by the app. Describe what to build in the chat.',()=>ctx.newEmpty()],
   ['folder','Open a folder','Work on files you already have on this computer.',openFolder],
   ['clone','Clone from GitHub','Copy one of your repositories, or any public one, and work on it.',cloneDialog],
   ...(ctx.teamJoin&&!ctx.online?.()?[['team','From your team','Get a folder a teammate shared with you, then push and pull together.',()=>ctx.teamJoin()]]:[])];
  const d=el('dialog','kit-dialog new-project-dialog');d.setAttribute('aria-labelledby','np-title');
  const head=el('div','np-head');const title=el('h2','','New project');title.id='np-title';const x=el('button','dialog-x','×');x.type='button';x.setAttribute('aria-label','Close');x.title='Close';head.append(title,x);
  const grid=el('div','np-cards');
  for(const [key,name,text,run] of choices){const c=el('button','np-card');c.type='button';const ic=el('span','np-icon');ic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICON[key]+'</svg>';c.append(ic,el('strong','',name),el('span','np-text',text));c.addEventListener('click',()=>{close();run()});grid.append(c)}
  d.append(head,grid);document.body.append(d);const close=()=>{d.close();setTimeout(()=>d.remove(),180)};x.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});d.addEventListener('click',e=>{if(e.target===d)close()});d.showModal();grid.firstChild.focus()}

 async function run(action,extra={},done){try{ctx.setBusyText?.(action);const r=await ctx.api('/git/run',{projectId:ctx.projectId(),action,...extra});ctx.notify(done||('git '+action+' finished.'));await ctx.afterChange();return r}catch(err){ctx.notify(err.message)}finally{await refresh()}}

 function render(){
  const bar=ctx.bar();bar.replaceChildren();bar.hidden=!state?.git;if(!state?.git)return;
  if(state.error){bar.append(el('span','git-branch',state.error));return}
  const branch=el('span','git-branch');branch.append(el('span','git-icon','⎇'),state.branch||'no branch');branch.title=(state.upstream?'Tracking '+state.upstream:'No upstream branch')+(state.github?' · github.com/'+state.github:'');
  const conflicts=el('button','git-conflicts');conflicts.type='button';conflicts.hidden=!state.conflicts;conflicts.textContent=state.conflicts+' conflict'+(state.conflicts>1?'s':'');conflicts.title='Files with merge conflicts';
  conflicts.onclick=()=>openMenu(conflicts,[{label:'Ask the AI to resolve the conflicts',hint:'You approve each edit',action:()=>ctx.askAI('This repository has merge conflicts ('+state.conflicts+' file'+(state.conflicts>1?'s':'')+'). Run git status and git diff to find them, explain each conflict briefly, resolve them by keeping the intent of both sides, remove every conflict marker, run the tests if there are any, then stage the files and finish the merge with git commit --no-edit. Ask me if a conflict needs a product decision.')},{label:'Cancel the merge…',danger:true,action:async()=>{if(await confirmDialog({title:'Cancel the merge?',message:'Puts the files back as they were before the merge started.',confirm:'Cancel merge',danger:true}))run('merge-abort',{},'Merge cancelled.')}}],{anchor:conflicts,label:'Merge conflicts'});
  const counts=el('span','git-counts');if(state.behind)counts.append(el('span','behind','↓'+state.behind));if(state.ahead)counts.append(el('span','ahead','↑'+state.ahead));counts.append(el('span','changed',state.changed?state.changed+' changed':'clean'));
  const pull=el('button','',state.behind?'Pull ↓'+state.behind:'Pull');pull.type='button';pull.title='Fast-forward from the remote. Recorded in Changes.';pull.onclick=()=>run('pull',{},'Pulled. Changes are listed in the Changes tab.');
  const commit=el('button','','Commit');commit.type='button';commit.disabled=!state.changed;commit.onclick=async()=>{const message=await promptDialog({title:'Commit '+state.changed+' changed file'+(state.changed>1?'s':''),label:'Commit message',confirm:'Commit',max:300});if(message)run('commit',{message},'Committed.')};
  const push=el('button','','Push'+(state.ahead?' ↑'+state.ahead:''));push.type='button';push.disabled=!state.ahead;push.onclick=async()=>{if(await confirmDialog({title:'Push to '+(state.upstream||'the remote')+'?',message:'This publishes '+state.ahead+' commit'+(state.ahead>1?'s':'')+' to GitHub, where others with access can see them.',confirm:'Push'}))run('push',{},'Pushed to '+(state.upstream||'remote')+'.')};
  const more=el('button','tree-more git-more','⋯');more.type='button';more.setAttribute('aria-label','More git actions');more.onclick=()=>openMenu(more,[
   {label:'Fetch',action:()=>run('fetch',{},'Fetched from remote.')},
   {label:'Compare with a branch…',hint:'Diff',action:()=>compare().catch(e=>ctx.notify(e.message))},
   {label:'Merge a branch…',action:()=>merge().catch(e=>ctx.notify(e.message))},
   {label:'Ask the AI to commit',hint:'Writes the message',action:()=>ctx.askAI('Review the uncommitted changes in this repository and commit them with a clear, conventional commit message. Do not push.')},
   ...(state.github&&!pr&&state.branch&&!/^(main|master)$/.test(state.branch)?[{label:'Open a pull request…',action:()=>createPR()}]:[]),
   {label:'Ask the AI to open a pull request',action:()=>ctx.askAI('Create a new branch for the current changes if needed, commit them, push the branch and open a pull request with a clear title and description using gh. Ask me before pushing.',{mode:'ask'})},
   {label:'Publish to GitHub Pages…',action:()=>publish()},
   ...(state.github?[{label:'Open on GitHub',action:()=>window.open('https://github.com/'+state.github,'_blank','noopener')}]:[]),
   'separator',{label:'New worktree for a branch…',hint:'Parallel work',action:async()=>{const branch=await promptDialog({title:'New worktree',label:'New branch name',confirm:'Create',max:60});if(!branch)return;try{const w=await ctx.api('/git/worktree',{projectId:ctx.projectId(),branch});ctx.notify('Worktree ready: '+w.name);await ctx.openProject(w.id)}catch(e){ctx.notify(e.message)}}},
   ...(ctx.project()?.worktreeOf?[{label:'Remove this worktree…',danger:true,action:async()=>{if(!(await confirmDialog({title:'Remove this worktree?',message:'Deletes the worktree folder. Commits on its branch stay in the repository.',confirm:'Remove',danger:true})))return;try{await ctx.api('/git/worktree/remove',{projectId:ctx.projectId()});ctx.notify('Worktree removed.');await ctx.openProject(ctx.project().worktreeOf)}catch(e){ctx.notify(e.message+' (commit or discard its changes first)')}}}]:[]),
  ],{anchor:more,label:'Git actions'});
  const prChip=el('button','pr-chip');prChip.type='button';prChip.hidden=!pr;if(pr){const failing=pr.checks.filter(c=>['failure','error','cancelled','timed_out','action_required'].includes(c.state)).length,passing=pr.checks.filter(c=>['success','neutral','skipped'].includes(c.state)).length,pending=pr.checks.length-failing-passing;
   prChip.classList.toggle('failing',failing>0);prChip.textContent='PR #'+pr.number+(pr.checks.length?' · '+(failing?failing+' failing':pending?pending+' running':'checks pass'):'')+(pr.reviewDecision==='CHANGES_REQUESTED'?' · changes requested':pr.reviewDecision==='APPROVED'?' · approved':'')+(pr.state!=='OPEN'?' · '+pr.state.toLowerCase():'');prChip.title=pr.title;
   prChip.onclick=()=>openMenu(prChip,[{label:'Open pull request on GitHub',action:()=>window.open(pr.url,'_blank','noopener')},{label:'Review comments'+(pr.feedback?' ('+pr.feedback+')':''),action:()=>reviewComments()},...(failing?[{label:'Ask the AI to fix failing checks',action:()=>ctx.askAI('The pull request '+pr.url+' has failing CI checks: '+pr.checks.filter(c=>['failure','error','cancelled','timed_out'].includes(c.state)).map(c=>c.name).join(', ')+'. Use gh run view --log-failed to read the logs, fix the causes, commit, and ask me before pushing.')}]:[]),
    ...(pr.state==='OPEN'?[{label:'Merge (squash)…',action:async()=>{if(!(await confirmDialog({title:'Merge PR #'+pr.number+'?',message:'Squash-merges “'+pr.title+'” into its base branch on GitHub.'+(failing?' Some checks are failing.':''),confirm:'Merge',danger:failing>0})))return;try{await ctx.api('/git/pr/merge',{projectId:ctx.projectId()});ctx.notify('Pull request merged.');refresh()}catch(e){ctx.notify(e.message)}}}]:[])],{anchor:prChip,label:'Pull request'})}
  // mid-merge: pull, commit and push cannot run until the conflicts are resolved
  if(state.conflicts)bar.append(branch,conflicts,prChip,more);else bar.append(branch,counts,prChip,pull,commit,push,more);
 }

 async function refresh(){const id=ctx.projectId();if(!id)return;try{const s=await ctx.api('/git?projectId='+id);if(id===ctx.projectId()){state=s;pr=null;render()}if(s.git&&s.github){const r=await ctx.api('/git/pr?projectId='+id);if(id===ctx.projectId()){pr=r.pr;render()}}}catch{state=null;render()}}

 // GitHub accounts: see which one is active, switch, or sign in to another one
 async function accountsDialog(){const d=el('dialog','kit-dialog gh-accounts');const head=el('div','np-head');const title=el('h2','','GitHub accounts');const x=el('button','dialog-x','×');x.type='button';x.setAttribute('aria-label','Close');head.append(title,x);
  const note=el('p','kit-message','Pushes, pull requests and cloning use the active account.');const list=el('div','gh-list');const add=el('button','','Sign in to another account');add.type='button';const status=el('p','kit-message gh-status');status.hidden=true;
  d.append(head,note,list,status,add);document.body.append(d);let poll=null;const close=()=>{clearInterval(poll);d.close();setTimeout(()=>d.remove(),180)};x.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});d.showModal();
  async function load(){try{const {accounts}=await ctx.api('/github/accounts');list.replaceChildren();if(!accounts.length)list.append(el('p','kit-message','Not signed in to GitHub yet.'));
    for(const a of accounts){const row=el('div','gh-row'+(a.active?' on':''));row.append(el('strong','',a.user));if(a.active)row.append(el('span','chip','Active'));else{const b=el('button','','Use this one');b.type='button';b.onclick=async()=>{b.disabled=true;try{await ctx.api('/github/account/switch',{user:a.user});ctx.notify('GitHub now uses '+a.user+'.');await load();void refresh()}catch(e){ctx.notify(e.message);b.disabled=false}};row.append(b)}list.append(row)}return accounts}catch(e){list.replaceChildren(el('p','kit-message',e.message));return []}}
  add.onclick=async()=>{add.disabled=true;try{const before=(await load()).length;const {code}=await ctx.api('/github/account/add',{});status.hidden=false;status.textContent='Your browser opened github.com. Enter the code '+code+' there and approve. This window updates when it is done.';
    poll=setInterval(async()=>{const now=await load();if(now.length>before){clearInterval(poll);status.textContent='Signed in. Switch accounts above.';add.disabled=false}},3000)}catch(e){ctx.notify(e.message);add.disabled=false}};
  await load()}
 return {refresh,newProjectMenu,cloneDialog,publish,accountsDialog,newEmpty:()=>ctx.newEmpty(),openFolder};
}
