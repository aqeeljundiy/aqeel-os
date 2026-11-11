// node scripts/bottlenecks.test.mjs — the Bottlenecks popup shows only what truly needs a person, each once, with what
// to do; everything else goes into the ladder on System › Health (owner, 7 Nov 2026)
import assert from 'node:assert/strict';
import {personNeed,forPopup,popupKey,memberCan} from '../app/bottlenecks.mjs';
import {forLadder,skillKey,configuredGroups} from '../app/agent-health.mjs';
let n=0;const t=async(name,f)=>{await f();n++;console.log('ok',name)};

// the owner's screenshot: skills missing files, one of them on two agents
const skill=(agent,sk,files)=>({id:'event|e'+agent+sk,kind:'skill',agent,agentName:agent,topic:'health|'+agent+'|skill|'+sk,title:'The skill '+sk.split('/').pop()+' points to a file that is not there',text:'Missing: '+files});
const SHOT=[skill('sela','productivity/maps','~/.aqeelos/skills/maps/scripts/maps_client.py'),skill('pine-agent','productivity/sela-personal-account-login','references/site-login-urls.md'),
 skill('pine-agent','creative/continue-vial-labels','assets/texture.png'),skill('cove-support','creative/continue-vial-labels','assets/texture.png'),
 skill('cove-social','creative/continue-longevity-brand','references/tiktok-hooks.md, assets/products/pens-trio-3.jpg.webp')];
const rep=(agent,missing,{system=false,fix=''}={})=>({id:'report|r'+agent+missing.length,kind:system?'system':'report',agent,agentName:agent,missing,title:(system?agent+' reported a system problem: ':agent+' is blocked: ')+missing,text:fix?'Would fix it: '+fix:'',count:1});

await t('none of the screenshot items needs the owner: the popup is empty, and all of them go into the ladder',()=>{
 assert.deepEqual(forPopup(SHOT),[]);for(const x of SHOT){assert.equal(personNeed(x),null,x.title);assert.equal(forLadder(x),true,x.title)}});
await t('what needs a person stays, with one plain line of what to do; no "Got it" kinds without an action',()=>{
 assert.match(personNeed({kind:'signin'}),/Only you have this login/);assert.match(personNeed({kind:'account',account:{state:'credit'}}),/Top up/);
 assert.match(personNeed({kind:'group',title:'Removed from the Telegram group Continue - Socials'}),/Add the bot back/);
 assert.match(personNeed({kind:'channel',channel:{needs_link:true}}),/scan the QR code/);assert.equal(personNeed({kind:'channel',channel:{needs_link:false}}),null);
 assert.match(personNeed(rep('a1','A new API key for Xendit; the old one was revoked')),/Xendit|key/i);
 for(const k of ['down','schedule','stopped','twice','dropped','backup','update','automations','models','selfruns','kirimdev','skill'])assert.equal(personNeed({kind:k,title:'x'}),null,k)});
await t('agent reports: fixable ones and planned tests go to the ladder, real person needs stay',()=>{
 for(const m of ['Read/execute access for ag-cove-threads to /home/claude/work/labels','Customer WhatsApp runs have no label tool','My live patches to app/kirimdev.mjs were overwritten by a redeploy',
  'PLANNED TEST, no action needed: a person must add the bot to a Telegram group called aqeelOS ladder test','Someone must send a WhatsApp message from the tester phone'])
  assert.equal(personNeed(rep('a1',m,{system:true})),null,m);
 assert.equal(forLadder(rep('a1','Customer WhatsApp runs have no label tool')),true);assert.equal(forLadder(rep('a1','x',{system:true})),false,'a system report is filed as an issue at once');
 assert.equal(forLadder({kind:'signin',id:'signin|a|b'}),false,'only a person can sign in');assert.equal(forLadder({kind:'group',id:'event|g',title:'Removed from the Telegram group X'}),true,'the fixer checks it and tells the right person')});
await t('a system report never shows: the fixer has it and sends the one message itself if a person is needed',()=>{
 assert.equal(personNeed(rep('a1','Check the model subscription usage limit, add an API key',{system:true})),null)});
await t('each need once: app sign-ins merged across agents, a group with its reports, the same report from two agents',()=>{
 const items=[rep('sela','A sign-in for figma, notion and slack. They have no saved tokens'),rep('cove-social','A sign-in for Notion and for Slack (OAuth)'),rep('bay-sales','Sign-in for figma, notion and slack; no cached tokens exist'),rep('default','Customer runs need a payment label tool',{system:true}),
  {id:'event|g1',kind:'group',agent:'cove-social',agentName:'cove-social',topic:'health|cove-social|group|-5390379831',title:'Removed from the Telegram group Continue - Socials'},
  rep('cove-social','The bot was removed from the group Continue - Socials (Telegram says the bot is left). A bot cannot add itself back.'),
  rep('a1','A new API key for Xendit'),rep('a2','A new API key for Xendit'),...SHOT];
 const p=forPopup(items);assert.deepEqual(p.map(x=>x.kind),['apps','apps','group','report'],JSON.stringify(p.map(x=>x.title)));
 const [three,two,g,key]=p;assert.equal(three.title,'Figma, Notion and Slack need a sign-in');assert.equal(three.also.length,1);assert.match(three.text,/Asked by sela and bay-sales/);assert.match(three.ask,/Connected apps/);
 assert.equal(two.title,'Notion and Slack need a sign-in');assert.equal(g.also.length,1,'the group report rides on the group');assert.equal(key.also.length,1);assert.equal(key.title,'A new API key for Xendit');
 assert.equal(popupKey(SHOT[2]),SHOT[2].id)});
await t('a skill shared by two agents is one problem: same skill and files, whatever the folder',()=>{
 assert.equal(skillKey({skill:'creative/continue-vial-labels',missing:['assets/texture.png']}),skillKey({skill:'continue-vial-labels',missing:['assets/texture.png']}));
 assert.notEqual(skillKey({skill:'a/x',missing:['assets/1.png']}),skillKey({skill:'a/x',missing:['assets/2.png']}))});
await t('a group counts only when it is in the agent\'s settings: its team group, or an id in its config or .env',()=>{
 const tg={groups:{'cove-support':{chatId:-1003999095054},'bay-sales':{chatId:-1003989506863}}};
 const bio=configuredGroups('bay-sales',{teamGroups:tg,texts:['telegram:\n  allowed_chats: [-1003989506863]','TELEGRAM_BOT_TOKEN=123:abc']});
 assert.deepEqual([...bio],['-1003989506863']);assert.equal(bio.has('-1003999095054'),false,'another agent\'s team group is not its own');
 assert.deepEqual([...configuredGroups('cove-social',{teamGroups:tg,texts:['model: x','PORT=4400']})],[],'a group it only chatted in once is history');
 assert.deepEqual([...configuredGroups('x',{texts:['HOME_CHANNEL=-5390379831']})],['-5390379831']);
 assert.deepEqual([...configuredGroups('default',{texts:['#     # allowed_chats: ["-1001234567890"]','telegram:\n  # home: -1009876543210','x: 1']})],[],'commented examples are not settings')});
await t('an app with its own sign-in item takes the agents\' reports about it; that item\'s button opens the sign-in',()=>{
 const p=forPopup([{id:'signin|a|slack',kind:'signin',agent:'a',agentName:'a',title:'Slack needs signing in',signin:{name:'slack'}},rep('sela','A sign-in for Slack (OAuth), no tokens')]);
 assert.equal(p.length,1);assert.equal(p[0].kind,'signin');assert.deepEqual(p[0].also,['report|rsela36'.replace('36',String('A sign-in for Slack (OAuth), no tokens'.length))])});
await t('a member counts only what they can act on: their blocked agent and their own agent\'s new instructions',()=>{
 const all=forPopup([{id:'access|1',kind:'access',title:'Sela asks for Gmail'},{id:'ticket|w',kind:'ticket',title:'A Help ticket is waiting'},{id:'signin|a|slack',kind:'signin',title:'Slack needs signing in',signin:{name:'slack'}},
  rep('sela','A sign-in for Notion (OAuth)'),rep('sela','A new API key for Xendit'),{id:'instr|sela|p1',kind:'instructions',agent:'sela',title:'Sela: new instructions wait for your approval'}]);
 assert.deepEqual(all.map(x=>x.kind),["access","ticket","signin","apps","report","instructions"]);assert.deepEqual(all.filter(memberCan).map(x=>x.kind),['report','instructions'])});
console.log(n+' passed');
