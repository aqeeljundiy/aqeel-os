// Slide renderer shared by the app (live deck editor) and the server (PDF/PNG export).
// A deck is data: {title, slides:[{layout, ...fields, notes}]}. Every string is escaped; images go through resolve().
// Sizes use container units (cqw), so one slide renders the same in a thumbnail, the editor and a 1920px export.
export const LAYOUTS=['title','section','bullets','two-column','image','quote','big-number','chart','table','timeline','team','closing'];
export const LAYOUT_NAMES={title:'Title','section':'Section','bullets':'Bullets','two-column':'Two columns','image':'Image and text','quote':'Quote','big-number':'Big number','chart':'Chart','table':'Table','timeline':'Timeline','team':'Team','closing':'Closing'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const arr=v=>Array.isArray(v)?v:v==null||v===''?[]:[v];
const f=(path,value,tag='div',cls='')=>`<${tag} class="${cls}" data-field="${path}">${esc(value)}</${tag}>`;
const list=(path,items)=>`<ul class="s-list" data-list="${path}">${arr(items).map((t,i)=>`<li data-field="${path}.${i}">${esc(t)}</li>`).join('')}</ul>`;
const COLOR_KEYS=['bg','surface','ink','muted','accent','accent2','onAccent'];
// fonts every computer has, plus the app's own; slides pick from these so they look the same everywhere
export const FONTS=['Plus Jakarta Sans','Arial','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New','Segoe UI'];
// one element's formatting as CSS (only known, safe values)
export function fieldCss(o={}){const out=[];if(FONTS.includes(o.font))out.push("font-family:'"+o.font+"',system-ui,sans-serif");const n=Number(o.size);if(n>=.6&&n<=30)out.push('font-size:'+n.toFixed(2)+'cqw');
 if(/^#[0-9a-f]{6}$/i.test(o.color||''))out.push('color:'+o.color+';-webkit-text-fill-color:'+o.color);if(o.bold===true)out.push('font-weight:800');if(o.bold===false)out.push('font-weight:400');if(o.italic)out.push('font-style:italic');if(['left','center','right'].includes(o.align))out.push('text-align:'+o.align+(o.align==='left'?'':';max-width:none;align-self:stretch'));
 const dx=Number(o.dx)||0,dy=Number(o.dy)||0,w=Number(o.w);if(dx||dy)out.push('translate:'+dx.toFixed(2)+'cqw '+dy.toFixed(2)+'cqw;position:relative;z-index:1');if(w>=5&&w<=100)out.push('width:'+w.toFixed(2)+'cqw;max-width:none;flex:none');return out.join(';')}
const bgCss=s=>/^#[0-9a-f]{6}$/i.test(s?.bg||'')?'background:'+s.bg:'';
// the app sets formatting with the DOM (its security policy blocks style attributes in markup)
export function paintFormatting(root,slide,index){if(!slide)return;const p='slides.'+index+'.';for(const [k,o] of Object.entries(slide.style||{})){const e=root.querySelector('[data-field="'+p+k+'"],[data-box="'+p+k+'"]');if(e)e.style.cssText=fieldCss(o)}const inner=root.querySelector('.slide-in');if(inner)inner.style.cssText=bgCss(slide)}
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
 let html=`<div class="slide-in l-${L}"${opts_inline(opts)&&bgCss(s)?' style="'+esc(bgCss(s))+'"':''}>${body}${foot}</div>`;
 if(opts_inline(opts))for(const [k,o] of Object.entries(s.style||{})){const css=fieldCss(o);if(css)html=html.replace('data-field="'+p+k+'"','data-field="'+p+k+'" style="'+esc(css)+'"').replace('data-box="'+p+k+'"','data-box="'+p+k+'" style="'+esc(css)+'"')}
 return html}
const opts_inline=o=>o?.inline!==false;

// a whole slide element (wrapper sets the design system and the container size)
// inline=false leaves the colours off the markup (the app sets them with paintSlides, which its security policy allows)
export const slideBlock=(slide,opts={})=>`<section class="slide"${opts.inline===false?'':' style="'+dsStyle(opts.ds)+'"'}>${slideHtml(slide,opts)}</section>`;
export function paintSlides(root,ds){const css=dsStyle(ds);for(const s of root.querySelectorAll('.slide'))s.style.cssText=css}

// stand-alone HTML for export (one slide per 1920×1080 page)
export function deckDocument(deck,{css,ds,resolve,fontFaces='',only=null}={}){const slides=arr(deck?.slides);
 return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(deck?.title||'Deck')}</title><style>${fontFaces}@page{size:1920px 1080px;margin:0}html,body{margin:0;background:#fff}.page{width:1920px;height:1080px;page-break-after:always;break-after:page;display:flex}.page .slide{width:1920px;height:1080px;border-radius:0;box-shadow:none}${css||''}</style></head><body>${slides.map((s,i)=>only!=null&&i!==only?'':`<div class="page">${slideBlock(s,{index:i,total:slides.length,deck,resolve,ds})}</div>`).join('')}</body></html>`}
