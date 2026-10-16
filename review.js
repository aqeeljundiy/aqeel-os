// Changes tab: every saved version with a line-by-line diff per file, per-file revert and full restore.
import {diffLines,hunks,stats,markBlocks,blockText} from './diff.mjs';
// "5 min ago" style times for the change list
const ago=t=>{const s=(Date.now()-t)/1000;if(s<60)return 'Just now';if(s<3600)return Math.round(s/60)+' min ago';if(s<86400)return Math.round(s/3600)+' h ago';if(s<604800)return Math.round(s/86400)+' d ago';return new Date(t).toLocaleDateString()};
import {confirmDialog,promptDialog} from './ui-kit.js';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

// a collapsible file diff (no actions); used by branch comparison
export function diffFile(f){const lines=f.skipped?[]:diffLines(f.before,f.after),{added,removed}=stats(lines);const kind=f.before===null?'Added':f.after===null?'Deleted':'Modified';
 const box=el('details','diff-file');box.open=lines.length<400;const head=el('summary','diff-head');head.append(el('span','diff-path',f.path),el('span','diff-kind '+kind.toLowerCase(),kind),el('span','diff-add','+'+added),el('span','diff-del','−'+removed));box.append(head);
 const table=el('div','diff-lines');table.setAttribute('role','table');table.setAttribute('aria-label','Changes in '+f.path);if(f.skipped)table.append(el('div','diff-note',f.skipped+'.'));
 for(const r of hunks(lines)){if(r.type==='skip'){table.append(el('div','diff-skip',r.count+' unchanged line'+(r.count>1?'s':'')));continue}const row=el('div','diff-row '+r.type);row.setAttribute('role','row');row.append(el('span','ln',r.old??''),el('span','ln',r.new??''),el('span','mark',r.type==='add'?'+':r.type==='del'?'−':' '),el('code','txt',r.text||' '));table.append(row)}
 box.append(table);return box}

export function createReview(ctx){
 const open=new Set();

 function fileDiff(versionId,f){
  const lines=diffLines(f.before,f.after),{added,removed}=stats(lines);
  const kind=f.before===null?'Added':f.after===null?'Deleted':'Modified';
  const box=el('details','diff-file');box.open=lines.length<400;
  const head=el('summary','diff-head');head.append(el('span','diff-path',f.path),el('span','diff-kind '+kind.toLowerCase(),kind),el('span','diff-add','+'+added),el('span','diff-del','−'+removed));
  const revert=el('button','diff-revert',kind==='Added'?'Remove file':'Revert file');revert.type='button';revert.title=kind==='Added'?'Delete this new file':'Put back the contents from before this change';
  revert.addEventListener('click',async e=>{e.preventDefault();if(!ctx.discard())return;if(!(await confirmDialog({title:(kind==='Added'?'Remove ':'Revert ')+f.path+'?',message:'This is saved as a new change, so you can undo it from this list.',confirm:kind==='Added'?'Remove file':'Revert file'})))return;
   try{await ctx.api('/revert-file',{projectId:ctx.projectId(),versionId,path:f.path});ctx.notify(f.path+(kind==='Added'?' removed.':' reverted.'));await ctx.afterChange()}catch(err){ctx.notify(err.message)}});
  head.append(revert);box.append(head);
  const table=el('div','diff-lines');table.setAttribute('role','table');table.setAttribute('aria-label','Changes in '+f.path);
  if(f.before===f.after)table.append(el('div','diff-note','No difference now — this file was changed back afterwards.'));
  const blocks=f.before!==null&&f.after!==null?markBlocks(lines):0;const seen=new Set();
  for(const r of hunks(lines)){if(r.type==='skip'){table.append(el('div','diff-skip',r.count+' unchanged line'+(r.count>1?'s':'')));continue}
   if(blocks>1&&r.block!==undefined&&!seen.has(r.block)){seen.add(r.block);const i=r.block,bar=el('div','diff-block');const undo=el('button','diff-block-revert','Revert this change');undo.type='button';undo.setAttribute('aria-label','Revert change '+(i+1)+' of '+blocks+' in '+f.path);
    undo.addEventListener('click',async()=>{if(!ctx.discard())return;try{await ctx.api('/revert-block',{projectId:ctx.projectId(),versionId,path:f.path,index:i,expect:blockText(lines,i)});ctx.notify('Change reverted in '+f.path+'. Saved as a new change.');await ctx.afterChange()}catch(err){ctx.notify(err.message)}});bar.append(undo);table.append(bar)}
   const row=el('div','diff-row '+r.type);row.setAttribute('role','row');row.append(el('span','ln',r.old??''),el('span','ln',r.new??''),el('span','mark',r.type==='add'?'+':r.type==='del'?'−':' '),el('code','txt',r.text||' '));
   // click a line to write a comment for the AI with the file and line reference
   if(ctx.comment){row.tabIndex=0;row.title='Comment on this line';const ask=async()=>{const line=r.new??r.old;const note=await promptDialog({title:'Comment on '+f.path+':'+line,label:'Your comment for the AI',confirm:'Add to message',max:1000});if(note)ctx.comment(f.path+' line '+line+(r.type==='del'?' (removed line)':'')+': `'+String(r.text).trim().slice(0,160)+'` — '+note)};row.addEventListener('click',ask);row.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();ask()}})}
   table.append(row)}
  box.append(table);return box}

 async function expand(row,v){const panel=row.querySelector('.version-diff');if(panel){panel.remove();open.delete(v.id);row.querySelector('.show-diff').textContent='Show changes';return}
  open.add(v.id);row.querySelector('.show-diff').textContent='Hide changes';const p=el('div','version-diff');p.append(el('p','diff-note','Loading changes…'));row.append(p);
  try{const data=await ctx.api('/changes?projectId='+ctx.projectId()+'&versionId='+v.id);p.replaceChildren(...data.files.map(f=>fileDiff(v.id,f)))}catch(err){p.replaceChildren(el('p','diff-note',err.message))}}

 function render(){
  const list=ctx.container();list.replaceChildren();const versions=ctx.project()?.versions||[];
  if(!versions.length){list.append(el('p','diff-note','No changes saved yet. Every AI run and manual save appears here.'));return}
  for(const v of versions){const row=el('article','version');row.dataset.version=v.id;
   const title=el('p','',v.label);const detail=el('small','version-meta');detail.append(el('span','',ago(v.time)),' · ',el('span','',v.files.length+(v.files.length>1?' files':' file')));detail.title=new Date(v.time).toLocaleString();const chips=el('div','version-files');for(const f of v.files.slice(0,8))chips.append(el('code','',f));if(v.files.length>8)chips.append(el('span','','+'+(v.files.length-8)+' more'));detail.append(chips);
   const actions=el('div','version-actions');const show=el('button','show-diff','Show changes');show.type='button';show.addEventListener('click',()=>expand(row,v));
   const restore=el('button','','Restore to before this');restore.title='Put every file back the way it was before this change. The restore is saved as a new change, so you can undo it.';restore.type='button';restore.addEventListener('click',async()=>{if(!ctx.discard())return;try{await ctx.api('/restore',{projectId:ctx.projectId(),versionId:v.id});ctx.notify('Previous contents restored. This restore is saved as a new change.');await ctx.afterChange()}catch(err){ctx.notify(err.message)}});
   actions.append(show,restore);row.append(title,detail,actions);list.append(row);if(open.has(v.id)){open.delete(v.id);expand(row,v)}}
 }

 async function openVersion(versionId){ctx.showTab();render();const row=ctx.container().querySelector(`[data-version="${versionId}"]`);if(!row)return ctx.notify('That change is no longer in the list.');if(!row.querySelector('.version-diff'))await expand(row,ctx.project().versions.find(v=>v.id===versionId));row.scrollIntoView({block:'start',behavior:'smooth'})}

 return {render,openVersion};
}
