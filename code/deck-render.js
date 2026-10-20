// Slide renderer shared by the app (live deck editor) and the server (PDF/PNG export).
// A deck is data: {title, slides:[{layout, ...fields, notes}]}. Every string is escaped; images go through resolve().
// Sizes use container units (cqw), so one slide renders the same in a thumbnail, the editor and a 1920px export.
export const LAYOUTS=['title','section','bullets','two-column','image','quote','big-number','chart','table','timeline','team','closing'];
export const LAYOUT_NAMES={title:'Title','section':'Section','bullets':'Bullets','two-column':'Two columns','image':'Image and text','quote':'Quote','big-number':'Big number','chart':'Chart','table':'Table','timeline':'Timeline','team':'Team','closing':'Closing'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const arr=v=>Array.isArray(v)?v:v==null||v===''?[]:[v];
const f=(path,value,tag='div',cls='')=>`<${tag} class="${cls}" data-field="${path}">${esc(value)}</${tag}>`;
const list=(path,items)=>`<ul class="s-list" data-list="${path}">${arr(items).map((t,i)=>`<li data-field="${path}.${i}">${esc(t)}</li>`).join('')}</ul>`;
export const SIZES={'16:9':16/9,'4:3':4/3,'1:1':1,'9:16':9/16};
export const ratioOf=deck=>SIZES[deck?.size]||16/9;
const sizeClass=deck=>({'4:3':' r-4x3','1:1':' r-1x1','9:16':' r-9x16'})[deck?.size]||'';
const COLOR_KEYS=['bg','surface','ink','muted','accent','accent2','onAccent'];
// fonts every computer has, plus the app's own; slides pick from these so they look the same everywhere
export const FONTS=['Plus Jakarta Sans','Arial','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New','Segoe UI'];
// one element's formatting as CSS (only known, safe values)
export function fieldCss(o={}){const out=[];if(FONTS.includes(o.font))out.push("font-family:'"+o.font+"',system-ui,sans-serif");const n=Number(o.size);if(n>=.6&&n<=30)out.push('font-size:'+n.toFixed(2)+'cqw');
 if(/^#[0-9a-f]{6}$/i.test(o.color||''))out.push('color:'+o.color+';-webkit-text-fill-color:'+o.color);if(o.bold===true)out.push('font-weight:800');if(o.bold===false)out.push('font-weight:400');if(o.italic)out.push('font-style:italic');if(['left','center','right'].includes(o.align))out.push('text-align:'+o.align+(o.align==='left'?'':';max-width:none;align-self:stretch'));
 const dx=Number(o.dx)||0,dy=Number(o.dy)||0,w=Number(o.w);if(dx||dy)out.push('translate:'+dx.toFixed(2)+'cqw '+dy.toFixed(2)+'cqw;position:relative;z-index:1');if(w>=5&&w<=100)out.push('width:'+w.toFixed(2)+'cqw;max-width:none;flex:none');const h=Number(o.h);if(h>=2&&h<=180)out.push('height:'+h.toFixed(2)+'cqw;max-height:none;flex:none');
 const rot=Number(o.rot)||0;if(rot)out.push('rotate:'+rot.toFixed(1)+'deg');if(Number.isInteger(o.z))out.push('position:relative;z-index:'+o.z);return out.join(';')}
// an image's crop: which part shows (x, y in %) and how far it is zoomed in
export function cropCss(c){if(!c)return '';const x=num(c.x,0,100,50),y=num(c.y,0,100,50),z=num(c.zoom,1,4,1);return 'object-fit:cover;object-position:'+x+'% '+y+'%'+(z>1?';scale:'+z.toFixed(2)+';transform-origin:'+x+'% '+y+'%':'')}
// free items placed on a slide: position and size in cqw, then the look of their kind
const num=(v,lo,hi,d=0)=>{const n=Number(v);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):d};
export const ITEM_TYPES=['text','rect','ellipse','line','arrow','image','icon'];
// line icons for slides (24×24, drawn with the item's line colour)
export const ICONS={check:'M5 12.5l4.5 4.5L19 7.5',star:'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z',heart:'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',bolt:'M13 3L5 14h6l-1 7 8-11h-6z',chart:'M4 20V10M10 20V4M16 20v-7M22 20H2',users:'M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 3.6a3.5 3.5 0 0 1 0 6.8',target:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',mail:'M4 6h16v12H4zM4 7l8 6 8-6',phone:'M6.5 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2L21 14.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5a2 2 0 0 1 2-2z',pin:'M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',idea:'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'};
export const iconSvg=(name,color='currentColor',w=1.8)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]||ICONS.star}"/></svg>`;
export function itemCss(it={}){const out=['position:absolute','left:'+num(it.x,-50,150).toFixed(2)+'cqw','top:'+num(it.y,-50,230).toFixed(2)+'cqw','width:'+num(it.w,.5,200,20).toFixed(2)+'cqw','height:'+num(it.h,.2,230,10).toFixed(2)+'cqw'];
 const rot=num(it.rot,-360,360);if(rot)out.push('rotate:'+rot.toFixed(1)+'deg');out.push('z-index:'+(Number.isInteger(it.z)?it.z:2));const fill=/^#[0-9a-f]{6}$/i.test(it.fill||'')?it.fill:null,line=/^#[0-9a-f]{6}$/i.test(it.line||'')?it.line:null,lw=num(it.lw,0,3,.15);
 if(it.type==='text'){out.push('font-size:2.2cqw','line-height:1.3','white-space:pre-wrap','overflow-wrap:anywhere');if(fill)out.push('background:'+fill);const f=fieldCss({...it.fmt,dx:0,dy:0,w:0,h:0,rot:0,z:undefined});if(f)out.push(f)}
 else if(it.type==='rect'||it.type==='ellipse'){out.push('background:'+(fill||'var(--ds-accent)'));if(line&&lw)out.push('border:'+lw.toFixed(2)+'cqw solid '+line);out.push('border-radius:'+(it.type==='ellipse'?'50%':num(it.r,0,20).toFixed(2)+'cqw'))}
 else if(it.type==='image')out.push('overflow:hidden','border-radius:'+num(it.r,0,20).toFixed(2)+'cqw');
 else out.push('overflow:visible','color:'+(line||(it.type==='icon'?'var(--ds-accent)':'var(--ds-ink)')));return out.join(';')}
function itemHtml(it,k,resolve,inline){const css=inline?' style="'+esc(itemCss(it))+'"':'';const t=ITEM_TYPES.includes(it?.type)?it.type:'rect';
 if(t==='text')return `<div class="s-item s-tx" data-box="${k}" data-field="${k}.text"${css}>${esc(it.text)}</div>`;
 if(t==='image'){const u=it.src&&resolve?resolve(it.src):'';const ic=inline&&it.crop?' style="'+esc(cropCss(it.crop))+'"':'';return `<div class="s-item s-pic" data-box="${k}"${css}>${u?`<img src="${esc(u)}" alt="${esc(it.alt||'')}"${ic}>`:'<div class="s-img-empty"><span>Image</span></div>'}</div>`}
 if(t==='icon')return `<div class="s-item s-ic" data-box="${k}"${css}>${iconSvg(it.icon)}</div>`;
 if(t==='line'||t==='arrow'){const lw=num(it.lw,.02,3,.2);return `<div class="s-item s-ln" data-box="${k}"${css}><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="50" x2="${t==='arrow'?96:100}" y2="50" stroke="currentColor" stroke-width="${(lw*6).toFixed(2)}" vector-effect="non-scaling-stroke"/>${t==='arrow'?'<path d="M88 38 100 50 88 62" fill="none" stroke="currentColor" stroke-width="'+(lw*6).toFixed(2)+'" vector-effect="non-scaling-stroke"/>':''}</svg></div>`}
 return `<div class="s-item s-sh" data-box="${k}"${css}></div>`}
const bgCss=s=>/^#[0-9a-f]{6}$/i.test(s?.bg||'')?'background:'+s.bg:'';
// the app sets formatting with the DOM (its security policy blocks style attributes in markup)
export function paintFormatting(root,slide,index){if(!slide)return;const p='slides.'+index+'.';for(const [k,o] of Object.entries(slide.style||{})){const e=root.querySelector('[data-field="'+p+k+'"],[data-box="'+p+k+'"]');if(e)e.style.cssText=fieldCss(o);const im=o.crop&&(e?.tagName==='IMG'?e:e?.querySelector('img'));if(im)im.style.cssText=cropCss(o.crop)}
 arr(slide.items).forEach((it,i)=>{const e=root.querySelector('[data-box="'+p+'items.'+i+'"]');if(!e)return;e.style.cssText=itemCss(it);const im=e.querySelector('img');if(im)im.style.cssText=cropCss(it.crop)});const inner=root.querySelector('.slide-in');if(inner)inner.style.cssText=bgCss(slide)}
const safeColor=c=>/^#[0-9a-f]{3,8}$/i.test(String(c||''))?c:null;
const safeFont=n=>String(n||'').replace(/[^\w \-]/g,'').slice(0,40);
export const DEFAULT_DS={id:'elkiya',name:'Elkiya',colors:{bg:'#ffffff',surface:'#f5f6f8',ink:'#0b0c10',muted:'#646875',accent:'#0158cb',accent2:'#2f7bff',onAccent:'#ffffff'},fonts:{heading:'Plus Jakarta Sans',body:'Plus Jakarta Sans'},radius:14,logo:''};
// CSS custom properties for a design system, as an inline style string
export function dsStyle(ds=DEFAULT_DS){const c={...DEFAULT_DS.colors,...(ds.colors||{})};let s='';for(const k of COLOR_KEYS){const v=safeColor(c[k]);if(v)s+=`--ds-${k}:${v};`}
 s+=`--ds-head:'${safeFont(ds.fonts?.heading)||'Plus Jakarta Sans'}',system-ui,sans-serif;--ds-body:'${safeFont(ds.fonts?.body)||'Plus Jakarta Sans'}',system-ui,sans-serif;--ds-radius:${Math.max(0,Math.min(40,Number(ds.radius)||0))/19.2}cqw;`;return s}

export function chartSvg(chart){const c=chart||{},labels=arr(c.labels).slice(0,12),series=arr(c.series).slice(0,4).map(s=>({name:s.name||'',values:arr(s.values).map(Number).map(v=>Number.isFinite(v)?v:0)}));
 if(!labels.length||!series.length)return '<div class="s-empty">Chart data goes here</div>';
 const W=800,H=420,P=40,max=Math.max(1,...series.flatMap(s=>s.values)),custom=arr(c.colors).filter(x=>/^#[0-9a-f]{6}$/i.test(x)),colors=[0,1,2,3].map(i=>custom[i]||['var(--ds-accent)','var(--ds-accent2)','var(--ds-muted)','var(--ds-ink)'][i]);
 if(c.type==='pie'){const vals=series[0].values,total=vals.reduce((a,b)=>a+b,0)||1;let a=-Math.PI/2,out='';
  vals.forEach((v,i)=>{const a2=a+v/total*Math.PI*2,large=a2-a>Math.PI?1:0,cx=H/2,cy=H/2,r=H/2-10,x1=cx+r*Math.cos(a),y1=cy+r*Math.sin(a),x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
   out+=`<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${colors[i%2]}" opacity="${1-i*0.12}"/>`;a=a2});
  const legend=labels.map((l,i)=>`<text x="${H+30}" y="${60+i*34}" class="s-chart-label">${esc(l)} · ${esc(vals[i]??'')}</text>`).join('');
  return `<svg class="s-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title||'Pie chart')}">${out}${legend}</svg>`}
 const n=labels.length,bw=(W-P*2)/n,y=v=>H-P-(v/max)*(H-P*2);let out=`<line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" class="s-axis"/>`;
 if(c.type==='line')series.forEach((s,si)=>{out+=`<polyline fill="none" stroke="${colors[si]}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" points="${s.values.map((v,i)=>(P+bw*i+bw/2).toFixed(1)+','+y(v).toFixed(1)).join(' ')}"/>`});
 else{const gw=bw*0.7/series.length;series.forEach((s,si)=>s.values.forEach((v,i)=>{out+=`<rect x="${(P+bw*i+bw*0.15+gw*si).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(gw-4).toFixed(1)}" height="${(H-P-y(v)).toFixed(1)}" rx="6" fill="${colors[si]}"/>`}))}
 labels.forEach((l,i)=>{out+=`<text x="${(P+bw*i+bw/2).toFixed(1)}" y="${H-P+28}" text-anchor="middle" class="s-chart-label">${esc(l)}</text>`});
 return `<svg class="s-chart" viewBox="0 0 ${W} ${H+10}" role="img" aria-label="${esc(c.title||'Chart')}">${out}</svg>`}

function img(src,resolve,alt,cls='s-img',fit){const u=src&&resolve?resolve(src):'';return u?`<img class="${cls}${fit==='contain'?' s-contain':''}" src="${esc(u)}" alt="${esc(alt||'')}">`:`<div class="${cls} s-img-empty"><span>${esc(alt||'Image')}</span></div>`}

// one slide's inner HTML
export function slideHtml(slide,opts={}){const {index=0,total=1,deck={},resolve,ds=DEFAULT_DS}=opts;const s=slide||{},L=LAYOUTS.includes(s.layout)?s.layout:'bullets',p=`slides.${index}.`;let body='';
 switch(L){
  case 'title':body=`${s.eyebrow?f(p+'eyebrow',s.eyebrow,'div','s-eyebrow'):''}${f(p+'title',s.title||deck.title,'h1','s-title')}${s.subtitle?f(p+'subtitle',s.subtitle,'p','s-sub'):''}`;break;
  case 'section':body=`<div class="s-num">${esc(String(s.number||'').slice(0,4))}</div>${f(p+'title',s.title,'h2','s-title')}${s.subtitle?f(p+'subtitle',s.subtitle,'p','s-sub'):''}`;break;
  case 'two-column':body=`${f(p+'title',s.title,'h2','s-h')}<div class="s-cols">${['left','right'].map(k=>`<div class="s-col">${f(p+k+'.title',s[k]?.title,'h3','s-colh')}${s[k]?.text?f(p+k+'.text',s[k].text,'p','s-p'):''}${list(p+k+'.bullets',s[k]?.bullets)}</div>`).join('')}</div>`;break;
  case 'image':body=`<div class="s-split"><div class="s-col">${f(p+'title',s.title,'h2','s-h')}${s.text?f(p+'text',s.text,'p','s-p'):''}${list(p+'bullets',s.bullets)}</div>${img(s.image,resolve,s.imageAlt||s.title,'s-img',s.imageFit).replace('class="s-img','data-box="'+p+'image" class="s-img')}</div>`;break;
  case 'quote':body=`${f(p+'quote',s.quote,'blockquote','s-quote')}${s.by?f(p+'by',s.by,'p','s-by'):''}`;break;
  case 'big-number':body=`${s.eyebrow?f(p+'eyebrow',s.eyebrow,'div','s-eyebrow'):''}${f(p+'number',s.number,'div','s-big')}${f(p+'text',s.text,'p','s-lead')}`;break;
  case 'chart':body=`${f(p+'title',s.title,'h2','s-h')}${s.text?f(p+'text',s.text,'p','s-p'):''}<div class="s-chartbox" data-box="${p}chart">${chartSvg(s.chart)}</div>`;break;
  case 'table':{const t=s.table||{};body=`${f(p+'title',s.title,'h2','s-h')}<table class="s-table" data-box="${p}table"><thead><tr>${arr(t.head).map((h,i)=>`<th data-field="${p}table.head.${i}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${arr(t.rows).slice(0,10).map((r,ri)=>`<tr>${arr(r).map((c,ci)=>`<td data-field="${p}table.rows.${ri}.${ci}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;break}
  case 'timeline':body=`${f(p+'title',s.title,'h2','s-h')}<ol class="s-timeline">${arr(s.items).slice(0,6).map((it,i)=>`<li>${f(p+'items.'+i+'.title',it?.title,'strong')}${f(p+'items.'+i+'.text',it?.text,'span')}</li>`).join('')}</ol>`;break;
  case 'team':body=`${f(p+'title',s.title,'h2','s-h')}<div class="s-team">${arr(s.items).slice(0,6).map((it,i)=>`<div class="s-person">${img(it?.image,resolve,it?.name,'s-face')}${f(p+'items.'+i+'.name',it?.name,'strong')}${f(p+'items.'+i+'.role',it?.role,'span')}</div>`).join('')}</div>`;break;
  case 'closing':body=`${f(p+'title',s.title,'h2','s-title')}${s.subtitle?f(p+'subtitle',s.subtitle,'p','s-sub'):''}${s.contact?f(p+'contact',s.contact,'p','s-contact'):''}`;break;
  default:body=`${f(p+'title',s.title,'h2','s-h')}${s.text?f(p+'text',s.text,'p','s-p'):''}${list(p+'bullets',s.bullets)}`}
 const logo=ds.logo&&resolve?`<img class="s-logo" src="${esc(ds.logo.startsWith('data:image/')?ds.logo:resolve(ds.logo))}" alt="">`:'';
 const foot=['title','closing','section'].includes(L)?(L==='section'?'':`<div class="s-foot">${logo}</div>`):`<div class="s-foot">${logo}<span>${esc(deck.title||'')}</span><span class="s-pg">${index+1}</span></div>`;
 const items=arr(s.items).slice(0,60).map((it,i)=>itemHtml(it||{},p+'items.'+i,resolve,opts_inline(opts))).join('');
 let html=`<div class="slide-in l-${L}"${opts_inline(opts)&&bgCss(s)?' style="'+esc(bgCss(s))+'"':''}>${body}${foot}${items}</div>`;
 if(opts_inline(opts))for(const [k,o] of Object.entries(s.style||{})){const css=fieldCss(o);if(css)html=html.replace('data-field="'+p+k+'"','data-field="'+p+k+'" style="'+esc(css)+'"').replace('data-box="'+p+k+'"','data-box="'+p+k+'" style="'+esc(css)+'"');if(o.crop&&k==='image')html=html.replace(/(data-box="[^"]*image"[^>]*?)(\/?>)/,(m,a,b)=>a+' style="'+esc(fieldCss(o)+';'+cropCss(o.crop))+'"'+b)}
 return html}
const opts_inline=o=>o?.inline!==false;

// a whole slide element (wrapper sets the design system and the container size)
// inline=false leaves the colours off the markup (the app sets them with paintSlides, which its security policy allows)
export const slideBlock=(slide,opts={})=>`<section class="slide${sizeClass(opts.deck)}"${opts.inline===false?'':' style="'+dsStyle(opts.ds)+'"'}>${slideHtml(slide,opts)}</section>`;
export function paintSlides(root,ds){const css=dsStyle(ds);for(const s of root.querySelectorAll('.slide'))s.style.cssText=css}

// stand-alone HTML for export (one slide per 1920×1080 page)
export function deckDocument(deck,{css,ds,resolve,fontFaces='',only=null}={}){const slides=arr(deck?.slides),W=1920,H=Math.round(W/ratioOf(deck));
 return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(deck?.title||'Deck')}</title><style>${fontFaces}@page{size:${W}px ${H}px;margin:0}html,body{margin:0;background:#fff}.page{width:${W}px;height:${H}px;page-break-after:always;break-after:page;display:flex}.page .slide{width:${W}px;height:${H}px;aspect-ratio:auto;border-radius:0;box-shadow:none}${css||''}</style></head><body>${slides.map((s,i)=>only!=null&&i!==only?'':`<div class="page">${slideBlock(s,{index:i,total:slides.length,deck,resolve,ds})}</div>`).join('')}</body></html>`}
