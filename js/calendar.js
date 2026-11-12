/* Due-date calendar: month grid across all clients, assignment to staff,
   one-click WhatsApp / email reminders, calendar (.ics) export, and automatic
   filing set-up from the Client master. Reads the Compliance tracker's data. */
(function () {
  'use strict';
  const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DEF_TPL = {
    c: 'Dear {client},\n\nA reminder from {firm}: your {filing} for {period} is due on {due}. Please send us {docs} at the earliest so that we can file it on time and avoid late fees and interest.\n\nRegards,\n{firm}',
    s: 'Hi {staff}, please take up {filing} for {client} ({period}). Due on {due}.'
  };
  let started = false;

  /* ---------- people ---------- */
  function staffList() {
    if (window.Cloud && Cloud.enabled) return (Cloud.members || []).map(m => ({ id: m.user_id, name: m.name || m.email, phone: m.phone || '', email: m.email }));
    return get('ca.calstaff', []).map(s => ({ id: s.name, name: s.name, phone: s.phone || '', email: s.email || '' }));
  }
  const staffBy = id => staffList().find(s => s.id === id);
  const myId = () => (window.Cloud && Cloud.enabled && Cloud.user) ? Cloud.user.id : null;
  const firmName = () => (window.Cloud && Cloud.firmName) || 'M/s. Malaji And Co';

  /* ---------- helpers ---------- */
  const digits = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; if (d.length === 11 && d[0] === '0') d = '91' + d.slice(1); return d; };
  const wa = (phone, text) => 'https://wa.me/' + digits(phone) + '?text=' + encodeURIComponent(text);
  const mail = (to, subj, text) => 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(text);
  function clientInfo(c) {
    const cm = APP.CM || [], n = String(c.name || '').trim().toLowerCase();
    return cm.find(x => c.gstin && x.g && x.g.toUpperCase() === c.gstin.toUpperCase()) || cm.find(x => String(x.n || '').trim().toLowerCase() === n) || {};
  }
  function fill(tpl, t, staffName) {
    return tpl.replace(/\{(\w+)\}/g, (m, k) => ({ client: t.c.name, filing: t.comp.label, period: t.period, due: APP.fmtD(t.due), docs: CA_EXTRA.docs(t.comp), firm: firmName(), staff: staffName || '' }[k] ?? m));
  }
  const tpl = () => Object.assign({}, DEF_TPL, get('ca.caltpl', {}));

  /* ---------- the tasks for a month ---------- */
  function tasksFor(y, m) {
    const TR = APP.TR, today = APP.today0(), asg = get('ca.calassign', {}), out = [];
    TR.clients.forEach(c => c.comps.forEach(id => {
      const comp = APP.COMPS.find(x => x.id === id); if (!comp) return;
      const due = comp.due(y, m); if (!due) return;
      const key = c.id + '|' + id + '|' + y + '-' + (m + 1), done = !!TR.status[key];
      out.push({ c, comp, due, key, done, st: APP.taskStatus(due, done, today), who: asg[c.id + '|' + id] || '', period: CA_EXTRA.period(comp, y, m), ak: c.id + '|' + id });
    }));
    return out.sort((a, b) => a.due - b.due || a.c.name.localeCompare(b.c.name));
  }
  function ym() { const v = (q('#cal-month').value || '').split('-').map(Number); return [v[0], v[1] - 1]; }
  function filtered(list) {
    const who = q('#cal-who').value, grp = q('#cal-grp').value, sh = q('#cal-show').value;
    return list.filter(t => (!grp || t.comp.grp === grp) &&
      (!who || (who === '__me' ? t.who === myId() : who === '__none' ? !t.who : t.who === who)) &&
      (sh === 'all' || (sh === 'pending' && !t.done) || (sh === 'overdue' && t.st === 'overdue')));
  }

  /* ---------- render ---------- */
  function render() {
    if (!started) return;
    const [y, m] = ym(), all = tasksFor(y, m), list = filtered(all), staff = staffList();
    // filter selects
    const ws = q('#cal-who'), wv = ws.value;
    ws.innerHTML = '<option value="">Everyone</option>' + (myId() ? '<option value="__me">Only me</option>' : '') + '<option value="__none">Not assigned</option>' + staff.map(s => `<option value="${APP.esc(s.id)}">${APP.esc(s.name)}</option>`).join('');
    ws.value = [...ws.options].some(o => o.value === wv) ? wv : '';
    const gs = q('#cal-grp'), gv = gs.value, grps = [...new Set(APP.COMPS.map(c => c.grp))];
    gs.innerHTML = '<option value="">All types</option>' + grps.map(g => `<option>${APP.esc(g)}</option>`).join(''); gs.value = gv;

    const n = s => all.filter(t => t.st === s).length;
    q('#cal-stats').innerHTML = `<div class="stat bad"><b>${n('overdue')}</b><span>Overdue</span></div><div class="stat warn"><b>${n('soon')}</b><span>Due within 7 days</span></div><div class="stat"><b>${n('upcoming')}</b><span>Later this month</span></div><div class="stat good"><b>${n('done')}</b><span>Done</span></div><div class="stat"><b>${all.filter(t => !t.who && !t.done).length}</b><span>Not assigned</span></div>`;

    // grid
    const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), today = APP.today0();
    let cells = WD.map(d => `<div class="cal-h">${d}</div>`).join('');
    for (let i = 0; i < lead; i++) cells += '<div class="cal-d empty"></div>';
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m, d), its = list.filter(t => t.due.getDate() === d), isT = +dt === +today;
      const shown = its.slice(0, 4).map(t => `<button class="cal-i ${t.st}" data-k="${APP.esc(t.key)}" title="${APP.esc(t.comp.label + ' - ' + t.c.name)}">${APP.esc(short(t.comp.label))} &middot; ${APP.esc(t.c.name)}</button>`).join('');
      cells += `<div class="cal-d${isT ? ' today' : ''}${dt.getDay() === 0 ? ' sun' : ''}"><span class="cal-n">${d}</span>${shown}${its.length > 4 ? `<button class="cal-more" data-day="${d}">+${its.length - 4} more</button>` : ''}</div>`;
    }
    q('#cal-grid').innerHTML = cells;
    qa('#cal-grid .cal-i').forEach(b => b.onclick = () => { const r = q(`#cal-list tr[data-k="${CSS.escape(b.dataset.k)}"]`); if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1600); } });
    qa('#cal-grid .cal-more').forEach(b => b.onclick = () => { const r = qa('#cal-list tr').find(tr => tr.dataset.day === b.dataset.day); if (r) r.scrollIntoView({ block: 'start', behavior: 'smooth' }); });

    // list
    const CH = { done: ['Done', 'good'], overdue: ['Overdue', 'bad'], soon: ['Due soon', 'warn'], upcoming: ['Upcoming', 'mute'] };
    const T = tpl();
    q('#cal-list').innerHTML = `<table><thead><tr><th>Done</th><th>Due</th><th>Filing</th><th>Client</th><th>Assigned to</th><th>Status</th><th class="no-print">Remind</th></tr></thead><tbody>${list.map(t => {
      const ci = clientInfo(t.c), st = staffBy(t.who), dd = APP.daysBetween(today, t.due);
      const cMsg = fill(T.c, t), sMsg = st ? fill(T.s, t, st.name) : '';
      return `<tr data-k="${APP.esc(t.key)}" data-day="${t.due.getDate()}"><td><input type="checkbox" data-done="${APP.esc(t.key)}"${t.done ? ' checked' : ''} aria-label="Mark done"></td>
        <td class="n" style="text-align:left">${APP.fmtD(t.due)}</td><td>${APP.esc(t.comp.label)}<br><span class="sub">${APP.esc(t.period)}</span></td><td>${APP.esc(t.c.name)}</td>
        <td><select data-as="${APP.esc(t.ak)}" aria-label="Assign"><option value="">Not assigned</option>${staff.map(s => `<option value="${APP.esc(s.id)}"${s.id === t.who ? ' selected' : ''}>${APP.esc(s.name)}</option>`).join('')}</select></td>
        <td><span class="chip ${CH[t.st][1]}">${CH[t.st][0]}</span>${t.st === 'overdue' ? ' <span class="sub">' + (-dd) + ' days</span>' : t.st === 'soon' ? ' <span class="sub">' + (dd === 0 ? 'today' : dd + ' days') + '</span>' : ''}</td>
        <td class="no-print" style="white-space:nowrap">${t.done ? '' : `${ci.ph ? `<a class="btn small" target="_blank" rel="noopener" href="${wa(ci.ph, cMsg)}">Client</a>` : `<a class="btn ghost small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(cMsg)}" title="No mobile in Client master: pick the contact in WhatsApp">Client</a>`}
          <a class="btn ghost small" href="${mail(ci.em, t.comp.label + ' due ' + APP.fmtD(t.due), cMsg)}">Email</a>
          ${st ? (st.phone ? `<a class="btn ghost small" target="_blank" rel="noopener" href="${wa(st.phone, sMsg)}">Staff</a>` : `<a class="btn ghost small" href="${mail(st.email, 'Task: ' + t.comp.label + ' - ' + t.c.name, sMsg)}">Staff</a>`) : ''}`}</td></tr>`;
    }).join('') || '<tr><td colspan="7">No filings match. Add clients and their filings in the Compliance tracker, or use "Set up filings automatically" below.</td></tr>'}</tbody></table>`;
    qa('#cal-list [data-done]').forEach(b => b.onchange = () => { const S = APP.TR.status; if (b.checked) S[b.dataset.done] = true; else delete S[b.dataset.done]; APP.saveTR(); APP.trRender(); render(); });
    qa('#cal-list [data-as]').forEach(s => s.onchange = () => { const a = get('ca.calassign', {}); if (s.value) a[s.dataset.as] = s.value; else delete a[s.dataset.as]; put('ca.calassign', a); render(); homePanel(); });
    homePanel();
  }
  const short = l => l.replace(/\s*\(.*\)$/, '').replace(' financial statements', '').replace(' annual return', '');

  /* ---------- weekly digest per staff member ---------- */
  function digest() {
    const today = APP.today0(), end = new Date(+today + 7 * 864e5), staff = staffList();
    const [y, m] = [today.getFullYear(), today.getMonth()], nx = new Date(y, m + 1, 1);
    const all = tasksFor(y, m).concat(tasksFor(nx.getFullYear(), nx.getMonth())).filter(t => !t.done && t.due <= end);
    if (!staff.length) { APP.toast('Add your team on the Team tab first'); return; }
    const rows = staff.map(s => {
      const mine = all.filter(t => t.who === s.id); if (!mine.length) return '';
      const txt = `Hi ${s.name}, your filings for the next 7 days:\n\n` + mine.map(t => `${APP.fmtD(t.due)} - ${t.comp.label} - ${t.c.name}${t.st === 'overdue' ? ' (OVERDUE)' : ''}`).join('\n') + `\n\n- ${firmName()}`;
      return `<tr><td>${APP.esc(s.name)}</td><td class="n">${mine.length}</td><td>${s.phone ? `<a class="btn small" target="_blank" rel="noopener" href="${wa(s.phone, txt)}">Send on WhatsApp</a>` : `<a class="btn ghost small" href="${mail(s.email, 'Your filings this week', txt)}">Send by email</a>`}</td></tr>`;
    }).join('');
    const un = all.filter(t => !t.who).length;
    const box = document.createElement('div');
    box.className = 'panel'; box.style.margin = '0 0 12px';
    box.innerHTML = `<h3>This week, by person</h3><div class="tw"><table><thead><tr><th>Person</th><th class="n">Filings</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="3">Nobody has filings assigned in the next 7 days.</td></tr>'}</tbody></table></div>${un ? `<p class="note">${un} filing(s) in the next 7 days are not assigned to anyone.</p>` : ''}`;
    const old = q('#cal-dg'); if (old) old.remove(); box.id = 'cal-dg';
    q('#cal-list').before(box);
  }

  /* ---------- .ics export ---------- */
  function ics(months) {
    const pad = n => String(n).padStart(2, '0'), d8 = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const esc = s => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const ev = [];
    months.forEach(([y, m]) => tasksFor(y, m).filter(t => !t.done).forEach(t => {
      const nd = new Date(+t.due + 864e5), st = staffBy(t.who);
      ev.push(['BEGIN:VEVENT', 'UID:' + t.key.replace(/\|/g, '-') + '@ca-controlroom', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + d8(t.due), 'DTEND;VALUE=DATE:' + d8(nd),
        'SUMMARY:' + esc(t.comp.label + ' - ' + t.c.name), 'DESCRIPTION:' + esc('Period: ' + t.period + (st ? '\nAssigned to: ' + st.name : '')),
        'BEGIN:VALARM', 'TRIGGER:-P2D', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(t.comp.label + ' due'), 'END:VALARM', 'END:VEVENT'].join('\r\n'));
    }));
    if (!ev.length) { APP.toast('No pending filings to export'); return; }
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CA ControlRoom//EN', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
    APP.saveFile('due-dates.ics', new Blob([body], { type: 'text/calendar' }));
  }

  /* ---------- automatic filing set-up from the Client master ---------- */
  function autoSetup() {
    const TR = APP.TR, cm = APP.CM || [];
    if (!cm.length) { APP.toast('The Client master is empty. Add clients there first.'); return; }
    let added = 0;
    cm.forEach(x => {
      const nm = String(x.n || '').trim(); if (!nm) return;
      const g = String(x.g || '').toUpperCase(), p = String(x.p || (g.length === 15 ? g.slice(2, 12) : '')).toUpperCase();
      if (TR.clients.some(c => (g && c.gstin === g) || c.name.trim().toLowerCase() === nm.toLowerCase())) return;
      const t = p[3] || '', comps = [];
      if (g) comps.push('gstr1m', 'gstr3bm', 'gstr9');
      if (t === 'C') comps.push('tdspay', 'tdsret', 'advtax', 'taxaudit', 'itraud', 'aoc4', 'mgt7', 'adt1', 'dir3', 'dpt3');
      else if (t === 'F') comps.push('tdspay', 'tdsret', 'advtax', 'itraud', 'llp11', 'llp8');
      else if (t === 'P' || t === 'H') comps.push('advtax', 'itrnon');
      else comps.push('itrnon');
      TR.clients.push({ id: 'c' + Date.now().toString(36) + added, name: nm, gstin: g, comps: [...new Set(comps)] });
      added++;
    });
    TR.clients = TR.clients.filter(c => !c.sample || added === 0);
    APP.saveTR(); APP.trRender(); render();
    q('#cal-auto-n').textContent = added ? added + ' client(s) added. Check their filings in the Compliance tracker.' : 'Every Client master client is already in the tracker.';
  }

  /* ---------- "this week" panel on Home ---------- */
  function homePanel() {
    const home = q('#tab-home'); if (!home) return;
    let p = q('#dh-week');
    if (!p) { p = document.createElement('div'); p.id = 'dh-week'; p.className = 'panel'; p.style.marginTop = '16px'; home.appendChild(p); }
    const today = APP.today0(), end = new Date(+today + 7 * 864e5), nx = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const lst = tasksFor(today.getFullYear(), today.getMonth()).concat(tasksFor(nx.getFullYear(), nx.getMonth()))
      .filter(t => !t.done && t.due <= end && (!myId() || !q('#dh-mine') || !q('#dh-mine').checked || t.who === myId()));
    const od = lst.filter(t => t.st === 'overdue').length;
    p.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Filings due in the next 7 days${od ? ` <span class="chip bad">${od} overdue</span>` : ''}</h3>${myId() ? `<label class="sub"><input type="checkbox" id="dh-mine"${p.dataset.mine === '1' ? ' checked' : ''}> Only mine</label>` : ''}</div>
      <div class="tw" style="margin-top:8px"><table><thead><tr><th>Due</th><th>Filing</th><th>Client</th><th>Assigned to</th></tr></thead><tbody>${lst.slice(0, 12).map(t => `<tr><td>${APP.fmtD(t.due)}</td><td>${APP.esc(t.comp.label)}</td><td>${APP.esc(t.c.name)}</td><td>${APP.esc((staffBy(t.who) || {}).name || '-')}</td></tr>`).join('') || '<tr><td colspan="4">Nothing due in the next 7 days.</td></tr>'}</tbody></table></div>
      <p class="note"><a href="#calendar">Open the due-date calendar</a></p>`;
    const mn = q('#dh-mine'); if (mn) mn.onchange = () => { p.dataset.mine = mn.checked ? '1' : ''; homePanel(); };
  }

  /* ---------- wire up ---------- */
  document.addEventListener('app:start', () => {
    started = true;
    const t = new Date(); q('#cal-month').value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
    const shift = k => { const [y, m] = ym(), d = new Date(y, m + k, 1); q('#cal-month').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); render(); };
    q('#cal-prev').onclick = () => shift(-1); q('#cal-next').onclick = () => shift(1);
    ['cal-month', 'cal-who', 'cal-grp', 'cal-show'].forEach(id => q('#' + id).oninput = render);
    q('#cal-digest').onclick = digest;
    q('#cal-ics').onclick = () => ics([ym()]);
    q('#cal-ics-y').onclick = () => { const [y, m] = ym(), s = m >= 3 ? y : y - 1; ics(Array.from({ length: 12 }, (_, i) => { const d = new Date(s, 3 + i, 1); return [d.getFullYear(), d.getMonth()]; })); };
    q('#cal-auto').onclick = autoSetup;
    const T = tpl(); q('#cal-tpl-c').value = T.c; q('#cal-tpl-s').value = T.s;
    q('#cal-tpl-save').onclick = () => { put('ca.caltpl', { c: q('#cal-tpl-c').value, s: q('#cal-tpl-s').value }); render(); APP.toast('Templates saved'); };
    q('#cal-tpl-reset').onclick = () => { localStorage.removeItem('ca.caltpl'); q('#cal-tpl-c').value = DEF_TPL.c; q('#cal-tpl-s').value = DEF_TPL.s; render(); };
    // keep in step with ticks made on the tracker tab
    const tl = q('#t-list'); if (tl) tl.addEventListener('change', () => setTimeout(render, 0));
    render();
  });
  document.addEventListener('app:tab', e => { if (e.detail === 'calendar' || e.detail === 'home') render(); });
  window.CAL = { render, tasksFor, staffList };
})();
