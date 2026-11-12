/* Client document inbox: private upload links per client and the files they send.
   Needs the online database (Supabase Storage, free 1 GB). */
(function () {
  'use strict';
  const q = s => document.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  let started = false, links = [], files = [], filt = { c: '', st: 'new' }, subscribed = false;
  const size = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const linkUrl = t => location.origin + location.pathname.replace(/[^/]*$/, '') + 'upload.html?t=' + t;
  const token = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return [...a].map(x => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join(''); };

  async function load() {
    const [l, f] = await Promise.all([
      Cloud.sb.from('client_links').select('*').eq('firm_id', Cloud.firm).order('client'),
      Cloud.sb.from('inbox_files').select('*').eq('firm_id', Cloud.firm).order('uploaded_at', { ascending: false }).limit(500)]);
    links = l.data || []; files = f.data || [];
    badge();
  }
  function badge() {
    const b = q('nav.tabs button[data-tab="inbox"]'); if (!b) return;
    const n = files.filter(f => f.status === 'new').length;
    b.textContent = 'Document inbox' + (n ? ' (' + n + ')' : '');
  }

  async function render() {
    if (!started) return;
    const body = q('#ib-body'), esc = APP.esc;
    if (!(window.Cloud && Cloud.enabled)) { body.innerHTML = '<div class="panel"><p class="note" style="margin:0"><span class="chip warn">Needs the online setup</span> Clients upload into your free Supabase storage, so this tab works once the app is connected (see SETUP.md). Everything else works now.</p></div>'; return; }
    await load();
    const can = Cloud.role() !== 'article';
    const cm = (APP.CM || []).map(c => c.n);
    const fl = files.filter(f => (!filt.c || f.client === filt.c) && (filt.st === 'all' || f.status === filt.st));
    body.innerHTML = `
      <div class="row no-print" style="margin-bottom:10px"><label class="fld">Client<select id="ib-fc"><option value="">All clients</option>${[...new Set(files.map(f => f.client))].sort().map(c => `<option${c === filt.c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="fld">Show<select id="ib-fs"><option value="new"${filt.st === 'new' ? ' selected' : ''}>New</option><option value="done"${filt.st === 'done' ? ' selected' : ''}>Reviewed</option><option value="all"${filt.st === 'all' ? ' selected' : ''}>All</option></select></label></div>
      <div class="tw tall"><table><thead><tr><th>Received</th><th>Client</th><th>File</th><th>Note from client</th><th></th></tr></thead><tbody>${fl.map(f => `<tr data-id="${esc(f.id)}"><td>${new Date(f.uploaded_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${esc(f.client)}</td><td>${esc(f.name)}<br><span class="sub">${size(f.size)}</span></td><td>${esc(f.note)}</td>
        <td style="white-space:nowrap"><button class="btn small" data-dl>Open</button> ${f.status === 'new' ? '<button class="btn ghost small" data-rv>Mark reviewed</button>' : '<span class="chip good">Reviewed</span>'} ${can ? '<button class="btn ghost small" data-rm>Delete</button>' : ''}</td></tr>`).join('') || '<tr><td colspan="5">No files here.</td></tr>'}</tbody></table></div>
      <h2>Upload links</h2>
      ${can ? `<div class="panel"><div class="row"><label class="fld">Client<input id="ib-c" list="ib-cl" style="width:220px"><datalist id="ib-cl">${cm.map(n => `<option value="${esc(n)}">`).join('')}</datalist></label><button class="btn" id="ib-new">Create link</button></div></div>` : ''}
      <div class="tw" style="margin-top:12px"><table><thead><tr><th>Client</th><th>Link</th><th class="n">Files</th><th></th></tr></thead><tbody>${links.map(l => `<tr data-t="${esc(l.token)}"><td>${esc(l.client)}${l.active ? '' : ' <span class="chip mute">switched off</span>'}</td><td class="sub" style="word-break:break-all">${esc(linkUrl(l.token))}</td><td class="n">${files.filter(f => f.token === l.token).length}</td>
        <td style="white-space:nowrap">${l.active ? '<button class="btn small" data-wa>WhatsApp</button> <button class="btn ghost small" data-cp>Copy</button>' : ''} ${can ? `<button class="btn ghost small" data-tg>${l.active ? 'Switch off' : 'Switch on'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4">No links yet.</td></tr>'}</tbody></table></div>
      <p class="note">Each link only lets that client add files; they cannot see anything. Switch a link off when the work is over. Files are kept in your free Supabase storage (1 GB); delete reviewed files you have saved elsewhere to keep space free.</p>`;
    q('#ib-fc').onchange = e => { filt.c = e.target.value; render(); };
    q('#ib-fs').onchange = e => { filt.st = e.target.value; render(); };
    qa('#ib-body tr[data-id]').forEach(tr => {
      const f = files.find(x => x.id === tr.dataset.id);
      tr.querySelector('[data-dl]').onclick = async () => {
        const w = window.open('', '_blank');
        const r = await Cloud.sb.storage.from('inbox').createSignedUrl(f.path, 300, { download: f.name });
        if (r.error) { if (w) w.close(); APP.toast(r.error.message); return; }
        if (w) w.location = r.data.signedUrl; else location.href = r.data.signedUrl;
      };
      const rv = tr.querySelector('[data-rv]'); if (rv) rv.onclick = async () => { await Cloud.sb.from('inbox_files').update({ status: 'done', reviewed_by: Cloud.user.id }).eq('id', f.id); render(); };
      const rm = tr.querySelector('[data-rm]'); if (rm) rm.onclick = async () => {
        if (rm.dataset.sure !== '1') { rm.dataset.sure = '1'; rm.textContent = 'Confirm delete'; return; }
        await Cloud.sb.storage.from('inbox').remove([f.path]); await Cloud.sb.from('inbox_files').delete().eq('id', f.id); render();
      };
    });
    const nb = q('#ib-new'); if (nb) nb.onclick = async () => {
      const c = q('#ib-c').value.trim(); if (!c) { APP.toast('Enter the client'); return; }
      const r = await Cloud.sb.from('client_links').insert({ token: token(), firm_id: Cloud.firm, client: c, active: true, created_by: Cloud.user.id });
      if (r.error) APP.toast(r.error.message); else { APP.toast('Link created'); render(); }
    };
    qa('#ib-body tr[data-t]').forEach(tr => {
      const l = links.find(x => x.token === tr.dataset.t), url = linkUrl(l.token);
      const msg = `Dear ${l.client},\n\nPlease use this secure link to send us your documents (bills, bank statements, Form 16 and so on). Open it, choose the files and press Upload. No login is needed.\n\n${url}\n\nRegards,\n${Cloud.firmName}`;
      const wa = tr.querySelector('[data-wa]'); if (wa) wa.onclick = () => { const ci = (APP.CM || []).find(c => c.n === l.client) || {}; let d = String(ci.ph || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(msg), '_blank'); };
      const cp = tr.querySelector('[data-cp]'); if (cp) cp.onclick = () => navigator.clipboard.writeText(url).then(() => APP.toast('Link copied'), () => APP.toast(url));
      const tg = tr.querySelector('[data-tg]'); if (tg) tg.onclick = async () => { await Cloud.sb.from('client_links').update({ active: !l.active }).eq('token', l.token); render(); };
    });
  }

  function live() {
    if (subscribed || !(window.Cloud && Cloud.enabled && Cloud.firm)) return; subscribed = true;
    Cloud.sb.channel('inbox-' + Cloud.firm).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inbox_files', filter: 'firm_id=eq.' + Cloud.firm }, p => {
      files.unshift(p.new); badge(); APP.toast(p.new.client + ' sent ' + p.new.name);
      if (!q('#tab-inbox').hidden) render();
    }).subscribe();
  }

  document.addEventListener('app:start', async () => { started = true; if (window.Cloud && Cloud.enabled) { await load(); live(); } });
  document.addEventListener('app:tab', e => { if (e.detail === 'inbox') render(); });
})();
