// Code (PREVIEW, 19 Oct): how the Code section will look inside aqeelOS, with sample projects so it can be judged in
// the real app. Nothing here runs yet: buttons say so. Agreed shape: a project is a folder on the AI box with an owner
// agent and who may work on it; the workspace (files, preview, code, changes, artifacts) works without AI; agents do
// the coding beside it with all their powers (skills, apps, browser, automations; Claude Code and Codex as tools).
const CODE_DEMO=[
 {id:'frea-landing',name:'Acme Store landing page',kind:'Next.js',folder:'~/projects/frea-landing',owner:'default',team:['agent-a'],preview:true,changed:'12 min ago',branch:'feature/login',
  files:[['app/',0],['  login/page.tsx','M'],['  page.tsx',0],['components/',0],['  Hero.tsx','M'],['lib/sheets.ts','+'],['public/',0],['package.json',0],['README.md',0]],
  changes:[['app/login/page.tsx',42,0],['components/Hero.tsx',6,3],['lib/sheets.ts',28,0]],
  artifacts:[['Deck','Launch deck','12 slides · PPTX, PDF'],['Doc','Landing page copy','Doc · DOCX'],['Design','Hero options','3 frames · PNG']]},
 {id:'aqeelos',name:'aqeelOS',kind:'Node',folder:'github.com/example/aqeel-os',owner:'default',team:[],preview:false,changed:'today',branch:'main',files:[['app/',0],['  server.mjs',0],['  core.js',0],['extension/',0],['scripts/',0]],changes:[],artifacts:[]},
 {id:'pixel-reports',name:'Client reports',kind:'Decks and sheets',folder:'~/projects/pixel-reports',owner:'agent-a',team:['agent-b'],preview:false,changed:'yesterday',branch:'main',files:[['decks/',0],['  frea-baby-oct.deck',0],['sheets/',0]],changes:[],artifacts:[['Deck','Acme Store October report','9 slides'],['Sheet','Ad spend by week','Sheet · XLSX']]}];
const codeSoon=()=>toast('Preview of the Code section: this part isn’t built yet');
ACT['code-soon']=codeSoon;
PAGES.projects=async(p,el,r)=>{viewPick([]);const id=(r?.arg||[])[0];const pr=id&&CODE_DEMO.find(x=>x.id===id);if(pr)return codeWorkspace(pr,el);
 setActions(`<button data-act="code-soon">${icon('download',16)}Import from GitHub</button><button class="primary" data-act="code-soon">${icon('plus',16)}New project</button>`);
 const list=await viewAgents();const av=a=>Access.av({id:a,name:ident(a).name},22);
 el.innerHTML=`<div class="code-preview-note">${icon('sparkle',14)}Preview of the Code section with sample projects. Click a project to see its workspace.</div>
 <div class="panel card"><h2>Every project</h2><p class="sub">A project is a folder on the AI box. Its owner agent is in charge; others you allow may work on it too. Open goes into its files, live preview and changes.</p>
 <div class="code-list">${CODE_DEMO.map((x,i)=>`<div class="row code-row" ${st(i)} data-go="/code/projects/${x.id}"><div class="main-c"><span class="logo" style="background:var(--soft);color:var(--ink)">${esc(x.name.split(' ').map(w=>w[0]).join('').slice(0,2))}</span><div class="txt"><b>${esc(x.name)}</b><span>${x.preview?'<i class="dot" style="color:var(--ok)"></i>Preview running · ':''}${esc(x.kind)} · ${esc(x.folder)} · changed ${esc(x.changed)}</span></div></div>
  <div class="act"><span class="ab-lbl">Owned by</span><select class="code-owner" aria-label="Owner of ${esc(x.name)}">${list.map(a=>`<option ${a===x.owner?'selected':''}>${esc(ident(a).name)}</option>`).join('')}</select>
   <span class="acc-who">${[x.owner,...x.team].map(av).join('')}</span><span class="code-n">${x.team.length?(x.team.length+1)+' agents':'Only '+esc(ident(x.owner).name)}</span><button data-go="/code/projects/${x.id}">Open</button></div></div>`).join('')}</div></div>`;
 el.querySelectorAll('select.code-owner').forEach(s=>{s.onclick=e=>e.stopPropagation();s.onchange=codeSoon})};
function codeWorkspace(x,el){const tab=S.tab.codews||'Preview';const owner=ident(x.owner);
 setActions(`<button data-go="/code/projects">${icon('chevL',16)}All projects</button>`);
 const pane={
  Preview:`<div class="cw-prev"><div class="cw-url"><i class="dot" style="color:${x.preview?'var(--ok)':'var(--muted)'}"></i>${x.preview?'preview-'+esc(x.id)+'.'+esc(location.hostname)+'/login':'Not running'}<span style="flex:1"></span><button class="ghost small" data-act="code-soon">Desktop</button><button class="ghost small" data-act="code-soon">Phone</button></div>
   ${x.preview?`<div class="cw-site"><h3>Welcome back to Acme Store</h3><p>Sign in to see your orders and favourites.</p><span class="cw-in"></span><span class="cw-in"></span><span class="cw-go">Sign in</span></div>`:`<div class="state-box"><b>The preview isn’t running</b>Start it to see the project live.<br><button class="primary" data-act="code-soon">${icon('play',15)}Start preview</button></div>`}</div>`,
  Code:`<pre class="cw-code">export default function Login() {
  return (
    &lt;main className="mx-auto max-w-sm py-24"&gt;
      &lt;h1&gt;Welcome back to Acme Store&lt;/h1&gt;
      &lt;SignInForm onDone={() =&gt; router.push('/orders')} /&gt;
    &lt;/main&gt;
  )
}</pre>`,
  Changes:x.changes.length?`${x.changes.map(([f,a,d])=>`<div class="cw-chg"><span>${icon('file',15)}</span><b>${esc(f)}</b><span class="cw-a">+${a}</span><span class="cw-d">−${d}</span></div>`).join('')}<pre class="cw-code"><span class="cw-del">-  &lt;h1&gt;Shop Acme Store&lt;/h1&gt;</span><span class="cw-add">+  &lt;h1&gt;Gentle care for little ones&lt;/h1&gt;</span><span class="cw-add">+  &lt;Link href="/login"&gt;Sign in&lt;/Link&gt;</span></pre>`:`<div class="state-box"><b>No changes</b>Everything is committed.</div>`,
  Artifacts:x.artifacts.length?`<div class="cw-arts">${x.artifacts.map(([k,n,d])=>`<button class="card cw-art" data-act="code-soon"><span class="cw-th">${esc(k)}</span><b>${esc(n)}</b><small>${esc(d)}</small></button>`).join('')}</div>`:`<div class="state-box"><b>No artifacts yet</b>Decks, docs, designs and sheets made in this project show here.</div>`};
 const steps=x.id==='frea-landing'?[['code','Code','Claude Code built app/login/page.tsx and the sign-in form; tests pass'],['skill','Skill','Google Workspace read “[Acme] Store - Dashboard” into lib/sheets.ts'],['web','Browser','Checked the preview at phone size and fixed the button wrapping'],['auto','Automation','New schedule “Frea site screenshot”, Mondays 09:00, to Slack'],['app','GitHub','Opened pull request #14 “Login page and live product list”']]:[];
 el.innerHTML=`<div class="cw">
  <div class="cw-tree"><div class="cw-h">${icon('folder',13)}Files</div>${x.files.map(([f,m],i)=>`<button class="cw-f${i===1?' on':''}" data-act="code-soon"><span>${esc(f.trim())}</span>${m?`<i class="cw-m">${m}</i>`:''}</button>`).join('').replace(/<span>(\s*)/g,'<span>')}
   ${x.artifacts.length?`<div class="cw-h" style="margin-top:14px">${icon('layers',13)}Artifacts</div>${x.artifacts.map(a=>`<button class="cw-f" data-act="code-soon"><span>${esc(a[1])}</span></button>`).join('')}`:''}</div>
  <div class="cw-mid"><div class="cw-bar"><b>${esc(x.name)}</b><span class="cw-br">${icon('fork',12)}${esc(x.branch)}</span><span style="flex:1"></span>
    <button class="small" data-act="code-soon">${icon(x.preview?'stop':'play',14)}${x.preview?'Stop preview':'Start preview'}</button><button class="small" data-act="code-soon">Commit</button><button class="primary small" data-act="code-soon">Open pull request</button></div>
   ${tabs('codews',['Preview','Code','Changes'+(x.changes.length?' · '+x.changes.length:''),'Artifacts'],tab.startsWith('Changes')?('Changes'+(x.changes.length?' · '+x.changes.length:'')):tab)}
   <div class="cw-pane">${pane[tab.split(' ')[0]]||pane.Preview}</div></div>
  <div class="cw-chat"><div class="cw-ch">${Access.av({id:x.owner,name:owner.name},26)}<b>${esc(owner.name)}</b><span class="hint">${esc(modelLabel(S.model))}</span></div>
   <div class="cw-msgs">${steps.length?`<div class="cw-me">Add a login page, pull the product list from the Acme Store sheet, and every Monday send me a screenshot of the live site on Slack.</div>
    ${steps.map(([k,l,t])=>`<div class="cw-step"><span class="cw-k ${k}">${esc(l)}</span><span>${esc(t)}</span></div>`).join('')}
    <div class="cw-ai">Done. The login page is in the preview, products now come from the sheet, and you’ll get a screenshot on Slack every Monday. Want me to merge the pull request?</div>`:`<p class="hint" style="margin:auto;text-align:center">Ask ${esc(owner.name)} to build or change something in this project.</p>`}</div>
   <div class="cw-comp"><div class="hint">Ask ${esc(owner.name)} to change something in this project…</div><div class="cw-chips"><span>This project</span><span>${esc(modelLabel(S.model))}</span><span>Ask me</span><button class="primary icon" data-act="code-soon" aria-label="Send">${icon('send',15)}</button></div></div></div></div>`;
 placePills()}
