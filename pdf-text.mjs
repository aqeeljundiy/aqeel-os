// Best-effort text from a PDF without dependencies: inflate content streams and read the strings
// shown by Tj, TJ, ' and " operators. Good for ordinary text PDFs; scanned or custom-encoded ones yield little.
import {inflateSync} from 'node:zlib';

function unescape(s){return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g,(m,c)=>{if(/^[0-7]/.test(c))return String.fromCharCode(parseInt(c,8));return {n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'}[c]??''})}
const hex=h=>{h=h.replace(/\s+/g,'');if(h.length%2)h+='0';let out='';const two=h.length>=4&&h.startsWith('FEFF');for(let i=two?4:0;i<h.length;i+=two?4:2)out+=String.fromCharCode(parseInt(h.slice(i,i+(two?4:2)),16));return out};

// literal strings may contain balanced parentheses
function strings(src){const out=[];for(let i=0;i<src.length;i++){if(src[i]==='('){let depth=1,j=i+1,s='';for(;j<src.length&&depth;j++){const ch=src[j];if(ch==='\\'){s+=ch+src[j+1];j++;continue}if(ch==='(')depth++;else if(ch===')'&&!--depth)break;s+=ch}out.push({at:i,end:j,text:unescape(s)});i=j}else if(src[i]==='<'&&src[i+1]!=='<'){const j=src.indexOf('>',i);if(j<0)break;if(/^[0-9a-fA-F\s]*$/.test(src.slice(i+1,j)))out.push({at:i,end:j,text:hex(src.slice(i+1,j))});i=j}}return out}

export function contentText(src){let text='';
 // walk text operators in order; a TJ array is one run, Td/T*/' start new lines
 const re=/\[((?:[^\]\\]|\\.)*)\]\s*TJ|(\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\)|<[0-9a-fA-F\s]*>)\s*(Tj|'|")|(T\*|Td|TD|Tm|ET)\b/g;let m;
 while((m=re.exec(src))){if(m[1]!==undefined){const parts=strings(m[1]);let line='';const nums=m[1].replace(/\((?:[^()\\]|\\.)*\)|<[^>]*>/g,' ');for(const p of parts)line+=p.text;if(/-\d{3,}/.test(nums)&&!line.includes(' '))line=parts.map(p=>p.text).join(' ');text+=line}
  else if(m[2]){const s=strings(m[2])[0]?.text||'';if(m[3]!=='Tj')text+='\n';text+=s}
  else if(m[4]){if(!text.endsWith('\n'))text+='\n'}}
 return text}

export function pdfText(buf,max=200000){const raw=buf.toString('latin1');let out='';const re=/<<((?:(?!>>\s*stream)[\s\S]){0,2000}?)>>\s*stream\r?\n/g;let m;
 while((m=re.exec(raw))&&out.length<max){const start=m.index+m[0].length,end=raw.indexOf('endstream',start);if(end<0)break;let body=buf.subarray(start,end);re.lastIndex=end;
  if(/\/Subtype\s*\/(Image|XML)|\/Type\s*\/(XObject|Metadata|XRef|ObjStm)|\/Length1/.test(m[1]))continue;
  if(/\/FlateDecode/.test(m[1])){try{body=inflateSync(body)}catch{try{body=inflateSync(body.subarray(0,body.length-1))}catch{continue}}}else if(/\/Filter/.test(m[1]))continue;
  const src=body.toString('latin1');if(!/\b(Tj|TJ)\b/.test(src))continue;out+=contentText(src)+'\n'}
 return out.replace(/[^\S\n]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim().slice(0,max)}

// extracted text is only worth sending when it reads like text (custom font encodings give symbol soup)
export function readable(t){if(!t||t.length<20)return false;const ok=(t.match(/[\p{L}\p{N}\s.,:;!?()%'"\/&+-]/gu)||[]).length;const words=(t.match(/\p{L}{3,}/gu)||[]).length;return ok/t.length>=0.85&&words>=3}
