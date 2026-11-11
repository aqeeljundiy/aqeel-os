// The icon set of one brand, drawn from its REAL mark (12 Nov 2026). Source of truth, in order: an icon the owner uploaded; the
// brand's own logo SVG (vector, drawn at every size, never a small PNG scaled up); a PNG logo that is big enough. With no real
// mark the icon is the brand's plain colour tile with nothing on it, and the caller raises ONE "upload its mark" question. A
// letter exists only when the owner chose it (mono:true), never as a default. Pure: bytes in, bytes out; every set says where
// its mark came from (source) so Settings › Branding can show "Taken from <file>".
import {createHash} from 'node:crypto';
import {encodePng,decodePng,resize,encodeIco,pngInfo} from './png.mjs';
import {parseSvg,renderSvg,bounds,parseColour} from './raster.mjs';

export const GEN='g2';
export const RADIUS=.2237;      // the iOS home-screen corner, also used for the rounded 'any' icons and the favicon
const SAFE=.56;                 // mark box inside a maskable icon: its corners stay within the centre 80% circle
const TAB=.7;                   // mark box in the tiny tab icons (little padding so it stays readable)

const hex=c=>'#'+c.slice(0,3).map(x=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0')).join('');
export const toRgb=h=>{const c=parseColour(h);return c?c.slice(0,3):null};
const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])};
export const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
export const normHex=v=>{v=String(v||'').trim();if(/^#?[0-9a-f]{3}$/i.test(v))v=v.replace('#','').split('').map(c=>c+c).join('');v=v.replace('#','');return /^[0-9a-f]{6}$/i.test(v)?'#'+v.toLowerCase():''};

// A monogram, only when the owner picks it: plain rounded strokes, one capital or digit
const GLYPH={A:'M6 78L30 6L54 78M15 52H45',B:'M10 6V74M10 6H33Q47 6 47 21Q47 38 33 38H10M33 38Q52 38 52 56Q52 74 33 74H10',C:'M52 20Q46 6 30 6Q8 6 8 40Q8 74 30 74Q46 74 52 60',D:'M10 6V74H28Q52 74 52 40Q52 6 28 6H10',E:'M50 6H10V74H50M10 40H44',F:'M50 6H10V74M10 40H44',G:'M52 20Q46 6 30 6Q8 6 8 40Q8 74 30 74Q52 74 52 48H32',H:'M10 6V74M50 6V74M10 40H50',I:'M30 6V74',J:'M44 6V54Q44 74 26 74Q12 74 8 60',K:'M10 6V74M50 6L10 46M24 32L52 74',L:'M10 6V74H50',M:'M8 74V6L30 48L52 6V74',N:'M10 74V6L50 74V6',O:'M30 6Q8 6 8 40Q8 74 30 74Q52 74 52 40Q52 6 30 6Z',P:'M10 74V6H31Q50 6 50 24Q50 42 31 42H10',Q:'M30 6Q8 6 8 40Q8 74 30 74Q52 74 52 40Q52 6 30 6ZM34 56L52 76',R:'M10 74V6H31Q50 6 50 24Q50 42 31 42H10M30 42L50 74',S:'M50 18Q44 6 30 6Q10 6 10 22Q10 38 30 40Q50 42 50 58Q50 74 30 74Q14 74 8 62',T:'M6 6H54M30 6V74',U:'M10 6V50Q10 74 30 74Q50 74 50 50V6',V:'M6 6L30 74L54 6',W:'M4 6L17 74L30 30L43 74L56 6',X:'M8 6L52 74M52 6L8 74',Y:'M6 6L30 42L54 6M30 42V74',Z:'M8 6H52L8 74H52',
 0:'M30 6Q10 6 10 40Q10 74 30 74Q50 74 50 40Q50 6 30 6Z',1:'M16 22L32 6V74',2:'M10 20Q14 6 30 6Q50 6 50 24Q50 38 30 54L10 74H52',3:'M10 14Q16 6 30 6Q48 6 48 22Q48 38 28 38Q50 38 50 56Q50 74 30 74Q14 74 8 64',4:'M40 74V6L6 54H54',5:'M48 6H14L11 36Q18 30 30 30Q50 30 50 52Q50 74 30 74Q14 74 8 64',6:'M46 10Q40 6 30 6Q10 6 10 44M10 44Q10 30 30 30Q50 30 50 52Q50 74 30 74Q10 74 10 44',7:'M8 6H52Q36 36 28 74',8:'M30 38Q12 38 12 22Q12 6 30 6Q48 6 48 22Q48 38 30 38Q8 38 8 56Q8 74 30 74Q52 74 52 56Q52 38 30 38',9:'M14 70Q20 74 30 74Q50 74 50 36M50 36Q50 50 30 50Q10 50 10 28Q10 6 30 6Q50 6 50 36'};
export const monoLetter=name=>{const c=String(name||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().match(/[A-Z0-9]/)?.[0];return c&&GLYPH[c]?c:''};
const monoSvg=(name,col)=>{const c=monoLetter(name);return c?`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 76 96"><path d="${GLYPH[c]}" fill="none" stroke="${col}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>`:''};

// ---- reading the real mark ----
// A source's drawn items minus a full-bleed background rectangle (a logo that is its own tile): that rectangle's colour is the
// brand's own background.
function splitBackground(doc){const [vx,vy,vw,vh]=doc.vb;const i=doc.items.findIndex(it=>{if(!it.fill||it.stroke||it.subs.length!==1||it.evenodd)return false;const p=it.subs[0].pts;if(p.length<4)return false;
  const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]);return Math.min(...xs)<=vx+vw*.02&&Math.max(...xs)>=vx+vw*.98&&Math.min(...ys)<=vy+vh*.02&&Math.max(...ys)>=vy+vh*.98&&it.fill.a>=.99&&it.fill.c[3]>=250});
 return i<0?{doc,bg:null}:{doc:{vb:doc.vb,items:doc.items.filter((_,k)=>k!==i)},bg:doc.items[i].fill.c.slice(0,3)}}
const recolour=(doc,c)=>({vb:doc.vb,items:doc.items.map(it=>({...it,fill:it.fill&&{...it.fill,c:[c[0],c[1],c[2],it.fill.c[3]]},stroke:it.stroke&&{...it.stroke,c:[c[0],c[1],c[2],it.stroke.c[3]]}}))});
const colours=doc=>doc.items.flatMap(it=>[it.fill&&it.fill.c,it.stroke&&it.stroke.c].filter(c=>c&&c[3]>0)).map(c=>c.slice(0,3));

// -> {kind:'svg',doc,bg,file,note} | {kind:'png',img,file,note} | {kind:'art',img,...} | {kind:null,why}
function readMark(cands){const why=[];
 for(const c of cands||[]){if(!c?.data?.length)continue;const t=String(c.type||'');
  if(/svg/.test(t)||/^\s*(<\?xml|<svg|<!--)/.test(c.data.subarray(0,200).toString())){const txt=c.data.toString('utf8');let doc,file=c.file,note='';
   try{doc=parseSvg(txt)}catch(e){if(c.alt?.data){try{doc=parseSvg(c.alt.data.toString('utf8'));note='its letter drawn as outlines, from '+c.alt.file}catch(e2){why.push(c.file+': '+e2.message);continue}}else{why.push(c.file+': '+e.message);continue}}
   const sp=splitBackground(doc);if(!sp.doc.items.length){why.push(c.file+': nothing left to draw on its tile');continue}return {kind:'svg',doc:sp.doc,bg:sp.bg,file,note,from:c.from||'brand'}}
  const inf=pngInfo(c.data);if(inf){let img;try{img=decodePng(c.data)}catch(e){why.push(c.file+': '+e.message);continue}
   let clear=0;for(let i=3;i<img.data.length;i+=4)if(img.data[i]<250)clear++;
   if(clear<img.w*img.h*.02){if(Math.abs(img.w-img.h)<=img.w*.02&&img.w>=512)return {kind:'art',img,file:c.file,note:'a full-bleed picture, used as it is',from:c.from||'brand'};why.push(c.file+': a PNG with a solid background that is not a square of at least 512 px');continue}
   if(Math.min(img.w,img.h)<320){why.push(c.file+': a PNG of '+img.w+'x'+img.h+' is too small to scale up cleanly (needs 320 px or more, or an SVG)');continue}return {kind:'png',img,file:c.file,note:'',from:c.from||'brand'}}
  why.push(c.file+': not an SVG or PNG')}
 return {kind:null,why:why.join('; ')}}

// ---- drawing ----
function tile(S,bg,radius){const o=new Uint8Array(S*S*4),h=S/2,r=radius*S;for(let y=0;y<S;y++)for(let x=0;x<S;x++){let a=255;if(radius>0){const qx=Math.abs(x+.5-h)-(h-r),qy=Math.abs(y+.5-h)-(h-r),d=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;a=Math.round(Math.max(0,Math.min(1,.5-d))*255)}const i=(y*S+x)*4;o[i]=bg[0];o[i+1]=bg[1];o[i+2]=bg[2];o[i+3]=a}return o}
function over(base,layer){for(let i=0;i<base.length;i+=4){const a=layer[i+3]/255;if(!a)continue;const ba=base[i+3]/255,oa=a+ba*(1-a);for(let c=0;c<3;c++)base[i+c]=Math.round((layer[i+c]*a+base[i+c]*ba*(1-a))/oa);base[i+3]=Math.round(oa*255)}return base}

export function buildIcons(spec){const name=String(spec.name||'App').slice(0,40),T0=spec.markCands,custom=spec.custom||null;
 const key=createHash('sha1').update(GEN).update(JSON.stringify([name,spec.colour||'',spec.accent||'',!!spec.mono,spec.defaultColour||'']))
  .update(custom?.data||'').update(custom?'1':'0').update(JSON.stringify((T0||[]).map(c=>[c.file,c.type,createHash('sha1').update(c.data||'').digest('hex'),c.alt?.file,c.alt?.data?createHash('sha1').update(c.alt.data).digest('hex'):'']))).digest('hex').slice(0,10);
 let source={file:'',note:'',kind:'none',why:''},mark=null,art=null,markDoc=null,bg=null;
 if(custom?.data){let img;try{img=/svg/.test(custom.type)?(()=>{const d=parseSvg(custom.data.toString('utf8'));return {w:1024,h:1024,data:renderSvg(null,1024,{doc:d})}})():decodePng(custom.data)}catch(e){img=null;source.why='The uploaded icon could not be read: '+e.message}
  if(img){art=img;source={file:'the icon you uploaded (System › Branding)',note:'used as it is, rounded for the browser and Android',kind:'upload'}}}
 if(!art){const m=readMark(T0);if(m.kind==='art'){art=m.img;source={file:m.file,note:m.note,kind:'art'}}else if(m.kind){mark=m;source={file:m.file,note:m.note,kind:m.kind}}else source.why=m.why||'no logo file found'}
 // the tile colour: the owner's, the install's default, the source's own background, else what makes its colours readable
 let tileRgb=toRgb(spec.colour),colourFrom=tileRgb?'the colour set in Branding':'';
 if(!tileRgb&&spec.defaultColour){tileRgb=toRgb(spec.defaultColour);colourFrom=tileRgb?'this install\'s brand colour':''}
 if(mark?.kind==='svg'){markDoc=mark.doc;bg=mark.bg}
 if(!tileRgb&&bg){tileRgb=bg;colourFrom='the background of '+mark.file}
 if(!tileRgb&&markDoc){const cs=colours(markDoc),mean=cs.length?cs.reduce((s,c)=>s+lum(c),0)/cs.length:0;tileRgb=mean<.4?[255,255,255]:[17,24,39];colourFrom='chosen so the mark of '+mark.file+' reads on it'}
 if(!tileRgb&&mark?.kind==='png'){tileRgb=[255,255,255];colourFrom='white, behind a PNG mark'}
 if(!tileRgb){tileRgb=[17,24,39];colourFrom='the default brand colour'}
 // contrast: keep the mark's own colours when they read on the tile; else the brand accent; else black or white
 let recoloured='';const acc=toRgb(spec.accent);
 if(markDoc){const cs=colours(markDoc);const bad=cs.some(c=>contrast(c,tileRgb)<3);
  if(acc&&(!spec.accentAuto)){markDoc=recolour(markDoc,acc);recoloured='in the accent colour '+hex(acc)}
  else if(bad){const w=contrast([255,255,255],tileRgb)>=contrast([17,17,17],tileRgb)?[255,255,255]:[17,17,17];markDoc=recolour(markDoc,w);recoloured='recoloured '+hex(w)+' because its own colours do not read on '+hex(tileRgb)}}
 let monoDoc=null;if(!mark&&!art&&spec.mono&&monoLetter(name)){const w=acc||(contrast([255,255,255],tileRgb)>=contrast([17,17,17],tileRgb)?[255,255,255]:[17,17,17]);monoDoc=parseSvg(monoSvg(name,hex(w)));source={file:'the first letter of "'+name+'" (chosen in Branding)',note:'',kind:'letter'}}
 const drawDoc=markDoc||monoDoc;

 // the mark layer at S, its drawn bounds centred in a box of side s*S
 const layer=(S,s)=>{if(drawDoc){const bx=Math.round(S*(1-s)/2),bs=Math.round(S*s);return renderSvg(null,S,{doc:drawDoc,box:{x:bx,y:bx,w:bs,h:bs},fitBounds:true})}
  if(mark?.kind==='png'){const {img}=mark;let x0=img.w,y0=img.h,x1=0,y1=0;for(let y=0;y<img.h;y++)for(let x=0;x<img.w;x++)if(img.data[(y*img.w+x)*4+3]>8){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
   const cw=x1-x0+1,ch=y1-y0+1,crop=new Uint8Array(cw*ch*4);for(let y=0;y<ch;y++)crop.set(img.data.subarray(((y0+y)*img.w+x0)*4,((y0+y)*img.w+x0+cw)*4),y*cw*4);
   const bs=Math.round(S*s),k=Math.min(bs/cw,bs/ch),w=Math.max(1,Math.round(cw*k)),h=Math.max(1,Math.round(ch*k)),sm=resize(crop,cw,ch,w,h),out=new Uint8Array(S*S*4),ox=Math.floor((S-w)/2),oy=Math.floor((S-h)/2);
   for(let y=0;y<h;y++)out.set(sm.subarray(y*w*4,(y+1)*w*4),((oy+y)*S+ox)*4);return out}
  return null};
 const artAt=(S,radius)=>{const a=resize(art.data,art.w,art.h,S,S);if(radius>0){const t=tile(S,[0,0,0],radius);for(let i=3;i<a.length;i+=4)a[i]=Math.round(a[i]*t[i]/255)}return a};
 const iconAt=(S,{radius,s,opaque})=>{let px;if(art){px=artAt(S,radius);if(opaque){const b=tile(S,tileRgb,0);px=over(b,px)}}else{px=tile(S,tileRgb,radius);const l=layer(S,s);if(l)over(px,l)}return px};
 const png=(S,o)=>encodePng(S,S,iconAt(S,o),{opaque:!!o.opaque});
 const files={};const add=(n,type,data)=>{files[n]={type,data}};
 add('apple-touch-icon.png','image/png',png(180,{radius:0,s:SAFE,opaque:true}));
 for(const S of [192,512]){add('icon-'+S+'.png','image/png',png(S,{radius:RADIUS,s:SAFE}));add('icon-maskable-'+S+'.png','image/png',png(S,{radius:0,s:SAFE,opaque:true}))}
 const fav={};for(const S of [16,32,48]){fav[S]=png(S,{radius:RADIUS,s:TAB});add('favicon-'+S+'.png','image/png',fav[S])}
 add('favicon.ico','image/x-icon',encodeIco([16,32,48].map(S=>({size:S,png:fav[S]}))));
 // favicon.svg: the rounded tile with the mark in it (drawn at 256 from the vector, embedded), fine on light and dark tabs
 {const inner=art?encodePng(256,256,artAt(256,0)):(()=>{const l=layer(256,TAB);return l?encodePng(256,256,l):null})();
  add('favicon.svg','image/svg+xml',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${name.replace(/[<>&"]/g,'')}</title>`+(art?`<clipPath id="r"><rect width="64" height="64" rx="${(RADIUS*64).toFixed(2)}"/></clipPath><image width="64" height="64" clip-path="url(#r)" href="data:image/png;base64,${inner.toString('base64')}"/>`:`<rect width="64" height="64" rx="${(RADIUS*64).toFixed(2)}" fill="${hex(tileRgb)}"/>`+(inner?`<image width="64" height="64" href="data:image/png;base64,${inner.toString('base64')}"/>`:''))+'</svg>')}
 // monochrome (Android themed icons): the mark's shape in one colour, only when there is a mark
 if(drawDoc||mark?.kind==='png'){const l=layer(512,SAFE);for(let i=0;i<l.length;i+=4){l[i]=l[i+1]=l[i+2]=0}add('icon-mono-512.png','image/png',encodePng(512,512,l))}
 // what the source mark looks like on its own (for the Branding preview)
 {let sp=null;if(drawDoc)sp=renderSvg(null,256,{doc:markDoc?(mark.doc):drawDoc,box:{x:16,y:16,w:224,h:224},fitBounds:true});else if(mark?.kind==='png'){const {img}=mark,k=Math.min(1,256/Math.max(img.w,img.h)),w=Math.round(img.w*k),h=Math.round(img.h*k),r=resize(img.data,img.w,img.h,w,h);sp=new Uint8Array(256*256*4);for(let y=0;y<h;y++)sp.set(r.subarray(y*w*4,(y+1)*w*4),((Math.floor((256-h)/2)+y)*256+Math.floor((256-w)/2))*4)}else if(art)sp=artAt(256,0);
  if(sp)add('source.png','image/png',encodePng(256,256,sp))}
 const hasMark=!!(drawDoc||mark||art);
 return {v:key,files,hasMark,colour:hex(tileRgb),source:{...source,colourFrom,recoloured},needsLogo:!hasMark}}
