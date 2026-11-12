// Who is calling (12 Nov 2026). The sign-in limit ("5 wrong passwords per address") keys on this address, so it must not be something a caller can write.
// Forwarding headers (cf-connecting-ip, x-forwarded-for) are believed ONLY when the socket's own remote address is a trusted proxy: the reverse proxy or tunnel
// in front of the app. TRUSTED_PROXIES is a comma list of addresses and CIDR ranges (IPv4 or IPv6); the default is loopback, because the proxy runs on the same
// host. A box whose proxy reaches the app from a private network (a Docker network) lists that range in its env file, e.g. TRUSTED_PROXIES=127.0.0.1,::1,10.0.1.0/24.
// A caller that is not a trusted proxy is identified by its socket address and its headers are ignored.
// Note: cf-connecting-ip is only as good as the proxy chain: the origin must be reachable from Cloudflare (or the tunnel) only, or the proxy must drop that header.
import {BlockList,isIP} from 'node:net';
export const DEFAULT_TRUSTED='127.0.0.1,::1';
const bare=a=>String(a||'').trim().replace(/^\[|\]$/g,'').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i,'$1');
export function parseTrusted(list){const bl=new BlockList(),bad=[];
 for(const raw of String(list==null||list===''?DEFAULT_TRUSTED:list).split(',').map(x=>x.trim()).filter(Boolean)){
  const [a,len]=raw.split('/'),ip=bare(a),fam=isIP(ip);
  if(!fam){bad.push(raw);continue}
  try{if(len===undefined)bl.addAddress(ip,fam===4?'ipv4':'ipv6');else{const n=+len;if(!Number.isInteger(n)||n<0||n>(fam===4?32:128)){bad.push(raw);continue}bl.addSubnet(ip,n,fam===4?'ipv4':'ipv6')}}catch{bad.push(raw)}}
 return {bl,bad,has:addr=>{const ip=bare(addr),f=isIP(ip);return !!f&&bl.check(ip,f===4?'ipv4':'ipv6')}}}
export function makeClientIp(list,{warn}={}){const T=parseTrusted(list);let warned=false;
 if(T.bad.length&&warn)warn('TRUSTED_PROXIES: ignored '+T.bad.join(', '));
 const privateNet=a=>/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:)/i.test(a);
 const f=function clientIp(req){const peer=bare(req.socket?.remoteAddress)||'?';
  if(!T.has(peer)){
   // the usual set-up mistake: the proxy sits on a private (Docker) network. Said once, so the owner can list the range.
   if(!warned&&warn&&privateNet(peer)&&(req.headers['x-forwarded-for']||req.headers['cf-connecting-ip'])){warned=true;warn('client address: a proxy at '+peer+' sent forwarding headers but is not in TRUSTED_PROXIES, so every visitor counts as '+peer+'. Add its address or range to TRUSTED_PROXIES.')}
   return peer}
  const cf=bare(req.headers['cf-connecting-ip']);if(isIP(cf))return cf;
  // x-forwarded-for: each proxy appends the address it saw; the client is the first one from the right that is not itself a trusted proxy
  const l=String(req.headers['x-forwarded-for']||'').split(',').map(bare).filter(Boolean);
  for(let i=l.length-1;i>=0;i--){if(!isIP(l[i]))return peer;if(!T.has(l[i]))return l[i]}
  return peer};
 f.trusts=T.has;return f}
