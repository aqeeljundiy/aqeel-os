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
