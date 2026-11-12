// Tests for real spreadsheet work through google_sheets (app/google-sheet-ops.mjs + app/google-tools.mjs), with a mocked Google.
// Run: node --test scripts/google-sheet-ops.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGoogleTools,GOOGLE_TOOLS,apiOff} from '../app/google-tools.mjs';
import {gridRange,rgb,splitRange,Ask,checkBatch} from '../app/google-sheet-ops.mjs';

const NOW=Date.parse('2026-11-12T10:00:00Z');
const own={type:'authorized_user',account:'me@example.com',client_id:'c',client_secret:'s',refresh_token:'RT',token:'AT',token_uri:'https://oauth2.googleapis.com/token',expiry:new Date(NOW+3600e3).toISOString()};
const TABS=[{properties:{sheetId:0,title:'Sales',index:0,gridProperties:{rowCount:100,columnCount:10,frozenRowCount:1}}},{properties:{sheetId:7,title:"Bob's data",index:1,gridProperties:{rowCount:50,columnCount:5}}}];
// a fake Google: records every call; batchUpdate bodies are in `batches`
async function make({policy=null,locked=false,filesCall=null,routes=[],tabs=TABS}={}){
 const H=await mkdtemp(path.join(tmpdir(),'gso-')),home=path.join(H,'profiles','bot');await mkdir(home,{recursive:true});
 if(!locked)await writeFile(path.join(home,'google_token.json'),JSON.stringify(own));if(policy)await writeFile(path.join(H,'aqeelos-accounts.json'),JSON.stringify(policy));
 const calls=[],batches=[];
 const fetchImpl=async(u,o={})=>{u=String(u);calls.push({u,o});let x;const m=o.method||'GET';
  const r=routes.find(([mm,re])=>mm===m&&re.test(u));
  if(r)x=await r[2](u,o);
  else if(m==='GET'&&/spreadsheets\/S1\?/.test(u))x={status:200,body:{sheets:tabs}};
  else if(m==='POST'&&/S1:batchUpdate$/.test(u)){const b=JSON.parse(o.body);batches.push(b);x={status:200,body:{replies:b.requests.map(q=>q.addSheet?{addSheet:{properties:{sheetId:99,title:q.addSheet.properties.title}}}:q.duplicateSheet?{duplicateSheet:{properties:{sheetId:98,title:q.duplicateSheet.newSheetName||'Copy of Sales'}}}:{})}}}
  else x={status:404,body:{error:{message:'not mocked '+u}}};
  const t=JSON.stringify(x.body??{});return {ok:x.status<300,status:x.status,json:async()=>JSON.parse(t),text:async()=>t}};
 const t=createGoogleTools({HERMES_HOME:H,fetchImpl,now:()=>NOW,locked:async()=>locked,filesCall});
 return {t,calls,batches}}
const S=(t,a)=>t.call('bot','google_sheets',{spreadsheet:'S1',...a});

test('the tool lists every action and the examples agents need',()=>{const d=GOOGLE_TOOLS.find(x=>x.name==='google_sheets');const en=d.inputSchema.properties.action.enum;
 for(const a of ['read','write','append','create','clear','format','resize','freeze','merge','unmerge','borders','conditional_format','validation','list_sheets','add_sheet','rename_sheet','duplicate_sheet','delete_sheet','move_sheet','batch_update'])assert.ok(en.includes(a),a);
 assert.match(d.description,/formula/);assert.match(d.description,/batch_update/);assert.match(d.description,/confirm/)});

test('helpers: A1 ranges become grid ranges, colours and splitting',()=>{const tabs=TABS.map(x=>x.properties);
 assert.deepEqual(gridRange('B2:D9',tabs),{sheetId:0,startColumnIndex:1,endColumnIndex:4,startRowIndex:1,endRowIndex:9});
 assert.deepEqual(gridRange('A1',tabs),{sheetId:0,startColumnIndex:0,endColumnIndex:1,startRowIndex:0,endRowIndex:1});
 assert.deepEqual(gridRange("'Bob''s data'!A:C",tabs),{sheetId:7,startColumnIndex:0,endColumnIndex:3});
 assert.deepEqual(gridRange('2:4',tabs),{sheetId:0,startRowIndex:1,endRowIndex:4});assert.deepEqual(gridRange('sales!AA1',tabs).startColumnIndex,26);assert.deepEqual(gridRange('Sales',tabs),{sheetId:0});
 assert.throws(()=>gridRange('Nope!A1',tabs),/No tab called "Nope". Its tabs: Sales/);assert.throws(()=>gridRange('B2:A1',tabs),/runs backwards/);assert.throws(()=>gridRange('??',tabs),/not an A1 range/);
 assert.deepEqual(rgb('#ff0000'),{red:1,green:0,blue:0});assert.deepEqual(rgb('#fff'),{red:1,green:1,blue:1});assert.equal(rgb('Light Green').green>0.9,true);assert.throws(()=>rgb('banana'),Ask);
 assert.deepEqual(splitRange("'A!B'!C1"),{sheet:'A!B',rest:'C1'})});

test('formulas: written as typed, read back as formula and computed value',async()=>{const {t,calls}=await make({routes:[
  ['GET',/values\/Sales!A1%3AB2/,u=>({status:200,body:{range:'Sales!A1:B2',values:/valueRenderOption=FORMULA/.test(u)?[['Sum','=SUM(B1:B1)'],['x',3]]:[['Sum',3],['x',3]]}})],
  ['PUT',/values\//,()=>({status:200,body:{updatedCells:2,updatedRange:'Sales!A1:B1'}})]]});
 assert.match((await S(t,{action:'write',range:'Sales!A1',values:[['Sum','=SUM(B2:B9)']]})).text,/Wrote 2 cells/);assert.match(calls[0].u,/valueInputOption=USER_ENTERED/);assert.equal(JSON.parse(calls[0].o.body).values[0][1],'=SUM(B2:B9)');
 await S(t,{action:'write',range:'A1',values:[['=not a formula']],raw:true});assert.match(calls.at(-1).u,/valueInputOption=RAW/);
 const both=await S(t,{action:'read',range:'Sales!A1:B2',render:'both'});assert.equal(both.isError,undefined,both.text);assert.match(both.text,/values: \[\["Sum",3\],\["x",3\]\]\nformulas: \[\["Sum","=SUM\(B1:B1\)"\],\["x",3\]\]/);
 const f=await S(t,{action:'read',range:'Sales!A1:B2',render:'formulas'});assert.match(f.text,/formulas as typed\):\n\[\["Sum","=SUM/);
 const v=await S(t,{action:'read',range:'Sales!A1:B2'});assert.match(v.text,/\[\["Sum",3\]/);assert.doesNotMatch(v.text,/formulas/);
 assert.match((await S(t,{action:'read',range:'Sales!A1:B2',render:'xml'})).text,/values, formulas or both/)});

test('empty cells and clear and append',async()=>{const {t,calls}=await make({routes:[
  ['PUT',/values\//,()=>({status:200,body:{updatedCells:1}})],['POST',/values\/.*:clear$/,()=>({status:200,body:{clearedRange:'Sales!A2:C9'}})],['POST',/:append/,()=>({status:200,body:{updates:{updatedRows:2,updatedRange:'Sales!A10:B11'}}})]]});
 await S(t,{action:'write',range:'A1',values:[['', null,'x']]});assert.deepEqual(JSON.parse(calls[0].o.body).values,[['',null,'x']]);
 assert.match((await S(t,{action:'clear',range:'Sales!A2:C9'})).text,/Emptied Sales!A2:C9 \(formatting kept\)/);assert.match(calls.at(-1).u,/values\/Sales!A2%3AC9:clear$/);
 assert.match((await S(t,{action:'append',range:'Sales!A1',values:[[1,2],[3,4]]})).text,/Added 2 rows/);
 assert.match((await S(t,{action:'clear'})).text,/Give the range/)});

test('format: text, fill, number format, alignment, wrap become one repeatCell with a field mask',async()=>{const {t,batches}=await make();
 const r=await S(t,{action:'format',range:'Sales!A1:C1',format:{bold:true,italic:false,color:'#ff0000',background:'lightyellow',number_format:'currency',h_align:'center',v_align:'middle',wrap:'wrap',font_size:12}});assert.equal(r.isError,undefined,r.text);
 const q=batches[0].requests[0].repeatCell;assert.deepEqual(q.range,{sheetId:0,startColumnIndex:0,endColumnIndex:3,startRowIndex:0,endRowIndex:1});
 assert.equal(q.cell.userEnteredFormat.textFormat.bold,true);assert.equal(q.cell.userEnteredFormat.textFormat.italic,false);assert.equal(q.cell.userEnteredFormat.textFormat.fontSize,12);assert.equal(q.cell.userEnteredFormat.horizontalAlignment,'CENTER');assert.equal(q.cell.userEnteredFormat.verticalAlignment,'MIDDLE');assert.equal(q.cell.userEnteredFormat.wrapStrategy,'WRAP');
 assert.deepEqual(q.cell.userEnteredFormat.numberFormat,{type:'CURRENCY',pattern:'$#,##0.00'});assert.match(q.fields,/userEnteredFormat\.textFormat\.bold,.*userEnteredFormat\.backgroundColor,.*numberFormat/);
 await S(t,{action:'format',range:'D:D',format:{number_format:'dd/mm/yyyy'}});assert.deepEqual(batches[1].requests[0].repeatCell.cell.userEnteredFormat.numberFormat,{type:'DATE',pattern:'dd/mm/yyyy'});
 await S(t,{action:'format',range:'A1',format:{number_format:'€#,##0.00'}});assert.equal(batches[2].requests[0].repeatCell.cell.userEnteredFormat.numberFormat.type,'CURRENCY');
 await S(t,{action:'format',range:'A1',format:{reset:true}});assert.equal(batches[3].requests[0].repeatCell.fields,'userEnteredFormat');
 assert.match((await S(t,{action:'format',range:'A1',format:{}})).text,/nothing to set/);assert.match((await S(t,{action:'format',range:'A1'})).text,/Give format/);
 assert.match((await S(t,{action:'format',range:'A1',format:{color:'banana'}})).text,/not a colour/);assert.match((await S(t,{action:'format',range:'A1',format:{h_align:'diagonal'}})).text,/h_align is one of/);
 assert.match((await S(t,{action:'format',range:'Nope!A1',format:{bold:true}})).text,/No tab called "Nope"/);assert.equal(batches.length,4)});

test('resize, freeze, merge, unmerge, borders',async()=>{const {t,batches}=await make();
 await S(t,{action:'resize',range:'A:C',column_width:180});assert.deepEqual(batches[0].requests[0].updateDimensionProperties,{range:{sheetId:0,dimension:'COLUMNS',startIndex:0,endIndex:3},properties:{pixelSize:180},fields:'pixelSize'});
 await S(t,{action:'resize',range:'1:2',row_height:40});assert.equal(batches[1].requests[0].updateDimensionProperties.range.dimension,'ROWS');
 await S(t,{action:'resize',range:'B:B',auto:true});assert.deepEqual(batches[2].requests[0].autoResizeDimensions.dimensions,{sheetId:0,dimension:'COLUMNS',startIndex:1,endIndex:2});
 assert.match((await S(t,{action:'resize',range:'A1:B2',column_width:100})).text,/Resized/);assert.match((await S(t,{action:'resize',range:'1:2',column_width:100})).text,/needs columns in range/);assert.match((await S(t,{action:'resize',range:'A:B'})).text,/Give column_width/);
 await S(t,{action:'freeze',range:'x',sheet:"Bob's data",rows:1,columns:2});
 assert.deepEqual(batches.at(-1).requests[0],{updateSheetProperties:{properties:{sheetId:7,gridProperties:{frozenRowCount:1,frozenColumnCount:2}},fields:'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'}});
 await S(t,{action:'freeze',sheet:'Sales',rows:0});assert.equal(batches.at(-1).requests[0].updateSheetProperties.properties.gridProperties.frozenRowCount,0);
 assert.match((await S(t,{action:'freeze'})).text,/Give rows and\/or columns/);assert.match((await S(t,{action:'freeze',rows:-1})).text,/whole number/);
 await S(t,{action:'merge',range:'A1:C1'});assert.equal(batches.at(-1).requests[0].mergeCells.mergeType,'MERGE_ALL');await S(t,{action:'merge',range:'A1:C3',merge_type:'rows'});assert.equal(batches.at(-1).requests[0].mergeCells.mergeType,'MERGE_ROWS');
 assert.match((await S(t,{action:'merge',range:'A1:C1',merge_type:'diag'})).text,/merge_type is one of/);await S(t,{action:'unmerge',range:'A1:C1'});assert.ok(batches.at(-1).requests[0].unmergeCells);
 await S(t,{action:'borders',range:'A1:C5',borders:{style:'dashed',color:'#333',sides:'outer'}});const b=batches.at(-1).requests[0].updateBorders;assert.deepEqual(Object.keys(b).sort(),['bottom','left','range','right','top']);assert.equal(b.top.style,'DASHED');
 await S(t,{action:'borders',range:'A1:C5'});assert.equal(Object.keys(batches.at(-1).requests[0].updateBorders).length,7);
 await S(t,{action:'borders',range:'A1:C5',borders:{sides:['inner_horizontal']}});assert.ok(batches.at(-1).requests[0].updateBorders.innerHorizontal);assert.match((await S(t,{action:'borders',range:'A1',borders:{sides:['middle']}})).text,/borders\.sides/)});

test('conditional formatting and data validation',async()=>{const {t,batches}=await make();
 await S(t,{action:'conditional_format',range:'C2:C50',rule:{type:'greater',values:[100],background:'#ffcdd2',bold:true}});
 const c=batches[0].requests[0].addConditionalFormatRule;assert.equal(c.index,0);assert.equal(c.rule.booleanRule.condition.type,'NUMBER_GREATER');assert.deepEqual(c.rule.booleanRule.condition.values,[{userEnteredValue:'100'}]);assert.equal(c.rule.booleanRule.format.textFormat.bold,true);assert.equal(c.rule.ranges[0].sheetId,0);
 await S(t,{action:'conditional_format',range:'A:A',rule:{type:'between',values:[1,5],color:'red'}});assert.equal(batches[1].requests[0].addConditionalFormatRule.rule.booleanRule.condition.values.length,2);
 await S(t,{action:'conditional_format',range:'A:A',rule:{type:'formula',values:['=$B1>10'],background:'red'}});assert.equal(batches[2].requests[0].addConditionalFormatRule.rule.booleanRule.condition.type,'CUSTOM_FORMULA');
 assert.match((await S(t,{action:'conditional_format',range:'A:A',rule:{type:'between',values:[1],background:'red'}})).text,/needs 2 values/);assert.match((await S(t,{action:'conditional_format',range:'A:A',rule:{type:'greater',values:[1]}})).text,/needs a look/);
 assert.match((await S(t,{action:'conditional_format',range:'A:A',rule:{type:'nonsense'}})).text,/type is one of/);assert.match((await S(t,{action:'conditional_format',range:'A:A'})).text,/Give rule/);
 await S(t,{action:'validation',range:'D2:D50',options:['Open','Won','Lost'],help:'Pick one'});const v=batches[3].requests[0].setDataValidation;
 assert.deepEqual(v.rule.condition,{type:'ONE_OF_LIST',values:[{userEnteredValue:'Open'},{userEnteredValue:'Won'},{userEnteredValue:'Lost'}]});assert.equal(v.rule.strict,true);assert.equal(v.rule.showCustomUi,true);assert.equal(v.rule.inputMessage,'Pick one');
 await S(t,{action:'validation',range:'E2:E9',from_range:'Lists!A1:A5',strict:false});assert.equal(batches[4].requests[0].setDataValidation.rule.condition.type,'ONE_OF_RANGE');assert.equal(batches[4].requests[0].setDataValidation.rule.strict,false);
 await S(t,{action:'validation',range:'F2:F9',checkbox:true});assert.equal(batches[5].requests[0].setDataValidation.rule.condition.type,'BOOLEAN');
 await S(t,{action:'validation',range:'G2:G9',condition:{type:'greater',values:[0]}});assert.equal(batches[6].requests[0].setDataValidation.rule.condition.type,'NUMBER_GREATER');
 await S(t,{action:'validation',range:'D2:D50',clear_validation:true});assert.deepEqual(Object.keys(batches[7].requests[0].setDataValidation),['range']);assert.match((await S(t,{action:'validation',range:'D2'})).text,/Give options/)});

test('tabs: list, add, rename, duplicate, move; clashes and unknown tabs are refused',async()=>{const {t,batches}=await make();
 const l=await S(t,{action:'list_sheets'});assert.match(l.text,/2 tabs:\n- Sales · sheetId 0 · position 0 · 100 rows × 10 columns · 1 frozen rows\n- Bob's data · sheetId 7/);
 assert.match((await S(t,{action:'add_sheet',title:'Q4',index:1,rows:20,columns:4})).text,/Added tab "Q4" \(sheetId 99\)/);assert.deepEqual(batches[0].requests[0].addSheet.properties,{title:'Q4',index:1,gridProperties:{rowCount:20,columnCount:4}});
 assert.match((await S(t,{action:'add_sheet',title:'sales'})).text,/already exists/);assert.match((await S(t,{action:'add_sheet'})).text,/Give title/);
 assert.match((await S(t,{action:'rename_sheet',sheet:'Sales',title:'Sales 2026'})).text,/Renamed "Sales" to "Sales 2026"/);assert.deepEqual(batches.at(-1).requests[0],{updateSheetProperties:{properties:{sheetId:0,title:'Sales 2026'},fields:'title'}});
 assert.match((await S(t,{action:'rename_sheet',sheet:'Sales',title:"bob's data"})).text,/already exists/);assert.match((await S(t,{action:'rename_sheet',title:'x'})).text,/Give sheet/);assert.match((await S(t,{action:'rename_sheet',sheet:'Zzz',title:'x'})).text,/No tab called/);
 assert.match((await S(t,{action:'duplicate_sheet',sheet:'Sales',title:'Sales backup',index:2})).text,/Copied "Sales" to "Sales backup" \(sheetId 98\)/);assert.deepEqual(batches.at(-1).requests[0].duplicateSheet,{sourceSheetId:0,newSheetName:'Sales backup',insertSheetIndex:2});
 assert.match((await S(t,{action:'duplicate_sheet',sheet:'Sales',title:'Q4x'})).text,/Copied/);assert.match((await S(t,{action:'duplicate_sheet',sheet:'Sales',title:'Bob\'s data'})).text,/already exists/);
 assert.match((await S(t,{action:'move_sheet',sheet:"Bob's data",index:0})).text,/Moved "Bob's data" to position 0/);assert.deepEqual(batches.at(-1).requests[0].updateSheetProperties.fields,'index');assert.match((await S(t,{action:'move_sheet',sheet:'Sales'})).text,/Give index/)});

test('delete_sheet: refused without confirm (and without calling Google), done with confirm true, last tab protected',async()=>{const {t,calls,batches}=await make();
 const r=await S(t,{action:'delete_sheet',sheet:'Sales'});assert.equal(r.isError,true);assert.match(r.text,/archive, don't delete/);assert.match(r.text,/rename_sheet/);assert.equal(calls.length,0);
 assert.equal((await S(t,{action:'delete_sheet',sheet:'Sales',confirm:'yes'})).isError,true);assert.equal(calls.length,0);
 const ok=await S(t,{action:'delete_sheet',sheet:'Sales',confirm:true});assert.equal(ok.isError,undefined,ok.text);assert.match(ok.text,/Deleted tab "Sales"/);assert.deepEqual(batches[0].requests,[{deleteSheet:{sheetId:0}}]);
 const one=await make({tabs:[TABS[0]]});assert.match((await S(one.t,{action:'delete_sheet',sheet:'Sales',confirm:true})).text,/only tab/);assert.equal(one.batches.length,0);
 assert.match((await S(t,{action:'delete_sheet',confirm:true})).text,/Give sheet/)});

test('batch_update: passes Sheets requests to the named spreadsheet only; a tab delete needs confirm; foreign ids refused',async()=>{const {t,calls,batches}=await make();
 const reqs=[{sortRange:{range:{sheetId:0,startRowIndex:1},sortSpecs:[{dimensionIndex:1,sortOrder:'ASCENDING'}]}},{updateCells:{range:{sheetId:0},fields:'userEnteredValue'}}];
 const r=await S(t,{action:'batch_update',requests:reqs});assert.equal(r.isError,undefined,r.text);assert.match(r.text,/2 requests applied/);assert.deepEqual(batches[0].requests,reqs);assert.equal(batches[0].includeSpreadsheetInResponse,false);assert.match(calls.at(-1).u,/spreadsheets\/S1:batchUpdate$/);
 const n=calls.length;
 for(const [bad,re] of [[[{deleteSheet:{sheetId:3}}],/archive, don't delete/],[[{updateCells:{range:{sheetId:0},rows:[{values:[{userEnteredValue:{formulaValue:'=1'}}]}],source:{spreadsheetId:'OTHER'}}}],/may not name a spreadsheet/],[[],/Give requests/],['x',/Give requests/],[[{a:1,b:2}],/one request name/],[[1],/one request name/],[Array(201).fill({autoResizeDimensions:{}}),/At most 200/]])
  {const x=await S(t,{action:'batch_update',requests:bad});assert.equal(x.isError,true);assert.match(x.text,re)}
 assert.equal(calls.length,n);
 assert.equal((await S(t,{action:'batch_update',requests:[{deleteSheet:{sheetId:3}}],confirm:true})).isError,undefined);assert.throws(()=>checkBatch([{deleteSheet:{}}]),Ask);
 const other=await t.call('bot','google_sheets',{action:'batch_update',requests:reqs});assert.match(other.text,/Give the spreadsheet id/)});

test('read-only sharing may read and list tabs but not change anything; no Google call is made for a refused change',async()=>{
 const {t,calls}=await make({policy:{google:{'me@example.com':{agents:{bot:['read']}}}}});
 assert.equal((await S(t,{action:'list_sheets'})).isError,undefined);const n=calls.length;
 for(const a of [{action:'format',range:'A1',format:{bold:true}},{action:'clear',range:'A1'},{action:'add_sheet',title:'x'},{action:'batch_update',requests:[{mergeCells:{}}]},{action:'freeze',rows:1}]){const r=await S(t,a);assert.equal(r.isError,true,a.action);assert.match(r.text,/does not let you change Sheets, Docs or Drive files/)}
 assert.equal(calls.length,n)});

test('an agent locked to its own files: every new action goes through google-files with the spreadsheet id',async()=>{const seen=[];
 const {t,calls}=await make({locked:true,filesCall:async(agent,req)=>{seen.push(req);if(req.params.spreadsheetId==='OTHER')return {status:403,json:{error:'aqeelOS only lets this agent use its own Google files'}};
   return {status:200,json:req.method==='spreadsheets.get'?{sheets:TABS}:req.method==='spreadsheets.values.clear'?{clearedRange:'A1:B2'}:req.method==='spreadsheets.values.get'?{values:[['=1+1']]}:{replies:[{}]}}}});
 assert.match((await t.call('bot','google_sheets',{action:'format',spreadsheet:'OWN',range:'Sales!A1',format:{bold:true}})).text,/Formatted/);
 assert.deepEqual(seen.map(x=>x.method),['spreadsheets.get','spreadsheets.batchUpdate']);assert.equal(seen[0].params.fields.startsWith('sheets.properties'),true);assert.equal(seen[1].params.spreadsheetId,'OWN');assert.equal(seen[1].body.requests[0].repeatCell.range.sheetId,0);
 await t.call('bot','google_sheets',{action:'clear',spreadsheet:'OWN',range:'A1:B2'});assert.deepEqual(seen.at(-1),{service:'sheets',method:'spreadsheets.values.clear',params:{spreadsheetId:'OWN',range:'A1:B2'},body:{},account:undefined});
 const f=await t.call('bot','google_sheets',{action:'read',spreadsheet:'OWN',range:'A1',render:'formulas'});assert.equal(seen.at(-1).params.valueRenderOption,'FORMULA');assert.match(f.text,/=1\+1/);
 assert.equal((await t.call('bot','google_sheets',{action:'batch_update',spreadsheet:'OWN',requests:[{unmergeCells:{range:{sheetId:0}}}]})).isError,undefined);
 assert.match((await t.call('bot','google_sheets',{action:'add_sheet',spreadsheet:'OTHER',title:'x'})).text,/only lets this agent use its own/);assert.equal(calls.length,0)});

test('the Sheets API switched off in the Google Cloud project: says so, who can enable it, and where',async()=>{
 const msg='Google Sheets API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=123456 then retry.';
 const {t}=await make({routes:[['GET',/spreadsheets\/S1\?/,()=>({status:403,body:{error:{code:403,message:msg}}})]]});
 const r=await S(t,{action:'list_sheets'});assert.equal(r.isError,true);assert.match(r.text,/sheets API is switched off in this install's Google Cloud project/);assert.match(r.text,/owner or an admin of that Google Cloud project/);assert.match(r.text,/console\.developers\.google\.com\/apis\/api\/sheets\.googleapis\.com/);assert.match(r.text,/report_bottleneck/);
 const l=await make({locked:true,filesCall:async()=>({status:403,json:{error:{code:403,message:msg}}})});assert.match((await l.t.call('bot','google_sheets',{action:'list_sheets',spreadsheet:'OWN'})).text,/switched off in this install/);
 assert.match(apiOff('x'),/this tool cannot work yet/)});
