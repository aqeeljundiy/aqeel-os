// Composer extras: image attachments (paste, drop or pick) and @-mentions of project files.
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const IMAGE=/^image\/(png|jpeg|webp|gif)$/,DOC=/\.(xlsx|xls|pdf|txt|md|csv|tsv|json|xml|yaml|yml|toml|ini|log|html|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sh|ps1|sql|vue|svelte)$/i;
const attachable=f=>IMAGE.test(f.type)||DOC.test(f.name||'');

// subsequence match with a score that prefers matches in the file name and earlier positions
export function fuzzy(query,name){if(!query)return 1;const q=query.toLowerCase(),n=name.toLowerCase();let i=0,score=0,last=-1;
 for(let j=0;j<n.length&&i<q.length;j++)if(n[j]===q[i]){score+=last===j-1?3:1;if(j>n.lastIndexOf('/'))score+=1;last=j;i++}
 return i===q.length?score-n.length*0.01:0}

export function createComposer(ctx){
 const area=ctx.textarea(),form=ctx.form();let attachments=[],files=null,filesFor=null,menu=null,active=0,matches=[];
 const tray=el('div','attach-tray');tray.hidden=true;form.prepend(tray);
 const picker=el('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp,image/gif,'+'.xlsx,.xls,.pdf,.txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.toml,.ini,.log,.html,.css,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cs,.php,.sh,.ps1,.sql,.vue,.svelte';picker.multiple=true;picker.hidden=true;form.append(picker);
 const clip=el('button','attach-button');clip.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';clip.type='button';clip.title='Attach images or files';clip.setAttribute('aria-label','Attach images or files');clip.addEventListener('click',()=>picker.click());ctx.controls().querySelector('.composer-tools').prepend(clip);

 // dictation through the browser's speech service; needs a secure page (localhost on the computer), so it is hidden on the phone's LAN address
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(Speech&&window.isSecureContext){const mic=el('button','attach-button mic');mic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';mic.type='button';mic.title='Dictate (uses your browser\'s speech service)';mic.setAttribute('aria-label','Dictate');mic.setAttribute('aria-pressed','false');clip.after(mic);let rec=null;
  // dictation language: English or Bahasa Indonesia, remembered; starts from the app language
  const LANGS={en:['EN','en-US','English'],id:['ID','id-ID','Bahasa Indonesia']};let dl=null;try{dl=localStorage.getItem('cba-dict-lang')}catch{}
  if(!LANGS[dl])dl=document.documentElement.lang==='id'||/^id/i.test(navigator.language)?'id':'en';
  const langBtn=el('button','attach-button dict-lang');langBtn.type='button';
  const paintLang=()=>{langBtn.textContent=LANGS[dl][0];langBtn.title='Dictation language: '+LANGS[dl][2];langBtn.setAttribute('aria-label',langBtn.title)};paintLang();
  langBtn.addEventListener('click',()=>{dl=dl==='en'?'id':'en';try{localStorage.setItem('cba-dict-lang',dl)}catch{}paintLang();langBtn.classList.remove('flip');void langBtn.offsetWidth;langBtn.classList.add('flip');rec?.stop()});mic.after(langBtn);
  const stop=()=>{rec?.stop()};mic.addEventListener('click',()=>{if(rec)return stop();rec=new Speech();rec.lang=LANGS[dl][1];rec.interimResults=true;rec.continuous=true;const start=area.selectionStart,end=area.selectionEnd,before=area.value.slice(0,start),after=area.value.slice(end);const pad=before&&!/\s$/.test(before)?' ':'';
   rec.onresult=e=>{let text='';for(const r of e.results)text+=r[0].transcript;area.value=before+pad+text+after;const at=(before+pad+text).length;area.setSelectionRange(at,at);area.dispatchEvent(new Event('input'))};
   rec.onerror=e=>{if(e.error!=='aborted'&&e.error!=='no-speech')ctx.notify(e.error==='not-allowed'?'Microphone access was blocked.':'Dictation stopped: '+e.error)};rec.onend=()=>{rec=null;mic.classList.remove('on');mic.setAttribute('aria-pressed','false')};
   try{rec.start();mic.classList.add('on');mic.setAttribute('aria-pressed','true');area.focus()}catch(err){rec=null;ctx.notify(err.message)}});area.addEventListener('keydown',e=>{if(rec&&e.key==='Escape'){e.preventDefault();stop()}},true)}
 function paintTray(){tray.replaceChildren();tray.hidden=!attachments.length;for(const a of attachments){const chip=el('figure','attach-chip'+(a.preview?'':' doc'));const img=a.preview?el('img'):el('span','attach-doc',a.name);if(a.preview){img.src=a.preview;img.alt=a.name}else img.title=a.name;const x=el('button','attach-remove','×');x.type='button';x.setAttribute('aria-label','Remove '+a.name);x.addEventListener('click',()=>{attachments=attachments.filter(b=>b!==a);paintTray()});
  chip.append(img,x);if(a.uploading)chip.classList.add('uploading');tray.append(chip)}}
 async function add(list){for(const file of list){if(!attachable(file)){ctx.notify(file.name+' cannot be attached. Attach images, PDFs, or text and code files.');continue}if(file.size>8*1024*1024){ctx.notify(file.name+' is larger than 8 MB.');continue}if(attachments.length>=6){ctx.notify('Attach up to 6 files.');break}
  const a={name:file.name||'pasted image',preview:IMAGE.test(file.type)?URL.createObjectURL(file):null,uploading:true};attachments.push(a);paintTray();
  try{const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(file)});const up=await ctx.api('/upload',{name:a.name,type:IMAGE.test(file.type)?file.type:'',data});a.id=up.id;a.uploading=false}
  catch(e){attachments=attachments.filter(b=>b!==a);ctx.notify(e.message)}paintTray()}}
 picker.addEventListener('change',()=>{add([...picker.files]);picker.value=''});
 area.addEventListener('paste',e=>{const imgs=[...(e.clipboardData?.files||[])].filter(attachable);if(imgs.length){e.preventDefault();add(imgs);return}
  // very long pasted text (logs, files) becomes a text attachment, like Claude Code
  const text=e.clipboardData?.getData('text/plain')||'';const lines=text.split(/\r?\n/).length;if(lines>80||text.length>6000){e.preventDefault();add([new File([text],'pasted-'+lines+'-lines.txt',{type:'text/plain'})]);ctx.notify('Long paste added as an attachment ('+lines+' lines).')}});
 form.addEventListener('dragover',e=>{if([...e.dataTransfer.items].some(i=>i.kind==='file')){e.preventDefault();form.classList.add('dropping')}});
 form.addEventListener('dragleave',()=>form.classList.remove('dropping'));
 form.addEventListener('drop',e=>{form.classList.remove('dropping');const imgs=[...e.dataTransfer.files].filter(attachable);if(imgs.length){e.preventDefault();add(imgs)}});

 // @-mentions
 function close(){menu?.remove();menu=null;area.removeAttribute('aria-activedescendant')}
 // "/" at the very start opens the slash-command menu
 let slashMode=false;
 function slash(){const m=area.value.match(/^\/([\w-]*)$/);if(!m||!ctx.commands)return false;const list=ctx.commands().map(c=>[c,fuzzy(m[1],c.name)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);if(!list.length){close();return true}
  slashMode=true;matches=list;active=Math.min(active,list.length-1);if(!menu){menu=el('div','mention-menu');menu.setAttribute('role','listbox');menu.id='mention-list';form.append(menu)}
  menu.replaceChildren(...list.map((c,i)=>{const o=el('div','mention-option'+(i===active?' active':''));o.id='mention-'+i;o.setAttribute('role','option');o.setAttribute('aria-selected',String(i===active));o.append(el('strong','','/'+c.name),el('small','',c.description));o.addEventListener('mousedown',e=>{e.preventDefault();pick(i)});return o}));area.setAttribute('aria-activedescendant','mention-'+active);return true}
 async function mention(){slashMode=false;if(slash())return;const caret=area.selectionStart,before=area.value.slice(0,caret),m=before.match(/(?:^|\s)@([\w./-]*)$/);if(!m){close();return}
  if(filesFor!==ctx.projectId()){filesFor=ctx.projectId();files=(await ctx.api('/files?projectId='+filesFor)).files}
  matches=files.map(f=>[f,fuzzy(m[1],f)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);if(!matches.length){close();return}
  active=Math.min(active,matches.length-1);if(!menu){menu=el('div','mention-menu');menu.setAttribute('role','listbox');menu.id='mention-list';form.append(menu)}
  menu.replaceChildren(...matches.map((f,i)=>{const o=el('div','mention-option'+(i===active?' active':''));o.id='mention-'+i;o.setAttribute('role','option');o.setAttribute('aria-selected',String(i===active));const slash=f.lastIndexOf('/');o.append(el('strong','',f.slice(slash+1)),el('small','',slash>0?f.slice(0,slash):''));o.addEventListener('mousedown',e=>{e.preventDefault();pick(i)});return o}));
  area.setAttribute('aria-activedescendant','mention-'+active)}
 function pick(i){const f=matches[i];if(!f)return;if(slashMode){close();slashMode=false;area.value='';area.dispatchEvent(new Event('input'));f.run();return}const caret=area.selectionStart,before=area.value.slice(0,caret).replace(/@([\w./-]*)$/,'@'+f+' ');area.value=before+area.value.slice(caret);area.selectionStart=area.selectionEnd=before.length;close();area.dispatchEvent(new Event('input'))}
 area.setAttribute('aria-controls','mention-list');
 area.addEventListener('input',()=>{active=0;mention().catch(()=>close())});
 area.addEventListener('keydown',e=>{if(!menu)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;mention()}else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();pick(active)}else if(e.key==='Escape'){e.preventDefault();close()}},true);
 area.addEventListener('blur',()=>setTimeout(close,120));
 let hIndex=-1,hDraft='';area.addEventListener('keydown',e=>{if(menu||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;const list=ctx.history?.()||[];if(!list.length)return;
  if(e.key==='ArrowUp'&&area.selectionStart===0&&area.selectionEnd===0&&(hIndex>=0||!area.value.trim())){e.preventDefault();if(hIndex<0)hDraft=area.value;hIndex=Math.min(hIndex+1,list.length-1);area.value=list[list.length-1-hIndex];area.setSelectionRange(0,0)}
  else if(e.key==='ArrowDown'&&hIndex>=0&&area.selectionStart===area.value.length){e.preventDefault();hIndex--;area.value=hIndex<0?hDraft:list[list.length-1-hIndex];area.setSelectionRange(area.value.length,area.value.length)}});
 area.addEventListener('input',e=>{if(e.isTrusted)hIndex=-1});

 return {attach:files=>add(files),attachments:()=>attachments.filter(a=>a.id).map(a=>({id:a.id,name:a.name})),pending:()=>attachments.some(a=>a.uploading),clear:()=>{attachments=[];paintTray()},invalidateFiles:()=>{filesFor=null}};
}
