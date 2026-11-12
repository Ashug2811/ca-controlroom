/* Merged navigation: tabs that do the same kind of work sit under one main tab,
   with small sub-tabs inside. The original sections keep their ids, so every
   tool works exactly as before; "More modules" is shared out to the right place. */
(function () {
  'use strict';
  const GROUPS = [
    { main: 'gst', subs: [['gst', 'Reconciliation'], ['gsttools', 'Returns and invoices']] },
    { main: 'bank', subs: [['bank', 'Bank to Tally'], ['books', 'Books and accounts']] },
    { main: 'tax', subs: [['tax', 'Calculators'], ['taxtools', 'TDS returns and computation']] },
    { main: 'tracker', subs: [['tracker', 'Tracker'], ['calendar', 'Due-date calendar']] },
    { main: 'clients', subs: [['clients', 'Client master'], ['inbox', 'Document inbox']] },
    { main: 'assign', subs: [['assign', 'Assignments and fees'], ['billing', 'Invoices and outstanding']] },
    { main: 'settings', subs: [['settings', 'Rates'], ['team', 'Team'], ['backup', 'Backup']] }
  ];
  // Where each "More modules" tool goes, by its heading.
  const MOVE = {
    'GSTR-3B draft': 'gsttools', 'GSTR-1 summary': 'gsttools', 'GST invoice generator': 'gsttools',
    'Portal JSON export': 'gsttools', 'GSTR-2B vs books: full-year summary': 'gsttools',
    'Bank reconciliation': 'books', 'Books checks': 'books', 'Depreciation': 'books',
    'Depreciation on sale of a block': 'books', 'Interest calculator': 'books',
    'Bulk TDS': 'taxtools', 'TDS deducted vs deposited': 'taxtools', 'Interest under 234A, 234B and 234C': 'taxtools',
    '26AS / AIS vs books (TDS)': 'taxtools', 'TDS return working (24Q / 26Q)': 'taxtools', 'Full income tax computation': 'taxtools',
    'Client reminder': 'calendar', 'Validators': 'clients', 'Number to words': 'billing'
  };
  const ARTICLE_HIDE = ['assign', 'billing', 'settings', 'backup'];
  const groupOf = t => GROUPS.find(g => g.subs.some(s => s[0] === t));
  const isArticle = () => window.Cloud && Cloud.role && Cloud.role() === 'article';
  const allowed = t => !(isArticle() && ARTICLE_HIDE.includes(t)) && !(t === 'inbox' && !(window.Cloud && Cloud.enabled));

  function moveModules() {
    const more = document.getElementById('tab-more');
    if (!more || more.dataset.split) return;
    more.dataset.split = '1';
    let dest = null;
    [...more.children].forEach(n => {
      if (n.tagName === 'H2') dest = MOVE[n.textContent.trim()] || null;
      if (!dest || n.dataset.m === undefined) return; // skips the old search bar
      n.hidden = false;
      document.getElementById('tab-' + dest).appendChild(n);
    });
  }

  function subBar(g, t) {
    const sec = document.getElementById('tab-' + t);
    let bar = sec.querySelector(':scope > .subtabs');
    const subs = g.subs.filter(s => allowed(s[0]));
    if (subs.length < 2) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'filters subtabs no-print'; sec.insertBefore(bar, sec.firstChild); }
    bar.innerHTML = subs.map(s => `<button data-sub="${s[0]}" aria-pressed="${s[0] === t}">${s[1]}</button>`).join('');
    bar.querySelectorAll('button').forEach(b => b.onclick = () => { location.hash = b.dataset.sub; });
  }

  document.addEventListener('app:start', () => {
    moveModules();
    const css = document.createElement('style');
    css.textContent = '.subtabs{margin:-6px 0 18px}.subtabs button{font-weight:600}';
    document.head.appendChild(css);
  });

  document.addEventListener('app:tab', e => {
    const t = e.detail;
    if (t === 'more') { location.hash = 'gsttools'; return; }
    if (!allowed(t)) { location.hash = 'home'; return; }
    const g = groupOf(t);
    const main = g ? g.main : t;
    document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === main));
    if (g) subBar(g, t);
  });
  // An old link to "More modules" opens the GST tools instead.
  window.addEventListener('hashchange', () => { if (location.hash === '#more') location.hash = 'gsttools'; });
})();
