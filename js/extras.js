/* Extra due dates (ROC, LLP, composition, professional tax and more) added to the
   Compliance tracker's list, plus the "for which period" and "documents needed"
   details the calendar uses in reminders. Dates are standard statutory dates;
   extensions notified by CBDT, CBIC or MCA are not applied automatically. */
(function () {
  'use strict';
  const D = (y, m, d) => new Date(y, m, d);
  const EXTRA = [
    { id: 'gstr7', grp: 'GST', label: 'GSTR-7 (TDS under GST)', due: (y, m) => D(y, m, 10) },
    { id: 'cmp08', grp: 'GST', label: 'CMP-08 (composition, quarterly)', due: (y, m) => [0, 3, 6, 9].includes(m) ? D(y, m, 18) : null },
    { id: 'gstr4', grp: 'GST', label: 'GSTR-4 (composition annual)', due: (y, m) => m === 3 ? D(y, 3, 30) : null },
    { id: 'gstr9c', grp: 'GST', label: 'GSTR-9C reconciliation', due: (y, m) => m === 11 ? D(y, 11, 31) : null },
    { id: 'ptax', grp: 'Payroll', label: 'Professional tax payment (Karnataka)', due: (y, m) => D(y, m, 20) },
    { id: 'itrtp', grp: 'Income tax', label: 'ITR (transfer pricing cases)', due: (y, m) => m === 10 ? D(y, 10, 30) : null },
    { id: 'f3ceb', grp: 'Income tax', label: 'Form 3CEB', due: (y, m) => m === 9 ? D(y, 9, 31) : null },
    { id: 'itrrev', grp: 'Income tax', label: 'Belated / revised ITR', due: (y, m) => m === 11 ? D(y, 11, 31) : null },
    { id: 'sft', grp: 'Income tax', label: 'SFT (Form 61A)', due: (y, m) => m === 4 ? D(y, 4, 31) : null },
    { id: 'aoc4', grp: 'ROC', label: 'AOC-4 financial statements (company)', due: (y, m) => m === 9 ? D(y, 9, 29) : null },
    { id: 'mgt7', grp: 'ROC', label: 'MGT-7 / 7A annual return (company)', due: (y, m) => m === 10 ? D(y, 10, 29) : null },
    { id: 'adt1', grp: 'ROC', label: 'ADT-1 auditor appointment', due: (y, m) => m === 9 ? D(y, 9, 14) : null },
    { id: 'dir3', grp: 'ROC', label: 'DIR-3 KYC (directors)', due: (y, m) => m === 8 ? D(y, 8, 30) : null },
    { id: 'dpt3', grp: 'ROC', label: 'DPT-3 return of deposits', due: (y, m) => m === 5 ? D(y, 5, 30) : null },
    { id: 'msme1', grp: 'ROC', label: 'MSME-1 half-yearly', due: (y, m) => m === 3 ? D(y, 3, 30) : m === 9 ? D(y, 9, 31) : null },
    { id: 'llp11', grp: 'ROC', label: 'LLP Form 11 annual return', due: (y, m) => m === 4 ? D(y, 4, 30) : null },
    { id: 'llp8', grp: 'ROC', label: 'LLP Form 8 accounts', due: (y, m) => m === 9 ? D(y, 9, 30) : null }
  ];

  // Which period a filing due in month m (0-11) of year y is for.
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fyOf = (y, m) => (m >= 3 ? y : y - 1);
  const fyTxt = s => 'FY ' + s + '-' + String(s + 1).slice(2);
  const PERIOD = {
    prevm: (y, m) => { const d = new Date(y, m - 1, 1); return MN[d.getMonth()] + ' ' + d.getFullYear(); },
    prevq: (y, m) => { const d = new Date(y, m - 1, 1), q = Math.floor(((d.getMonth() + 9) % 12) / 3) + 1; return 'Q' + q + ' ' + fyTxt(fyOf(d.getFullYear(), d.getMonth())); },
    prevfy: (y, m) => fyTxt(fyOf(y, m) - 1),
    curfy: (y, m) => fyTxt(fyOf(y, m)),
    halfyear: (y, m) => m === 3 ? 'Oct-Mar' : 'Apr-Sep'
  };
  const PTYPE = { gstr1q: 'prevq', gstr3bq: 'prevq', cmp08: 'prevq', tdsret: 'prevq', tdscert: 'prevq', advtax: 'curfy', dir3: 'curfy',
    gstr9: 'prevfy', gstr9c: 'prevfy', gstr4: 'prevfy', taxaudit: 'prevfy', itrnon: 'prevfy', itraud: 'prevfy', itrtp: 'prevfy', f3ceb: 'prevfy',
    itrrev: 'prevfy', sft: 'prevfy', aoc4: 'prevfy', mgt7: 'prevfy', adt1: 'curfy', dpt3: 'prevfy', llp11: 'prevfy', llp8: 'prevfy', msme1: 'halfyear' };
  const DOCS = {
    GST: 'sales and purchase invoices, credit and debit notes',
    TDS: 'details of payments made, with PAN of each party',
    Payroll: 'salary register and attendance for the month',
    'Income tax': 'bank statements, Form 16 / 26AS, investment proofs and books of account',
    ROC: 'signed financial statements, board resolutions and director details'
  };

  window.CA_EXTRA = {
    period(comp, y, m) { const t = PTYPE[comp.id] || 'prevm'; return PERIOD[t](y, m); },
    docs(comp) { return DOCS[comp.grp] || 'the related documents'; }
  };

  document.addEventListener('app:start', () => {
    const C = APP.COMPS;
    EXTRA.forEach(x => { if (!C.some(c => c.id === x.id)) C.push(x); });
    const order = ['GST', 'TDS', 'Payroll', 'Income tax', 'ROC'];
    C.sort((a, b) => order.indexOf(a.grp) - order.indexOf(b.grp));
    APP.trCheckboxes([]); APP.trRender();
    const rf = document.getElementById('rm-f');
    if (rf) rf.innerHTML = C.map(c => '<option>' + APP.esc(c.label) + '</option>').join('');
  });
})();
