// Route bodies taken out of server.mjs so they can be tested as what they do, not as text (audit H12, 12 Nov 2026: with the ownership check
// of /ui/channels/pause switched off, the payment wake-up switched off and the journal step before an engine stop switched off, the whole
// suite stayed green, because the tests only looked for the words in the source). Each takes what it needs and answers {status, body}
// (and after: what to do once the answer is out). server.mjs calls these; scripts/route-handlers.test.mjs runs them as a member, an owner and an admin.

// POST /ui/channels/pause {agent, platform, on}: an admin or the agent's owner pauses or resumes one of its channels
export async function channelsPause({u,body,ownsAgent,profiles,setChannelOn}){const b=body||{};
 if(!ownsAgent(u,b.agent))return {status:403,body:{error:'Only an admin or this agent’s owner pauses its channels.'}};
 const ag=String(b.agent||''),pf=String(b.platform||'');
 if(!(await profiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf)||['api_server','webhook'].includes(pf))return {status:400,body:{error:'Unknown channel'}};
 try{return {status:200,body:await setChannelOn(ag,pf,b.on===true)}}catch(e){return {status:400,body:{error:e.message}}}}

// POST /hooks/pay/<provider>/<agent>: a payment provider's callback. The body is never believed: a verified callback only wakes the payment
// check for that agent (after), on the live app; the test copy answers the same and wakes nothing.
export async function payHook({provider,agent,headers,raw,receive,live,log=m=>console.warn(m)}){
 let r;try{r=await receive(provider,agent,headers,raw)}catch(e){log('payment callback '+e.message);return {status:500,body:{success:false}}}
 return {status:r.status,body:r.body,after:r.after&&live?()=>Promise.resolve().then(r.after).catch(e=>log('payment callback '+e.message)):null}}

// what happens right before aqeelOS stops the engine itself: what runs now is journaled first, so the stop that cuts it is known and it is
// continued afterwards. A journal that cannot be read must not stop the restart.
export async function beforeEngineStop({syncDelegs,log=()=>{}}){try{return await syncDelegs()}catch(e){log('resume: background tasks not journaled before the stop: '+e.message);return false}}
