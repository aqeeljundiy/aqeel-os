const $=id=>document.getElementById(id);
let token='',providers=[],loginSession=null,loginPolling=false;
async function request(url,options){const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data}
async function refresh(){
 $('refresh').disabled=true;
 try{const data=await request('/api/status');token=data.token;providers=data.providers;if(data.modelsAt){if(parent!==window){parent.postMessage({cba:1,type:'openModels'},'*');location.replace('/')}else location.replace(data.modelsAt+'/#/models/models');return}$('connections').replaceChildren();for(const provider of providers){const row=document.createElement('div');row.className='connection';const title=document.createElement('strong');title.textContent=({claude:'Claude Code',codex:'Codex / ChatGPT',gemini:'Gemini CLI'})[provider.id]||provider.id;const content=document.createElement('div');const detail=document.createElement('p');detail.textContent=provider.message;if(provider.ready)detail.className='ready';content.append(detail);if(provider.installed&&!provider.ready){const button=document.createElement('button');button.type='button';button.textContent='Sign in to '+(({claude:'Claude',codex:'Codex',gemini:'Gemini'})[provider.id]);button.addEventListener('click',()=>startLogin(provider.id));content.append(button)}row.append(title,content);$('connections').append(row)}if(providers.filter(p=>p.ready).length===1)$('provider').value=providers.find(p=>p.ready).id}
 catch(e){$('connections').textContent=e.message}
 finally{$('refresh').disabled=false;if(token)await refreshAccounts();for(const p of providers){const rows=[...$('connections').children];const row=rows[providers.indexOf(p)];if(row&&[p.account?.name,p.account?.email,p.account?.plan].some(Boolean)){const detail=document.createElement('p');detail.textContent=[p.account.name,p.account.email,p.account.plan].filter(Boolean).join(' · ');row.lastChild.append(detail)}}}
}
async function run(provider,prompt){
 const state=$(provider+'-state'),output=$(provider+'-output');state.textContent='Sending…';output.textContent='Waiting for the provider response…';$(provider+'-billing').textContent='';
 try{const started=await request('/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify({provider,prompt})});const began=Date.now();while(true){const job=await request('/api/jobs/'+started.id);if(job.state!=='running'){state.textContent=job.state==='complete'?'Response received':'Connection failed';output.textContent=job.text||job.error;$(provider+'-billing').textContent=[job.account?(job.switched?'Automatically used ':'Account: ')+job.account:'',job.billing].filter(Boolean).join(' · ');break}state.textContent='Waiting · '+Math.round((Date.now()-began)/1000)+'s';await new Promise(resolve=>setTimeout(resolve,900))}}
 catch(e){state.textContent='Connection failed';output.textContent=e.message}
}
const label={codex:'Codex',claude:'Claude'};
$('refresh').addEventListener('click',refresh);
$('prompt-form').addEventListener('submit',async event=>{event.preventDefault();const selected=$('provider').value;const targets=selected==='both'?['claude','codex']:[selected];const unavailable=targets.filter(id=>!providers.find(p=>p.id===id)?.ready);if(unavailable.length){$('notice').textContent=unavailable.map(id=>label[id]).join(' and ')+' needs a confirmed subscription login. Check connections or choose the other provider.';return}$('send').disabled=true;$('notice').textContent='Request running. Keep this page open.';await Promise.all(targets.map(id=>run(id,$('prompt').value)));$('send').disabled=false;$('notice').textContent='Test finished. See each provider’s result.'});
const loginHeaders=()=>({'Content-Type':'application/json','X-Local-Token':token});
function renderLogin(session){
 loginSession=session;if(!session)return;
 $('login-panel').hidden=false;$('login-title').textContent=(({claude:'Claude',codex:'Codex',gemini:'Gemini'})[session.provider])+' sign-in';
 $('login-output').textContent=session.output.replace(/https:\/\/[^\s<>\x1b]+/g,'[provider sign-in link]');$('login-output').scrollTop=$('login-output').scrollHeight;
 $('login-status').textContent=session.state==='running'?'Complete sign-in in your browser. This panel will update automatically.':session.state==='complete'?'Sign-in command completed. Connection status refreshed.':session.error||'Sign-in stopped.';
 $('login-stop').disabled=session.state!=='running';$('login-input-send').disabled=session.state!=='running';$('login-links').replaceChildren();
 $('login-input-form').hidden=session.state!=='running';
 if(session.state==='running')for(const candidate of new Set(session.output.match(/https:\/\/[^\s<>\x1b]+/g)||[])){try{const url=new URL(candidate);if(!['claude.ai','claude.com','platform.claude.com','console.anthropic.com','auth.anthropic.com','auth.openai.com','chatgpt.com','accounts.google.com'].includes(url.hostname))continue;const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open '+(({claude:'Claude',codex:'OpenAI',gemini:'Google'})[session.provider])+' sign-in page';$('login-links').append(a,document.createElement('br'))}catch{}}
}
async function pollLogin(){
 if(loginPolling)return;loginPolling=true;
 try{while(true){const {session}=await request('/api/login',{headers:{'X-Local-Token':token}});renderLogin(session);if(!session||session.state!=='running'){await refresh();break}await new Promise(resolve=>setTimeout(resolve,800))}}
 catch(e){$('login-status').textContent=e.message}finally{loginPolling=false}
}
async function startLogin(provider,profileId){
 $('login-panel').hidden=false;$('login-status').textContent='Starting sign-in…';
 try{const {session}=await request('/api/login/start',{method:'POST',headers:loginHeaders(),body:JSON.stringify({provider,profileId})});renderLogin(session);$('login-title').textContent=(session.profileLabel||label[provider])+' sign-in';$('login-panel').scrollIntoView({block:'nearest'});void pollLogin()}catch(e){$('login-status').textContent=e.message}
}
async function refreshAccounts(){
 try{const data=await request('/api/accounts',{headers:{'X-Local-Token':token}});$('account-list').replaceChildren();$('auto-switch').checked=data.autoSwitch;
  for(const p of data.profiles){const row=document.createElement('article');row.className='account-row';const text=document.createElement('div');const title=document.createElement('strong');title.textContent=p.label;const identity=document.createElement('p');identity.textContent=p.ready?[p.account?.email||'Email unavailable',p.account?.plan].filter(Boolean).join(' · '):'Not signed in';const usage=document.createElement('p');usage.className='hint';const bucket=p.limits?.rateLimitsByLimitId?.codex||p.limits?.rateLimits;const windows=[bucket?.primary,bucket?.secondary].filter(Boolean);usage.textContent=windows.length?windows.map(w=>`${w.windowDurationMins?Math.round(w.windowDurationMins/60*10)/10+'h window':'Usage'}: ${typeof w.usedPercent==='number'?Math.round(w.usedPercent)+'% used':'unavailable'}${w.resetsAt?' · resets '+new Date(w.resetsAt*1000).toLocaleString():''}`).join(' / '):'Usage unavailable';text.append(title,identity,usage);const actions=document.createElement('div');actions.className='account-actions';const button=document.createElement('button');button.type='button';button.textContent=p.ready?(p.id===data.active?'Selected':'Use account'):'Sign in';button.disabled=p.ready&&p.id===data.active;button.onclick=async()=>{if(!p.ready)return startLogin('codex',p.id);await changeAccounts({action:'select',id:p.id});await refresh()};actions.append(button);row.append(text,actions);$('account-list').append(row)}
 }catch(e){$('account-notice').textContent=e.message}
}
async function changeAccounts(data){try{const result=await request('/api/accounts',{method:'POST',headers:loginHeaders(),body:JSON.stringify(data)});$('account-notice').textContent='Saved';return result}catch(e){$('account-notice').textContent=e.message;throw e}}
$('add-account').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{const data=await changeAccounts({action:'create',label:$('account-label').value});$('account-label').value='';await refreshAccounts();await startLogin('codex',data.profiles.at(-1).id)}catch{}finally{button.disabled=false}};
$('claude-auto-switch').onchange=async()=>{try{await request('/api/accounts',{method:'POST',headers:loginHeaders(),body:JSON.stringify({provider:'claude',action:'settings',autoSwitch:$('claude-auto-switch').checked})});$('claude-account-notice').textContent='Saved'}catch(e){$('claude-account-notice').textContent=e.message;await refreshClaudeAccounts()}};
$('auto-switch').onchange=async()=>{try{await changeAccounts({action:'settings',autoSwitch:$('auto-switch').checked})}catch{await refreshAccounts()}};
$('login-stop').addEventListener('click',async()=>{try{const {session}=await request('/api/login/stop',{method:'POST',headers:loginHeaders(),body:JSON.stringify({id:loginSession?.id})});renderLogin(session)}catch(e){$('login-status').textContent=e.message}});
$('login-input-form').addEventListener('submit',async event=>{event.preventDefault();try{await request('/api/login/input',{method:'POST',headers:loginHeaders(),body:JSON.stringify({id:loginSession?.id,value:$('login-input').value})});$('login-input').value=''}catch(e){$('login-status').textContent=e.message}});
void refresh().then(async()=>{if(!token)return;try{const {session}=await request('/api/login',{headers:{'X-Local-Token':token}});renderLogin(session);if(session?.state==='running')void pollLogin()}catch{}});

// Claude accounts: same flow as Codex — separate profiles, each with its own sign-in (CLAUDE_CONFIG_DIR).
async function refreshClaudeAccounts(){const list=$('claude-account-list');try{const data=await request('/api/accounts?provider=claude',{headers:{'X-Local-Token':token}});list.replaceChildren();$('claude-auto-switch').checked=Boolean(data.autoSwitch);
 for(const p of data.profiles){const row=document.createElement('article');row.className='account-row';const text=document.createElement('div');const title=document.createElement('strong');title.textContent=p.label;
  const identity=document.createElement('p');identity.textContent=p.ready?[p.account?.email||'Email unavailable',p.account?.plan].filter(Boolean).join(' · '):'Not signed in';text.append(title,identity);
  const actions=document.createElement('div');actions.className='account-actions';const b=document.createElement('button');b.type='button';b.textContent=p.ready?(p.id===data.active?'Selected':'Use account'):'Sign in';b.disabled=p.ready&&p.id===data.active;
  b.onclick=async()=>{if(!p.ready)return startLogin('claude',p.id);try{await request('/api/accounts',{method:'POST',headers:loginHeaders(),body:JSON.stringify({provider:'claude',action:'select',id:p.id})});$('claude-account-notice').textContent='Saved';await refreshClaudeAccounts();await refresh()}catch(e){$('claude-account-notice').textContent=e.message}};
  actions.append(b);row.append(text,actions);list.append(row)}}catch(e){$('claude-account-notice').textContent=e.message}}
$('add-claude-account').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
 try{const data=await request('/api/accounts',{method:'POST',headers:loginHeaders(),body:JSON.stringify({provider:'claude',action:'create',label:$('claude-account-label').value})});$('claude-account-label').value='';await refreshClaudeAccounts();await startLogin('claude',data.profiles.at(-1).id)}catch(e){$('claude-account-notice').textContent=e.message}finally{button.disabled=false}};
{const wait=setInterval(()=>{if(token){clearInterval(wait);refreshClaudeAccounts()}},300)}

// online (the copy on the AI box): its runs use the agents' accounts from aqeelOS › Models, so the sign-ins here are shown only
function managed(base){if(document.body.classList.contains('managed'))return;document.body.classList.add('managed');const note=document.createElement('p');note.className='managed-note card';note.append('Models are managed on aqeelOS › Models. Runs for an agent use the account that agent is on there; the sign-ins below are shown for reference only. ');
 if(base){const a=document.createElement('a');a.href=base.replace(/\/$/,'')+'/#/models/models';a.target='_top';a.rel='noopener';a.textContent='Open aqeelOS › Models';note.append(a)}document.querySelector('main')?.prepend(note)}
