// Design systems: pick the one a project uses, make one from a website, or edit one by hand.
// Decks, documents, designs and new apps follow the project's design system (the AI gets it with each request).
import {slideBlock,paintSlides} from './deck-render.js';
import {confirmDialog} from './ui-kit.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const COLORS=[['bg','Background'],['surface','Surface'],['ink','Text'],['muted','Muted text'],['accent','Accent'],['accent2','Second accent'],['onAccent','Text on accent']];
const SAMPLE={title:'Preview',slides:[{layout:'title',eyebrow:'Design system',title:'Headline in your style',subtitle:'Subtitle and body text'}]};

export function openDesignSystems(ctx){
 const d=el('dialog','kit-dialog ds-dialog');d.setAttribute('aria-labelledby','ds-title');const head=el('div','np-head');const title=el('h2','','Design system');title.id='ds-title';const x=el('button','dialog-x','×');x.type='button';x.setAttribute('aria-label','Close');head.append(title,x);
 const intro=el('p','ds-intro','Decks, documents and designs in this project follow it. Pick one, make one from a website, or create your own.');
 const grid=el('div','ds-grid'),actions=el('div','ds-new');const fromUrl=el('form','ds-url');const url=el('input');url.type='text';url.inputMode='url';url.autocomplete='off';url.placeholder='Make one from a website: example.com';url.setAttribute('aria-label','Website address');const go=el('button','','Make it');go.type='submit';fromUrl.append(url,go);
 const blank=el('button','','New design system');blank.type='button';const files=el('button','','From files…');files.type='button';files.title='A brand guide PDF, logo, screenshots or a codebase';files.onclick=()=>{close();ctx.fromFiles()};actions.append(fromUrl,files,blank);
 d.append(head,intro,grid,actions);document.body.append(d);const close=()=>{d.close();setTimeout(()=>d.remove(),180)};x.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close()});d.addEventListener('click',e=>{if(e.target===d)close()});d.showModal();
 let list=[];
 async function load(){list=(await ctx.api('/design-systems')).designSystems;paint()}
 function paint(){const saved=ctx.project()?.settings?.designSystem,chosen=(saved==='el'+'kiya'?'':saved)||'standard';grid.replaceChildren();
  for(const ds of list){const card=el('div','ds-card'+(ds.id===chosen?' on':''));const pick=el('button','ds-pick');pick.type='button';pick.setAttribute('aria-pressed',String(ds.id===chosen));
   const prev=el('div','ds-preview');prev.innerHTML=slideBlock(SAMPLE.slides[0],{deck:SAMPLE,ds,inline:false});paintSlides(prev,ds);
   const sw=el('div','ds-swatches');for(let n=0;n<4;n++)sw.append(el('i'));sw.setAttribute('aria-hidden','true');[...sw.children].forEach((i,n)=>i.style.background=ds.colors[['accent','accent2','ink','surface'][n]]);
   const meta=el('div','ds-meta');meta.append(el('strong','',ds.name),sw);pick.append(prev,meta);pick.addEventListener('click',()=>choose(ds));card.append(pick);
   if(!ds.builtIn){const edit=el('button','ds-edit','Edit');edit.type='button';edit.addEventListener('click',()=>editor(ds));card.append(edit)}
   grid.append(card)}}
 async function choose(ds){try{const p=ctx.project();await ctx.api('/project/update',{projectId:p.id,settings:{...(p.settings||{}),designSystem:ds.id}});await ctx.changed();paint();ctx.notify('This project now uses '+ds.name+'.')}catch(e){ctx.notify(e.message)}}
 fromUrl.addEventListener('submit',async e=>{e.preventDefault();if(!url.value.trim())return url.focus();go.disabled=true;go.textContent='Reading the site…';
  try{const ds=await ctx.api('/design-system/from-url',{url:url.value.trim()});editor(ds,true)}catch(err){ctx.notify(err.message)}finally{go.disabled=false;go.textContent='Make it'}});
 blank.addEventListener('click',()=>editor({name:'My brand',colors:{...list[0].colors},fonts:{...list[0].fonts},radius:12},true));
 // editor: name, colours, fonts, radius, logo and tone, with a live slide preview
 function editor(start,isNew){const ds=structuredClone(start);const e=el('div','ds-editor');const preview=el('div','ds-preview big');
  const form=el('div','ds-form');const field=(label,input)=>{const l=el('label','ds-field');l.append(el('span','',label),input);return l};
  const name=el('input');name.value=ds.name||'';name.maxLength=40;form.append(field('Name',name));
  const colors=el('div','ds-colors');for(const [k,label] of COLORS){const c=el('input');c.type='color';c.value=ds.colors?.[k]||'#000000';c.addEventListener('input',()=>{ds.colors[k]=c.value;paintPrev()});colors.append(field(label,c))}form.append(colors);
  const hf=el('input');hf.value=ds.fonts?.heading||'';hf.placeholder='Plus Jakarta Sans';const bf=el('input');bf.value=ds.fonts?.body||'';bf.placeholder='Plus Jakarta Sans';const fonts=el('div','ds-row');fonts.append(field('Heading font',hf),field('Body font',bf));form.append(fonts);
  const rad=el('input');rad.type='range';rad.min='0';rad.max='40';rad.value=String(ds.radius??12);rad.addEventListener('input',()=>{ds.radius=Number(rad.value);paintPrev()});form.append(field('Corner radius',rad));
  const logo=el('input');logo.type='file';logo.accept='image/png,image/jpeg,image/webp,image/svg+xml';logo.addEventListener('change',()=>{const f=logo.files[0];if(!f)return;if(f.size>280000)return ctx.notify('Use a logo under 280 KB.');const r=new FileReader();r.onload=()=>{ds.logo=String(r.result);paintPrev()};r.readAsDataURL(f)});form.append(field('Logo',logo));
  const voice=el('textarea');voice.rows=2;voice.maxLength=400;voice.value=ds.voice||'';voice.placeholder='Tone of voice, for example: clear, confident, no jargon';form.append(field('Tone of voice',voice));
  const row=el('div','dialog-actions');const back=el('button','','Back');back.type='button';const save=el('button','primary',isNew?'Save and use':'Save');save.type='button';
  if(!isNew&&!ds.builtIn){const del=el('button','deny','Delete');del.type='button';del.addEventListener('click',async()=>{if(!await confirmDialog({title:'Delete '+ds.name+'?',message:'Projects using it go back to Standard.',confirm:'Delete',danger:true}))return;try{await ctx.api('/design-system/delete',{id:ds.id});await load();e.remove();grid.hidden=actions.hidden=intro.hidden=false}catch(err){ctx.notify(err.message)}});row.append(del)}
  row.append(back,save);
  function paintPrev(){ds.name=name.value;preview.innerHTML=slideBlock(SAMPLE.slides[0],{deck:SAMPLE,ds,inline:false,resolve:s=>s});paintSlides(preview,ds)}
  for(const i of [name,hf,bf,voice])i.addEventListener('input',()=>{ds.fonts={heading:hf.value,body:bf.value};ds.voice=voice.value;paintPrev()});
  back.addEventListener('click',()=>{e.remove();grid.hidden=actions.hidden=intro.hidden=false});
  save.addEventListener('click',async()=>{save.disabled=true;try{ds.name=name.value;ds.fonts={heading:hf.value,body:bf.value};ds.voice=voice.value;const saved=await ctx.api('/design-system',ds);await load();if(isNew)await choose(saved);e.remove();grid.hidden=actions.hidden=intro.hidden=false}catch(err){ctx.notify(err.message);save.disabled=false}});
  // the sample page: colours with their codes, the type scale and a few components
  const sample=el('div','ds-sample');const paintSample=()=>{sample.replaceChildren();const c=ds.colors;const sw=el('div','ds-sample-swatches');for(const [k,label] of COLORS){const s=el('div','ds-sample-swatch');const chip=el('i');chip.style.background=c[k];s.append(chip,el('strong','',label),el('code','',c[k]));sw.append(s)}
   const type=el('div','ds-sample-type');type.style.fontFamily="'"+(ds.fonts?.heading||'Plus Jakarta Sans')+"',system-ui,sans-serif";type.style.color=c.ink;type.style.background=c.bg;for(const [size,t] of [[34,'Headline'],[22,'Section title'],[15,'Body text reads like this, comfortably.'],[12,'Small print and labels']]){const p=el('p','',t);p.style.fontSize=size+'px';p.style.fontWeight=size>20?'700':'400';if(size<20)p.style.fontFamily="'"+(ds.fonts?.body||'Plus Jakarta Sans')+"',system-ui,sans-serif";type.append(p)}
   const comp=el('div','ds-sample-comp');comp.style.background=c.surface;const b1=el('span','ds-sample-btn','Primary');b1.style.cssText='background:'+c.accent+';color:'+c.onAccent+';border-radius:'+(ds.radius??12)+'px';const b2=el('span','ds-sample-btn','Secondary');b2.style.cssText='background:'+c.bg+';color:'+c.ink+';border:1px solid '+c.muted+'55;border-radius:'+(ds.radius??12)+'px';
   const card=el('div','ds-sample-card');card.style.cssText='background:'+c.bg+';color:'+c.ink+';border-radius:'+(ds.radius??12)+'px';card.append(el('strong','','Card title'),el('span','','Muted supporting text'));card.lastChild.style.color=c.muted;comp.append(b1,b2,card);sample.append(sw,type,comp)};
  for(const i of form.querySelectorAll('input,textarea'))i.addEventListener('input',paintSample);
  // tokens to use elsewhere
  const exp=el('div','ds-export');exp.append(el('span','','Export'));const file=(name,text,type)=>{const a=el('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000)};
  const slug=()=>(ds.name||'design-system').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  for(const [label,make] of [['CSS variables',()=>file(slug()+'.css',':root{\n'+Object.entries(ds.colors).map(([k,v])=>'  --color-'+k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())+': '+v+';').join('\n')+"\n  --font-heading: '"+(ds.fonts?.heading||'Plus Jakarta Sans')+"', sans-serif;\n  --font-body: '"+(ds.fonts?.body||'Plus Jakarta Sans')+"', sans-serif;\n  --radius: "+(ds.radius??12)+'px;\n}\n','text/css')],
   ['Tailwind',()=>file('tailwind.'+slug()+'.js','/** @type {import(\'tailwindcss\').Config} */\nexport default {\n  theme: {\n    extend: {\n      colors: '+JSON.stringify(ds.colors,null,2).replace(/\n/g,'\n      ')+",\n      fontFamily: { heading: ['"+(ds.fonts?.heading||'Plus Jakarta Sans')+"'], body: ['"+(ds.fonts?.body||'Plus Jakarta Sans')+"'] },\n      borderRadius: { DEFAULT: '"+(ds.radius??12)+"px' }\n    }\n  }\n};\n",'text/javascript')],
   ['JSON',()=>file(slug()+'.tokens.json',JSON.stringify({name:ds.name,colors:ds.colors,fonts:ds.fonts,radius:ds.radius,voice:ds.voice},null,2),'application/json')]]){const b=el('button','',label);b.type='button';b.onclick=make;exp.append(b)}
  e.append(preview,sample,form,exp,row);paintSample();grid.hidden=actions.hidden=intro.hidden=true;d.append(e);paintPrev();name.focus()}
 load().catch(e=>ctx.notify(e.message))}
