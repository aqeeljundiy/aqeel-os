// Line diff (Myers O(ND)) shared by the server and the browser.
// Returns hunks of {type:'same'|'add'|'del', text} lines with surrounding context collapsed.
export function diffLines(before,after){
 const a=String(before??'').split('\n'),b=String(after??'').split('\n');
 if(before==null)return b.map(text=>({type:'add',text}));if(after==null)return a.map(text=>({type:'del',text}));
 const n=a.length,m=b.length,max=n+m,v=new Map([[1,0]]),trace=[];
 outer:for(let d=0;d<=max;d++){trace.push(new Map(v));
  for(let k=-d;k<=d;k+=2){let x=(k===-d||(k!==d&&(v.get(k-1)??-1)<(v.get(k+1)??-1)))?(v.get(k+1)??0):(v.get(k-1)??0)+1;let y=x-k;
   while(x<n&&y<m&&a[x]===b[y]){x++;y++}v.set(k,x);if(x>=n&&y>=m)break outer}
  if(d>4000)return [...a.map(text=>({type:'del',text})),...b.map(text=>({type:'add',text}))]; // pathological: fall back
 }
 const out=[];let x=n,y=m;
 for(let d=trace.length-1;d>=0&&(x>0||y>0);d--){const vv=trace[d],k=x-y;
  const prevK=(k===-d||(k!==d&&(vv.get(k-1)??-1)<(vv.get(k+1)??-1)))?k+1:k-1;const px=vv.get(prevK)??0,py=px-prevK;
  while(x>px&&y>py){out.push({type:'same',text:a[x-1]});x--;y--}
  if(d>0){if(x===px)out.push({type:'add',text:b[y-1]});else out.push({type:'del',text:a[x-1]})}x=px;y=py}
 return out.reverse();
}

// Collapse unchanged runs to `context` lines around changes; numbers lines for display.
export function hunks(lines,context=3){
 const rows=[];let oldNo=1,newNo=1;for(const l of lines){rows.push({...l,old:l.type==='add'?null:oldNo,new:l.type==='del'?null:newNo});if(l.type!=='add')oldNo++;if(l.type!=='del')newNo++}
 const keep=rows.map(()=>false);rows.forEach((r,i)=>{if(r.type!=='same')for(let j=Math.max(0,i-context);j<=Math.min(rows.length-1,i+context);j++)keep[j]=true});
 const out=[];let skipped=0;rows.forEach((r,i)=>{if(keep[i]){if(skipped){out.push({type:'skip',count:skipped});skipped=0}out.push(r)}else skipped++});if(skipped&&out.length)out.push({type:'skip',count:skipped});
 return out;
}
export const stats=lines=>({added:lines.filter(l=>l.type==='add').length,removed:lines.filter(l=>l.type==='del').length});

// Number each run of added/removed lines (a "block"); unchanged lines get no block.
export function markBlocks(lines){let b=-1,inBlock=false;for(const l of lines){if(l.type==='same'){inBlock=false;delete l.block}else{if(!inBlock){b++;inBlock=true}l.block=b}}return b+1}
// What a block looked like, so the server can check it still matches before undoing it.
export const blockText=(lines,i)=>lines.filter(l=>l.block===i).map(l=>(l.type==='add'?'+':'-')+l.text).join('\n');
// The file with block i put back as it was and every other change kept.
export function revertBlock(lines,i){return lines.filter(l=>l.type==='same'||(l.block===i?l.type==='del':l.type==='add')).map(l=>l.text).join('\n')}
