// "Which browser?" An agent about to work in a browser asks (choose_browser) once per chat: the person's own Chrome (one-off
// jobs where they are already signed in) or the agent's screen on the AI box (anything that must keep running). The person
// answers on a card in the aqeelOS web chat (/ui/secrets/pending shows it, /ui/browser-choice/<id> answers it); the answer
// links that chat to their browser or not.
// Issue i26680424 (EN-8, 10 Nov 2026): the owner was on Telegram, no web chat was open, so nobody could ever see the card.
// A web chat page asks for its cards every 2.5 s while a turn runs; when none asked for this agent in the last 20 s the
// tool answers at once and tells the agent to ask in the chat instead of waiting 270 s for an answer that cannot come.
import {randomBytes} from 'node:crypto';

const WAIT_MS=270000,SEEN_MS=20000;
const NOBODY='The person is not looking at an aqeelOS chat page, so no card can be shown. Ask them in this chat, in one short line, whether to use "yours" (their own Chrome, via the aqeelOS extension: only possible from an aqeelOS web chat) or "server" (your screen on the AI box), and follow their reply. If they want their own Chrome, tell them to open this agent in the aqeelOS web app, press Connect in the extension, and ask again there; until then use the AI box screen for read-only work and say so.';
const TOO_LATE='The person did not choose in time. Use your own screen on the AI box and tell them you did.';

// true when a web chat page asked for this agent's cards recently enough that a card would be seen (pure)
export function cardWatched(lastPoll,now,windowMs=SEEN_MS){return lastPoll>0&&now-lastPoll>=0&&now-lastPoll<=windowMs}

export function createBrowserAsks({now=()=>Date.now(),waitMs=WAIT_MS,seenMs=SEEN_MS}={}){
 const asks=new Map(),polled=new Map();
 // the agent's chat page asked for its cards (base agent name, without --<chat>)
 const seen=base=>{polled.set(String(base),now())};
 const ask=(agent,a)=>new Promise(resolve=>{const base=String(agent).split('--')[0];
  if(!cardWatched(polled.get(base)||0,now(),seenMs))return resolve({text:NOBODY});
  const id=randomBytes(9).toString('base64url');
  const rec={id,kind:'browser',agent,base,task:String(a?.task||'a browser job').slice(0,160),suggest:a?.suggest==='yours'?'yours':'server',why:String(a?.why||'').slice(0,220),t:now(),resolve};asks.set(id,rec);
  setTimeout(()=>{if(asks.get(id)===rec){asks.delete(id);resolve({text:TOO_LATE})}},waitMs).unref?.()});
 return {asks,ask,seen}}
