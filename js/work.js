/* Time and work: timer and manual time entries per client, "my time" list,
   and the partner dashboard (people workload, overdue work, client hours vs fees). */
(function () {
  'use strict';
  const q = s => document.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const hm = m => Math.floor(m / 60) + 'h ' + String(Math.round(m % 60)).padStart(2, '0') + 'm';
  let started = false, tick = null, editId = null;

  function me() {
    if (window.Cloud && Cloud.enabled && Cloud.user) return { id: Cloud.user.id, name: (Cloud.me && Cloud.me.name) || Cloud.user.email };
    const n = localStorage.getItem('work.me') || ''; return n ? { id: n, name: n } : null;
  }
  const people = () => window.CAL ? CAL.staffList() : [];
  const isPartner = () => Cloud.role() === 'partner';

  /* ---------- timer and manual entry ---------- */
  function timerBox() {
    const box = q('#wk-timer'), m = me(), t = get('work.timer', null), esc = APP.esc;
    if (!m) {
      const ps = people();
      box.innerHTML = `<h3>Who are you?</h3>${ps.length ? `<div class="row"><label class="fld">Pick your name<select id="wk-who">${ps.map(p => `<option>${esc(p.name)}</option>`).join('')}</select></label><button class="btn" id="wk-who-ok">Continue</button></div>` : '<p class="note" style="margin:0">Add team names on the Team tab first.</p>'}`;
      const ok = q('#wk-who-ok'); if (ok) ok.onclick = () => { localStorage.setItem('work.me', q('#wk-who').value); renderAll(); };
      q('#wk-manual').innerHTML = ''; return;
    }
    if (t) {
      const upd = () => { const el = q('#wk-run'); if (el) el.textContent = hm((Date.now() - t.start) / 60000); };
      box.innerHTML = `<h3>Timer running</h3><p style="margin:0"><b>${esc(t.client)}</b>${t.task ? ' &middot; ' + esc(t.task) : ''}</p><p class="n" style="font-size:1.6rem;margin:0" id="wk-run"></p><div class="row"><button class="btn" id="wk-stop">Stop and save</button><button class="btn ghost" id="wk-cancel">Discard</button></div>`;
      upd(); clearInterval(tick); tick = setInterval(upd, 15000);
      q('#wk-stop').onclick = () => { const mins = Math.max(1, Math.round((Date.now() - t.start) / 60000)); save({ date: iso(new Date(t.start)), client: t.client, task: t.task, mins }); localStorage.removeItem('work.timer'); clearInterval(tick); APP.toast('Saved ' + hm(mins)); renderAll(); };
      q('#wk-cancel').onclick = () => { localStorage.removeItem('work.timer'); clearInterval(tick); renderAll(); };
    } else {
      box.innerHTML = `<h3>Start a timer</h3><p class="sub" style="margin:0">Signed in as ${esc(m.name)}${!(window.Cloud && Cloud.enabled) ? ' <a href="#" id="wk-sw">change</a>' : ''}</p>
        <div class="row"><label class="fld">Client<input id="wk-c" list="as-cl" style="width:200px"></label><label class="fld">Task<input id="wk-t" list="wk-tasks" style="width:200px" placeholder="e.g. GSTR-3B Oct"></label><button class="btn" id="wk-start">Start</button></div>`;
      q('#wk-start').onclick = () => { const c = q('#wk-c').value.trim(); if (!c) { APP.toast('Enter the client'); return; } put('work.timer', { start: Date.now(), client: c, task: q('#wk-t').value.trim() }); renderAll(); };
      const sw = q('#wk-sw'); if (sw) sw.onclick = e => { e.preventDefault(); localStorage.removeItem('work.me'); renderAll(); };
    }
    q('#wk-manual').innerHTML = `<h3>Add time by hand</h3><div class="row"><label class="fld">Date<input type="date" id="wm-d" value="${iso(new Date())}"></label><label class="fld">Client<input id="wm-c" list="as-cl" style="width:180px"></label>
      <label class="fld">Task<input id="wm-t" list="wk-tasks" style="width:170px"></label><label class="fld">Hours<input type="number" id="wm-h" min="0" step="0.25" value="1" style="width:80px" class="num"></label><button class="btn" id="wm-add">Add</button></div>
      <datalist id="wk-tasks">${[...new Set(Store.list('time').map(x => x.task).filter(Boolean).concat(APP.COMPS.map(c => c.label)))].slice(0, 80).map(t => `<option value="${esc(t)}">`).join('')}</datalist>`;
    q('#wm-add').onclick = () => { const c = q('#wm-c').value.trim(), h = num(q('#wm-h').value); if (!c || !h) { APP.toast('Enter the client and hours'); return; } save({ date: q('#wm-d').value, client: c, task: q('#wm-t').value.trim(), mins: Math.round(h * 60) }); q('#wm-c').value = ''; q('#wm-t').value = ''; APP.toast('Time added'); };
  }
  function save(o) { const m = me(); Store.save('time', Object.assign({ by: m.id, who: m.name }, o)); }

  /* ---------- my time ---------- */
  function mine() {
    const m = me(), esc = APP.esc; if (!m) { q('#wk-mine').innerHTML = ''; return; }
    const since = new Date(); since.setDate(since.getDate() - 30);
    const L = Store.list('time').filter(x => x.by === m.id && x.date >= iso(since)).sort((a, b) => b.date.localeCompare(a.date));
    const wk = new Date(); wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
    const week = L.filter(x => x.date >= iso(wk)).reduce((a, x) => a + x.mins, 0);
    q('#wk-mine').innerHTML = `<table><thead><tr><th>Date</th><th>Client</th><th>Task</th><th class="n">Time</th><th></th></tr></thead><tbody>${L.map(x => editId === x.id ?
      `<tr data-id="${esc(x.id)}"><td><input type="date" data-k="date" value="${esc(x.date)}"></td><td><input data-k="client" list="as-cl" value="${esc(x.client)}"></td><td><input data-k="task" value="${esc(x.task)}"></td><td class="n"><input data-k="hrs" type="number" step="0.25" value="${(x.mins / 60).toFixed(2)}" style="width:80px"></td><td><button class="btn small" data-sv>Save</button></td></tr>` :
      `<tr data-id="${esc(x.id)}"><td>${APP.fmtD(APP.parseDate(x.date))}</td><td>${esc(x.client)}</td><td>${esc(x.task)}</td><td class="n">${hm(x.mins)}</td><td style="white-space:nowrap"><button class="btn ghost small" data-ed>Edit</button> <button class="btn ghost small" data-dl>Delete</button></td></tr>`).join('') || '<tr><td colspan="5">No time in the last 30 days.</td></tr>'}
      <tr class="total"><td colspan="3">This week</td><td class="n">${hm(week)}</td><td></td></tr></tbody></table>`;
    qa('#wk-mine tr[data-id]').forEach(tr => {
      const id = tr.dataset.id, ed = tr.querySelector('[data-ed]'), dl = tr.querySelector('[data-dl]'), sv = tr.querySelector('[data-sv]');
      if (ed) ed.onclick = () => { editId = id; mine(); };
      if (dl) dl.onclick = () => { if (dl.dataset.sure !== '1') { dl.dataset.sure = '1'; dl.textContent = 'Confirm'; return; } Store.remove('time', id); };
      if (sv) sv.onclick = () => { const x = Object.assign({}, Store.get('time', id)); qa('[data-k]', tr).forEach(i => { if (i.dataset.k === 'hrs') x.mins = Math.round(num(i.value) * 60); else x[i.dataset.k] = i.value.trim(); }); Store.save('time', x); editId = null; };
    });
  }

  /* ---------- partner dashboard ---------- */
  function range(p) {
    const t = APP.today0(), s = new Date(t), e = new Date(t);
    if (p === 'week') s.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    else if (p === 'month') s.setDate(1);
    else if (p === 'lastmonth') { s.setMonth(t.getMonth() - 1, 1); e.setDate(0); }
    else { s.setFullYear(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1); }
    return [iso(s), iso(e)];
  }
  function dash() {
    const box = q('#wk-dash'), esc = APP.esc;
    if (!isPartner()) { box.innerHTML = ''; return; }
    const per = box.dataset.p || 'month', [s, e] = range(per), T = Store.list('time').filter(x => x.date >= s && x.date <= e);
    const rates = get('ca.workrate', {}), defRate = num(rates._def || 500);
    const ppl = people(), names = new Map(ppl.map(p => [p.id, p.name])); T.forEach(x => { if (!names.has(x.by)) names.set(x.by, x.who || x.by); });
    const today = APP.today0(), y = today.getFullYear(), m = today.getMonth(), cal = window.CAL ? CAL.tasksFor(y, m) : [];
    const AS = APP.AS || [], open = a => a.st !== 'Filed' && a.st !== 'Closed';
    const pRows = [...names].map(([id, name]) => {
      const mins = T.filter(x => x.by === id).reduce((a, x) => a + x.mins, 0);
      const myCal = cal.filter(t => t.who === id), asg = AS.filter(a => open(a) && String(a.ca || '').trim().toLowerCase() === String(name).trim().toLowerCase());
      return { id, name, mins, calOver: myCal.filter(t => t.st === 'overdue').length, calPend: myCal.filter(t => !t.done).length, calDone: myCal.filter(t => t.done).length, asg: asg.length, asgOver: asg.filter(a => a.d && APP.parseDate(a.d) < today).length };
    }).sort((a, b) => b.mins - a.mins);
    const unassigned = cal.filter(t => !t.who && !t.done).length;
    const byC = {}; T.forEach(x => { const c = byC[x.client] = byC[x.client] || { mins: 0, value: 0 }; c.mins += x.mins; c.value += x.mins / 60 * num(rates[x.by] ?? defRate); });
    const inv = Store.list('invoice').filter(i => i.date >= s && i.date <= e);
    inv.forEach(i => { const c = byC[i.client] = byC[i.client] || { mins: 0, value: 0 }; c.billed = (c.billed || 0) + i.taxable; });
    const cRows = Object.entries(byC).sort((a, b) => b[1].mins - a[1].mins);
    const P = [['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['fy', 'This financial year']];
    box.innerHTML = `<h2>Partner dashboard</h2><div class="filters">${P.map(([k, l]) => `<button data-p="${k}" aria-pressed="${per === k}">${l}</button>`).join('')}</div>
      <div class="stats"><div class="stat"><b>${hm(T.reduce((a, x) => a + x.mins, 0))}</b><span>Time recorded</span></div><div class="stat bad"><b>${pRows.reduce((a, r) => a + r.calOver, 0)}</b><span>Overdue filings this month</span></div><div class="stat warn"><b>${unassigned}</b><span>Filings not assigned</span></div><div class="stat"><b>₹${APP.inr0(inv.reduce((a, i) => a + i.taxable, 0))}</b><span>Fees billed</span></div></div>
      <h3>People</h3><div class="tw"><table><thead><tr><th>Person</th><th class="n">Time</th><th class="n">Filings pending</th><th class="n">Overdue</th><th class="n">Done this month</th><th class="n">Open assignments</th><th class="n">Overdue assignments</th><th class="n">Rate ₹/hour</th></tr></thead><tbody>${pRows.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${hm(r.mins)}</td><td class="n">${r.calPend}</td><td class="n"${r.calOver ? ' style="color:var(--bad)"' : ''}>${r.calOver}</td><td class="n">${r.calDone}</td><td class="n">${r.asg}</td><td class="n"${r.asgOver ? ' style="color:var(--bad)"' : ''}>${r.asgOver}</td><td class="n"><input type="number" class="num" data-rate="${esc(r.id)}" value="${num(rates[r.id] ?? defRate)}" style="width:80px"></td></tr>`).join('') || '<tr><td colspan="8">No team members yet.</td></tr>'}</tbody></table></div>
      <p class="note">Filings come from the Due-date calendar (by who they are assigned to); assignments from Assignments and fees (by the name in "Allocated to"). Default rate for others: <input type="number" class="num" id="wk-def" value="${defRate}" style="width:80px"> ₹/hour.</p>
      <h3 style="margin-top:16px">Clients: time against fees</h3><div class="tw"><table><thead><tr><th>Client</th><th class="n">Time</th><th class="n">Time value</th><th class="n">Fees billed</th><th class="n">Recovery</th></tr></thead><tbody>${cRows.map(([c, v]) => { const rec = v.value ? (v.billed || 0) / v.value * 100 : null; return `<tr><td>${esc(c)}</td><td class="n">${hm(v.mins)}</td><td class="n">${APP.inr0(v.value)}</td><td class="n">${APP.inr0(v.billed || 0)}</td><td class="n"${rec != null && rec < 80 ? ' style="color:var(--bad)"' : ''}>${rec == null ? '-' : Math.round(rec) + '%'}</td></tr>`; }).join('') || '<tr><td colspan="5">No time or invoices in this period.</td></tr>'}</tbody></table></div>
      <p class="note">Recovery is fees billed divided by time value. Below 80% (red) means the client takes more time than the fee covers.</p>`;
    qa('#wk-dash [data-p]').forEach(b => b.onclick = () => { box.dataset.p = b.dataset.p; dash(); });
    qa('#wk-dash [data-rate]').forEach(i => i.onchange = () => { const r = get('ca.workrate', {}); r[i.dataset.rate] = num(i.value); put('ca.workrate', r); dash(); });
    q('#wk-def').onchange = () => { const r = get('ca.workrate', {}); r._def = num(q('#wk-def').value); put('ca.workrate', r); dash(); };
  }

  function renderAll() { if (!started) return; timerBox(); mine(); dash(); }
  document.addEventListener('app:start', () => { started = true; renderAll(); Store.on(k => { if (k === 'time') { mine(); dash(); } if (k === 'invoice') dash(); }); });
  document.addEventListener('app:tab', e => { if (e.detail === 'work') renderAll(); });
})();
