// A small xterm-compatible terminal emulator: enough of VT100/xterm for shells, prompts, colours, and full-screen
// programs (vim, less, top): cursor movement, erase, scroll regions, insert/delete, SGR colours and the alternate screen.
// The core has no DOM; renderRows() turns a row into HTML-safe spans for the page.

const blank=a=>({c:' ',a});
const DEFAULT={fg:null,bg:null,b:false,d:false,i:false,u:false,inv:false};

export class Screen{
 constructor(cols=80,rows=24,{onReply=()=>{},onTitle=()=>{},scrollback=2000}={}){Object.assign(this,{cols,rows,onReply,onTitle,maxBack:scrollback});this.history=[];this.reset()}
 reset(){this.attr={...DEFAULT};this.main=this.grid();this.alt=null;this.lines=this.main;this.x=0;this.y=0;this.top=0;this.bottom=this.rows-1;this.wrapNext=false;this.autowrap=true;this.cursorVisible=true;this.appCursor=false;this.bracketed=false;this.saved=null;this.state='ground';this.params='';this.osc='';this.dirty=true}
 grid(){return Array.from({length:this.rows},()=>this.row())}
 row(){return Array.from({length:this.cols},()=>blank(this.attr&&(this.attr.bg)?{...DEFAULT,bg:this.attr.bg}:DEFAULT))}
 get altActive(){return this.lines===this.alt}

 write(data){for(const ch of String(data))this.feed(ch);this.dirty=true}
 feed(ch){const code=ch.codePointAt(0);
  switch(this.state){
   case 'ground':if(code===0x1b){this.state='esc';return}if(code<0x20||code===0x7f){this.control(code);return}this.print(ch);return;
   case 'esc':this.state='ground';
    if(ch==='['){this.state='csi';this.params='';return}if(ch===']'){this.state='osc';this.osc='';return}if(ch==='('||ch===')'||ch==='*'||ch==='+'){this.state='charset';return}if(ch==='P'||ch==='_'||ch==='^'||ch==='X'){this.state='string';return}
    if(ch==='7')this.save();else if(ch==='8')this.restore();else if(ch==='D')this.index();else if(ch==='E'){this.x=0;this.index()}else if(ch==='M')this.reverseIndex();else if(ch==='c')this.reset();return;
   case 'charset':this.state='ground';return;
   case 'csi':if(code>=0x40&&code<=0x7e){this.state='ground';this.csi(ch,this.params);return}if(code===0x1b){this.state='esc';return}this.params+=ch;if(this.params.length>64)this.state='ground';return;
   case 'osc':if(code===7){this.endOsc();return}if(code===0x1b){this.state='oscEsc';return}this.osc+=ch;if(this.osc.length>4096)this.state='ground';return;
   case 'oscEsc':this.endOsc();if(ch!=='\\')this.feed(ch);return;
   case 'string':if(code===0x1b)this.state='stringEsc';else if(code===7)this.state='ground';return;
   case 'stringEsc':this.state='ground';return;
  }}
 endOsc(){this.state='ground';const m=this.osc.match(/^(\d+);([\s\S]*)$/);if(m&&(m[1]==='0'||m[1]==='2'))this.onTitle(m[2])}
 control(code){if(code===10||code===11||code===12)this.index();else if(code===13){this.x=0;this.wrapNext=false}else if(code===8){this.x=Math.max(0,this.x-(this.wrapNext?0:1));this.wrapNext=false}else if(code===9)this.x=Math.min(this.cols-1,(Math.floor(this.x/8)+1)*8)}
 print(ch){if(this.wrapNext){this.wrapNext=false;this.x=0;this.index()}
  const line=this.lines[this.y];if(line)line[this.x]={c:ch,a:{...this.attr}};
  if(this.x>=this.cols-1){if(this.autowrap)this.wrapNext=true}else this.x++}
 index(){if(this.y===this.bottom)this.scrollUp(1);else if(this.y<this.rows-1)this.y++}
 reverseIndex(){if(this.y===this.top)this.scrollDown(1);else if(this.y>0)this.y--}
 scrollUp(n){for(let k=0;k<n;k++){const gone=this.lines.splice(this.top,1)[0];this.lines.splice(this.bottom,0,this.row());if(!this.altActive&&this.top===0){this.history.push(gone);if(this.history.length>this.maxBack)this.history.shift()}}}
 scrollDown(n){for(let k=0;k<n;k++){this.lines.splice(this.bottom,1);this.lines.splice(this.top,0,this.row())}}
 save(){this.saved={x:this.x,y:this.y,attr:{...this.attr}}}
 restore(){if(this.saved){this.x=this.saved.x;this.y=this.saved.y;this.attr={...this.saved.attr}}this.wrapNext=false}
 clamp(){this.x=Math.max(0,Math.min(this.cols-1,this.x));this.y=Math.max(0,Math.min(this.rows-1,this.y));this.wrapNext=false}
 erase(line,from,to){for(let i=Math.max(0,from);i<Math.min(this.cols,to);i++)line[i]=blank(this.attr.bg?{...DEFAULT,bg:this.attr.bg}:DEFAULT)}
 csi(final,raw){const priv=raw.startsWith('?')?'?':raw.startsWith('>')?'>':'';const p=raw.replace(/^[?>=]/,'').split(';').map(v=>v===''?NaN:parseInt(v,10));const n=(i=0,d=1)=>Number.isFinite(p[i])&&p[i]>0?p[i]:d;
  switch(final){
   case 'A':this.y=Math.max(this.y<this.top?0:this.top,this.y-n());this.wrapNext=false;break;
   case 'B':this.y=Math.min(this.y>this.bottom?this.rows-1:this.bottom,this.y+n());this.wrapNext=false;break;
   case 'C':this.x+=n();this.clamp();break;case 'D':this.x-=n();this.clamp();break;
   case 'E':this.y+=n();this.x=0;this.clamp();break;case 'F':this.y-=n();this.x=0;this.clamp();break;
   case 'G':case '`':this.x=n()-1;this.clamp();break;case 'd':this.y=n()-1;this.clamp();break;
   case 'H':case 'f':this.y=n(0)-1;this.x=n(1)-1;this.clamp();break;
   case 'J':{const m=p[0]||0;if(m===0){this.erase(this.lines[this.y],this.x,this.cols);for(let r=this.y+1;r<this.rows;r++)this.erase(this.lines[r],0,this.cols)}else if(m===1){this.erase(this.lines[this.y],0,this.x+1);for(let r=0;r<this.y;r++)this.erase(this.lines[r],0,this.cols)}else{for(let r=0;r<this.rows;r++)this.erase(this.lines[r],0,this.cols);if(m===3)this.history=[]}break}
   case 'K':{const m=p[0]||0,line=this.lines[this.y];if(m===0)this.erase(line,this.x,this.cols);else if(m===1)this.erase(line,0,this.x+1);else this.erase(line,0,this.cols);break}
   case 'L':if(this.y>=this.top&&this.y<=this.bottom)for(let k=0;k<n();k++){this.lines.splice(this.bottom,1);this.lines.splice(this.y,0,this.row())}break;
   case 'M':if(this.y>=this.top&&this.y<=this.bottom)for(let k=0;k<n();k++){this.lines.splice(this.y,1);this.lines.splice(this.bottom,0,this.row())}break;
   case 'P':{const line=this.lines[this.y];line.splice(this.x,Math.min(n(),this.cols-this.x));while(line.length<this.cols)line.push(blank(DEFAULT));break}
   case '@':{const line=this.lines[this.y];for(let k=0;k<Math.min(n(),this.cols-this.x);k++)line.splice(this.x,0,blank(DEFAULT));line.length=this.cols;break}
   case 'X':this.erase(this.lines[this.y],this.x,this.x+n());break;
   case 'S':this.scrollUp(n());break;case 'T':if(!priv)this.scrollDown(n());break;
   case 'r':if(!priv){this.top=n(0)-1;this.bottom=Math.min(this.rows-1,n(1,this.rows)-1);if(this.top>=this.bottom){this.top=0;this.bottom=this.rows-1}this.x=0;this.y=0}break;
   case 's':if(!priv)this.save();break;case 'u':this.restore();break;
   case 'm':this.sgr(raw===''?[0]:p.map(v=>Number.isFinite(v)?v:0));break;
   case 'h':case 'l':{const on=final==='h';if(priv==='?')for(const m of p){if(m===1)this.appCursor=on;else if(m===7)this.autowrap=on;else if(m===25)this.cursorVisible=on;else if(m===2004)this.bracketed=on;else if(m===47||m===1047||m===1049){if(on&&!this.altActive){if(m===1049)this.save();this.alt=this.grid();this.lines=this.alt}else if(!on&&this.altActive){this.lines=this.main;this.alt=null;if(m===1049)this.restore()}}}break}
   case 'n':if(p[0]===6)this.onReply('\x1b['+(this.y+1)+';'+(this.x+1)+'R');else if(p[0]===5)this.onReply('\x1b[0n');break;
   case 'c':if(!priv)this.onReply('\x1b[?1;2c');break;
  }}
 sgr(p){for(let i=0;i<p.length;i++){const v=p[i];
  if(v===0)this.attr={...DEFAULT};else if(v===1)this.attr.b=true;else if(v===2)this.attr.d=true;else if(v===3)this.attr.i=true;else if(v===4)this.attr.u=true;else if(v===7)this.attr.inv=true;
  else if(v===22){this.attr.b=false;this.attr.d=false}else if(v===23)this.attr.i=false;else if(v===24)this.attr.u=false;else if(v===27)this.attr.inv=false;
  else if(v>=30&&v<=37)this.attr.fg=v-30;else if(v>=90&&v<=97)this.attr.fg=v-82;else if(v===39)this.attr.fg=null;
  else if(v>=40&&v<=47)this.attr.bg=v-40;else if(v>=100&&v<=107)this.attr.bg=v-92;else if(v===49)this.attr.bg=null;
  else if(v===38||v===48){const key=v===38?'fg':'bg';if(p[i+1]===5){this.attr[key]=p[i+2];i+=2}else if(p[i+1]===2){this.attr[key]='#'+[p[i+2],p[i+3],p[i+4]].map(x=>Math.max(0,Math.min(255,x||0)).toString(16).padStart(2,'0')).join('');i+=4}}}}
 resize(cols,rows){cols=Math.max(10,Math.min(400,cols|0));rows=Math.max(4,Math.min(200,rows|0));if(cols===this.cols&&rows===this.rows)return false;
  for(const g of [this.main,this.alt].filter(Boolean)){for(const line of g){if(line.length>cols)line.length=cols;else while(line.length<cols)line.push(blank(DEFAULT))}
   while(g.length>rows){if(g===this.main&&this.y>=rows){this.history.push(g.shift());this.y--}else g.pop()}while(g.length<rows)g.push(Array.from({length:cols},()=>blank(DEFAULT)))}
  this.cols=cols;this.rows=rows;this.top=0;this.bottom=rows-1;this.clamp();this.dirty=true;return true}
 text(){return this.lines.map(l=>l.map(c=>c.c).join('').replace(/\s+$/,'')).join('\n').replace(/\n+$/,'')}
}

// xterm's 16 colours tuned for the app's light and dark themes come from CSS variables --t0..--t15
const CUBE=[0,95,135,175,215,255];
export function color(v){if(v===null||v===undefined)return null;if(typeof v==='string')return v;if(v<16)return 'var(--t'+v+')';
 if(v<232){const n=v-16;return 'rgb('+CUBE[Math.floor(n/36)]+','+CUBE[Math.floor(n/6)%6]+','+CUBE[n%6]+')'}const g=8+(v-232)*10;return 'rgb('+g+','+g+','+g+')'}
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
// one row → HTML with runs of equal attributes merged; cursorX marks the cursor cell
export function renderRow(line,cursorX=-1){let html='',run='',key=null,style='';const flush=()=>{if(run)html+=style?'<span style="'+style+'">'+esc(run)+'</span>':esc(run);run=''};
 for(let i=0;i<line.length;i++){const {c,a}=line[i];let fg=color(a.fg!==null&&a.b&&typeof a.fg==='number'&&a.fg<8?a.fg+8:a.fg),bg=color(a.bg);if(a.inv){const t=fg||'var(--term-fg)';fg=bg||'var(--term-bg)';bg=t}if(i===cursorX){const t=fg||'var(--term-fg)';fg=bg||'var(--term-bg)';bg=t}
  const s=(fg?'color:'+fg+';':'')+(bg?'background:'+bg+';':'')+(a.b?'font-weight:700;':'')+(a.d?'opacity:.7;':'')+(a.i?'font-style:italic;':'')+(a.u?'text-decoration:underline;':'');const k=s;if(k!==key){flush();key=k;style=s}run+=c}
 flush();return html}

// keys → bytes, following xterm (application cursor mode switches arrows to ESC O x)
export function keyBytes(e,appCursor){const k=e.key;if(e.ctrlKey&&!e.altKey&&!e.metaKey&&k.length===1){const c=k.toUpperCase().charCodeAt(0);if(c>=64&&c<=95)return String.fromCharCode(c-64);if(k===' ')return '\x00';if(k==='?')return '\x7f'}
 const arrows={ArrowUp:'A',ArrowDown:'B',ArrowRight:'C',ArrowLeft:'D'};if(arrows[k])return (e.ctrlKey?'\x1b[1;5':appCursor?'\x1bO':'\x1b[')+arrows[k];
 const map={Enter:'\r',Backspace:'\x7f',Tab:e.shiftKey?'\x1b[Z':'\t',Escape:'\x1b',Home:'\x1b[H',End:'\x1b[F',Insert:'\x1b[2~',Delete:'\x1b[3~',PageUp:'\x1b[5~',PageDown:'\x1b[6~',F1:'\x1bOP',F2:'\x1bOQ',F3:'\x1bOR',F4:'\x1bOS',F5:'\x1b[15~',F6:'\x1b[17~',F7:'\x1b[18~',F8:'\x1b[19~',F9:'\x1b[20~',F10:'\x1b[21~',F11:'\x1b[23~',F12:'\x1b[24~'};
 if(map[k])return map[k];if(k.length===1&&!e.ctrlKey&&!e.metaKey)return e.altKey?'\x1b'+k:k;return null}
