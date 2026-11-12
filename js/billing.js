/* Billing: fee invoices with GST, payments with TDS, outstanding and ageing,
   WhatsApp / email payment reminders, printable invoices. Records live in Store
   ("invoice" and "payment"); firm details in ca.firm. */
(function () {
  'use strict';
  const q = s => document.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const r2 = n => Math.round(n * 100) / 100;
  const SAC = [['998221', 'Audit and assurance'], ['998222', 'Accounting and bookkeeping'], ['998231', 'Business tax consultancy and returns'], ['998232', 'Individual tax preparation'], ['998311', 'Management consultancy'], ['998399', 'Other professional services']];
  const FIRM_DEF = { name: 'M/s. Malaji And Co', addr: 'SVM College Complex, Office No. 37, Ilkal, Karnataka 587-203', phone: '7899824673', email: 'Malajiandco@yahoo.com', gstin: '', pan: '', state: '29', bank: '', acno: '', ifsc: '', upi: '', prefix: 'MAC/', days: 15, rate: 18 };
  const firm = () => Object.assign({}, FIRM_DEF, { name: (window.Cloud && Cloud.firmName) || FIRM_DEF.name }, get('ca.firm', {}));
  const today = () => { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const fyOf = d => { const x = APP.parseDate(d) || new Date(), y = x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1; return String(y).slice(2) + '-' + String(y + 1).slice(2); };
  let started = false, editing = null, payFor = null;

  /* ---------- maths ---------- */
  function calc(inv) {
    const f = firm(), rate = f.gstin ? +(inv.rate ?? f.rate) : 0;
    const taxable = r2(inv.lines.filter(l => !l.rimb).reduce((a, l) => a + num(l.amt), 0));
    const rimb = r2(inv.lines.filter(l => l.rimb).reduce((a, l) => a + num(l.amt), 0));
    const inter = !!(f.gstin && inv.pos && inv.pos !== (f.gstin.slice(0, 2) || f.state));
    const tax = r2(taxable * rate / 100), igst = inter ? tax : 0, cgst = inter ? 0 : r2(tax / 2), sgst = inter ? 0 : r2(tax - r2(tax / 2));
    const gross = taxable + igst + cgst + sgst + rimb, total = Math.round(gross);
    return { rate, taxable, rimb, inter, igst, cgst, sgst, round: r2(total - gross), total };
  }
  const paysOf = id => Store.list('payment').filter(p => p.inv === id);
  function bal(inv) {
    const ps = paysOf(inv.id), rec = ps.reduce((a, p) => a + num(p.amt) + num(p.tds) + num(p.wo), 0), b = r2(inv.total - rec);
    const due = new Date(APP.parseDate(inv.date) || new Date()); due.setDate(due.getDate() + (+inv.days || 0));
    const age = APP.daysBetween(APP.parseDate(inv.date) || new Date(), APP.today0()), od = APP.daysBetween(due, APP.today0());
    return { rec: r2(rec), bal: b, st: b <= 1 ? 'paid' : rec > 0 ? 'part' : 'unpaid', age, od, due, tds: ps.reduce((a, p) => a + num(p.tds), 0) };
  }
  function nextNo(date) {
    const f = firm(), fy = fyOf(date), pre = f.prefix + fy + '/';
    const n = Store.list('invoice').filter(i => String(i.no || '').startsWith(pre)).map(i => parseInt(String(i.no).slice(pre.length), 10) || 0);
    return pre + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0');
  }
  const clientInfo = name => (APP.CM || []).find(c => String(c.n || '').trim().toLowerCase() === String(name || '').trim().toLowerCase()) || {};

  /* ---------- list ---------- */
  function render() {
    if (!started) return;
    const esc = APP.esc, invs = Store.list('invoice').sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.no).localeCompare(String(a.no)));
    const fy = fyOf(today()), thisFy = invs.filter(i => fyOf(i.date) === fy);
    const B = new Map(invs.map(i => [i.id, bal(i)]));
    const out = invs.reduce((a, i) => a + Math.max(0, B.get(i.id).bal), 0), od = invs.filter(i => B.get(i.id).bal > 1 && B.get(i.id).od > 0);
    q('#bl-stats').innerHTML = `<div class="stat"><b>₹${APP.inr0(thisFy.reduce((a, i) => a + i.total, 0))}</b><span>Billed in FY ${fy} (${thisFy.length})</span></div>
      <div class="stat good"><b>₹${APP.inr0(Store.list('payment').filter(p => fyOf(p.date) === fy).reduce((a, p) => a + num(p.amt) + num(p.tds), 0))}</b><span>Received this FY (with TDS)</span></div>
      <div class="stat warn"><b>₹${APP.inr0(out)}</b><span>Outstanding</span></div>
      <div class="stat bad"><b>₹${APP.inr0(od.reduce((a, i) => a + B.get(i.id).bal, 0))}</b><span>Overdue (${od.length} invoices)</span></div>`;
    const show = q('#bl-show').value, fc = q('#bl-fc').value.trim().toLowerCase();
    const list = invs.filter(i => (!fc || i.client.toLowerCase().includes(fc)) && (show === 'all' || (show === 'paid' ? B.get(i.id).st === 'paid' : B.get(i.id).st !== 'paid')));
    const CH = { paid: ['Paid', 'good'], part: ['Part paid', 'warn'], unpaid: ['Unpaid', 'mute'] };
    q('#bl-list').innerHTML = `<table><thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th class="n">Total</th><th class="n">Received</th><th class="n">Balance</th><th>Status</th><th class="no-print"></th></tr></thead><tbody>${list.map(i => {
      const b = B.get(i.id), chip = b.bal < -1 ? `<span class="chip warn">Excess ₹${APP.inr0(-b.bal)}</span>` : b.st !== 'paid' && b.od > 0 ? `<span class="chip bad">Overdue ${b.od}d</span>` : `<span class="chip ${CH[b.st][1]}">${CH[b.st][0]}</span>`;
      return `<tr data-id="${esc(i.id)}"><td>${esc(i.no)}</td><td>${APP.fmtD(APP.parseDate(i.date))}</td><td>${esc(i.client)}</td><td class="n">${APP.inr0(i.total)}</td><td class="n">${APP.inr0(b.rec)}</td><td class="n">${APP.inr0(b.bal)}</td><td>${chip}</td>
        <td class="no-print" style="white-space:nowrap"><button class="btn ghost small" data-a="view">Print</button> ${b.st !== 'paid' ? '<button class="btn small" data-a="pay">Payment</button> <button class="btn ghost small" data-a="wa">Remind</button>' : ''} <button class="btn ghost small" data-a="edit">Edit</button> ${Cloud.role() === 'partner' ? '<button class="btn ghost small" data-a="del">Delete</button>' : ''}</td></tr>
        ${payFor === i.id ? `<tr><td colspan="8">${payForm(i, b)}</td></tr>` : ''}`;
    }).join('') || '<tr><td colspan="8">No invoices here yet. Click New invoice.</td></tr>'}</tbody></table>`;
    qa('#bl-list tr[data-id] [data-a]').forEach(btn => btn.onclick = () => action(btn.dataset.a, Store.get('invoice', btn.closest('tr').dataset.id)));
    wirePay();
    // ageing
    const ag = {}; invs.forEach(i => { const b = B.get(i.id); if (b.bal <= 1) return; const e = ag[i.client] = ag[i.client] || [0, 0, 0, 0, 0]; const k = b.age <= 30 ? 0 : b.age <= 60 ? 1 : b.age <= 90 ? 2 : 3; e[k] += b.bal; e[4] += b.bal; });
    const rows = Object.entries(ag).sort((a, b) => b[1][4] - a[1][4]);
    q('#bl-age').innerHTML = `<table><thead><tr><th>Client</th><th class="n">0-30 days</th><th class="n">31-60</th><th class="n">61-90</th><th class="n">Over 90</th><th class="n">Total</th><th class="no-print"></th></tr></thead><tbody>${rows.map(([c, a]) => `<tr><td>${esc(c)}</td>${a.map((v, k) => `<td class="n"${k === 3 && v ? ' style="color:var(--bad)"' : ''}>${v ? APP.inr0(v) : '-'}</td>`).join('')}<td class="no-print"><button class="btn ghost small" data-st="${esc(c)}">Statement</button></td></tr>`).join('') || '<tr><td colspan="7">Nothing outstanding.</td></tr>'}</tbody></table>`;
    qa('#bl-age [data-st]').forEach(b => b.onclick = () => statement(b.dataset.st));
  }

  function action(a, inv) {
    if (!inv) return;
    if (a === 'view') return printInv(inv);
    if (a === 'pay') { payFor = payFor === inv.id ? null : inv.id; render(); return; }
    if (a === 'edit') { editing = JSON.parse(JSON.stringify(inv)); form(); q('#bl-form').scrollIntoView({ behavior: 'smooth' }); return; }
    if (a === 'wa') return remind(inv);
    if (a === 'del') {
      const b = q(`#bl-list tr[data-id="${CSS.escape(inv.id)}"] [data-a="del"]`);
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Confirm delete'; return; }
      paysOf(inv.id).forEach(p => Store.remove('payment', p.id)); Store.remove('invoice', inv.id); APP.toast('Invoice deleted');
    }
  }

  /* ---------- payments ---------- */
  function payForm(inv, b) {
    const tds = Math.round(inv.taxable * 0.10);
    return `<div class="panel" style="margin:4px 0"><h3>Payment for ${APP.esc(inv.no)} (balance ₹${APP.inr0(b.bal)})</h3>${paysOf(inv.id).length ? `<p class="note" style="margin:0 0 8px">Earlier: ${paysOf(inv.id).map(p => `${APP.fmtD(APP.parseDate(p.date))} ₹${APP.inr0(num(p.amt))}${num(p.tds) ? ' + TDS ₹' + APP.inr0(num(p.tds)) : ''} (${APP.esc(p.mode)}) <button class="btn ghost small" data-pdel="${APP.esc(p.id)}">Remove</button>`).join('; ')}</p>` : ''}
      <div class="row"><label class="fld">Date<input type="date" id="py-d" value="${today()}"></label>
      <label class="fld">Amount received (₹)<input type="number" class="num" id="py-a" value="${Math.max(0, b.bal - (b.tds ? 0 : tds))}" style="width:120px"></label>
      <label class="fld">TDS deducted by client (₹)<input type="number" class="num" id="py-t" value="${b.tds ? 0 : tds}" style="width:110px" title="194J at 10% of fees, before GST"></label>
      <label class="fld">Discount / written off (₹)<input type="number" class="num" id="py-w" value="0" style="width:100px"></label>
      <label class="fld">Mode<select id="py-m"><option>UPI</option><option>NEFT / IMPS</option><option>Cheque</option><option>Cash</option></select></label>
      <label class="fld">Reference<input id="py-r" style="width:130px"></label><button class="btn" id="py-save">Save payment</button></div>
      <p class="note">TDS is suggested at 10% of the fee before GST (section 194J). Set it to 0 if the client did not deduct, and check it later in their 26AS.</p></div>`;
  }
  function wirePay() {
    const s = q('#py-save'); if (!s) return;
    s.onclick = () => {
      const a = num(q('#py-a').value), t = num(q('#py-t').value), w = num(q('#py-w').value);
      if (!(a + t + w)) { APP.toast('Enter the amount'); return; }
      Store.save('payment', { inv: payFor, date: q('#py-d').value, amt: a, tds: t, wo: w, mode: q('#py-m').value, ref: q('#py-r').value.trim(), by: myName() });
      payFor = null; APP.toast('Payment saved');
    };
    qa('[data-pdel]').forEach(b => b.onclick = () => Store.remove('payment', b.dataset.pdel));
  }
  const myName = () => (window.Cloud && Cloud.me && Cloud.me.name) || '';

  /* ---------- reminders ---------- */
  function remind(inv) {
    const f = firm(), b = bal(inv), ci = clientInfo(inv.client);
    const txt = `Dear ${inv.client},\n\nA gentle reminder that our invoice ${inv.no} dated ${APP.fmtD(APP.parseDate(inv.date))} for ₹${APP.inr0(inv.total)} has ₹${APP.inr0(b.bal)} outstanding${b.od > 0 ? ' (due ' + APP.fmtD(b.due) + ')' : ''}.\n\n` +
      (f.upi ? `Pay by UPI to: ${f.upi}\n` : '') + (f.acno ? `Bank transfer: ${f.bank} A/c ${f.acno}, IFSC ${f.ifsc}\n` : '') +
      `\nPlease ignore this if you have already paid. Thank you.\n\n${f.name}\n${f.phone}`;
    let d = String(ci.ph || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d;
    window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(txt), '_blank');
  }

  /* ---------- invoice form ---------- */
  function blank() { const f = firm(); return { id: '', no: '', date: today(), client: '', cgstin: '', pos: f.gstin ? f.gstin.slice(0, 2) : f.state, days: f.days, rate: f.rate, lines: [{ d: '', sac: '998231', amt: '' }], notes: '' }; }
  function form() {
    const box = q('#bl-form'); if (!editing) { box.innerHTML = ''; return; }
    const esc = APP.esc, inv = editing, f = firm(), c = calc(inv);
    box.innerHTML = `<div class="panel stack" style="margin-bottom:14px"><h3>${inv.id ? 'Edit invoice ' + esc(inv.no) : 'New invoice'}</h3>
      <div class="row"><label class="fld">Client<input id="bf-c" list="as-cl" value="${esc(inv.client)}" style="width:220px"></label>
        <label class="fld">Client GSTIN<input id="bf-g" value="${esc(inv.cgstin)}" style="width:170px"></label>
        <label class="fld">Place of supply (state code)<input id="bf-pos" value="${esc(inv.pos)}" style="width:80px"></label>
        <label class="fld">Date<input type="date" id="bf-d" value="${esc(inv.date)}"></label>
        <label class="fld">Credit days<input type="number" id="bf-days" value="${esc(inv.days)}" style="width:80px"></label>
        ${f.gstin ? `<label class="fld">GST %<input type="number" id="bf-rate" value="${esc(inv.rate)}" style="width:70px"></label>` : ''}</div>
      <div class="tw"><table><thead><tr><th>Description</th><th>SAC</th><th class="n">Amount (₹)</th><th>Reimbursement (no GST)</th><th></th></tr></thead><tbody>${inv.lines.map((l, i) => `<tr data-l="${i}"><td><input data-k="d" value="${esc(l.d)}" style="width:100%;min-width:220px" placeholder="e.g. GST return filing, Oct 2026"></td><td><input data-k="sac" list="bl-sac" value="${esc(l.sac)}" style="width:90px"></td><td><input data-k="amt" type="number" class="num" value="${esc(l.amt)}" style="width:120px"></td><td><input data-k="rimb" type="checkbox"${l.rimb ? ' checked' : ''} aria-label="Reimbursement"></td><td><button class="btn ghost small" data-rm="${i}">Remove</button></td></tr>`).join('')}</tbody></table></div>
      <datalist id="bl-sac">${SAC.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('')}</datalist>
      <div class="row"><button class="btn ghost small" id="bf-add">Add line</button><button class="btn ghost small" id="bf-as">Add this client's open assignments</button></div>
      <label class="fld">Notes on invoice<input id="bf-n" value="${esc(inv.notes)}" placeholder="optional"></label>
      <p class="note" style="margin:0"><span id="bf-tot"></span>${f.gstin ? '' : '. No GST is charged because the firm GSTIN is blank under Firm details.'}</p>
      <div class="row"><button class="btn" id="bf-save">${inv.id ? 'Save changes' : 'Save invoice'}</button><button class="btn ghost" id="bf-x">Cancel</button></div></div>`;
    const sync = () => {
      inv.client = q('#bf-c').value.trim(); inv.cgstin = q('#bf-g').value.trim().toUpperCase(); inv.pos = q('#bf-pos').value.trim(); inv.date = q('#bf-d').value; inv.days = +q('#bf-days').value || 0; inv.notes = q('#bf-n').value;
      if (q('#bf-rate')) inv.rate = num(q('#bf-rate').value);
      qa('#bl-form tr[data-l]').forEach(tr => { const l = inv.lines[+tr.dataset.l]; qa('[data-k]', tr).forEach(i => l[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value); });
    };
    const note = () => { const c2 = calc(inv); q('#bf-tot').innerHTML = `Fees ₹${APP.inr(c2.taxable)}${c2.rate ? (c2.inter ? ` + IGST ${c2.rate}% ₹${APP.inr(c2.igst)}` : ` + CGST ₹${APP.inr(c2.cgst)} + SGST ₹${APP.inr(c2.sgst)}`) : ''}${c2.rimb ? ` + reimbursements ₹${APP.inr(c2.rimb)}` : ''} = <b>₹${APP.inr0(c2.total)}</b>`; };
    qa('#bl-form input').forEach(i => i.addEventListener(i.type === 'checkbox' ? 'change' : 'input', () => { sync(); note(); }));
    q('#bf-c').addEventListener('change', () => { const ci = clientInfo(inv.client); if (ci.g && !inv.cgstin) { inv.cgstin = ci.g; inv.pos = ci.g.slice(0, 2); q('#bf-g').value = inv.cgstin; q('#bf-pos').value = inv.pos; note(); } });
    q('#bf-add').onclick = () => { sync(); inv.lines.push({ d: '', sac: '998231', amt: '' }); form(); };
    qa('#bl-form [data-rm]').forEach(b => b.onclick = () => { sync(); inv.lines.splice(+b.dataset.rm, 1); if (!inv.lines.length) inv.lines.push({ d: '', sac: '998231', amt: '' }); form(); });
    q('#bf-as').onclick = () => {
      sync(); const open = (APP.AS || []).filter(a => a.c.trim().toLowerCase() === inv.client.toLowerCase() && a.f > 0 && a.st !== 'Closed');
      if (!open.length) { APP.toast('No assignments with a fee for this client'); return; }
      inv.lines = inv.lines.filter(l => l.d || num(l.amt)).concat(open.map(a => ({ d: a.s, sac: /audit/i.test(a.s) ? '998221' : /account|book/i.test(a.s) ? '998222' : '998231', amt: a.f })));
      form();
    };
    q('#bf-x').onclick = () => { editing = null; form(); };
    note();
    q('#bf-save').onclick = () => {
      sync();
      if (!inv.client) { APP.toast('Enter the client'); return; }
      inv.lines = inv.lines.filter(l => String(l.d).trim() || num(l.amt));
      if (!inv.lines.length || !inv.lines.some(l => num(l.amt))) { APP.toast('Add at least one line with an amount'); inv.lines.push({ d: '', sac: '998231', amt: '' }); return; }
      if (inv.cgstin && typeof gstinOk === 'function' && gstinOk(inv.cgstin)) { APP.toast('Client GSTIN looks wrong: ' + gstinOk(inv.cgstin)); return; }
      Object.assign(inv, calc(inv)); if (!inv.no) inv.no = nextNo(inv.date);
      const saved = Store.save('invoice', inv); editing = null; form();
      APP.toast('Invoice ' + saved.no + ' saved'); printPrompt(saved);
    };
  }
  function printPrompt(inv) {
    const n = document.createElement('div'); n.className = 'live'; n.innerHTML = `Invoice ${APP.esc(inv.no)} saved. <button class="btn small">Print / PDF</button> <button class="btn ghost small">Close</button>`;
    document.body.appendChild(n); const [p, x] = n.querySelectorAll('button'); p.onclick = () => { printInv(inv); n.remove(); }; x.onclick = () => n.remove(); setTimeout(() => n.remove(), 12000);
  }

  /* ---------- printing ---------- */
  function sheet(title, body) {
    const w = window.open('', '_blank'); if (!w) { APP.toast('Allow pop-ups to print'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
      body{font:13px Arial,sans-serif;color:#111;margin:28px;max-width:780px}h1{font-size:18px;margin:0}h2{font-size:15px;margin:18px 0 6px}
      .top{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #f5b81c;padding-bottom:10px}.m{color:#555}
      table{border-collapse:collapse;width:100%;margin-top:10px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#e3edfb;color:#1546a0}td.n,th.n{text-align:right;white-space:nowrap}
      tr.t td{font-weight:bold}.foot{margin-top:24px;display:flex;justify-content:space-between;gap:20px}@media print{body{margin:10mm}}</style></head><body>${body}<script>setTimeout(()=>print(),300)<\/script></body></html>`);
    w.document.close();
  }
  function head(f, title) {
    return `<div class="top"><div><h1>${APP.esc(f.name)}</h1><div class="m">${APP.esc(f.addr)}<br>${APP.esc(f.phone)} &middot; ${APP.esc(f.email)}${f.gstin ? '<br>GSTIN ' + APP.esc(f.gstin) : ''}${f.pan ? ' &middot; PAN ' + APP.esc(f.pan) : ''}</div></div><div style="text-align:right"><h1 style="color:#1546a0">${title}</h1></div></div>`;
  }
  function printInv(inv) {
    const f = firm(), esc = APP.esc, c = calc(inv), b = bal(inv);
    const lines = inv.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.d)}${l.rimb ? ' <i>(reimbursement)</i>' : ''}</td><td>${l.rimb ? '' : esc(l.sac)}</td><td class="n">${APP.inr(num(l.amt))}</td></tr>`).join('');
    const tr = (l, v, t) => `<tr${t ? ' class="t"' : ''}><td colspan="3" style="text-align:right">${l}</td><td class="n">${APP.inr(v)}</td></tr>`;
    const w = typeof words === 'function' ? 'Rupees ' + words(c.total) + ' Only' : '';
    sheet(inv.no, head(f, f.gstin ? 'TAX INVOICE' : 'INVOICE') +
      `<p><b>Invoice no.</b> ${esc(inv.no)} &nbsp; <b>Date</b> ${APP.fmtD(APP.parseDate(inv.date))} &nbsp; <b>Due</b> ${APP.fmtD(b.due)}</p>
      <p><b>Bill to:</b> ${esc(inv.client)}${inv.cgstin ? '<br>GSTIN ' + esc(inv.cgstin) : ''}${f.gstin ? '<br>Place of supply: state code ' + esc(inv.pos) + (c.inter ? ' (inter-state, IGST)' : ' (intra-state, CGST and SGST)') : ''}</p>
      <table><thead><tr><th>#</th><th>Description</th><th>SAC</th><th class="n">Amount (₹)</th></tr></thead><tbody>${lines}
      ${tr('Fees (taxable value)', c.taxable)}${c.rate ? (c.inter ? tr('IGST @ ' + c.rate + '%', c.igst) : tr('CGST @ ' + c.rate / 2 + '%', c.cgst) + tr('SGST @ ' + c.rate / 2 + '%', c.sgst)) : ''}${c.rimb ? tr('Reimbursements', c.rimb) : ''}${c.round ? tr('Round off', c.round) : ''}${tr('Total', c.total, 1)}</tbody></table>
      <p>${w}</p>${inv.notes ? '<p>' + esc(inv.notes) + '</p>' : ''}
      <div class="foot"><div class="m">${f.acno ? `Bank: ${esc(f.bank)}<br>A/c ${esc(f.acno)} &middot; IFSC ${esc(f.ifsc)}<br>` : ''}${f.upi ? 'UPI: ' + esc(f.upi) : ''}</div><div style="text-align:right">For ${esc(f.name)}<br><br><br>Authorised signatory</div></div>`);
  }
  function statement(client) {
    const f = firm(), invs = Store.list('invoice').filter(i => i.client === client).sort((a, b) => a.date.localeCompare(b.date));
    let run = 0; const rows = [];
    invs.forEach(i => { run += i.total; rows.push([i.date, 'Invoice ' + i.no, i.total, 0, run]); paysOf(i.id).forEach(p => { const x = num(p.amt) + num(p.tds) + num(p.wo); run -= x; rows.push([p.date, `Received (${p.mode})${num(p.tds) ? ', incl. TDS ' + APP.inr0(num(p.tds)) : ''}`, 0, x, run]); }); });
    rows.sort((a, b) => a[0].localeCompare(b[0])); run = 0; rows.forEach(r => { run += r[2] - r[3]; r[4] = run; });
    sheet('Statement ' + client, head(f, 'STATEMENT') + `<p><b>${APP.esc(client)}</b> &middot; as on ${APP.fmtD(new Date())}</p><table><thead><tr><th>Date</th><th>Particulars</th><th class="n">Billed</th><th class="n">Received</th><th class="n">Balance</th></tr></thead><tbody>${rows.map(r => `<tr><td>${APP.fmtD(APP.parseDate(r[0]))}</td><td>${APP.esc(r[1])}</td><td class="n">${r[2] ? APP.inr(r[2]) : ''}</td><td class="n">${r[3] ? APP.inr(r[3]) : ''}</td><td class="n">${APP.inr(r[4])}</td></tr>`).join('')}<tr class="t"><td colspan="4" style="text-align:right">Balance due</td><td class="n">${APP.inr(run)}</td></tr></tbody></table>`);
  }

  /* ---------- firm details ---------- */
  function firmForm() {
    const f = firm(), esc = APP.esc, can = Cloud.role() === 'partner';
    const fld = (k, l, w, ph) => `<label class="fld">${l}<input data-fk="${k}" value="${esc(f[k])}" style="width:${w}px" placeholder="${ph || ''}"${can ? '' : ' disabled'}></label>`;
    q('#bl-firm').innerHTML = `<div class="row">${fld('name', 'Firm name', 220)}${fld('addr', 'Address', 360)}${fld('phone', 'Phone', 130)}${fld('email', 'Email', 200)}</div>
      <div class="row" style="margin-top:10px">${fld('gstin', 'Firm GSTIN (blank if not registered)', 190)}${fld('pan', 'PAN', 120)}${fld('state', 'State code', 70)}${fld('prefix', 'Invoice prefix', 90)}${fld('days', 'Credit days', 70)}${fld('rate', 'GST %', 60)}</div>
      <div class="row" style="margin-top:10px">${fld('bank', 'Bank name', 160)}${fld('acno', 'Account no.', 160)}${fld('ifsc', 'IFSC', 120)}${fld('upi', 'UPI ID', 180, 'name@okhdfcbank')}</div>
      ${can ? '<div class="row" style="margin-top:10px"><button class="btn small" id="bl-fsave">Save firm details</button></div>' : '<p class="note">Only a partner can change these.</p>'}`;
    const s = q('#bl-fsave'); if (s) s.onclick = () => {
      const o = {}; qa('#bl-firm [data-fk]').forEach(i => o[i.dataset.fk] = ['days', 'rate'].includes(i.dataset.fk) ? num(i.value) : i.value.trim());
      o.gstin = o.gstin.toUpperCase(); if (o.gstin && typeof gstinOk === 'function' && gstinOk(o.gstin)) { APP.toast('GSTIN looks wrong: ' + gstinOk(o.gstin)); return; }
      put('ca.firm', o); APP.toast('Firm details saved'); render();
    };
  }

  document.addEventListener('app:start', () => {
    started = true;
    q('#bl-new').onclick = () => { editing = blank(); form(); };
    q('#bl-show').oninput = render; q('#bl-fc').oninput = render;
    q('#bl-xlsx').onclick = () => {
      const inv = Store.list('invoice').map(i => { const b = bal(i); return { 'Invoice no': i.no, Date: i.date, Client: i.client, 'Client GSTIN': i.cgstin, Fees: i.taxable, IGST: i.igst, CGST: i.cgst, SGST: i.sgst, Reimbursements: i.rimb, Total: i.total, Received: b.rec, Balance: b.bal, Status: b.st }; });
      const pay = Store.list('payment').map(p => ({ Date: p.date, Invoice: (Store.get('invoice', p.inv) || {}).no, Client: (Store.get('invoice', p.inv) || {}).client, Amount: num(p.amt), TDS: num(p.tds), 'Written off': num(p.wo), Mode: p.mode, Reference: p.ref }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inv.length ? inv : [{}]), 'Invoices'); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pay.length ? pay : [{}]), 'Payments');
      APP.saveFile('fee-register.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    };
    firmForm(); render();
    Store.on(k => { if (k === 'invoice' || k === 'payment') render(); });
  });
  document.addEventListener('app:tab', e => { if (e.detail === 'billing') { firmForm(); render(); } });
  window.BILL = { calc, bal, nextNo, firm };
})();
