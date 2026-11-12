/* Team tab: members and roles, invites, and "undo a mistake" from saved history.
   Without the cloud set up it keeps a simple staff list on this device. */
(function () {
  'use strict';
  const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
  const ROLES = ['partner', 'staff', 'article'];
  const LABELS = { 'ca.clients': 'Tracker clients and filings', 'ca.status': 'Tracker ticks', 'ca.cm': 'Client master', 'ca.as': 'Assignments and fees',
    'ca.rates': 'Rates and settings', 'ca.rules': 'Bank ledger rules', 'ca.calassign': 'Calendar assignments', 'ca.caltpl': 'Message templates' };
  const e = s => APP.esc(s);
  let started = false;

  async function render() {
    if (!started) return;
    const body = q('#team-body');
    if (!(window.Cloud && Cloud.enabled)) return renderLocal(body);
    const me = Cloud.me, partner = me.role === 'partner';
    const members = await Cloud.refreshMembers();
    let invites = [];
    if (partner) { const r = await Cloud.sb.from('invites').select('*').eq('firm_id', Cloud.firm).order('created_at'); invites = r.data || []; }
    const link = location.origin + location.pathname;
    body.innerHTML = `
      <div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Mobile (for WhatsApp)</th><th>Role</th><th></th></tr></thead><tbody>
      ${members.map(m => {
        const self = m.user_id === Cloud.user.id, can = partner || self;
        return `<tr data-u="${e(m.user_id)}"><td>${can ? `<input data-f="name" value="${e(m.name)}" style="width:150px">` : e(m.name)}</td><td>${e(m.email)}</td>
          <td>${can ? `<input data-f="phone" value="${e(m.phone)}" style="width:130px" inputmode="tel">` : e(m.phone)}</td>
          <td>${partner && !self ? `<select data-f="role">${ROLES.map(r => `<option${r === m.role ? ' selected' : ''}>${r}</option>`).join('')}</select>` : `<span class="chip mute">${e(m.role)}</span>`}</td>
          <td style="white-space:nowrap">${can ? '<button class="btn small" data-save>Save</button>' : ''} ${partner && !self ? '<button class="btn ghost small" data-rm>Remove</button>' : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
      ${partner ? `
      <h2>Add a team member</h2>
      <div class="panel"><div class="row">
        <label class="fld">Name<input id="tm-n" style="width:160px"></label>
        <label class="fld">Email<input id="tm-e" type="email" style="width:210px"></label>
        <label class="fld">Mobile<input id="tm-p" style="width:130px" inputmode="tel"></label>
        <label class="fld">Role<select id="tm-r"><option>staff</option><option>article</option><option>partner</option></select></label>
        <button class="btn" id="tm-add">Add</button></div>
        <p class="note">Then send them this link: <b>${e(link)}</b>. They choose "Create a login" with the same email and pick their own password. <button class="btn ghost small" id="tm-wa">Send the link on WhatsApp</button></p></div>
      ${invites.length ? `<h3 style="margin-top:16px">Waiting to sign up</h3><div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>${invites.map(i => `<tr><td>${e(i.name)}</td><td>${e(i.email)}</td><td>${e(i.role)}</td><td><button class="btn ghost small" data-uninv="${e(i.email)}">Cancel</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <h2>Undo a mistake</h2>
      <p class="hint">Every save from the last 90 days is kept. Pick what went wrong and bring back an earlier version for everyone.</p>
      <div class="panel"><div class="row"><label class="fld">Data<select id="hi-k">${Object.entries(LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><button class="btn ghost" id="hi-go">Show saves</button></div><div id="hi-out" style="margin-top:10px"></div></div>` : ''}`;

    qa('#team-body tr[data-u]').forEach(tr => {
      const sv = tr.querySelector('[data-save]');
      if (sv) sv.onclick = async () => {
        const upd = {}; tr.querySelectorAll('[data-f]').forEach(i => upd[i.dataset.f] = i.value.trim());
        const r = await Cloud.sb.from('members').update(upd).eq('firm_id', Cloud.firm).eq('user_id', tr.dataset.u);
        if (r.error) APP.toast(r.error.message); else { APP.toast('Saved'); if (tr.dataset.u === Cloud.user.id) Object.assign(Cloud.me, upd); await Cloud.refreshMembers(); window.CAL && CAL.render(); }
      };
      const rm = tr.querySelector('[data-rm]');
      if (rm) rm.onclick = async () => {
        if (rm.dataset.sure !== '1') { rm.dataset.sure = '1'; rm.textContent = 'Confirm remove'; return; }
        const r = await Cloud.sb.from('members').delete().eq('firm_id', Cloud.firm).eq('user_id', tr.dataset.u);
        if (r.error) APP.toast(r.error.message); else { APP.toast('Removed. They can no longer open the firm\'s data.'); render(); }
      };
    });
    if (!partner) return;
    q('#tm-add').onclick = async () => {
      const email = q('#tm-e').value.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) { APP.toast('Enter a valid email'); return; }
      const r = await Cloud.sb.from('invites').upsert({ firm_id: Cloud.firm, email, name: q('#tm-n').value.trim(), phone: q('#tm-p').value.trim(), role: q('#tm-r').value }, { onConflict: 'firm_id,email' });
      if (r.error) APP.toast(r.error.message); else { APP.toast('Added. Send them the link.'); render(); }
    };
    q('#tm-wa').onclick = () => {
      const p = q('#tm-p').value.replace(/\D/g, ''), ph = p.length === 10 ? '91' + p : p;
      const txt = `Hi ${q('#tm-n').value.trim()}, you have been added to CA ControlRoom at ${Cloud.firmName}. Open ${link} and choose "Create a login" with the email ${q('#tm-e').value.trim()}.`;
      window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent(txt), '_blank');
    };
    qa('[data-uninv]').forEach(b => b.onclick = async () => { await Cloud.sb.from('invites').delete().eq('firm_id', Cloud.firm).eq('email', b.dataset.uninv); render(); });
    q('#hi-go').onclick = history;
  }

  async function history() {
    const k = q('#hi-k').value, out = q('#hi-out');
    out.innerHTML = '<p class="sub">Loading...</p>';
    const r = await Cloud.sb.from('kv_history').select('id,value,updated_by,updated_at').eq('firm_id', Cloud.firm).eq('key', k).order('updated_at', { ascending: false }).limit(25);
    if (r.error) { out.innerHTML = '<p class="err">' + e(r.error.message) + '</p>'; return; }
    const rows = r.data || [];
    const name = id => (Cloud.members.find(m => m.user_id === id) || {}).name || '-';
    const size = v => { try { const j = JSON.parse(v); return Array.isArray(j) ? j.length + ' rows' : Object.keys(j || {}).length + ' entries'; } catch (x) { return ''; } };
    out.innerHTML = rows.length ? `<div class="tw"><table><thead><tr><th>Saved at</th><th>By</th><th>Size</th><th></th></tr></thead><tbody>${rows.map((h, i) => `<tr><td>${new Date(h.updated_at).toLocaleString('en-IN')}</td><td>${e(name(h.updated_by))}</td><td>${h.value == null ? 'deleted' : size(h.value)}</td><td>${i === 0 ? '<span class="sub">current</span>' : h.value == null ? '' : `<button class="btn ghost small" data-h="${h.id}">Bring back this version</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">No saves yet.</p>';
    qa('#hi-out [data-h]').forEach(b => b.onclick = async () => {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Confirm: replace for everyone'; return; }
      const h = rows.find(x => String(x.id) === b.dataset.h);
      localStorage.setItem(k, h.value); await Cloud.flush();
      APP.toast('Restored. Reloading.'); setTimeout(() => location.reload(), 900);
    });
  }

  function renderLocal(body) {
    const list = JSON.parse(localStorage.getItem('ca.calstaff') || '[]');
    body.innerHTML = `<div class="panel stack"><p class="note" style="margin:0"><span class="chip warn">This device only</span> Logins are not switched on yet, so data stays in this browser. Follow SETUP.md to connect the free Supabase database; then each person gets their own login and the data is shared.</p></div>
      <h2>Team names for assigning work</h2><div class="panel"><div class="row"><label class="fld">Name<input id="ls-n" style="width:160px"></label><label class="fld">Mobile<input id="ls-p" style="width:130px"></label><label class="fld">Email<input id="ls-e" type="email" style="width:200px"></label><button class="btn" id="ls-add">Add</button></div></div>
      <div class="tw" style="margin-top:12px"><table><thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th></th></tr></thead><tbody>${list.map((s, i) => `<tr><td>${e(s.name)}</td><td>${e(s.phone)}</td><td>${e(s.email || '')}</td><td><button class="btn ghost small" data-x="${i}">Delete</button></td></tr>`).join('') || '<tr><td colspan="4">No names yet.</td></tr>'}</tbody></table></div>`;
    q('#ls-add').onclick = () => { const n = q('#ls-n').value.trim(); if (!n) { APP.toast('Enter a name'); return; } list.push({ name: n, phone: q('#ls-p').value.trim(), email: q('#ls-e').value.trim() }); localStorage.setItem('ca.calstaff', JSON.stringify(list)); render(); window.CAL && CAL.render(); };
    qa('#team-body [data-x]').forEach(b => b.onclick = () => { list.splice(+b.dataset.x, 1); localStorage.setItem('ca.calstaff', JSON.stringify(list)); render(); });
  }

  document.addEventListener('app:start', () => { started = true; });
  document.addEventListener('app:tab', ev => { if (ev.detail === 'team') render(); });
})();
