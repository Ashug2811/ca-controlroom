/* Smarter Bank to Tally (adds to the original tool):
   - Reads PDF bank statements (text PDFs, including password-protected ones).
   - Learns ledgers: when you correct a row, the party is remembered for next time.
   - Your Tally ledger list: suggestions while typing, and a warning for any ledger
     Tally does not have (Tally rejects those vouchers on import).
   - Cash deposits and withdrawals become Contra vouchers; XML saves directly as .xml. */
(function () {
  'use strict';
  const q = s => document.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

  /* ---------- learning ---------- */
  const STOP = new Set('NEFT RTGS IMPS UPI MB IB TRF TRANSFER BY TO FROM PAYMENT PAYMT PMT RCVD RECEIVED REF INV INVOICE CR DR CHQ CHEQUE CLG ACH NACH ECS INF INFT POS FT NA THE OF FOR AC A/C SBIN HDFC ICIC UTIB KKBK PUNB BARB CNRB YESB IDIB UBIN MAH BKID IOBA INDB FDRL KARB CBIN JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' '));
  function sig(narr) {
    const words = String(narr || '').toUpperCase().replace(/[A-Z0-9._-]+@[A-Z]+/g, ' ').split(/[^A-Z&]+/).filter(w => w.length >= 3 && !STOP.has(w));
    return words.slice(0, 3).join(' ');
  }
  function learned(narr) {
    const L = get('ca.banklearn', {}), s = sig(narr);
    if (s && L[s]) return L[s];
    const up = String(narr || '').toUpperCase();
    let best = '', bl = 0;
    Object.keys(L).forEach(k => { if (k.length >= 6 && k.length > bl && up.includes(k)) { best = L[k]; bl = k.length; } });
    return best;
  }
  function learn(narr, ledger) {
    const s = sig(narr); if (!s || !ledger) return;
    const sp = [val('b-sp'), val('b-sr')].map(x => x.trim().toLowerCase());
    if (sp.includes(ledger.trim().toLowerCase())) return;
    const L = get('ca.banklearn', {}); if (L[s] === ledger) return; L[s] = ledger; put('ca.banklearn', L);
  }

  /* ---------- Tally ledger list ---------- */
  const ledgers = () => get('ca.ledgers', []);
  const known = n => { const L = ledgers(); return !L.length || L.some(x => x.toLowerCase() === String(n || '').trim().toLowerCase()); };
  function parseLedgers(text) {
    const out = new Set();
    const xml = text.match(/<LEDGER\s+NAME="([^"]+)"/gi);
    if (xml) xml.forEach(m => out.add(m.replace(/<LEDGER\s+NAME="/i, '').replace(/"$/, '').replace(/&amp;/g, '&').trim()));
    else text.split(/\r?\n/).forEach(l => { const n = l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0].replace(/^"|"$/g, '').trim(); if (n && !/^(particulars|name|ledger|list of)/i.test(n)) out.add(n); });
    return [...out];
  }

  /* ---------- PDF statements ---------- */
  let pdfReady = null;
  function loadPdfJs() {
    if (pdfReady) return pdfReady;
    pdfReady = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'lib/pdf.min.js'; s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'; res(); }; s.onerror = rej; document.head.appendChild(s); });
    return pdfReady;
  }
  const DATE_RE = /^(\d{1,2}[\/\-.](\d{1,2}|[A-Za-z]{3})[\/\-.]\d{2,4}|\d{1,2}\s[A-Za-z]{3}\s\d{2,4})$/;
  const AMT_RE = /^-?[\d,]*\d\.\d{2}(\s*(cr|dr))?$/i;
  const amt = s => parseFloat(String(s).replace(/[,\s]|cr|dr/gi, '')) || 0;
  async function pdfRows(file) {
    await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjsLib.getDocument({ data });
    task.onPassword = (cb, reason) => { const p = prompt(reason === 2 ? 'Wrong password. Try again:' : 'This statement is password protected. Enter the password (often your customer ID or date of birth):'); if (p == null) task.destroy(); else cb(p); };
    const doc = await task.promise, lines = [];
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const tc = await (await doc.getPage(pn)).getTextContent(), byY = [];
      tc.items.forEach(it => { const s = it.str.trim(); if (!s) return; const y = it.transform[5], x = it.transform[4]; let L = byY.find(l => Math.abs(l.y - y) < 3); if (!L) { L = { y, items: [] }; byY.push(L); } L.items.push({ x, s }); });
      byY.sort((a, b) => b.y - a.y).forEach(l => { l.items.sort((a, b) => a.x - b.x); lines.push(l.items); });
    }
    // column positions from the header line, if any
    let xDr = null, xCr = null, opening = null;
    for (const l of lines) {
      const t = l.map(i => i.s).join(' ');
      if (xDr == null && /withdraw|debit/i.test(t) && /deposit|credit/i.test(t)) { l.forEach(i => { if (/withdraw|debit/i.test(i.s)) xDr = i.x; if (/deposit|credit/i.test(i.s)) xCr = i.x; }); }
      if (opening == null && /opening\s*balance/i.test(t)) { const a = l.filter(i => AMT_RE.test(i.s)); if (a.length) opening = amt(a[a.length - 1].s) * (/dr/i.test(a[a.length - 1].s) ? -1 : 1); }
    }
    const tx = []; let prevBal = opening;
    for (const l of lines) {
      // split items that pdf.js joined, e.g. "01/11/2026 NEFT-..."
      const parts = []; l.forEach(i => { const m = i.s.match(/^(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s+(.*)$/); if (m) { parts.push({ x: i.x, s: m[1] }, { x: i.x + 1, s: m[2] }); } else parts.push(i); });
      const first = parts[0] && parts[0].s;
      const amts = parts.filter(i => AMT_RE.test(i.s));
      if (first && DATE_RE.test(first) && amts.length >= 1) {
        const bal = amts.length >= 2 ? amts[amts.length - 1] : null, a = amts.length >= 2 ? amts[amts.length - 2] : amts[0];
        const v = amt(a.s); let isDr = null;
        const b = bal ? amt(bal.s) * (/dr\s*$/i.test(bal.s) ? -1 : 1) : null;
        if (prevBal != null && b != null) { if (Math.abs(prevBal - v - b) < 0.02) isDr = true; else if (Math.abs(prevBal + v - b) < 0.02) isDr = false; }
        if (isDr == null && xDr != null && xCr != null) isDr = Math.abs(a.x - xDr) < Math.abs(a.x - xCr);
        if (isDr == null && /dr\s*$/i.test(a.s)) isDr = true; else if (isDr == null && /cr\s*$/i.test(a.s)) isDr = false;
        if (isDr == null) isDr = true;
        const narr = parts.slice(1).filter(i => !AMT_RE.test(i.s) && !DATE_RE.test(i.s)).map(i => i.s).join(' ');
        tx.push([first, narr, '', isDr ? v : '', isDr ? '' : v, b == null ? '' : b]);
        if (b != null) prevBal = b;
      } else if (tx.length && !amts.length && parts.length && !/page\s*\d|balance|statement|total/i.test(parts.map(i => i.s).join(' '))) {
        const last = tx[tx.length - 1]; if (last[1].length < 160) last[1] = (last[1] + ' ' + parts.map(i => i.s).join(' ')).trim();
      }
    }
    return [['Date', 'Narration', 'Ref', 'Withdrawal', 'Deposit', 'Balance'], ...tx];
  }

  /* ---------- Tally XML with Contra for cash ---------- */
  function tallyXmlPlus(txns, bank, company) {
    const xesc2 = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
    const ymd2 = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const vs = txns.filter(t => t.date && (t.dr > 0 || t.cr > 0)).map(t => {
      const pay = t.dr > 0, a = (pay ? t.dr : t.cr).toFixed(2), party = t.ledger || 'Suspense A/c';
      const type = /^cash(\s|$|-)/i.test(party.trim()) || /^cash in hand$/i.test(party.trim()) ? 'Contra' : pay ? 'Payment' : 'Receipt';
      const e = (n, yes, v) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xesc2(n)}</LEDGERNAME><ISDEEMEDPOSITIVE>${yes ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${v}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
      return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${ymd2(t.date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><NARRATION>${xesc2((t.narr || '') + (t.ref ? ' | ' + t.ref : ''))}</NARRATION><EFFECTIVEDATE>${ymd2(t.date)}</EFFECTIVEDATE>${e(pay ? party : bank, true, '-' + a)}${e(pay ? bank : party, false, a)}</VOUCHER></TALLYMESSAGE>`;
    });
    const co = company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xesc2(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : '<STATICVARIABLES/>';
    return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${co}</REQUESTDESC><REQUESTDATA>\n${vs.join('\n')}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  }

  /* ---------- panels ---------- */
  function panels() {
    const L = get('ca.banklearn', {}), names = ledgers(), esc = APP.esc;
    q('#bp-led-n').textContent = names.length ? names.length + ' ledger names loaded.' : 'No ledger list yet: any name is accepted.';
    q('#bp-learn').innerHTML = Object.keys(L).length ? `<table><thead><tr><th>Party in narration</th><th>Ledger</th><th></th></tr></thead><tbody>${Object.entries(L).sort().map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}${known(v) ? '' : ' <span class="chip warn">not in Tally list</span>'}</td><td><button class="btn ghost small" data-forget="${esc(k)}">Forget</button></td></tr>`).join('')}</tbody></table>` : '<p class="note" style="margin:0 8px 8px">Nothing learned yet. Correct a ledger in the voucher list and it is remembered here.</p>';
    qa('#bp-learn [data-forget]').forEach(b => b.onclick = () => { const L2 = get('ca.banklearn', {}); delete L2[b.dataset.forget]; put('ca.banklearn', L2); panels(); });
    let dl = q('#bp-ledgers'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'bp-ledgers'; document.body.appendChild(dl); }
    const all = new Set([...names, ...Object.values(L), ...B.rules.map(r => r[1])]);
    dl.innerHTML = [...all].sort().map(n => `<option value="${esc(n)}">`).join('');
  }
  function enhance() {
    const out = q('#b-out'); if (!out || !B.txns.length) return;
    qa('input.led', out).forEach(inp => {
      inp.setAttribute('list', 'bp-ledgers');
      const t = B.txns[+inp.dataset.i];
      const mark = () => { inp.style.borderColor = known(inp.value) ? '' : 'var(--warn)'; inp.title = known(inp.value) ? '' : 'Not in your Tally ledger list: Tally will reject this voucher until the ledger exists.'; };
      mark();
      if (t.src === 'learned' && !t.manual) inp.insertAdjacentHTML('afterend', '<br><span class="chip mute" style="margin-top:3px">learned</span>');
      inp.addEventListener('input', mark);
      inp.addEventListener('change', () => { learn(t.narr, inp.value); panels(); });
    });
    const unknown = B.txns.filter(t => !known(t.ledger)).length;
    const note = out.querySelector('p.note');
    if (note) note.insertAdjacentHTML('beforebegin', unknown ? `<p class="note err">${unknown} voucher(s) use a ledger that is not in your Tally ledger list (orange boxes). Create those ledgers in Tally or correct them before importing.</p>` : '');
    const cash = B.txns.filter(t => /^cash/i.test(String(t.ledger).trim())).length;
    if (cash && note) note.insertAdjacentHTML('beforebegin', `<p class="note">${cash} cash deposit / withdrawal(s) will import as Contra vouchers.</p>`);
    const sv = q('#b-save'); if (sv) { sv.textContent = 'Save Tally XML file'; sv.onclick = () => APP.saveFile('tally-vouchers.xml', tallyXmlPlus(B.txns, val('b-bank').trim() || 'Bank', val('b-comp').trim())); }
    if (note) note.textContent = 'Every ledger named above must already exist in Tally, or the voucher is rejected on import. In Tally: Gateway of Tally, Import Data, Vouchers, and pick the saved .xml file.';
  }

  document.addEventListener('app:start', () => {
    window.tallyXml = tallyXmlPlus;
    window.bankRules = function () {
      B.txns.forEach(t => { if (!t.manual) { const l = learned(t.narr); t.src = l ? 'learned' : ''; t.ledger = l || applyRule(t.narr, B.rules) || (t.dr > 0 ? val('b-sp') : val('b-sr')); } });
      bankRender();
    };
    const origRender = window.bankRender;
    window.bankRender = function () { origRender(); enhance(); };
    // PDF input
    const bf = q('#bf'); bf.accept = '.xlsx,.xls,.csv,.pdf';
    bf.onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        if (/\.pdf$/i.test(f.name)) {
          q('#bs').textContent = 'Reading ' + f.name + '...';
          const rows = await pdfRows(f);
          if (rows.length < 2) { q('#bs').innerHTML = '<span class="err">No transactions found in this PDF. Scanned (photo) PDFs cannot be read; download the statement as Excel or a text PDF from net banking.</span>'; return; }
          bankLoaded(rows, f.name);
          const T = B.txns, last = rows[rows.length - 1][5];
          q('#bs').insertAdjacentHTML('beforeend', ` Read from PDF: check the count and totals against the statement${last !== '' ? ' (closing balance per PDF ₹' + inr(+last) + ')' : ''}.`);
        } else bankLoaded(await readRows(f), f.name);
      } catch (x) { q('#bs').innerHTML = '<span class="err">Could not read that file' + (x && x.name === 'PasswordException' ? ': password needed' : '') + '.</span>'; }
    };
    q('#bs').closest('.panel').querySelector('h3').textContent = 'Statement (Excel, CSV or PDF)';
    q('#tab-bank > p.hint').textContent = 'Upload a bank statement as Excel, CSV or PDF. Each narration gets a ledger from what the tool has learned from your past corrections, then from your keyword rules. Correct any row and it is remembered for next time. Withdrawals become Payment vouchers, deposits Receipt vouchers, and cash entries Contra vouchers.';
    q('#r-list').closest('.panel').insertAdjacentHTML('afterend', `
      <h3 style="margin-top:22px">Your Tally ledgers</h3>
      <p class="hint" style="margin-bottom:8px">Load your ledger names once so the tool can suggest them and warn about names Tally does not have. In Tally: Gateway of Tally, Display More Reports, List of Accounts, then export (Alt+E) as Excel or XML. Or paste names, one per line.</p>
      <div class="panel stack"><div class="row"><label class="fld">Ledger list file<input type="file" id="bp-led-f" accept=".xml,.xlsx,.xls,.csv,.txt"></label><button class="btn ghost" id="bp-led-clear">Clear list</button></div>
        <details><summary>Paste names instead</summary><textarea id="bp-led-t" rows="5" style="width:100%;margin-top:8px" placeholder="Bank Charges&#10;Salary&#10;Acme Supplies"></textarea><button class="btn small" id="bp-led-add" style="margin-top:6px">Add these names</button></details>
        <p class="note" id="bp-led-n" style="margin:0"></p></div>
      <h3 style="margin-top:22px">Learned from your corrections</h3>
      <div id="bp-learn" class="tw"></div>`);
    const addNames = list => { const s = new Set(ledgers()); list.forEach(n => s.add(n)); put('ca.ledgers', [...s].sort()); panels(); bankRender(); APP.toast(list.length + ' ledger names added'); };
    q('#bp-led-f').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      if (/\.(xml|txt|csv)$/i.test(f.name)) addNames(parseLedgers(await f.text()));
      else { const rows = await readRows(f); addNames(rows.map(r => String(r[0] || '').trim()).filter(n => n && !/^(particulars|name|ledger|list of|total)/i.test(n))); }
    };
    q('#bp-led-add').onclick = () => addNames(parseLedgers(q('#bp-led-t').value));
    q('#bp-led-clear').onclick = () => { put('ca.ledgers', []); panels(); bankRender(); };
    panels();
  });
  window.BANKPLUS = { sig, learned, pdfRows, tallyXml: tallyXmlPlus, parseLedgers };
})();
