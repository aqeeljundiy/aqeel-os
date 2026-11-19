// Roles: what you own decides what you can do (app/role-scope.mjs, docs/roles-design.md, 19 Nov 2026).
import test from 'node:test';import assert from 'node:assert/strict';
import {channelRouteOk,opensToAnyone,visibleChannels,AGENT_CHANNEL_ROUTE} from '../app/role-scope.mjs';

test('an agent\'s owner or editor may use its channel routes, whatever their role; never the main agent; admins always',()=>{
 for(const level of ['owner','edit'])assert.equal(channelRouteOk({admin:false,level,agent:'aldillah-lead'}),true,level);
 assert.equal(channelRouteOk({admin:false,level:'chat',agent:'aldillah-lead'}),false,'chat only');
 assert.equal(channelRouteOk({admin:false,level:null,agent:'aldillah-lead'}),false,'not shared');
 assert.equal(channelRouteOk({admin:false,level:'owner',agent:'default'}),false,'the main agent restarts everyone');
 assert.equal(channelRouteOk({admin:true,level:null,agent:'default'}),true);
 assert.ok(AGENT_CHANNEL_ROUTE.test('/messaging/platforms')&&AGENT_CHANNEL_ROUTE.test('/pairing/approve')&&!AGENT_CHANNEL_ROUTE.test('/messagingx'))});

test('opening an outside-facing channel to anyone is caught; a Slack bot in the team workspace and named people are not',()=>{
 assert.equal(opensToAnyone('/hapi/messaging/platforms/whatsapp',{env:{WHATSAPP_DM_POLICY:'open'}}),'whatsapp');
 assert.equal(opensToAnyone('/hapi/messaging/platforms/telegram',{settings:{allow_all_users:true}}),'telegram');
 assert.equal(opensToAnyone('/hapi/messaging/platforms/telegram',{env:{TELEGRAM_ALLOW_ALL_USERS:'true'}}),'telegram');
 assert.equal(opensToAnyone('/hapi/messaging/platforms/whatsapp',{env:{WHATSAPP_DM_POLICY:'pairing'}}),'');
 assert.equal(opensToAnyone('/hapi/messaging/platforms/whatsapp',{env:{WHATSAPP_ALLOWED_USERS:'6281234567890'}}),'');
 assert.equal(opensToAnyone('/hapi/messaging/platforms/slack',{env:{SLACK_DM_POLICY:'open'}}),'','inside the team workspace (owner, 19 Nov 2026)');
 assert.equal(opensToAnyone('/hapi/profiles',{dm_policy:'open'}),'')});

test('the channel list shows someone who is not an admin only the agents they may edit',()=>{
 const d={channels:[{agent:'aldillah-lead',id:'telegram'},{agent:'pixel-agent',id:'slack'},{agent:'default',id:'slack'}],failed:['pixel-agent','aldillah-lead'],partial:true,loading:['faisal-lead']};
 const mine=visibleChannels(d,{admin:false,mayEdit:a=>a==='aldillah-lead'});
 assert.deepEqual(mine.channels.map(c=>c.agent),['aldillah-lead']);assert.deepEqual(mine.failed,['aldillah-lead']);assert.deepEqual(mine.loading,[]);
 assert.equal(visibleChannels(d,{admin:true,mayEdit:()=>false}),d,'admins see every row')});

test('an agent owner may set keys for outside services, never the names that wire the engine, the terminal, the network or who may message',async()=>{
 const {keyNameOk,memberBody}=await import('../app/role-scope.mjs');
 for(const k of ['OPENAI_API_KEY','AIRTABLE_TOKEN','TRIPAY_API_KEY','NOTION_SECRET'])assert.equal(keyNameOk(k),true,k);
 for(const k of ['TERMINAL_SSH_USER','HERMES_SAFE_MODE','GATEWAY_ALLOW_ALL_USERS','WHATSAPP_DM_POLICY','TELEGRAM_ALLOWED_USERS','HTTPS_PROXY','API_SERVER_KEY','LD_PRELOAD','PATH','bad name'])assert.equal(keyNameOk(k),false,k);
 assert.equal(memberBody('/hapi/env',{key:'AIRTABLE_TOKEN',value:'x'}),null);
 assert.match(memberBody('/hapi/env',{key:'GATEWAY_ALLOW_ALL_USERS',value:'true'}).error,/engine or channel setting/);
 assert.equal(memberBody('/hapi/messaging/platforms/whatsapp',{env:{WHATSAPP_DM_POLICY:'open'}}).ask,'whatsapp')});

test('an agent workspace counts by its real place: a link out of it is not the workspace',async()=>{
 const {workspaceAgent}=await import('../app/role-scope.mjs');
 const links={'/w/sdr/out':'/home/claude/.hermes'};const real=p=>{for(const [l,t] of Object.entries(links))if(p===l||p.startsWith(l+'/'))return t+p.slice(l.length);return p};
 assert.equal(workspaceAgent('/w/sdr/notes/a.md',{root:'/w',real}),'sdr');
 assert.equal(workspaceAgent('/w/sdr/out/.env',{root:'/w',real}),'','a link out of the workspace');
 assert.equal(workspaceAgent('/w',{root:'/w',real}),'');assert.equal(workspaceAgent('/elsewhere/sdr',{root:'/w',real}),'')});
