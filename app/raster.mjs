// Draws a brand's own vector mark (a plain SVG) to pixels with no dependencies: rect, circle, ellipse, line, polyline, polygon
// and path (all commands, arcs too), fill and stroke with their real colours, groups and transforms. Anything it cannot draw
// faithfully (gradients, text, images, filters, masks, clip paths, dashes) throws {unsupported:true} so the caller never gets a
// guess. Used to make home-screen icons from the logo itself, never from a font or a redraw (12 Nov 2026).
const U=m=>Object.assign(Error('Cannot draw this SVG: '+m),{unsupported:true});
const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
const ap=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const NAMED={black:'#000000',white:'#ffffff',gray:'#808080',grey:'#808080',silver:'#c0c0c0',red:'#ff0000',green:'#008000',blue:'#0000ff',yellow:'#ffff00',orange:'#ffa500',purple:'#800080'};

export function parseColour(v){v=String(v||'').trim().toLowerCase();if(!v||v==='none')return null;if(v==='transparent')return null;if(v==='currentcolor')return [0,0,0,255];
 if(NAMED[v])v=NAMED[v];let m;
 if(m=/^#([0-9a-f]{3,8})$/.exec(v)){let h=m[1];if(h.length===3||h.length===4)h=h.split('').map(c=>c+c).join('');if(h.length!==6&&h.length!==8)throw U('colour '+v);return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).concat(h.length===8?parseInt(h.slice(6,8),16):255)}
 if(m=/^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(v)){const c=(x,p)=>Math.round(p?x*2.55:+x);return [c(m[1],m[2]),c(m[3],m[4]),c(m[5],m[6]),m[7]==null?255:Math.round(m[8]?m[7]*2.55:m[7]*255)]}
 throw U('colour '+v)}

function parseTransform(s){let m=[1,0,0,1,0,0];for(const t of String(s||'').matchAll(/(\w+)\s*\(([^)]*)\)/g)){const a=t[2].split(/[\s,]+/).filter(Boolean).map(Number);let n;
 switch(t[1]){case 'translate':n=[1,0,0,1,a[0]||0,a[1]||0];break;case 'scale':n=[a[0],0,0,a[1]??a[0],0,0];break;
  case 'rotate':{const r=(a[0]||0)*Math.PI/180,c=Math.cos(r),s2=Math.sin(r);n=[c,s2,-s2,c,0,0];if(a.length>2)n=mul(mul([1,0,0,1,a[1],a[2]],n),[1,0,0,1,-a[1],-a[2]]);break}
  case 'matrix':n=a.slice(0,6);break;case 'skewX':n=[1,0,Math.tan(a[0]*Math.PI/180),1,0,0];break;case 'skewY':n=[1,Math.tan(a[0]*Math.PI/180),0,1,0,0];break;default:throw U('transform '+t[1])}
 if(n.length!==6||n.some(x=>!Number.isFinite(x)))throw U('transform');m=mul(m,n)}return m}

// path data -> subpaths [{pts:[[x,y]..],closed}] in user space (arcs and curves flattened)
function pathToSubs(d){const s=String(d||''),subs=[];let i=0,cmd='',cx=0,cy=0,sx=0,sy=0,lcx=0,lcy=0,lastC='',cur=null;
 const num=()=>{const m=/^[\s,]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(s.slice(i));if(!m)throw U('path data');i+=m[0].length;return +m[1]};
 const flag=()=>{while(/[\s,]/.test(s[i]||''))i++;const c=s[i++];if(c!=='0'&&c!=='1')throw U('arc flag');return +c};
 const more=()=>{while(/[\s,]/.test(s[i]||''))i++;return i<s.length&&!/[A-Za-z]/.test(s[i])};
 const start=(x,y)=>{cur={pts:[[x,y]],closed:false};subs.push(cur)};const to=(x,y)=>{if(!cur)start(cx,cy);cur.pts.push([x,y]);cx=x;cy=y};
 const cubic=(x1,y1,x2,y2,x,y)=>{if(!cur)start(cx,cy);const n=24;for(let k=1;k<=n;k++){const t=k/n,u=1-t;cur.pts.push([u*u*u*cx+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,u*u*u*cy+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y])}lcx=x2;lcy=y2;cx=x;cy=y};
 const quad=(x1,y1,x,y)=>{cubic(cx+2/3*(x1-cx),cy+2/3*(y1-cy),x+2/3*(x1-x),y+2/3*(y1-y),x,y);lcx=x1;lcy=y1};
 const arc=(rx,ry,rot,fa,fs,x,y)=>{if(rx===0||ry===0||cx===x&&cy===y){to(x,y);return}rx=Math.abs(rx);ry=Math.abs(ry);const ph=rot*Math.PI/180,c=Math.cos(ph),sn=Math.sin(ph),dx=(cx-x)/2,dy=(cy-y)/2,x1=c*dx+sn*dy,y1=-sn*dx+c*dy;
  const l=x1*x1/(rx*rx)+y1*y1/(ry*ry);if(l>1){const q=Math.sqrt(l);rx*=q;ry*=q}
  const sg=fa===fs?-1:1,co=sg*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*y1*y1-ry*ry*x1*x1)/(rx*rx*y1*y1+ry*ry*x1*x1))),cxp=co*rx*y1/ry,cyp=-co*ry*x1/rx,ccx=c*cxp-sn*cyp+(cx+x)/2,ccy=sn*cxp+c*cyp+(cy+y)/2;
  const ang=(ux,uy,vx,vy)=>{const a=Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);return a},t1=ang(1,0,(x1-cxp)/rx,(y1-cyp)/ry);let dt=ang((x1-cxp)/rx,(y1-cyp)/ry,(-x1-cxp)/rx,(-y1-cyp)/ry);
  if(!fs&&dt>0)dt-=2*Math.PI;else if(fs&&dt<0)dt+=2*Math.PI;const n=Math.max(1,Math.ceil(Math.abs(dt)/(Math.PI/2))),step=dt/n,k=4/3*Math.tan(step/4);
  for(let j=0;j<n;j++){const a1=t1+j*step,a2=a1+step,p=(a,rr)=>{const ex=rx*Math.cos(a),ey=ry*Math.sin(a);return [c*ex-sn*ey+ccx,sn*ex+c*ey+ccy]},d1=a=>[-rx*Math.sin(a),ry*Math.cos(a)],P1=p(a1),P2=p(a2),D1=d1(a1),D2=d1(a2),rt=(v)=>[c*v[0]-sn*v[1],sn*v[0]+c*v[1]];
   const r1=rt(D1),r2=rt(D2);cubic(P1[0]+k*r1[0],P1[1]+k*r1[1],P2[0]-k*r2[0],P2[1]-k*r2[1],P2[0],P2[1])}};
 // every round takes at least one character, so the rounds are bounded by the length: counted, so no input can spin here (audit C2)
 let rounds=0;
 while(true){if(++rounds>s.length+1)throw U('path data');while(/[\s,]/.test(s[i]||''))i++;if(i>=s.length)break;if(/[A-Za-z]/.test(s[i]))cmd=s[i++];else if(!cmd)throw U('path data');
  const rel=cmd===cmd.toLowerCase(),C=cmd.toUpperCase(),ox=rel?cx:0,oy=rel?cy:0;
  // Z takes no numbers: forget the command, so a number after it is bad path data instead of Z again for ever (12 Nov 2026: "…Z 5" hung the app)
  if(C==='Z'){if(cur){cur.closed=true;cx=sx;cy=sy;cur=null}lastC='Z';cmd='';continue}
  if(C==='M'){const x=num()+ox,y=num()+oy;cx=sx=x;cy=sy=y;start(x,y);cmd=rel?'l':'L';lastC='M';continue}
  if(C==='L'){to(num()+ox,num()+oy)}else if(C==='H'){to(num()+ox,cy)}else if(C==='V'){to(cx,num()+oy)}
  else if(C==='C'){const a=num()+ox,b=num()+oy,c2=num()+ox,d=num()+oy,e=num()+ox,f=num()+oy;cubic(a,b,c2,d,e,f)}
  else if(C==='S'){const a=lastC==='C'||lastC==='S'?2*cx-lcx:cx,b=lastC==='C'||lastC==='S'?2*cy-lcy:cy,c2=num()+ox,d=num()+oy,e=num()+ox,f=num()+oy;cubic(a,b,c2,d,e,f)}
  else if(C==='Q'){const a=num()+ox,b=num()+oy,e=num()+ox,f=num()+oy;quad(a,b,e,f)}
  else if(C==='T'){const a=lastC==='Q'||lastC==='T'?2*cx-lcx:cx,b=lastC==='Q'||lastC==='T'?2*cy-lcy:cy,e=num()+ox,f=num()+oy;quad(a,b,e,f)}
  else if(C==='A'){const rx=num(),ry=num(),rot=num(),fa=flag(),fs=flag(),x=num()+ox,y=num()+oy;arc(rx,ry,rot,fa,fs,x,y)}
  else throw U('path command '+cmd);
  lastC=C;if(C==='L'||C==='H'||C==='V')lastC='L'}
 return subs}

const rectSubs=(x,y,w,h,rx,ry)=>{if(!(w>0&&h>0))return [];rx=Math.min(rx||0,w/2);ry=Math.min(ry||0,h/2);if(!rx&&!ry)return [{pts:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],closed:true}];
 const k=.5522847498;return pathToSubs(`M${x+rx} ${y}H${x+w-rx}C${x+w-rx+k*rx} ${y} ${x+w} ${y+ry-k*ry} ${x+w} ${y+ry}V${y+h-ry}C${x+w} ${y+h-ry+k*ry} ${x+w-rx+k*rx} ${y+h} ${x+w-rx} ${y+h}H${x+rx}C${x+rx-k*rx} ${y+h} ${x} ${y+h-ry+k*ry} ${x} ${y+h-ry}V${y+ry}C${x} ${y+ry-k*ry} ${x+rx-k*rx} ${y} ${x+rx} ${y}Z`)};
const ellipseSubs=(cx,cy,rx,ry)=>rx>0&&ry>0?pathToSubs(`M${cx+rx} ${cy}A${rx} ${ry} 0 1 1 ${cx-rx} ${cy}A${rx} ${ry} 0 1 1 ${cx+rx} ${cy}Z`):[];

// ---- coverage ----
function fillMask(polys,w,h,evenodd){const cov=new Float32Array(w*h),SS=4,rows=Array.from({length:h},()=>[]);
 for(const p of polys){const n=p.length;if(n<3)continue;for(let i=0;i<n;i++){const a=p[i],b=p[(i+1)%n];if(a[1]===b[1])continue;const e=a[1]<b[1]?[a[0],a[1],b[0],b[1],1]:[b[0],b[1],a[0],a[1],-1],r0=Math.max(0,Math.floor(e[1])),r1=Math.min(h-1,Math.floor(e[3]));for(let r=r0;r<=r1;r++)rows[r].push(e)}}
 for(let y=0;y<h;y++){const es=rows[y];if(!es.length)continue;const row=y*w;
  for(let s=0;s<SS;s++){const sy=y+(s+.5)/SS,xs=[];for(const e of es)if(sy>=e[1]&&sy<e[3])xs.push([e[0]+(sy-e[1])*(e[2]-e[0])/(e[3]-e[1]),e[4]]);if(xs.length<2)continue;xs.sort((a,b)=>a[0]-b[0]);
   let wn=0;for(let k=0;k<xs.length-1;k++){wn+=xs[k][1];const inside=evenodd?(k+1)%2===1:wn!==0;if(!inside)continue;let x0=Math.max(0,xs[k][0]),x1=Math.min(w,xs[k+1][0]);if(x1<=x0)continue;
    const i0=Math.floor(x0),i1=Math.floor(x1),wt=1/SS;if(i0===i1)cov[row+i0]+=(x1-x0)*wt;else{cov[row+i0]+=(i0+1-x0)*wt;for(let x=i0+1;x<i1;x++)cov[row+x]+=wt;if(i1<w)cov[row+i1]+=(x1-i1)*wt}}}}
 for(let i=0;i<cov.length;i++)if(cov[i]>1)cov[i]=1;return cov}
const area=p=>{let a=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];a+=p[i][0]*q[1]-q[0]*p[i][1]}return a/2};
const pos=p=>area(p)<0?p.slice().reverse():p;
const circle=(x,y,r)=>{const n=Math.min(72,Math.max(12,Math.ceil(r*2))),o=[];for(let i=0;i<n;i++){const a=i/n*Math.PI*2;o.push([x+r*Math.cos(a),y+r*Math.sin(a)])}return o};

// a stroke as the union of positively oriented polygons: a quad per segment, a join at each corner, a cap at each open end
function strokePolys(subs,hw,{cap='butt',join='miter',limit=4}){const out=[];
 for(const sp of subs){let pts=sp.pts.filter((p,i,a)=>i===0||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>1e-6);let closed=sp.closed;if(closed&&pts.length>1&&Math.hypot(pts[0][0]-pts.at(-1)[0],pts[0][1]-pts.at(-1)[1])<1e-6)pts.pop();
  if(pts.length===1){if(cap==='round')out.push(circle(pts[0][0],pts[0][1],hw));else if(cap==='square')out.push([[pts[0][0]-hw,pts[0][1]-hw],[pts[0][0]+hw,pts[0][1]-hw],[pts[0][0]+hw,pts[0][1]+hw],[pts[0][0]-hw,pts[0][1]+hw]]);continue}
  const n=pts.length,segs=closed?n:n-1,dirs=[];for(let i=0;i<segs;i++){const a=pts[i],b=pts[(i+1)%n],l=Math.hypot(b[0]-a[0],b[1]-a[1]);dirs.push([(b[0]-a[0])/l,(b[1]-a[1])/l])}
  for(let i=0;i<segs;i++){let a=pts[i],b=pts[(i+1)%n];const d=dirs[i],nx=-d[1]*hw,ny=d[0]*hw;if(!closed&&cap==='square'){if(i===0)a=[a[0]-d[0]*hw,a[1]-d[1]*hw];if(i===segs-1)b=[b[0]+d[0]*hw,b[1]+d[1]*hw]}
   out.push(pos([[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]]))}
  if(!closed&&cap==='round'){out.push(circle(pts[0][0],pts[0][1],hw),circle(pts[n-1][0],pts[n-1][1],hw))}
  for(let i=closed?0:1;i<(closed?n:n-1);i++){const d1=dirs[(i-1+segs)%segs],d2=dirs[i%segs],p=pts[i],cr=d1[0]*d2[1]-d1[1]*d2[0],dt=d1[0]*d2[0]+d1[1]*d2[1];
   if(Math.abs(cr)<1e-6&&dt>0)continue;if(join==='round'){out.push(circle(p[0],p[1],hw));continue}
   const sg=cr>0?-1:1,n1=[-d1[1]*sg,d1[0]*sg],n2=[-d2[1]*sg,d2[0]*sg],o1=[p[0]+n1[0]*hw,p[1]+n1[1]*hw],o2=[p[0]+n2[0]*hw,p[1]+n2[1]*hw],sm=[n1[0]+n2[0],n1[1]+n2[1]],sl=Math.hypot(sm[0],sm[1]),cosf=sl/2;
   if(join==='miter'&&sl>1e-6&&1/cosf<=limit){const tip=[p[0]+sm[0]/sl*hw/cosf,p[1]+sm[1]/sl*hw/cosf];out.push(pos([p,o1,tip,o2]))}else out.push(pos([p,o1,o2]))}}
 return out}

// ---- document ----
const TAGS=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/gi;
const attrs=s=>{const o={};for(const m of String(s||'').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))o[m[1].toLowerCase()]=m[2]??m[3];return o};
const NO=new Set(['style','text','tspan','textpath','image','use','lineargradient','radialgradient','pattern','mask','clippath','filter','foreignobject','script','symbol','marker','switch','animate','animatetransform','set']);
const IGN=new Set(['title','desc','metadata','defs','namedview','sodipodi:namedview','inkscape:perspective']);
const INH=['fill','stroke','stroke-width','fill-opacity','stroke-opacity','fill-rule','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','color'];

// parse into drawables: [{subs (device space), fill:[r,g,b,a]|null, stroke, sw, ...}] plus the document's own box
export const pathSubs=pathToSubs;   // for the tests
export function parseSvg(svg){const root=/<svg\b[^>]*>/i.exec(String(svg));if(!root)throw U('not an SVG');
 if(/<script|javascript:|<!ENTITY/i.test(svg))throw U('scripts or entities');
 const ra=attrs(root[0].slice(4));let vb=(ra.viewbox||'').split(/[\s,]+/).map(Number);if(vb.length!==4||vb.some(x=>!Number.isFinite(x)))vb=null;
 const len=v=>parseFloat(v),W=len(ra.width),H=len(ra.height);if(!vb){if(W>0&&H>0)vb=[0,0,W,H];else throw U('no viewBox')}
 if(!(vb[2]>0&&vb[3]>0))throw U('empty viewBox');
 const stack=[{m:[1,0,0,1,0,0],st:{fill:'#000000',stroke:'none','stroke-width':'1','fill-opacity':'1','stroke-opacity':'1','fill-rule':'nonzero','stroke-linecap':'butt','stroke-linejoin':'miter','stroke-miterlimit':'4'},op:1}],items=[];let skip=0,seenRoot=false,depthSkip=[];
 for(const t of String(svg).matchAll(TAGS)){if(t[1]){const n=t[1].toLowerCase();if(depthSkip.length&&depthSkip.at(-1)===n){depthSkip.pop();skip--;continue}if(!skip&&(n==='g'||n==='a'||n==='svg')&&stack.length>1)stack.pop();continue}
  if(!t[2])continue;const name=t[2].toLowerCase(),a=attrs(t[3]),self=!!t[4];
  if(skip){if(!self)depthSkip.push(name),skip++;continue}
  if(IGN.has(name)||/^(sodipodi|inkscape|dc|cc|rdf):/.test(name)){if(!self){depthSkip.push(name);skip++}continue}
  if(NO.has(name))throw U('<'+name+'>');
  if(name==='svg'){if(seenRoot)throw U('nested svg');seenRoot=true}
  const top=stack.at(-1),st={...top.st};const style={};for(const m of String(a.style||'').matchAll(/([\w-]+)\s*:\s*([^;]+)/g))style[m[1].toLowerCase()]=m[2].trim();
  if(style.display==='none'||a.display==='none'||style.visibility==='hidden'||a.visibility==='hidden'){if(!self){depthSkip.push(name);skip++}continue}
  for(const k of INH){const v=style[k]??a[k];if(v!=null)st[k]=String(v).trim()}
  for(const k of ['fill','stroke'])if(/url\(/i.test(st[k]))throw U('gradient or pattern paint');
  if(/^\s*(?!none)[^\s]/.test(st['stroke-dasharray']||'none')&&st['stroke-dasharray']!=='none'&&st.stroke!=='none')throw U('dashes');
  const op=top.op*(style.opacity!=null?+style.opacity:a.opacity!=null?+a.opacity:1);if(a['clip-path']||a.mask||a.filter||style['clip-path']||style.filter||style.mask)throw U('clip, mask or filter');
  const m=a.transform?mul(top.m,parseTransform(a.transform)):top.m,L=k=>len(a[k])||0;let subs=null;
  if(name==='svg'||name==='g'||name==='a'){if(!self)stack.push({m,st,op});continue}
  if(name==='rect')subs=rectSubs(L('x'),L('y'),L('width'),L('height'),a.rx!=null?L('rx'):L('ry'),a.ry!=null?L('ry'):L('rx'));
  else if(name==='circle')subs=ellipseSubs(L('cx'),L('cy'),L('r'),L('r'));else if(name==='ellipse')subs=ellipseSubs(L('cx'),L('cy'),L('rx'),L('ry'));
  else if(name==='line')subs=[{pts:[[L('x1'),L('y1')],[L('x2'),L('y2')]],closed:false}];
  else if(name==='polyline'||name==='polygon'){const n=String(a.points||'').split(/[\s,]+/).filter(Boolean).map(Number);const pts=[];for(let i=0;i+1<n.length;i+=2)pts.push([n[i],n[i+1]]);subs=[{pts,closed:name==='polygon'}]}
  else if(name==='path')subs=pathToSubs(a.d);else continue;
  const col=k=>{const c=parseColour(k==='fill'?(st.fill==='currentColor'?st.color||'#000':st.fill):(st.stroke==='currentColor'?st.color||'#000':st.stroke));return c};
  const fc=name==='line'||name==='polyline'&&false?null:col('fill'),sc=col('stroke');
  items.push({subs,m,fill:fc?{c:fc,a:op*+st['fill-opacity']}:null,stroke:sc?{c:sc,a:op*+st['stroke-opacity'],w:+st['stroke-width'],cap:st['stroke-linecap'],join:st['stroke-linejoin'],limit:+st['stroke-miterlimit'],scale:Math.sqrt(Math.abs(m[0]*m[3]-m[1]*m[2]))}:null,evenodd:st['fill-rule']==='evenodd'})}
 if(!items.length)throw U('nothing to draw');return {vb,items}}

// bounding box of what is drawn (user units), fills and strokes together
export function bounds(doc){let x0=1/0,y0=1/0,x1=-1/0,y1=-1/0;const inv=m=>{const d=m[0]*m[3]-m[1]*m[2];return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d]};
 for(const it of doc.items){const pad=it.stroke?it.stroke.w*it.stroke.scale/2:0;for(const s of it.subs)for(const p of s.pts){const [x,y]=ap(it.m,p[0],p[1]);const k=it.stroke?pad:0;x0=Math.min(x0,x-k);y0=Math.min(y0,y-k);x1=Math.max(x1,x+k);y1=Math.max(y1,y+k)}}void inv;return {x:x0,y:y0,w:x1-x0,h:y1-y0}}

// render to straight RGBA at size*size. box: where the drawing goes in the canvas {x,y,w,h} (default all of it); the document's
// viewBox is fitted inside it ("meet", centred). fitBounds:true fits what is actually drawn instead of the viewBox.
export function renderSvg(svg,size,{box,fitBounds=false,doc,skipFirstBackground=false}={}){doc||=parseSvg(svg);const S=size,bx=box||{x:0,y:0,w:S,h:S};
 let src=doc.vb;if(fitBounds){const b=bounds(doc);src=[b.x,b.y,b.w,b.h]}
 const sc=Math.min(bx.w/src[2],bx.h/src[3]),base=[sc,0,0,sc,bx.x+(bx.w-src[2]*sc)/2-src[0]*sc,bx.y+(bx.h-src[3]*sc)/2-src[1]*sc];
 const buf=new Float32Array(S*S*4);
 const paint=(cov,c,al)=>{const a0=al*c[3]/255;if(a0<=0)return;for(let i=0;i<S*S;i++){const k=cov[i]*a0;if(k<=0)continue;const o=i*4,inv=1-k;buf[o]=c[0]/255*k+buf[o]*inv;buf[o+1]=c[1]/255*k+buf[o+1]*inv;buf[o+2]=c[2]/255*k+buf[o+2]*inv;buf[o+3]=k+buf[o+3]*inv}};
 for(const it of doc.items){const m=mul(base,it.m),subs=it.subs.map(s=>({closed:s.closed,pts:s.pts.map(p=>ap(m,p[0],p[1]))}));
  if(it.fill)paint(fillMask(subs.filter(s=>s.pts.length>2).map(s=>s.pts),S,S,it.evenodd),it.fill.c,it.fill.a);
  if(it.stroke&&it.stroke.w>0){const hw=it.stroke.w*Math.sqrt(Math.abs(m[0]*m[3]-m[1]*m[2]))/2;paint(fillMask(strokePolys(subs,hw,it.stroke),S,S,false),it.stroke.c,it.stroke.a)}}
 const out=new Uint8Array(S*S*4);for(let i=0;i<S*S;i++){const a=buf[i*4+3];if(a>0){out[i*4]=Math.round(buf[i*4]/a*255);out[i*4+1]=Math.round(buf[i*4+1]/a*255);out[i*4+2]=Math.round(buf[i*4+2]/a*255);out[i*4+3]=Math.round(a*255)}}
 return out}
