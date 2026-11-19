const fs=require('fs');const [,,itemsFile,mdFile]=process.argv;
const window={};eval(fs.readFileSync(itemsFile,'utf8'));const B=window.BOARD;
const box={todo:'[ ]',doing:'[~]',you:'[ ]',check:'[~]',done:'[x]'};
const tag={todo:'',doing:' (doing)',you:' **(waiting on you)**',check:' (fixed, to check live)',done:''};
let out='### 19 Nov: everything open, one checklist (owner, from Amri, Donna, Aldillah and both Fixer lists)\nThe board shows the same list by status. `[~]` = fixed or doing, to check live. Priority 1 first. Fixer ids in brackets (Health › Fixer).\n';
for(const [k,name] of Object.entries(B.areas)){const l=B.items.filter(i=>i.area===k).sort((a,b)=>(a.status==='done')-(b.status==='done')||a.p-b.p);if(!l.length)continue;
 out+='\n**'+name+'**\n';for(const i of l)out+='- '+box[i.status]+' **'+i.id+'** P'+i.p+' · '+i.server+' · '+i.title+tag[i.status]+(i.detail?'. '+i.detail.replace(/\.$/,'')+'.':'')+(i.refs.length?' ['+i.refs.join(', ')+']':'')+'\n'}
let md=fs.readFileSync(mdFile,'utf8');
const a=md.indexOf('### 19 Nov'),b=md.indexOf('### Night of 17–18 Nov');
if(a<0||b<0)throw Error('section markers not found');
// keep ROLES-2 line text in the roles area already; replace the old 19 Nov section
md=md.slice(0,a)+out+'\n'+md.slice(b);
md=md.replace(/_Last updated: [^\n]*_/,'_Last updated: 19 Nov 2026 (everything open in one checklist; board in sync)_');
fs.writeFileSync(mdFile,md);
const c={};for(const i of B.items)c[i.status]=(c[i.status]||0)+1;console.log(B.items.length,'items',JSON.stringify(c));
