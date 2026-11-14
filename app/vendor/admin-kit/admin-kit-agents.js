/* aqeel-admin-kit 0.27.0 agent access page part. Do not edit in a site; change the kit repo and re-install. */
// Settings › Agent access: the owner makes a token per agent, chooses what it may do, sees when it was last used,
// and revokes it. Talks to the site's /api/agent-tokens (ak-mcp.mjs tokensApi). Load after admin-kit.js:
//   <div id="agents"></div>
//   <script defer src="/admin-kit/admin-kit-agents.js"></script>
//   AdminKit.agentAccess(document.getElementById('agents'), { api: '/api/agent-tokens', mcpUrl: location.origin + '/mcp', site: 'Elkiya Group' });
(function () {
  const AK = window.AdminKit;
  if (!AK) { console.error('admin-kit-agents.js needs admin-kit.js first'); return; }
  const esc = AK.esc;
  const KIND = { read: ['info', 'Reads'], write: ['warn', 'Changes data'], send: ['danger', 'Sends to people'] };
  const ago = (iso) => {
    if (!iso) return 'never used';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return 'used just now';
    if (s < 5400) return `used ${Math.round(s / 60)} min ago`;
    if (s < 129600) return `used ${Math.round(s / 3600)} h ago`;
    return `used ${Math.round(s / 86400)} days ago`;
  };
  const day = (iso) => new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  if (!document.getElementById('ak-agents-style')) {
    const st = document.createElement('style');
    st.id = 'ak-agents-style';
    st.textContent = `
.ak-agents-code{margin:0;padding:calc(var(--ak-space)*2.5) calc(var(--ak-space)*3);overflow:auto;border:1px solid var(--ak-border);border-radius:var(--ak-radius-inner,calc(var(--ak-radius-card)*.55));background:var(--ak-surface-2);color:var(--ak-text);font:var(--ak-text-sm)/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.ak-agents-pick{display:grid;gap:calc(var(--ak-space)*2)}
.ak-agents-pick label{display:grid;grid-template-columns:auto minmax(0,1fr);gap:calc(var(--ak-space)*.5) calc(var(--ak-space)*2.5);align-items:start;cursor:pointer}
.ak-agents-pick label .ak-check{margin-top:2px}
.ak-agents-pick small{grid-column:2;color:var(--ak-text-muted);font-size:var(--ak-text-sm)}
.ak-agents-group{display:grid;gap:calc(var(--ak-space)*2);margin:0;padding:0;border:0}
.ak-agents-group legend{padding:0;margin-bottom:calc(var(--ak-space)*1.5);font-weight:var(--ak-weight-bold)}
.ak-agents-intro{margin:0;color:var(--ak-text-muted);font-size:var(--ak-text-md);max-width:68ch}
[data-ak-agents]{font-family:var(--ak-font)}
.ak-agents-steps{margin:0;padding-left:1.2em;display:grid;gap:var(--ak-space)}`;
    document.head.appendChild(st);
  }

  AK.agentAccess = function (host, opt) {
    const api = opt.api || '/api/agent-tokens';
    const mcpUrl = opt.mcpUrl || location.origin + '/mcp';
    const site = opt.site || document.title;
    const short = (site.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'admin');
    let state = { tools: [], tokens: [], limits: {} };

    host.setAttribute('data-ak-agents', '');
    host.innerHTML = `
<div class="ak-columns">
  <section class="ak-card">
    <div class="ak-card__head"><h2>Agent tokens</h2><button class="ak-btn ak-btn--primary" type="button" data-new>New token</button></div>
    <div class="ak-card__body ak-stack">
    <p class="ak-agents-intro" data-intro>An AI agent (any model, any app that speaks MCP) can work in this backend with a token you make here. Each token belongs to one agent. Every call is in the activity log.</p>
    <ul class="ak-rows" data-list></ul>
    <details data-revoked hidden><summary class="ak-muted">Revoked tokens</summary><ul class="ak-rows" data-revoked-list></ul></details>
    </div>
  </section>
  <section class="ak-card">
    <div class="ak-card__head"><h2>What an agent can do</h2></div>
    <div class="ak-card__body"><ul class="ak-rows" data-tools></ul></div>
  </section>
  <section class="ak-card">
    <div class="ak-card__head"><h2>Connect an agent</h2></div>
    <div class="ak-card__body ak-stack">
    <ol class="ak-agents-steps">
      <li>Make a token above and copy it. It is shown once.</li>
      <li>In the agent's app, add an MCP server with this address and the token as a header.</li>
    </ol>
    <div class="ak-stack" data-snippets></div>
    </div>
  </section>
</div>
<ak-drawer heading="New token" data-drawer></ak-drawer>`;
    const $ = (s) => host.querySelector(s);
    const drawer = $('[data-drawer]');

    const snippets = (token) => {
      // One labelled block per kind of app, so the owner copies only the one they need.
      const t = token || '<token>';
      const block = (label, code) => `<p class="ak-muted" style="margin:0">${esc(label)}</p><pre class="ak-agents-code">${esc(code)}</pre>`;
      return [
        block('Address and header (any MCP app)', `${mcpUrl}\nAuthorization: Bearer ${t}`),
        block('Claude Code', `claude mcp add --transport http ${short} ${mcpUrl} --header "Authorization: Bearer ${t}"`),
        block('Cursor, VS Code, aqeelOS and other apps with a JSON config', JSON.stringify({ mcpServers: { [short]: { url: mcpUrl, headers: { Authorization: 'Bearer ' + t } } } }, null, 2)),
        block('Apps that only start local servers (Claude Desktop and others)', `npx mcp-remote ${mcpUrl} --header "Authorization: Bearer ${t}"`),
      ].join('');
    };

    const scopeText = (t) => {
      const w = t.scopes.filter((s) => s !== 'read');
      const r = t.scopes.includes('read') ? 'Reads' : 'No reading';
      return w.length ? `${r} · ${w.length} change tool${w.length === 1 ? '' : 's'}` : `${r} only`;
    };

    function draw() {
      const changes = state.tools.some((t) => t.kind !== 'read');
      $('[data-intro]').textContent = 'An AI agent (any model, any app that speaks MCP) can work in this backend with a token you make here. Each token belongs to one agent. '
        + (changes ? 'It can read; it changes or sends only what you tick. ' : 'Agents can only read here; nothing can be changed. ') + 'Every call is in the activity log.';
      const live = state.tokens.filter((t) => !t.revokedAt), dead = state.tokens.filter((t) => t.revokedAt);
      $('[data-list]').innerHTML = live.length ? live.map((t) => `
<li><div class="ak-row">
  <span class="ak-row__main"><span>${esc(t.name)}</span><span class="ak-row__sub">${esc(scopeText(t))} · ${esc(ago(t.lastUsedAt))} · ${esc(t.hint)}</span></span>
  <span class="ak-row__end"><ak-menu label="Token actions" align="end" trigger-class="ak-btn ak-btn--ghost">
    <span slot="trigger">Manage</span>
    <button type="button" data-edit="${esc(t.id)}">Change what it can do</button>
    <hr><button type="button" data-revoke="${esc(t.id)}" data-tone="danger">Revoke</button>
  </ak-menu></span>
</div></li>`).join('') : '<li class="ak-muted">No tokens yet. Agents cannot connect until you make one.</li>';
      $('[data-revoked]').hidden = !dead.length;
      $('[data-revoked-list]').innerHTML = dead.map((t) => `<li><div class="ak-row"><span class="ak-row__main"><span>${esc(t.name)}</span><span class="ak-row__sub">Revoked ${esc(day(t.revokedAt))}${t.revokedBy ? ' by ' + esc(t.revokedBy) : ''} · ${t.uses || 0} calls</span></span></div></li>`).join('');
      $('[data-tools]').innerHTML = state.tools.map((t) => `<li><div class="ak-row"><span class="ak-row__main"><span>${esc(t.title)}</span><span class="ak-row__sub">${esc(t.description)}</span></span><span class="ak-row__end"><ak-chip tone="${KIND[t.kind][0]}">${KIND[t.kind][1]}</ak-chip></span></div></li>`).join('');
      $('[data-snippets]').innerHTML = snippets();
    }

    async function load() {
      const r = await fetch(api, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Could not load (${r.status})`);
      state = await r.json();
      draw();
    }

    function form(token) {
      const has = (s) => (token ? token.scopes.includes(s) : s === 'read');
      const group = (kind, legend, note) => {
        const list = state.tools.filter((t) => t.kind === kind);
        if (!list.length) return '';
        return `<fieldset class="ak-agents-group"><legend>${legend}</legend>${note || ''}<div class="ak-agents-pick">${list.map((t) => `
<label><input type="checkbox" class="ak-check" name="scope" value="${esc(t.name)}"${has(t.name) ? ' checked' : ''}><span>${esc(t.title)}</span><small>${esc(t.description)}${t.undo ? ' Undo: ' + esc(t.undo) : ''}</small></label>`).join('')}</div></fieldset>`;
      };
      const reads = state.tools.filter((t) => t.kind === 'read');
      drawer.setAttribute('heading', token ? `Change ${token.name}` : 'New token');
      drawer.content.innerHTML = `
<form class="ak-stack" data-form>
  <div class="ak-field"><label for="ak-agent-name">Name</label><input id="ak-agent-name" class="ak-input" name="name" maxlength="60" required placeholder="Which agent, for example Donna (aqeelOS)" value="${esc(token ? token.name : '')}"></div>
  <fieldset class="ak-agents-group"><legend>Reading</legend><div class="ak-agents-pick"><label><input type="checkbox" class="ak-check" name="scope" value="read"${has('read') ? ' checked' : ''}><span>Read</span><small>${esc(reads.map((t) => t.title).join(', ') || 'Nothing to read yet.')}</small></label></div></fieldset>
  ${group('write', 'Changes', '<p class="ak-muted" style="margin:0">Off until you tick them. Each change is logged and can be undone.</p>')}
  ${group('send', 'Sends to people', '<div class="ak-banner" data-tone="warn"><div><strong>These reach real people</strong>An email, WhatsApp or invoice cannot be called back. Tick one only for an agent you trust with it.</div></div>')}
  <div class="ak-actions"><button class="ak-btn ak-btn--primary" type="submit">${token ? 'Save' : 'Make token'}</button><button class="ak-btn" type="button" data-cancel>Cancel</button></div>
</form>`;
      drawer.content.querySelector('[data-cancel]').onclick = () => drawer.hide();
      drawer.content.querySelector('[data-form]').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const body = { name: f.name.value, scopes: [...f.querySelectorAll('[name=scope]:checked')].map((c) => c.value) };
        if (token) body.id = token.id;
        const r = await fetch(api, { method: token ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) return AK.toast.error(out.error || 'Could not save');
        await load();
        if (token) { drawer.hide(); return AK.toast.success('Saved', { description: `${token.name} can now do what you ticked.` }); }
        reveal(out.token, out.record);
      };
      drawer.show();
    }

    function reveal(secret, rec) {
      drawer.setAttribute('heading', `Token for ${rec.name}`);
      drawer.content.innerHTML = `
<div class="ak-stack">
  <div class="ak-banner" data-tone="info"><div><strong>Copy it now</strong>This is the only time the token is shown. If it is lost, revoke it and make a new one.</div></div>
  <pre class="ak-agents-code" data-secret>${esc(secret)}</pre>
  <div class="ak-actions"><button class="ak-btn ak-btn--primary" type="button" data-copy>Copy token</button><button class="ak-btn" type="button" data-done>Done</button></div>
  ${snippets(secret)}
</div>`;
      drawer.content.querySelector('[data-copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(secret); AK.toast.success('Token copied'); } catch { AK.toast.error('Copy did not work: select the token and copy it.'); }
      };
      drawer.content.querySelector('[data-done]').onclick = () => drawer.hide();
      // The token must not stay on screen or in the page after the drawer closes.
      drawer.addEventListener('close', () => { drawer.content.innerHTML = ''; }, { once: true });
    }

    host.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-new')) return form(null);
      if (b.dataset.edit) return form(state.tokens.find((t) => t.id === b.dataset.edit));
      if (b.dataset.revoke) {
        const t = state.tokens.find((x) => x.id === b.dataset.revoke);
        const ok = await AK.confirm({ title: `Revoke ${t.name}?`, body: 'The agent is signed out at once and this token never works again. Its history stays in the activity log.', confirmLabel: 'Revoke token', cancelLabel: 'Keep it', tone: 'danger' });
        if (!ok) return;
        const r = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'revoke', id: t.id }) });
        if (!r.ok) return AK.toast.error('Could not revoke');
        await load();
        AK.toast.success(`${t.name} is signed out`);
      }
    });

    load().catch((err) => { $('[data-list]').innerHTML = `<li class="ak-muted">${esc(err.message)}</li>`; });
    return { reload: load };
  };
})();
