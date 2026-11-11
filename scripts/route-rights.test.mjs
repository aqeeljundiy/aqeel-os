// Who may use which route (11 Nov 2026, OPERATIONS.md): an action about ONE agent's own connections is for an admin or
// that agent's owner (ownsAgent); install-wide things stay admin-only. An employee on P&P could not connect Google, fix,
// rename or remove an app, or reconnect a channel on his own agent. This reads server.mjs, so a route that slips back to
// admin-only (or one that loses its check) fails here before it ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');
// the text of the handler that starts at a route test, up to the next route test at the same level
const handler=(route)=>{const i=src.indexOf("p==='"+route+"'");assert.ok(i>=0,'route not found: '+route);return src.slice(i,i+900)};

const OWN=['/ui/mcp/server','/ui/share/rename-mcp','/ui/channels/reconnect','/ui/channels/pause'];
const ADMIN_ONLY=['/ui/channels'];   // every agent's channels at once

test('own-agent routes: an admin or the agent\'s owner',()=>{
 for(const r of OWN){const h=handler(r);assert.match(h,/ownsAgent\(u,/,r+' must check ownsAgent');assert.doesNotMatch(h.slice(0,200),/if\(!users\.isAdmin\(u\)\)return send\(res,403/,r+' must not be admin-only')}});

test('Connect Google: the client is an admin\'s, an account is the owner\'s',()=>{
 const h=src.slice(src.indexOf("if(p.startsWith('/ui/google/'))"),src.indexOf("if(p.startsWith('/ui/google/'))")+2200);
 assert.match(h,/p==='\/ui\/google\/client'&&!admin\)return send\(res,403/);
 assert.match(h,/p==='\/ui\/google\/client\/check'&&!admin\)return send\(res,403/,'checking a client file (the guided setup) is admin-only too');
 assert.match(h,/\['\/ui\/google\/connect','\/ui\/google\/check','\/ui\/google\/account'\]\.includes\(p\)&&!mine\(ag\)/)});

test('the Connected apps panel removes a Google account for its owner too',()=>{
 assert.match(src,/if\(req\.method==='DELETE'\)\{if\(!ownsAgent\(u,a\)\)return send\(res,403,\{error:'Only an admin or this agent’s owner removes its Google accounts\.'/)});

test('install-wide routes stay admin-only',()=>{
 for(const r of ADMIN_ONLY)assert.match(handler(r).slice(0,200),/if\(!users\.isAdmin\(u\)\)return send\(res,403/,r);
 assert.match(src,/Only admins change the branding\./);assert.match(src,/Only admins can turn plugins on\./);assert.match(src,/Only admins can share connected apps between agents\./)});

test('ownsAgent is an admin, or the owner level on that agent',()=>{
 assert.match(src,/const ownsAgent=\(u,a\)=>!!u&&\(users\.isAdmin\(u\)\|\|users\.level\(u,String\(a\|\|'default'\)\)==='owner'\);/)});
