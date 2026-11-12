/* Stronger GST reconciliation (replaces the matching and results view of the
   original GSTR-2B vs books tool; the file inputs and calculators stay).
   - Several files at once (for example three months of 2B), Excel, CSV or portal JSON.
   - Reads the B2B and B2B-CDNR sheets of the portal's GSTR-2B Excel directly.
   - Optional GSTR-2A and IMS files: flags invoices only in 2A and the IMS action.
   - Probable matches: invoice number typos, same amount and date, wrong GSTIN in books.
   - Remembers confirmed matches for next time (shared with the firm).
   - Vendor follow-up: one WhatsApp or email per supplier listing missing invoices. */
(function () {
  'use strict';
  const q = s => document.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const P = { books: [], g2b: [], g2a: [], ims: [] };       // loaded files: {name, d}
  let rowsCache = [];

  const FIELDS = () => [
    ...GST_FIELDS.map(f => f.key === 'inv' ? Object.assign({}, f, { re: /invoice\s*(no|num)|inv\.?\s*(no|num)|bill\s*no|document\s*(no|num)|note\s*(no|num)|doc\.?\s*no/i }) : f),
    { key: 'name', label: 'Supplier name', re: /trade|legal\s*name|supplier\s*name|party\s*name|vendor/i },
    { key: 'ntype', label: 'Note type (credit / debit)', re: /note\s*type/i }];
  const IMS_FIELDS = () => [GST_FIELDS[0], { key: 'inv', label: 'Invoice number', re: /invoice\s*(no|num)|document\s*(no|num)|note\s*(no|num)|inv\.?\s*no/i },
    { key: 'action', label: 'IMS action', re: /action|ims.*status|^status/i }];

  /* ---------- reading files ---------- */
  const norm = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
  const digitsOf = s => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  // Header detection that also handles the portal's two-row headers.
  function table(rows2d, fields) {
    const score = cells => fields.filter(f => cells.some(c => f.re.test(String(c)))).length;
    let best = 0, bs = -1, two = false;
    for (let i = 0; i < Math.min(rows2d.length, 40); i++) {
      const a = (rows2d[i] || []).map(String), b = (rows2d[i + 1] || []).map(String);
      const s1 = score(a), comb = a.map((c, k) => (c + ' ' + (b[k] || '')).trim()).concat(b.slice(a.length)), s2 = score(comb);
      if (s1 > bs) { bs = s1; best = i; two = false; }
      if (s2 > bs + 1) { bs = s2; best = i; two = true; }
    }
    let headers = (rows2d[best] || []).map(h => String(h).trim());
    if (two) { const b = (rows2d[best + 1] || []).map(String); headers = headers.map((h, k) => (h + ' ' + (b[k] || '')).trim()); for (let k = headers.length; k < b.length; k++) headers.push(b[k]); }
    const rows = rows2d.slice(best + (two ? 2 : 1)).filter(r => r.some(c => String(c).trim() !== ''));
    // Prefer the more specific column when both a combined header and a narrower one match.
    const m = {}; fields.forEach(f => { m[f.key] = headers.findIndex((h, i) => f.re.test(h) && !Object.values(m).includes(i)); });
    const tx = headers.findIndex(h => /taxable/i.test(h)); if (tx >= 0) m.taxable = tx;
    return { headers, rows, map: m };
  }
  async function readAny(file) {
    if (/\.json$/i.test(file.name)) return { json: JSON.parse(await file.text()) };
    const buf = await file.arrayBuffer(), wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const pick = wb.SheetNames.filter(n => /^b2b$/i.test(n.trim()) || /^b2b[\s\-_]*cdnr$/i.test(n.trim()));
    const names = pick.length ? pick : [wb.SheetNames[0]];
    return { sheets: names.map(n => ({ sheet: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }), credit: /cdnr/i.test(n) })) };
  }
  // Portal JSON (GSTR-2B, GSTR-2A) to plain items.
  function fromJson(j) {
    const out = [], d = (j.data && j.data.docdata) || j.docdata || j;
    const push = (ctin, name, no, dt, items, sign) => {
      let t = { gstin: String(ctin || '').toUpperCase(), name: name || '', inv: String(no || ''), date: APP.parseDate(dt), taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      (items || []).forEach(it => { const x = it.itm_det || it; t.taxable += +(x.txval || 0); t.igst += +(x.igst ?? x.iamt ?? 0); t.cgst += +(x.cgst ?? x.camt ?? 0); t.sgst += +(x.sgst ?? x.samt ?? 0); });
      ['taxable', 'igst', 'cgst', 'sgst'].forEach(f => t[f] *= sign); out.push(t);
    };
    (d.b2b || []).forEach(s => (s.inv || []).forEach(i => push(s.ctin, s.trdnm, i.inum, i.dt || i.idt, i.items || i.itms, 1)));
    (d.cdnr || []).forEach(s => (s.nt || []).forEach(n => push(s.ctin, s.trdnm, n.ntnum || n.nt_num, n.dt || n.nt_dt, n.items || n.itms, /^c/i.test(n.typ || n.ntty || '') ? -1 : 1)));
    return out;
  }
  function itemsOf(kind) {
    const out = [];
    P[kind].forEach(f => {
      if (f.items) { out.push(...f.items); return; }
      const m = f.d.map, c = (r, k) => m[k] >= 0 ? r[m[k]] : '';
      f.d.rows.forEach(r => {
        const gstin = String(c(r, 'gstin')).trim().toUpperCase(), inv = String(c(r, 'inv')).trim(); if (!gstin || !inv) return;
        const sign = (f.credit || /credit|^c$/i.test(String(c(r, 'ntype')).trim())) ? -1 : 1;
        out.push({ gstin, inv, name: String(c(r, 'name') || '').trim(), date: APP.parseDate(c(r, 'date')), taxable: sign * Math.abs(num(c(r, 'taxable'))), igst: sign * Math.abs(num(c(r, 'igst'))), cgst: sign * Math.abs(num(c(r, 'cgst'))), sgst: sign * Math.abs(num(c(r, 'sgst'))) });
      });
    });
    return out;
  }
  function agg(list) {
    const m = new Map();
    list.forEach(it => {
      const k = it.gstin + '|' + norm(it.inv), e = m.get(k), tax = it.igst + it.cgst + it.sgst;
      if (e) { e.taxable += it.taxable; e.tax += tax; e.igst += it.igst; e.cgst += it.cgst; e.sgst += it.sgst; if (!e.name && it.name) e.name = it.name; }
      else m.set(k, Object.assign({}, it, { tax, key: k, ninv: norm(it.inv) }));
    });
    return m;
  }
  function imsMap() {
    const m = new Map();
    P.ims.forEach(f => {
      if (f.items) return;
      const mp = f.d.map, c = (r, k) => mp[k] >= 0 ? r[mp[k]] : '';
      f.d.rows.forEach(r => { const g = String(c(r, 'gstin')).trim().toUpperCase(), i = String(c(r, 'inv')).trim(); if (g && i) m.set(g + '|' + norm(i), String(c(r, 'action')).trim() || 'No action'); });
    });
    return m;
  }

  /* ---------- matching ---------- */
  function reconcilePlus(_b, _g, tol) {
    const B = agg(itemsOf('books')), G = agg(itemsOf('g2b')), A = agg(itemsOf('g2a')), I = imsMap();
    const mem = get('ca.gstmatch', {}), no = get('ca.gstnomatch', {}), vend = get('ca.vendors', {});
    const rows = [], usedG = new Set(), usedB = new Set();
    const nameOf = (b, g) => (g && g.name) || (b && b.name) || (vend[(b || g).gstin] || {}).n || '';
    const mk = (status, b, g, extra) => Object.assign({
      status, gstin: (b || g).gstin, inv: (b || g).inv, date: (b || g).date, name: nameOf(b, g),
      bTaxable: b ? b.taxable : 0, bTax: b ? b.tax : 0, gTaxable: g ? g.taxable : 0, gTax: g ? g.tax : 0,
      diff: (b ? b.tax : 0) - (g ? g.tax : 0), bKey: b ? b.key : '', gKey: g ? g.key : '',
      gInv: g ? g.inv : '', gGstin: g ? g.gstin : '', ims: g ? (I.get(g.key) || (I.size ? 'Not in IMS' : '')) : '', in2a: false, why: ''
    }, extra || {});
    // exact and remembered
    for (const [k, b] of B) {
      let gk = G.has(k) ? k : null, remembered = false;
      if (!gk && mem[k] && G.has(mem[k]) && !B.has(mem[k]) && !usedG.has(mem[k])) { gk = mem[k]; remembered = true; }
      if (!gk || usedG.has(gk)) continue;
      const g = G.get(gk); usedG.add(gk); usedB.add(k);
      rows.push(mk(Math.abs(b.tax - g.tax) <= tol ? 'matched' : 'differs', b, g, { remembered }));
    }
    // probable matches
    const UB = [...B.values()].filter(b => !usedB.has(b.key)), UG = [...G.values()].filter(g => !usedG.has(g.key)), cand = [];
    UB.forEach(b => UG.forEach(g => {
      if (no[b.key + '>' + g.key]) return;
      const sameG = b.gstin === g.gstin, samePan = b.gstin.slice(2, 12) === g.gstin.slice(2, 12);
      const db = digitsOf(b.inv), dg = digitsOf(g.inv);
      const invS = b.ninv === g.ninv ? 3 : (db && db === dg) ? 2 : (b.ninv.length >= 3 && lev(b.ninv, g.ninv) <= 2) ? 1 : 0;
      const taxOk = Math.abs(b.tax - g.tax) <= Math.max(tol, 0.01 * Math.abs(g.tax)), txOk = Math.abs(b.taxable - g.taxable) <= Math.max(1, 0.01 * Math.abs(g.taxable));
      const days = b.date && g.date ? Math.abs(APP.daysBetween(b.date, g.date)) : 99;
      let s = 0, why = '';
      if (sameG && invS >= 1 && (taxOk || txOk)) { s = 10 + invS; why = 'Invoice number written differently (' + g.inv + ' in 2B)'; }
      else if (sameG && invS === 0 && Math.abs(b.tax - g.tax) <= tol && txOk && days <= 7) { s = 6; why = 'Same supplier, amount and date; invoice number ' + g.inv + ' in 2B'; }
      else if (!sameG && invS >= 2 && Math.abs(b.tax - g.tax) <= tol) { s = 4; why = samePan ? 'Same invoice, but 2B shows GSTIN ' + g.gstin + ' (same PAN, other state or branch)' : 'Same invoice and amount, but 2B shows GSTIN ' + g.gstin + '. Check the GSTIN in books'; }
      if (s) cand.push({ b, g, s, why });
    }));
    cand.sort((x, y) => y.s - x.s);
    cand.forEach(c => { if (usedB.has(c.b.key) || usedG.has(c.g.key)) return; usedB.add(c.b.key); usedG.add(c.g.key); rows.push(mk('fuzzy', c.b, c.g, { why: c.why })); });
    UB.filter(b => !usedB.has(b.key)).forEach(b => { const a = A.get(b.key); rows.push(mk('notin2b', b, null, { in2a: !!a, why: a ? 'In GSTR-2A: supplier filed late, credit should come in a later 2B' : '' })); });
    UG.filter(g => !usedG.has(g.key)).forEach(g => rows.push(mk('notinbooks', null, g)));
    const ord = { fuzzy: 0, differs: 1, notin2b: 2, notinbooks: 3, matched: 4 };
    rows.sort((a, b) => ord[a.status] - ord[b.status] || a.gstin.localeCompare(b.gstin));
    rowsCache = rows;
    return rows;
  }

  /* ---------- results view ---------- */
  function render() {
    const R = G.rows, sum = (st, f) => R.filter(r => r.status === st).reduce((a, r) => a + r[f], 0), cnt = st => R.filter(r => r.status === st).length;
    const esc = APP.esc, shown = G.filter === 'all' ? R : R.filter(r => r.status === G.filter);
    const ims = R.some(r => r.ims), rej = R.filter(r => /reject/i.test(r.ims) && r.bKey).length;
    const f = [['all', 'All'], ['fuzzy', 'Probable match'], ['differs', 'Amount differs'], ['notin2b', 'Not in 2B'], ['notinbooks', 'Not in books'], ['matched', 'Matched']].map(([k, l]) => [k, l + ' (' + (k === 'all' ? R.length : cnt(k)) + ')']);
    const UGrows = R.filter(r => r.status === 'notinbooks');
    q('#g-out').innerHTML = `<div class="stats">
      <div class="stat"><b>₹${inr(R.reduce((a, r) => a + r.bTax, 0))}</b><span>Tax as per books</span></div>
      <div class="stat"><b>₹${inr(R.reduce((a, r) => a + r.gTax, 0))}</b><span>Tax as per GSTR-2B</span></div>
      <div class="stat good"><b>₹${inr(sum('matched', 'gTax'))}</b><span>Matched (${cnt('matched')})</span></div>
      <div class="stat warn"><b>${cnt('fuzzy')}</b><span>Probable matches to confirm</span></div>
      <div class="stat warn"><b>₹${inr(sum('differs', 'diff'))}</b><span>Net difference (${cnt('differs')})</span></div>
      <div class="stat bad"><b>₹${inr(sum('notin2b', 'bTax'))}</b><span>In books, not in 2B: ITC at risk</span></div>
      <div class="stat"><b>₹${inr(sum('notinbooks', 'gTax'))}</b><span>In 2B, not in books</span></div>
      ${ims ? `<div class="stat ${rej ? 'bad' : ''}"><b>${rej}</b><span>Booked but rejected in IMS</span></div>` : ''}</div>
      <div class="filters">${f.map(([k, l]) => `<button data-f="${k}" aria-pressed="${G.filter === k}">${l}</button>`).join('')}</div>
      <div class="tw tall"><table><thead><tr><th>Status</th><th>Supplier</th><th>Invoice</th><th>Date</th><th class="n">Books tax</th><th class="n">2B tax</th><th class="n">Difference</th>${ims ? '<th>IMS</th>' : ''}<th>Note / action</th></tr></thead><tbody>
      ${shown.map((r, i) => {
        const idx = R.indexOf(r);
        let act = esc(r.why);
        if (r.status === 'fuzzy') act += `<div class="row" style="gap:6px;margin-top:4px"><button class="btn small" data-ok="${idx}">Same invoice</button><button class="btn ghost small" data-no="${idx}">Different</button></div>`;
        if (r.status === 'matched' && r.remembered) act = `Linked to ${esc(r.gInv)} <button class="btn ghost small" data-un="${idx}">Unlink</button>`;
        if (r.status === 'notin2b') { const opts = UGrows.filter(g => g.gstin.slice(2, 12) === r.gstin.slice(2, 12)); if (opts.length) act += `<select data-ln="${idx}" style="margin-top:4px;max-width:220px"><option value="">Link to a 2B invoice...</option>${opts.map(g => `<option value="${esc(g.gKey)}">${esc(g.inv)} &middot; ₹${inr(g.gTax)}</option>`).join('')}</select>`; }
        const imsChip = r.ims ? `<span class="chip ${/accept/i.test(r.ims) ? 'good' : /reject/i.test(r.ims) ? 'bad' : /pend/i.test(r.ims) ? 'warn' : 'mute'}">${esc(r.ims)}</span>` : '';
        return `<tr><td><span class="chip ${ST[r.status][1]}">${ST[r.status][0]}</span>${r.in2a ? ' <span class="chip mute">In 2A</span>' : ''}</td>
          <td><span class="n">${esc(r.gstin)}</span>${r.name ? '<br><span class="sub">' + esc(r.name) + '</span>' : ''}</td><td>${esc(r.inv)}</td><td>${APP.fmtD(r.date)}</td>
          <td class="n">${inr(r.bTax)}</td><td class="n">${inr(r.gTax)}</td><td class="n">${r.status === 'matched' && Math.abs(r.diff) < 0.005 ? '' : inr(r.diff)}</td>${ims ? `<td>${imsChip}</td>` : ''}<td style="min-width:180px">${act}</td></tr>`;
      }).join('') || `<tr><td colspan="${ims ? 9 : 8}">Nothing in this group.</td></tr>`}
      </tbody></table></div>
      <div id="g-vendors"></div>`;
    qa('#g-out .filters button').forEach(b => b.onclick = () => { G.filter = b.dataset.f; render(); });
    const rerun = () => { gstRun(); };
    qa('#g-out [data-ok]').forEach(b => b.onclick = () => { const r = R[+b.dataset.ok], m = get('ca.gstmatch', {}); m[r.bKey] = r.gKey; put('ca.gstmatch', m); APP.toast('Remembered. This pair will match automatically next time.'); rerun(); });
    qa('#g-out [data-no]').forEach(b => b.onclick = () => { const r = R[+b.dataset.no], m = get('ca.gstnomatch', {}); m[r.bKey + '>' + r.gKey] = 1; put('ca.gstnomatch', m); rerun(); });
    qa('#g-out [data-un]').forEach(b => b.onclick = () => { const r = R[+b.dataset.un], m = get('ca.gstmatch', {}); delete m[r.bKey]; put('ca.gstmatch', m); rerun(); });
    qa('#g-out [data-ln]').forEach(s => s.onchange = () => { if (!s.value) return; const r = R[+s.dataset.ln], m = get('ca.gstmatch', {}); m[r.bKey] = s.value; put('ca.gstmatch', m); APP.toast('Linked and remembered'); rerun(); });
    vendors();
  }

  /* ---------- vendor follow-up ---------- */
  function vendors() {
    const R = G.rows, esc = APP.esc, V = get('ca.vendors', {});
    const issues = R.filter(r => (r.status === 'notin2b' && !r.in2a) || r.status === 'differs');
    const by = {}; issues.forEach(r => (by[r.gstin] = by[r.gstin] || []).push(r));
    const keys = Object.keys(by);
    const box = q('#g-vendors'); if (!box) return;
    if (!keys.length) { box.innerHTML = ''; return; }
    const client = () => (q('#g-cl').value || '').trim() || 'our client', per = () => (q('#g-per').value || '').trim();
    const firm = (window.Cloud && Cloud.firmName) || 'M/s. Malaji And Co';
    const msg = (g, list) => {
      const v = V[g] || {}, total = list.reduce((a, r) => a + (r.status === 'differs' ? r.diff : r.bTax), 0);
      return `Dear ${v.n || list[0].name || 'Sir/Madam'},\n\nWe are reconciling GST input tax credit for ${client()}${per() ? ' for ' + per() : ''}. The following invoices issued by you (GSTIN ${g}) are ${list.every(r => r.status === 'notin2b') ? 'not appearing' : 'not appearing correctly'} in GSTR-2B:\n\n` +
        list.map((r, i) => `${i + 1}. Invoice ${r.inv}${r.date ? ' dated ' + APP.fmtD(r.date) : ''}: taxable ₹${inr(r.bTaxable)}, tax ₹${inr(r.bTax)}${r.status === 'differs' ? ' (2B shows tax ₹' + inr(r.gTax) + ')' : ''}`).join('\n') +
        `\n\nTax involved: ₹${inr(total)}. Please upload or correct these in your GSTR-1 / IFF at the earliest so that the credit is not lost.\n\nRegards,\n${firm}`;
    };
    const wa = (ph, t) => { let d = String(ph || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return 'https://wa.me/' + d + '?text=' + encodeURIComponent(t); };
    box.innerHTML = `<h2>Follow up with suppliers</h2><p class="hint">One message per supplier, listing every invoice missing from 2B or showing a different amount. Invoices already in 2A are left out (they should come in a later 2B). Supplier contacts are saved for the whole firm.</p>
      <div class="tw"><table><thead><tr><th>Supplier</th><th>Mobile</th><th>Email</th><th class="n">Invoices</th><th class="n">Tax at stake</th><th></th></tr></thead><tbody>${keys.map(g => {
        const l = by[g], v = V[g] || {}, t = l.reduce((a, r) => a + (r.status === 'differs' ? r.diff : r.bTax), 0);
        return `<tr data-g="${esc(g)}"><td><input data-v="n" value="${esc(v.n || l[0].name || '')}" placeholder="Name" style="width:170px"><br><span class="sub n">${esc(g)}</span></td>
          <td><input data-v="ph" value="${esc(v.ph || '')}" inputmode="tel" style="width:120px"></td><td><input data-v="em" value="${esc(v.em || '')}" type="email" style="width:170px"></td>
          <td class="n">${l.length}</td><td class="n">${inr(t)}</td><td style="white-space:nowrap"><button class="btn small" data-wa>WhatsApp</button> <button class="btn ghost small" data-em>Email</button> <button class="btn ghost small" data-cp>Copy</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
    qa('#g-vendors tr[data-g]').forEach(tr => {
      const g = tr.dataset.g, save = () => { const V2 = get('ca.vendors', {}); V2[g] = Object.assign(V2[g] || {}, Object.fromEntries(qa('[data-v]', tr).map(i => [i.dataset.v, i.value.trim()]))); put('ca.vendors', V2); Object.assign(V, V2); };
      qa('[data-v]', tr).forEach(i => i.onchange = save);
      tr.querySelector('[data-wa]').onclick = () => { save(); window.open(wa((V[g] || {}).ph, msg(g, by[g])), '_blank'); };
      tr.querySelector('[data-em]').onclick = () => { save(); location.href = 'mailto:' + encodeURIComponent((V[g] || {}).em || '') + '?subject=' + encodeURIComponent('Invoices missing in GSTR-2B' + (per() ? ' - ' + per() : '')) + '&body=' + encodeURIComponent(msg(g, by[g])); };
      tr.querySelector('[data-cp]').onclick = () => { navigator.clipboard.writeText(msg(g, by[g])).then(() => APP.toast('Copied'), () => APP.toast('Copy failed')); };
    });
  }

  /* ---------- loading UI ---------- */
  function fileList(kind) {
    const el = q('#gs-' + (kind === 'g2b' ? '2b' : kind === 'g2a' ? '2a' : kind)), mp = q('#gm-' + (kind === 'g2b' ? '2b' : kind === 'g2a' ? '2a' : kind));
    const list = P[kind];
    if (!list.length) { el.textContent = 'No file loaded.'; if (mp) mp.innerHTML = ''; return; }
    el.innerHTML = list.map(f => `${APP.esc(f.name)}: ${f.items ? f.items.length + ' documents (portal JSON)' : f.d.rows.length + ' rows'}${f.miss ? ` <span class="err">Choose the ${f.miss} column under Column mapping.</span>` : ''}`).join('<br>');
    if (mp) {
      mp.innerHTML = ''; mp.style.display = 'block';
      list.forEach(f => { if (f.items) return; const w = document.createElement('div'); w.innerHTML = `<p class="group-t">${APP.esc(f.name)}</p><div class="maps"></div>`; mp.appendChild(w); renderMap(w.querySelector('.maps'), f.d, kind === 'ims' ? IMS_FIELDS() : FIELDS(), () => { check(f, kind); fileList(kind); gstRun(); }); });
    }
  }
  function check(f, kind) {
    if (f.items) { f.miss = ''; return; }
    const need = kind === 'ims' ? ['gstin', 'inv', 'action'] : ['gstin', 'inv'];
    const fl = kind === 'ims' ? IMS_FIELDS() : FIELDS();
    f.miss = need.filter(k => f.d.map[k] < 0).map(k => fl.find(x => x.key === k).label).join(' and ');
  }
  async function load(kind, files) {
    P[kind] = [];
    for (const file of files) {
      try {
        const r = await readAny(file);
        if (r.json) { P[kind].push({ name: file.name, items: fromJson(r.json) }); continue; }
        r.sheets.forEach(s => { const f = { name: file.name + (r.sheets.length > 1 || s.sheet !== 'Sheet1' ? ' / ' + s.sheet : ''), d: table(s.rows, kind === 'ims' ? IMS_FIELDS() : FIELDS()), credit: s.credit }; check(f, kind); P[kind].push(f); });
      } catch (e) { APP.toast('Could not read ' + file.name); }
    }
    G.books = P.books.length ? {} : null; G.g2b = P.g2b.length ? {} : null;
    fileList(kind); gstRun();
  }

  document.addEventListener('app:start', () => {
    ST.fuzzy = ['Probable match', 'warn'];
    window.reconcile = reconcilePlus;
    window.gstRender = render;
    // original sample loader and file inputs now go through the multi-file store
    window.gstLoaded = (kind, rows2d, name) => { const f = { name, d: table(rows2d, FIELDS()) }; check(f, kind); P[kind] = [f]; G.books = P.books.length ? {} : null; G.g2b = P.g2b.length ? {} : null; fileList(kind); gstRun(); };
    q('#gf-books').onchange = e => load('books', [...e.target.files]);
    const g2 = q('#gf-2b'); g2.onchange = e => load('g2b', [...e.target.files]); g2.accept = '.xlsx,.xls,.csv,.json';
    q('#gs-2b').closest('.panel').querySelector('h3').textContent = 'GSTR-2B (one or more months, Excel or JSON)';
    // extra inputs: 2A and IMS, client and period for follow-ups
    const grid = q('#gf-books').closest('.grid');
    grid.insertAdjacentHTML('beforeend', `<div class="panel stack"><h3>GSTR-2A (optional)</h3><input type="file" id="gf-2a" multiple accept=".xlsx,.xls,.csv,.json" aria-label="GSTR-2A file"><div id="gs-2a" class="note">Optional. Shows which missing invoices the supplier has filed late.</div><details><summary>Column mapping</summary><div id="gm-2a"></div></details></div>
      <div class="panel stack"><h3>IMS (optional)</h3><input type="file" id="gf-ims" multiple accept=".xlsx,.xls,.csv" aria-label="IMS file"><div id="gs-ims" class="note">Optional. The Invoice Management System download, to show accepted, rejected and pending invoices.</div><details><summary>Column mapping</summary><div id="gm-ims"></div></details></div>`);
    q('#gf-2a').onchange = e => load('g2a', [...e.target.files]);
    q('#gf-ims').onchange = e => load('ims', [...e.target.files]);
    q('#g-tol').closest('.row').insertAdjacentHTML('afterbegin', '<label class="fld">Client (for supplier messages)<input id="g-cl" list="as-cl" style="width:200px"></label><label class="fld">Period<input id="g-per" placeholder="Oct 2026" style="width:110px"></label>');
    const hint = q('#tab-gst > p.hint'); if (hint) hint.textContent = 'Load the purchase register and GSTR-2B (several months at once if you like, Excel, CSV or the portal JSON). Exact matches come first, then probable matches for invoice-number typos, wrong GSTINs and same-amount invoices, which you confirm once and the tool remembers. Add 2A and IMS files to see late filers and IMS actions.';
    // richer Excel export
    q('#g-export').onclick = () => {
      const R = G.rows, data = R.map(r => ({ Status: ST[r.status][0], GSTIN: r.gstin, Supplier: r.name, Invoice: r.inv, '2B invoice': r.gInv, Date: APP.fmtD(r.date), 'Books taxable': r.bTaxable, 'Books tax': r.bTax, '2B taxable': r.gTaxable, '2B tax': r.gTax, Difference: r.diff, IMS: r.ims, 'In 2A': r.in2a ? 'Yes' : '', Note: r.why }));
      const by = {}; R.filter(r => r.status === 'notin2b' || r.status === 'differs').forEach(r => { const e = by[r.gstin] = by[r.gstin] || { GSTIN: r.gstin, Supplier: r.name, Invoices: 0, 'Tax at stake': 0 }; e.Invoices++; e['Tax at stake'] += r.status === 'differs' ? r.diff : r.bTax; });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Reconciliation');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(by).length ? Object.values(by) : [{ Note: 'No supplier issues' }]), 'Supplier follow-up');
      APP.saveFile('GSTR-2B-reconciliation.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    };
  });
  window.GSTPLUS = { reconcile: reconcilePlus, table, fromJson, rows: () => rowsCache };
})();
