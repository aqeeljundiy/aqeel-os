// What an agent can ask of a spreadsheet beyond plain values (12 Nov 2026): the plain-language arguments of google_sheets
// (format, resize, freeze, merge, borders, conditional_format, validation, add/rename/duplicate/delete/move tabs, batch_update)
// turned into Sheets API batchUpdate requests. Pure functions, no network: google-tools.mjs sends them with the agent's own
// Google sign-in (or through google-files.mjs for an agent locked to its own files). Mistakes come back as Ask: the sentence
// the agent reads, saying what to change.
export class Ask extends Error{}
const ask=m=>{throw new Ask(m)};
export const SHEET_ACTIONS=['read','write','append','create','clear','format','resize','freeze','merge','unmerge','borders','conditional_format','validation','list_sheets','add_sheet','rename_sheet','duplicate_sheet','delete_sheet','move_sheet','batch_update'];
// actions that name a range (a tab alone is enough for the others)
export const NEEDS_RANGE=new Set(['read','write','append','clear','format','resize','merge','unmerge','borders','conditional_format','validation']);
const NAMED={black:'#000000',white:'#ffffff',red:'#e53935',green:'#43a047',blue:'#1e88e5',yellow:'#fdd835',orange:'#fb8c00',purple:'#8e24aa',pink:'#ec407a',gray:'#9e9e9e',grey:'#9e9e9e',lightgray:'#eeeeee',lightgrey:'#eeeeee',lightgreen:'#c8e6c9',lightred:'#ffcdd2',lightblue:'#bbdefb',lightyellow:'#fff9c4'};
export function rgb(c){let s=String(c??'').trim().toLowerCase().replace(/[\s_-]/g,'');s=NAMED[s]||s;const m=/^#?([0-9a-f]{6})$/.exec(s)||/^#?([0-9a-f]{3})$/.exec(s);
 if(!m)ask('"'+c+'" is not a colour. Use a hex like #ff0000 or one of: '+Object.keys(NAMED).join(', ')+'.');let h=m[1];if(h.length===3)h=[...h].map(x=>x+x).join('');
 const n=i=>Math.round(parseInt(h.slice(i,i+2),16)/255*1000)/1000;return {red:n(0),green:n(2),blue:n(4)}}
const colN=s=>[...s.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
export function splitRange(s){s=String(s||'').trim();const i=s.lastIndexOf('!');if(i<0)return {sheet:null,rest:s};let sh=s.slice(0,i);if(/^'.*'$/.test(sh))sh=sh.slice(1,-1).replace(/''/g,"'");return {sheet:sh,rest:s.slice(i+1)}}
function tabOf(tabs,name){if(!name)return tabs[0]||ask('This spreadsheet has no tabs.');const w=String(name).toLowerCase();
 return tabs.find(t=>t.title===name)||tabs.find(t=>t.title.toLowerCase()===w)||ask('No tab called "'+name+'". Its tabs: '+tabs.map(t=>t.title).join(', ')+'.')}
// A1 text -> a Sheets GridRange (0-based, end exclusive). "A1", "A1:C5", "A:C", "2:4", "Sheet2!B2:D9", "'My tab'!A1", or a tab name alone
export function gridRange(range,tabs,sheetName){let {sheet,rest}=splitRange(range);if(!sheet&&rest&&tabs.some(x=>x.title.toLowerCase()===rest.toLowerCase()))[sheet,rest]=[rest,''];const t=tabOf(tabs,sheet||sheetName);const r={sheetId:t.sheetId};if(!rest)return r;
 const m=/^([a-z]{0,3})(\d*)(?::([a-z]{0,3})(\d*))?$/i.exec(rest);if(!m||(!m[1]&&!m[2]))ask('"'+rest+'" is not an A1 range. Examples: A1, A1:C5, A:C, 2:4, Sheet2!B2:D9.');
 const colon=rest.includes(':'),a=m[1],b=m[2],c=colon?m[3]:a,d=colon?m[4]:b;
 if(a)r.startColumnIndex=colN(a)-1;if(c)r.endColumnIndex=colN(c);if(b)r.startRowIndex=Number(b)-1;if(d)r.endRowIndex=Number(d);
 if(r.endColumnIndex<=r.startColumnIndex||r.endRowIndex<=r.startRowIndex)ask('"'+rest+'" runs backwards; write the top-left cell first.');return r}
const NUMFMT={number:['NUMBER','#,##0.00'],integer:['NUMBER','#,##0'],currency:['CURRENCY','$#,##0.00'],percent:['PERCENT','0.00%'],date:['DATE','yyyy-mm-dd'],datetime:['DATE_TIME','yyyy-mm-dd hh:mm:ss'],time:['TIME','hh:mm:ss'],text:['TEXT','@'],scientific:['SCIENTIFIC','0.00E+00']};
function numFmt(v){if(v&&typeof v==='object'){if(!v.pattern)ask('number_format needs a pattern, e.g. "#,##0.00".');return {type:String(v.type||'NUMBER').toUpperCase(),pattern:String(v.pattern)}}
 const s=String(v),k=NUMFMT[s.toLowerCase()];if(k)return {type:k[0],pattern:k[1]};
 return {type:/[yd]{2}|hh|mmm/i.test(s)?'DATE':s.includes('%')?'PERCENT':/[$€£¥]/.test(s)?'CURRENCY':'NUMBER',pattern:s}}
const H={left:'LEFT',center:'CENTER',right:'RIGHT'},V={top:'TOP',middle:'MIDDLE',bottom:'BOTTOM'},W={wrap:'WRAP',clip:'CLIP',overflow:'OVERFLOW_CELL'};
const pickOf=(M,v,what)=>M[String(v).toLowerCase()]||ask(what+' is one of: '+Object.keys(M).join(', ')+'.');
function cellFormat(f){if(!f||typeof f!=='object')ask('Give format, e.g. {"bold":true,"background":"#ffff00","number_format":"currency"}.');
 if(f.reset)return {fmt:{},fields:['userEnteredFormat']};
 const tf={},fmt={},fields=[],T='userEnteredFormat.textFormat.';
 for(const k of ['bold','italic','underline','strikethrough'])if(f[k]!==undefined){tf[k]=!!f[k];fields.push(T+k)}
 if(f.font_size!==undefined){tf.fontSize=Number(f.font_size)||ask('font_size is a number of points.');fields.push(T+'fontSize')}
 if(f.font_family){tf.fontFamily=String(f.font_family);fields.push(T+'fontFamily')}
 if(f.color){tf.foregroundColor=rgb(f.color);fields.push(T+'foregroundColor')}
 if(fields.length)fmt.textFormat=tf;
 if(f.background){fmt.backgroundColor=rgb(f.background);fields.push('userEnteredFormat.backgroundColor')}
 if(f.h_align){fmt.horizontalAlignment=pickOf(H,f.h_align,'h_align');fields.push('userEnteredFormat.horizontalAlignment')}
 if(f.v_align){fmt.verticalAlignment=pickOf(V,f.v_align,'v_align');fields.push('userEnteredFormat.verticalAlignment')}
 if(f.wrap!==undefined){fmt.wrapStrategy=f.wrap===true?'WRAP':f.wrap===false?'OVERFLOW_CELL':pickOf(W,f.wrap,'wrap');fields.push('userEnteredFormat.wrapStrategy')}
 if(f.number_format!==undefined){fmt.numberFormat=numFmt(f.number_format);fields.push('userEnteredFormat.numberFormat')}
 if(!fields.length)ask('format has nothing to set. Use any of: bold, italic, underline, strikethrough, font_size, font_family, color, background, h_align, v_align, wrap, number_format, or reset true.');
 return {fmt,fields}}
const STYLE={solid:'SOLID',dashed:'DASHED',dotted:'DOTTED',double:'DOUBLE',medium:'SOLID_MEDIUM',thick:'SOLID_THICK',none:'NONE'};
const SIDES=['top','bottom','left','right','innerHorizontal','innerVertical'];
function borders(b,range){b=b&&typeof b==='object'?b:{};const style=pickOf(STYLE,b.style||'solid','border style'),color=rgb(b.color||'black');
 const s=b.sides??'all';const sel=s==='all'?SIDES:s==='outer'?SIDES.slice(0,4):s==='inner'?SIDES.slice(4):(Array.isArray(s)?s:[s]).map(x=>String(x).replace(/_(\w)/g,(_,c)=>c.toUpperCase()));
 for(const x of sel)if(!SIDES.includes(x))ask('borders.sides is all, outer, inner, or a list of: top, bottom, left, right, inner_horizontal, inner_vertical.');
 return {updateBorders:{range,...Object.fromEntries(sel.map(x=>[x,{style,color}]))}}}
const COND={greater:'NUMBER_GREATER',greater_or_equal:'NUMBER_GREATER_THAN_EQ',less:'NUMBER_LESS',less_or_equal:'NUMBER_LESS_THAN_EQ',equal:'NUMBER_EQ',not_equal:'NUMBER_NOT_EQ',between:'NUMBER_BETWEEN',not_between:'NUMBER_NOT_BETWEEN',
 text_contains:'TEXT_CONTAINS',text_not_contains:'TEXT_NOT_CONTAINS',text_starts_with:'TEXT_STARTS_WITH',text_ends_with:'TEXT_ENDS_WITH',text_equals:'TEXT_EQ',blank:'BLANK',not_blank:'NOT_BLANK',date_before:'DATE_BEFORE',date_after:'DATE_AFTER',date_equal:'DATE_EQ',formula:'CUSTOM_FORMULA'};
const NOVAL=new Set(['BLANK','NOT_BLANK']);
const vals=v=>(Array.isArray(v)?v:v===undefined?[]:[v]).map(x=>({userEnteredValue:String(x)}));
function condition(type,values){const t=pickOf(COND,type,'type'),n=NOVAL.has(t)?0:/BETWEEN/.test(t)?2:1,v=vals(values);
 if(v.length<n)ask('type '+type+' needs '+n+' value'+(n===1?'':'s')+' in values.');return {type:t,values:v}}
function conditionalRule(r,range){if(!r||typeof r!=='object'||!r.type)ask('Give rule, e.g. {"type":"greater","values":[100],"background":"#ffcdd2"}. Types: '+Object.keys(COND).join(', ')+'.');
 const cond=condition(r.type,r.values),fmt={},tf={};if(r.background)fmt.backgroundColor=rgb(r.background);if(r.color)tf.foregroundColor=rgb(r.color);if(r.bold!==undefined)tf.bold=!!r.bold;if(r.italic!==undefined)tf.italic=!!r.italic;if(Object.keys(tf).length)fmt.textFormat=tf;
 if(!Object.keys(fmt).length)ask('rule needs a look to apply: background, color, bold or italic.');
 return {addConditionalFormatRule:{rule:{ranges:[range],booleanRule:{condition:cond,format:fmt}},index:0}}}
function validationRule(a,range){if(a.clear_validation)return {setDataValidation:{range}};
 let c;if(Array.isArray(a.options)&&a.options.length)c={type:'ONE_OF_LIST',values:vals(a.options)};else if(a.from_range)c={type:'ONE_OF_RANGE',values:vals('='+String(a.from_range).replace(/^=/,''))};
 else if(a.checkbox)c={type:'BOOLEAN'};else if(a.condition&&typeof a.condition==='object')c=condition(a.condition.type,a.condition.values);
 else ask('Give options (a list for a dropdown), from_range, checkbox true, condition {type,values}, or clear_validation true.');
 return {setDataValidation:{range,rule:{condition:c,strict:a.strict!==false,showCustomUi:true,...(a.help?{inputMessage:String(a.help)}:{})}}}}
const PROPS=(sheetId,properties,fields)=>({updateSheetProperties:{properties:{sheetId,...properties},fields}});
export const DELETE_REFUSED='aqeelOS keeps "archive, don\'t delete": removing a tab cannot be undone from here. Rename it instead (rename_sheet, e.g. "Archive - <name>"), or ask the person. Only if the person clearly told you to delete this tab, call again with confirm true.';
// the most a batch_update passes: a few hundred small requests, none naming another spreadsheet, no tab deleted without confirm
export function checkBatch(reqs,confirm){if(!Array.isArray(reqs)||!reqs.length)ask('Give requests: a list of Sheets API requests, e.g. [{"autoResizeDimensions":{...}}].');
 if(reqs.length>200)ask('At most 200 requests in one batch_update; send them in parts.');if(JSON.stringify(reqs).length>400000)ask('That batch is too big; send it in parts.');
 for(const r of reqs){if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==1)ask('Each request is an object with one request name, e.g. {"mergeCells":{...}}.');
  if(r.deleteSheet&&confirm!==true)ask(DELETE_REFUSED)}
 const walk=x=>{if(x&&typeof x==='object')for(const [k,v] of Object.entries(x)){if(/^spreadsheetId$/i.test(k))ask('A request may not name a spreadsheet; batch_update only changes the one in spreadsheet.');walk(v)}};walk(reqs);return reqs}
const idOfReply=(rs,k)=>rs?.find(r=>r[k])?.[k]?.properties||rs?.find(r=>r[k])?.[k]?.sheet?.properties;
// {requests, done(replies)->text} for one tab/format action. tabs: [{sheetId,title,index,gridProperties}]
export function buildRequests(a,tabs){const act=a.action,range=()=>gridRange(a.range,tabs,a.sheet),at=n=>n===undefined?{}:{index:Math.max(0,Number(n)||0)};
 const t=()=>tabOf(tabs,a.sheet||(a.range?splitRange(a.range).sheet:null)),name=x=>'"'+x.title+'"';
 switch(act){
 case 'format':{const r=range(),{fmt,fields}=cellFormat(a.format);return {requests:[{repeatCell:{range:r,cell:{userEnteredFormat:fmt},fields:fields.join(',')}}],done:()=>'Formatted '+a.range+'.'}}
 case 'resize':{const r=range();if(a.auto){const d=r.startColumnIndex!==undefined?'COLUMNS':r.startRowIndex!==undefined?'ROWS':ask('Name columns (A:C) or rows (2:4) in range.');
   return {requests:[{autoResizeDimensions:{dimensions:{sheetId:r.sheetId,dimension:d,startIndex:d==='COLUMNS'?r.startColumnIndex:r.startRowIndex,endIndex:d==='COLUMNS'?r.endColumnIndex:r.endRowIndex}}}],done:()=>'Sized '+a.range+' to fit its content.'}}
  const out=[];if(a.column_width!==undefined){if(r.startColumnIndex===undefined||r.endColumnIndex===undefined)ask('column_width needs columns in range, e.g. A:C.');
   out.push({updateDimensionProperties:{range:{sheetId:r.sheetId,dimension:'COLUMNS',startIndex:r.startColumnIndex,endIndex:r.endColumnIndex},properties:{pixelSize:Number(a.column_width)||ask('column_width is pixels, e.g. 160.')},fields:'pixelSize'}})}
  if(a.row_height!==undefined){if(r.startRowIndex===undefined||r.endRowIndex===undefined)ask('row_height needs rows in range, e.g. 1:3.');
   out.push({updateDimensionProperties:{range:{sheetId:r.sheetId,dimension:'ROWS',startIndex:r.startRowIndex,endIndex:r.endRowIndex},properties:{pixelSize:Number(a.row_height)||ask('row_height is pixels, e.g. 30.')},fields:'pixelSize'}})}
  if(!out.length)ask('Give column_width and/or row_height (pixels), or auto true to fit the content.');return {requests:out,done:()=>'Resized '+a.range+'.'}}
 case 'freeze':{if(a.rows===undefined&&a.columns===undefined)ask('Give rows and/or columns to freeze (0 unfreezes), e.g. rows 1.');const x=t(),g={},f=[];
  for(const [k,key] of [['rows','frozenRowCount'],['columns','frozenColumnCount']])if(a[k]!==undefined){const n=Number(a[k]);if(!Number.isInteger(n)||n<0)ask(k+' is a whole number, 0 or more.');g[key]=n;f.push('gridProperties.'+key)}
  return {requests:[PROPS(x.sheetId,{gridProperties:g},f.join(','))],done:()=>'Froze '+(a.rows!==undefined?a.rows+' row(s)':'')+(a.rows!==undefined&&a.columns!==undefined?' and ':'')+(a.columns!==undefined?a.columns+' column(s)':'')+' in '+name(x)+'.'}}
 case 'merge':{const mt={all:'MERGE_ALL',rows:'MERGE_ROWS',columns:'MERGE_COLUMNS'};return {requests:[{mergeCells:{range:range(),mergeType:pickOf(mt,a.merge_type||'all','merge_type')}}],done:()=>'Merged '+a.range+'.'}}
 case 'unmerge':return {requests:[{unmergeCells:{range:range()}}],done:()=>'Unmerged '+a.range+'.'}
 case 'borders':return {requests:[borders(a.borders,range())],done:()=>'Borders set on '+a.range+'.'}
 case 'conditional_format':return {requests:[conditionalRule(a.rule,range())],done:()=>'Conditional format added to '+a.range+' (it is the first rule, so it wins; to remove rules use batch_update deleteConditionalFormatRule).'}
 case 'validation':return {requests:[validationRule(a,range())],done:()=>(a.clear_validation?'Validation removed from ':'Validation set on ')+a.range+'.'}
 case 'add_sheet':{const title=String(a.title||'').trim();if(!title)ask('Give title, the name of the new tab.');if(tabs.some(x=>x.title.toLowerCase()===title.toLowerCase()))ask('A tab called "'+title+'" already exists.');
  const gp={...(a.rows?{rowCount:Number(a.rows)}:{}),...(a.columns?{columnCount:Number(a.columns)}:{})};
  return {requests:[{addSheet:{properties:{title,...at(a.index),...(Object.keys(gp).length?{gridProperties:gp}:{})}}}],done:rs=>{const p=idOfReply(rs,'addSheet');return 'Added tab "'+title+'"'+(p?' (sheetId '+p.sheetId+')':'')+'.'}}}
 case 'rename_sheet':{if(!a.sheet)ask('Give sheet, the tab to rename.');const x=tabOf(tabs,a.sheet),title=String(a.title||'').trim();if(!title)ask('Give title, the new name.');
  if(tabs.some(y=>y!==x&&y.title.toLowerCase()===title.toLowerCase()))ask('A tab called "'+title+'" already exists.');return {requests:[PROPS(x.sheetId,{title},'title')],done:()=>'Renamed '+name(x)+' to "'+title+'".'}}
 case 'duplicate_sheet':{if(!a.sheet)ask('Give sheet, the tab to copy.');const x=tabOf(tabs,a.sheet),title=String(a.title||'').trim();
  if(title&&tabs.some(y=>y.title.toLowerCase()===title.toLowerCase()))ask('A tab called "'+title+'" already exists.');
  return {requests:[{duplicateSheet:{sourceSheetId:x.sheetId,...(title?{newSheetName:title}:{}),...(a.index!==undefined?{insertSheetIndex:Math.max(0,Number(a.index)||0)}:{})}}],done:rs=>{const p=idOfReply(rs,'duplicateSheet');return 'Copied '+name(x)+(p?' to "'+p.title+'" (sheetId '+p.sheetId+')':'')+'.'}}}
 case 'delete_sheet':{if(!a.sheet)ask('Give sheet, the tab to delete.');const x=tabOf(tabs,a.sheet);if(a.confirm!==true)ask(DELETE_REFUSED);
  if(tabs.length<2)ask('That is the only tab; a spreadsheet needs at least one.');return {requests:[{deleteSheet:{sheetId:x.sheetId}}],done:()=>'Deleted tab '+name(x)+' (it cannot be undone from here; Google\'s version history can bring it back).'}}
 case 'move_sheet':{if(!a.sheet)ask('Give sheet, the tab to move.');if(a.index===undefined||!Number.isInteger(Number(a.index)))ask('Give index, the new position (0 is first).');
  const x=tabOf(tabs,a.sheet);return {requests:[PROPS(x.sheetId,{index:Math.max(0,Number(a.index))},'index')],done:()=>'Moved '+name(x)+' to position '+a.index+'.'}}
 }
 ask('Not a sheet action: '+act)}
