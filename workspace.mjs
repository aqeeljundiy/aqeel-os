import {readFile,writeFile,mkdir,readdir,realpath,lstat,rename,unlink,rm,rmdir} from 'node:fs/promises';
import {killProcessesIn} from './platform.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {diffLines,markBlocks,blockText,revertBlock} from './diff.mjs';
export const buildSchema={type:'object',properties:{reply:{type:'string'},files:{type:'array',items:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}}},required:['reply','files'],additionalProperties:false};
// images are listed and served but never opened as text or included in AI context/snapshots
export const IMAGES=new Set(['.png','.jpg','.jpeg','.gif','.webp','.avif','.ico'])
export const isImage=name=>IMAGES.has(path.extname(name).toLowerCase())
const extensions=new Set(['.html','.css','.js','.mjs','.cjs','.jsx','.ts','.tsx','.json','.md','.txt','.svg','.astro','.vue','.svelte','.scss','.sass','.less','.yml','.yaml','.toml','.xml','.csv',...IMAGES]);
export function validateFile(name){if(typeof name!=='string'||name.length>180||/[\\:<>?"*|]/.test(name)||name.startsWith('/')||name.split('/').some(s=>!s||s==='.'||s==='..'||s.startsWith('.')||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))||!extensions.has(path.extname(name).toLowerCase()))throw Error('Use a relative HTML, CSS, JS, JSON, Markdown, text or SVG file path.');return name}
export class Workspace {
 constructor(root){this.root=root;this.projectsRoot=path.join(root,'projects');this.statePath=path.join(root,'workspace.json');this.queue=Promise.resolve()}
 async init(){await mkdir(this.projectsRoot,{recursive:true});try{this.state=JSON.parse(await readFile(this.statePath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;this.state={projects:[]};await this.createProject('First website')}return this}
 serialize(fn){const pending=this.queue.then(fn);this.queue=pending.catch(()=>{});return pending}
 async persist(){await writeFile(this.statePath+'.tmp',JSON.stringify(this.state,null,2));await rename(this.statePath+'.tmp',this.statePath)}
 project(id){const p=this.state.projects.find(p=>p.id===id);if(!p)throw Error('Project not found.');return p}
 async folder(id){const p=this.project(id);return p.path||path.join(this.projectsRoot,id)}
 async file(id,name){validateFile(name);const root=await this.folder(id);const target=path.join(root,name);let parent=target;while(parent!==root){try{const info=await lstat(parent);if(info.isSymbolicLink())throw Error('Linked files and folders cannot be edited here.')}catch(e){if(e.code!=='ENOENT')throw e}parent=path.dirname(parent)}const resolved=await realpath(root);if(process.platform==='win32'?resolved.toLowerCase()!==root.toLowerCase():resolved!==root)throw Error('Project folder must not be a symbolic link.');return target}
 async createProject(name){if(typeof name!=='string'||!name.trim()||name.length>80)throw Error('Name your project (up to 80 characters).');const id=randomUUID();const p={id,name:name.trim(),chats:[{id:randomUUID(),title:'New chat',messages:[]}],versions:[],createdAt:Date.now()};await mkdir(path.join(this.projectsRoot,id),{recursive:true});this.state.projects.push(p);await this.persist();return p}
 async createChat(id){const p=this.project(id);const chat={id:randomUUID(),title:'New chat',messages:[]};p.chats.unshift(chat);await this.persist();return chat}
 chat(id,chatId){const c=this.project(id).chats.find(c=>c.id===chatId);if(!c)throw Error('Chat not found.');return c}
 async listFiles(id){const root=await this.folder(id);const result=[];async function walk(dir,prefix=''){for(const item of await readdir(dir,{withFileTypes:true})){if(item.name.startsWith('.')||['node_modules','dist'].includes(item.name)||item.isSymbolicLink())continue;const name=prefix+item.name;if(result.length>=400)return;if(item.isDirectory())await walk(path.join(dir,item.name),name+'/');else if(extensions.has(path.extname(name))){result.push(name)}}}await walk(root);return result.sort()}
 async read(id,name){if(isImage(name))throw Error('Images open in the preview, not the text editor.');const content=await readFile(await this.file(id,name),'utf8');if(content.length>300000)throw Error('File too large for the editor.');return content}
 async context(id){let context='';for(const name of await this.listFiles(id)){if(isImage(name))continue;const text=await this.read(id,name);if(context.length+text.length>110000)break;context+='\nFILE '+name+'\n'+text+'\n'}return context}
 async apply(id,files,label){if(!Array.isArray(files)||files.length>40)throw Error('Too many files.');const seen=new Set();let size=0;for(const f of files){validateFile(f.path);if(seen.has(f.path))throw Error('Duplicate file path.');seen.add(f.path);if(typeof f.content!=='string'||(size+=f.content.length)>700000)throw Error('Generated files are too large.');await this.file(id,f.path)}if(!files.length)return;
 const version={id:randomUUID(),label,time:Date.now(),files:files.map(f=>f.path)};const backup=path.join(this.root,'versions',version.id);await mkdir(backup,{recursive:true});for(const f of files){const target=await this.file(id,f.path);let previous=null;try{previous=await readFile(target,'utf8')}catch(e){if(e.code!=='ENOENT')throw e}await writeFile(path.join(backup,encodeURIComponent(f.path)+'.json'),JSON.stringify({path:f.path,previous}));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,f.content)}this.project(id).versions.unshift(version);await this.persist();return version}
 async removeProject(id){const i=this.state.projects.findIndex(p=>p.id===id);if(i<0)return;const p=this.state.projects[i];
  // delete the app-made folder first (retrying while Windows releases files), and only then drop the project from the list;
  // folders you opened from elsewhere are never deleted from disk
  if(!p.path){try{await killProcessesIn(path.join(this.projectsRoot,id));await rm(path.join(this.projectsRoot,id),{recursive:true,force:true,maxRetries:10,retryDelay:300})}catch(e){if(e.code==='EBUSY'||e.code==='EPERM')throw Error('A program is still using this project folder. Close it (for example an editor or terminal open in that folder) and try again.');throw e}}
  this.state.projects.splice(i,1);await this.persist()}
 // remove app-made project folders that no project points to (left by an earlier failed delete)
 async sweep(){const keep=new Set(this.state.projects.map(p=>p.id));for(const d of await readdir(this.projectsRoot,{withFileTypes:true}).catch(()=>[]))if(d.isDirectory()&&!keep.has(d.name)){await killProcessesIn(path.join(this.projectsRoot,d.name));await rm(path.join(this.projectsRoot,d.name),{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{})}}
 async addFolder(folder,extra={}){const real=await realpath(folder);const info=await lstat(real);if(!info.isDirectory())throw Error('Choose a folder.');
  const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;const existing=this.state.projects.find(p=>p.path&&same(p.path,real));if(existing)return existing;
  const p={id:randomUUID(),name:extra.name||path.basename(real),path:real,chats:[{id:randomUUID(),title:'New chat',messages:[]}],versions:[],createdAt:Date.now(),...extra};this.state.projects.push(p);await this.persist();return p}
 async writeAsset(id,name,buffer){if(!isImage(name))throw Error('Upload PNG, JPEG, GIF, WebP, AVIF or ICO images.');if(buffer.length>8*1024*1024)throw Error('Images must be under 8 MB.');const target=await this.file(id,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,buffer);return name}
 async snapshot(id){const files={};for(const name of await this.listFiles(id)){if(isImage(name))continue;try{const text=await readFile(await this.file(id,name),'utf8');if(text.length<=300000)files[name]=text}catch{}}return files}
 async record(id,before,label){const after=await this.snapshot(id);const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(n=>before[n]!==after[n]).sort();if(!changed.length)return [];
  const version={id:randomUUID(),label,time:Date.now(),files:changed};const backup=path.join(this.root,'versions',version.id);await mkdir(backup,{recursive:true});
  for(const name of changed)await writeFile(path.join(backup,encodeURIComponent(name)+'.json'),JSON.stringify({path:name,previous:before[name]??null}));
  this.project(id).versions.unshift(version);await this.persist();return {id:version.id,files:changed}}
 async previous(versionId,name){return JSON.parse(await readFile(path.join(this.root,'versions',versionId,encodeURIComponent(name)+'.json'),'utf8')).previous}
 // Before/after contents for every file in a version (after = what is on disk now).
 async changes(id,versionId){const v=this.project(id).versions.find(v=>v.id===versionId);if(!v)throw Error('Version not found.');const out=[];
  for(const name of v.files){let before=null,after=null;try{before=await this.previous(versionId,name)}catch{}try{const t=await readFile(await this.file(id,name),'utf8');after=t.length>300000?'(file too large to compare)':t}catch(e){if(e.code!=='ENOENT')throw e}out.push({path:name,before,after})}return {version:v,files:out}}
 async revertFile(id,versionId,name){const v=this.project(id).versions.find(v=>v.id===versionId);if(!v||!v.files.includes(name))throw Error('That file is not part of this change.');const previous=await this.previous(versionId,name);
  const version=await this.apply(id,[{path:name,content:previous??''}],'Revert '+name);if(previous===null)await unlink(await this.file(id,name));return version}
 // undo one change block of a file in a version; refuses when the file changed since it was shown
 // Move or rename a file. Text files are recorded as a version (undo from Changes); images and very large files move as they are.
 async moveFile(id,from,to){if(from===to)return null;const src=await this.file(id,from),dest=await this.file(id,to);try{await lstat(src)}catch{throw Error(from+' no longer exists.')}try{await lstat(dest);throw Error(to+' already exists.')}catch(e){if(e.code!=='ENOENT')throw e}
  let content=null;if(!isImage(from)){content=await readFile(src,'utf8');if(content.length>600000)content=null}if(content===null||isImage(to)){await mkdir(path.dirname(dest),{recursive:true});await rename(src,dest);await this.prune(id,src);await this.persist();return null}
  const v=await this.apply(id,[{path:to,content},{path:from,content:''}],'Move '+from+' to '+to);await unlink(src);await this.prune(id,src);return v}
 // Delete a file; text files can be restored from Changes.
 // remove folders left empty by a move or delete, up to the project folder
 async prune(id,file){const root=await this.folder(id);let d=path.dirname(file);while(d.length>root.length&&d.startsWith(root)){try{await rmdir(d)}catch{break}d=path.dirname(d)}}
 async deleteFile(id,name){const p=await this.file(id,name);try{await lstat(p)}catch{throw Error(name+' no longer exists.')}if(isImage(name)){await unlink(p);await this.prune(id,p);return null}const content=await readFile(p,'utf8');if(content.length>600000){await unlink(p);await this.prune(id,p);return null}const v=await this.apply(id,[{path:name,content:''}],'Delete '+name);await unlink(p);await this.prune(id,p);return v}
 async revertBlock(id,versionId,name,index,expect){const v=this.project(id).versions.find(v=>v.id===versionId);if(!v||!v.files.includes(name))throw Error('That file is not part of this change.');const before=await this.previous(versionId,name);let after;try{after=await readFile(await this.file(id,name),'utf8')}catch{throw Error(name+' no longer exists.')}
  if(before===null)throw Error('Use Remove file for a new file.');const lines=diffLines(before,after);markBlocks(lines);if(blockText(lines,index)!==expect)throw Error(name+' changed since this list was shown. Refresh and try again.');
  return this.apply(id,[{path:name,content:revertBlock(lines,index)}],'Revert a change in '+name)}
 async restore(id,versionId){const p=this.project(id);const version=p.versions.find(v=>v.id===versionId);if(!version)throw Error('Version not found.');const files=[],remove=[];for(const name of version.files){const record=JSON.parse(await readFile(path.join(this.root,'versions',version.id,encodeURIComponent(name)+'.json'),'utf8'));files.push({path:name,content:record.previous??''});if(record.previous===null)remove.push(name)}const restored=await this.apply(id,files,'Restore before '+version.label);for(const name of remove)await unlink(await this.file(id,name));return restored}
}
