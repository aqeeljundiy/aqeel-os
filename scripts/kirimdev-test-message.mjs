#!/usr/bin/env node
// A message "from a tester" without a phone (7 Nov 2026: the fixer asked a person to send WhatsApp messages from the
// tester phone to prove a Kirimdev reply; that never needs a person). It posts the same signed webhook Kirimdev posts
// when a customer writes, from one of the line's own testers (Channels › Kirimdev, testers with a phone number), to
// this box's /kirimdev/<agent>. The agent then answers for real, through Kirimdev, to that tester's WhatsApp.
//   node scripts/kirimdev-test-message.mjs <agent> "<text>" [--tester <name part>] [--url http://127.0.0.1:4400]
// Only testers: it refuses any other number, so no customer is ever messaged. A line without a webhook secret (polling
// only) cannot be tested this way. Prints the event id, then how to see the reply.
import {readFile} from 'node:fs/promises';
import {createHmac,randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// the body Kirimdev posts for a received message (Meta's WhatsApp body plus Kirimdev's own "kirim" part)
export function testWebhook({line,tester,text,now=Date.now(),id=null}){
 const from=String(tester?.phone||'').replace(/\D/g,'');if(!/^\d{6,16}$/.test(from))throw Error('That tester has no phone number on the line.');
 const pid=String(line?.phoneNumberId||'');if(!pid)throw Error('The line has no phone number id.');
 const eid=id||'aqtest-'+randomBytes(6).toString('hex'),ts=Math.floor(now/1000);
 const body={object:'whatsapp_business_account',entry:[{id:'aqtest',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:pid},
  contacts:[{wa_id:from,profile:{name:tester.who||'Tester'}}],messages:[{from,id:'wamid.'+eid,timestamp:String(ts),type:'text',text:{body:String(text)}}]}}]}],
  kirim:{phone_number_id:pid,conversation_id:tester.conversationId||'',contact:{name:tester.who||'Tester'}}};
 return {eid,ts,from,raw:Buffer.from(JSON.stringify(body))}}
// Kirimdev's signature: t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the line's webhook secret>
export const sign=(raw,secret,ts)=>'t='+ts+',v1='+createHmac('sha256',secret).update(Buffer.concat([Buffer.from(ts+'.'),raw])).digest('hex');
// the tester to write as: one with a phone number, matching --tester when given
export function pickTester(line,want=''){const w=String(want||'').toLowerCase();
 const ok=(line?.testers||[]).filter(t=>/\d{6,}/.test(String(t.phone||'').replace(/\D/g,'')));
 const t=w?ok.find(x=>String(x.who||'').toLowerCase().includes(w)):ok[0];
 if(!t)throw Error(w?'No tester called '+want+' with a phone number on this line.':'This line has no tester with a phone number (Channels › Kirimdev › testers).');return t}

async function main(argv){const a=[...argv],opt={};for(let i=0;i<a.length;i++)if(a[i].startsWith('--')){opt[a[i].slice(2)]=a[i+1];a.splice(i,2);i--}
 const [agent,text]=a;if(!agent||!text){console.error('Use: node scripts/kirimdev-test-message.mjs <agent> "<text>" [--tester <name>] [--url http://127.0.0.1:4400]');process.exit(2)}
 const DATA=path.resolve(process.env.UI_DATA_DIR||path.join(homedir(),'apps','hermes-ui-data'));
 const rd=async f=>JSON.parse(await readFile(path.join(DATA,f),'utf8').catch(()=>'{}'));
 const line=(await rd('kirimdev.json')).lines?.[agent];if(!line)throw Error('No Kirimdev line for '+agent+'.');
 const secret=((await rd('kirimdev-secrets.json'))[agent]?.secrets||[])[0];if(!secret)throw Error(agent+' has no Kirimdev webhook (it reads by polling), so it cannot be tested with a webhook.');
 const tester=pickTester(line,opt.tester),w=testWebhook({line,tester,text});
 const url=(opt.url||'http://127.0.0.1:4400').replace(/\/$/,'')+'/kirimdev/'+agent;
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-kirim-event':'message.received','x-kirim-event-id':w.eid,'x-kirim-signature':sign(w.raw,secret,w.ts)},body:w.raw});
 console.log(r.status+' '+(await r.text()).slice(0,300));
 console.log('Sent as '+(tester.who||'a tester')+' (…'+w.from.slice(-4)+'), event '+w.eid+', line mode '+(line.mode||'test')+'. The reply comes after the line\'s wait ('+(line.debounceSec??'default')+' s):');
 console.log('look for it in '+path.join(DATA,'kirimdev-state.json')+' ("ours" holds what aqeelOS sent) and in the log, kirimdev '+agent+'.');
 if(!r.ok)process.exit(1)}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main(process.argv.slice(2)).catch(e=>{console.error('✗ '+e.message);process.exit(1)});
