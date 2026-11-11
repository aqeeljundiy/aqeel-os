// IPv4 first where IPv6 does not work (Elkiya, 11 Nov 2026: about 100 Telegram warnings an hour, "IPv6 Telegram API IP
// failed: ConnectTimeout", while IPv4 to api.telegram.org answered in 0.7 s; the box has an IPv6 address and no route).
//  - this app resolves IPv4 first (setDefaultResultOrder, set in server.mjs), so its own Telegram calls do not wait on a dead
//    IPv6 path;
//  - the engine makes the channel's calls. Its setting is network.force_ipv4 in config.yaml (read when the gateway starts;
//    the engine's Telegram adapter then skips IPv6). agent-defaults.mjs writes it for every agent when this probe finds IPv6
//    broken: a real connection to api.telegram.org:443 over IPv4 works and over IPv6 does not. A box whose IPv6 works is left
//    as it is. The probe is cached for 30 minutes.
import net from 'node:net';

const tryConnect=(host,family,ms)=>new Promise(res=>{let done=false;const s=net.connect({host,port:443,family,timeout:ms});
 const end=ok=>{if(done)return;done=true;s.destroy();res(ok)};s.once('connect',()=>end(true));s.once('timeout',()=>end(false));s.once('error',()=>end(false))});

// true: IPv4 works and IPv6 does not. No IPv4 either (no network just now): nothing is concluded, false.
export async function ipv6Broken({host='api.telegram.org',connect=tryConnect,ms=5000}={}){
 if(!await connect(host,4,ms))return false;return !await connect(host,6,ms)}

let cache=null;
export async function preferIpv4({now=Date.now(),probe=ipv6Broken,ttl=30*60e3}={}){
 if(cache&&now-cache.at<ttl)return cache.broken;const broken=await probe().catch(()=>false);cache={at:now,broken};return broken}
export const _reset=()=>{cache=null};
