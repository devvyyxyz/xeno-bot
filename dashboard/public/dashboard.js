async function getJson(url, opts) {
  const res = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
  return res.json();
}

async function init() {
  const me = await getJson('/api/me');
  if (!me.authenticated) return (document.getElementById('guilds').innerHTML = `<div class="center">Please <a class="link" href="/auth/discord?returnTo=/dashboard">login with Discord</a>.</div>`);
  document.getElementById('who').innerText = me.user.username + (me.user.discriminator ? ('#' + me.user.discriminator) : '');
  const guildsRes = await getJson('/api/guilds');
  const container = document.getElementById('guilds');
  container.innerHTML = '';
  const list = (guildsRes && guildsRes.guilds && guildsRes.guilds.length) ? guildsRes.guilds : (guildsRes && guildsRes.raw ? guildsRes.raw : []);
  // populate server select dropdown
  const select = document.getElementById('server-select');
  if (select) {
    select.innerHTML = '<option value="">Select server</option>';
    list.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      const gid = select.value;
      if (!gid) return;
      const found = list.find(x => x.id === gid);
      selectGuild(gid, found ? found.name : gid);
    });
  }
  if (!list.length) return (container.innerHTML = '<div class="muted">No manageable guilds found.</div>');
  list.forEach(g => {
    const el = document.createElement('div');
    el.className = 'guild';
    const initials = (g.name || '?').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
    // use Discord CDN icon if available, otherwise fallback to initials
    const avatarHtml = g.icon ? `<img class="avatar-img" src="https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64" alt="${g.name}">` : `<div class="avatar">${initials}</div>`;
    el.innerHTML = `<div style="display:flex; gap:10px; align-items:center">${avatarHtml}<div><strong>${g.name}</strong><div class="meta">id: ${g.id}</div></div></div>`;
    el.addEventListener('click', () => selectGuild(g.id, g.name));
    el.addEventListener('click', () => {
      // update select to match clicked guild
      if (select) select.value = g.id;
    });
    container.appendChild(el);
  });
}

async function selectGuild(gid, name) {
  const root = document.getElementById('settings-root');
  root.innerHTML = `<div style="font-weight:700">${name}</div><div class="muted">Loading settings…</div>`;
  const res = await getJson('/api/guilds/' + gid + '/settings');
  if (res.error) return (root.innerHTML = `<div class="muted">${res.error}</div>`);
  const cfg = res.config || { data: {} };
  const enabled = !!(cfg.data && cfg.data.delete_spawn_message);
  root.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px">
      <div class="row"><label>Delete spawn message after catch</label><input type="checkbox" id="chk" ${enabled? 'checked':''} /></div>
      <div class="row"><div class="muted">This will remove the spawn post after a successful catch if the bot has Manage Messages.</div></div>
      <div class="row"><button class="btn" id="saveBtn">Save</button></div>
    </div>
  `;
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const chk = document.getElementById('chk');
    const body = { delete_spawn_message: !!chk.checked };
    const saveRes = await fetch('/api/guilds/' + gid + '/settings', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saveRes.ok) return alert('Save failed');
    alert('Saved');
  });
}

function logout() { window.location.href = '/logout'; }

// attach logout handler
window.addEventListener('DOMContentLoaded', () => {
  const out = document.getElementById('logout-link');
  if (out) out.addEventListener('click', (e) => { e.preventDefault(); logout(); });
  init();
});
