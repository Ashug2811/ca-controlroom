/* Cloud layer: login, firm membership, and saving the tool's data online.
   The original tools keep reading and writing localStorage keys that start with "ca.".
   This file loads those keys from Supabase after login, starts the tools, and copies
   every later save back to Supabase (with an offline queue). */
(function () {
  'use strict';
  const cfg = window.CA_CONFIG || {};
  const LOCAL_ONLY = /^ca\.(theme|pin|key|mid|t0)$/;      // device preferences, never synced
  const LABELS = { 'ca.clients': 'tracker clients', 'ca.status': 'tracker ticks', 'ca.cm': 'Client master',
    'ca.as': 'Assignments and fees', 'ca.rates': 'Rates and settings', 'ca.rules': 'bank ledger rules',
    'ca.calassign': 'calendar assignments', 'ca.caltpl': 'message templates', 'ca.firm': 'firm details', 'ca.vendors': 'supplier contacts', 'ca.gstmatch': 'GST matches', 'ca.banklearn': 'learned ledgers', 'ca.ledgers': 'Tally ledger list', 'ca.workrate': 'hourly rates' };
  const ls = window.localStorage;
  const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const $ = s => document.querySelector(s);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const Cloud = window.Cloud = { enabled: false, sb: null, user: null, me: null, members: [], firm: null, firmName: cfg.firmName || '' };

  /* ---------- small event bus the add-on modules use ---------- */
  window.afterAppStart = () => document.dispatchEvent(new Event('app:start'));
  window.onTabShown = t => document.dispatchEvent(new CustomEvent('app:tab', { detail: t }));

  /* ---------- the login screen ---------- */
  let gate;
  function showGate(html) { gate = gate || $('#gate'); gate.innerHTML = '<div class="gate-card"><p class="brand">CA ControlRoom</p>' + html + '</div>'; gate.hidden = false; document.body.classList.add('gated'); }
  function hideGate() { gate = gate || $('#gate'); gate.hidden = true; gate.innerHTML = ''; document.body.classList.remove('gated'); }
  function gateMsg(t, bad) { const m = $('#gate').querySelector('.gate-msg'); if (m) { m.textContent = t; m.className = 'gate-msg' + (bad ? ' err' : ''); } }

  function loginForm(mode) {
    const signup = mode === 'signup';
    showGate(`<h1>${signup ? 'Create your login' : 'Sign in'}</h1>
      <p class="sub">${signup ? 'Use the same email your partner invited. The first person to sign up sets up the firm.' : 'CA ControlRoom for your whole team.'}</p>
      <form id="g-form" class="stack" style="margin-top:14px">
        ${signup ? '<label class="fld">Your name<input id="g-name" autocomplete="name" required></label>' : ''}
        <label class="fld">Email<input id="g-email" type="email" autocomplete="email" required></label>
        <label class="fld">Password<input id="g-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label>
        <button class="btn" type="submit">${signup ? 'Create login' : 'Sign in'}</button>
        <p class="gate-msg" role="status"></p>
      </form>
      <p class="sub" style="margin-top:6px">${signup ? 'Already have a login? <a href="#" id="g-alt">Sign in</a>' : 'New here? <a href="#" id="g-alt">Create a login</a> &middot; <a href="#" id="g-forgot">Forgot password</a>'}</p>`);
    $('#g-alt').onclick = e => { e.preventDefault(); loginForm(signup ? 'signin' : 'signup'); };
    const fg = $('#g-forgot');
    if (fg) fg.onclick = async e => {
      e.preventDefault(); const em = $('#g-email').value.trim(); if (!em) { gateMsg('Type your email first, then press Forgot password.', true); return; }
      const { error } = await Cloud.sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
      gateMsg(error ? error.message : 'A reset link is on its way to ' + em + '.', !!error);
    };
    $('#g-form').onsubmit = async e => {
      e.preventDefault();
      const email = $('#g-email').value.trim(), password = $('#g-pass').value;
      gateMsg(signup ? 'Creating your login...' : 'Signing in...');
      let r;
      if (signup) {
        r = await Cloud.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname, data: { name: $('#g-name').value.trim() } } });
        if (!r.error && !r.data.session) { gateMsg('Check your email and click the confirmation link, then sign in.'); return; }
      } else r = await Cloud.sb.auth.signInWithPassword({ email, password });
      if (r.error) { gateMsg(friendly(r.error.message), true); return; }
      afterLogin(r.data.session);
    };
    setTimeout(() => (signup ? $('#g-name') : $('#g-email')).focus(), 30);
  }
  function friendly(m) {
    if (/invalid login/i.test(m)) return 'That email and password do not match. Try again or use Forgot password.';
    if (/already registered/i.test(m)) return 'This email already has a login. Use Sign in.';
    if (/fetch|network/i.test(m)) return 'Cannot reach the server. Check the internet connection.';
    return m;
  }

  function resetForm() {
    showGate(`<h1>Set a new password</h1><form id="g-form" class="stack" style="margin-top:14px">
      <label class="fld">New password<input id="g-pass" type="password" minlength="6" autocomplete="new-password" required></label>
      <button class="btn" type="submit">Save password</button><p class="gate-msg" role="status"></p></form>`);
    $('#g-form').onsubmit = async e => {
      e.preventDefault(); const { error } = await Cloud.sb.auth.updateUser({ password: $('#g-pass').value });
      if (error) { gateMsg(error.message, true); return; }
      const { data } = await Cloud.sb.auth.getSession(); afterLogin(data.session);
    };
  }

  /* ---------- after login: find the firm ---------- */
  async function afterLogin(session) {
    Cloud.user = session.user;
    showGate('<p class="sub">Opening your desk...</p>');
    let me = null, offline = false;
    try {
      await Cloud.sb.rpc('join_invite');
      const r = await Cloud.sb.from('members').select('*').eq('user_id', session.user.id).maybeSingle();
      if (r.error) throw r.error;
      me = r.data;
    } catch (e) {
      offline = true;
      try { me = JSON.parse(ls.getItem('cloud.me') || 'null'); } catch (x) { me = null; }
      if (!me || me.user_id !== session.user.id) { showGate('<h1>No connection</h1><p class="sub">Cannot reach the server. Check the internet connection and reload.</p>'); return; }
    }
    if (!me) return noFirm(session);
    Cloud.me = me; Cloud.firm = me.firm_id;
    rawSet.call(ls, 'cloud.me', JSON.stringify(me));
    if (!offline) {
      const f = await Cloud.sb.from('firms').select('name').eq('id', me.firm_id).maybeSingle();
      if (f.data && f.data.name) Cloud.firmName = f.data.name;
      await Cloud.refreshMembers();
    }
    await loadData(offline);
    if (window.Store) { try { await Store.init(); } catch (e) { console.error(e); } }
    hideGate();
    startApp();
    subscribeLive();
  }

  async function noFirm(session) {
    const { data: exists, error } = await Cloud.sb.rpc('firm_exists');
    if (error) { showGate('<h1>Setup needed</h1><p class="sub">The database is not set up yet. Run supabase/schema.sql in the Supabase SQL editor (see SETUP.md), then reload.</p><p class="err">' + h(error.message) + '</p>'); return; }
    if (exists) {
      showGate(`<h1>Waiting for an invite</h1><p class="sub">You are signed in as <b>${h(session.user.email)}</b>, but no partner has added this email to the firm yet. Ask a partner to add you on the Team tab, then reload this page.</p>
        <div class="row" style="margin-top:14px"><button class="btn" onclick="location.reload()">Reload</button><button class="btn ghost" id="g-out">Sign out</button></div>`);
      $('#g-out').onclick = signOut; return;
    }
    showGate(`<h1>Set up your firm</h1><p class="sub">You are the first person here, so you will be the partner. You can invite the rest of the team next.</p>
      <form id="g-form" class="stack" style="margin-top:14px">
        <label class="fld">Firm name<input id="g-firm" value="${h(cfg.firmName || '')}" required></label>
        <label class="fld">Your name<input id="g-name" value="${h((session.user.user_metadata || {}).name || '')}" required></label>
        <button class="btn" type="submit">Create firm</button><p class="gate-msg" role="status"></p></form>`);
    $('#g-form').onsubmit = async e => {
      e.preventDefault();
      const { error } = await Cloud.sb.rpc('create_firm', { firm_name: $('#g-firm').value.trim(), my_name: $('#g-name').value.trim() });
      if (error) { gateMsg(error.message, true); return; }
      afterLogin(session);
    };
  }

  Cloud.refreshMembers = async function () {
    if (!Cloud.enabled || !Cloud.firm) return Cloud.members;
    const r = await Cloud.sb.from('members').select('*').eq('firm_id', Cloud.firm).order('name');
    if (!r.error) Cloud.members = r.data || [];
    return Cloud.members;
  };

  async function signOut() {
    await flush();
    try { await Cloud.sb.auth.signOut(); } catch (e) { }
    wipeLocal(); rawRemove.call(ls, 'cloud.me'); rawRemove.call(ls, 'cloud.owner');
    location.reload();
  }

  /* ---------- data sync ---------- */
  let pending = {};
  try { pending = JSON.parse(ls.getItem('cloud.pending') || '{}'); } catch (e) { pending = {}; }
  const savePending = () => rawSet.call(ls, 'cloud.pending', JSON.stringify(pending));
  const syncable = k => typeof k === 'string' && k.startsWith('ca.') && !LOCAL_ONLY.test(k);

  function wipeLocal() {
    const ks = []; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (syncable(k)) ks.push(k); }
    ks.forEach(k => rawRemove.call(ls, k));
  }

  async function loadData(offline) {
    const owner = Cloud.firm + ':' + Cloud.user.id;
    if (ls.getItem('cloud.owner') !== owner) { wipeLocal(); pending = {}; savePending(); }
    rawSet.call(ls, 'cloud.owner', owner);
    if (offline) { setSync('offline'); return; }
    const r = await Cloud.sb.from('kv').select('key,value').eq('firm_id', Cloud.firm);
    if (r.error) { setSync('offline'); return; }
    wipeLocal();
    (r.data || []).forEach(row => rawSet.call(ls, row.key, row.value));
    // Saves made while offline win over what is online.
    Object.entries(pending).forEach(([k, v]) => v === null ? rawRemove.call(ls, k) : rawSet.call(ls, k, v));
  }

  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === ls && Cloud.enabled && Cloud.firm && syncable(k)) { pending[k] = String(v); savePending(); queueFlush(); }
  };
  Storage.prototype.removeItem = function (k) {
    rawRemove.call(this, k);
    if (this === ls && Cloud.enabled && Cloud.firm && syncable(k)) { pending[k] = null; savePending(); queueFlush(); }
  };

  let flushT = null, flushing = null;
  function queueFlush() { setSync('saving'); clearTimeout(flushT); flushT = setTimeout(flush, 700); }
  async function flush() {
    clearTimeout(flushT);
    if (flushing) { await flushing; }
    const batch = Object.entries(pending); if (!batch.length) { setSync('saved'); return; }
    flushing = (async () => {
      const ups = batch.filter(([, v]) => v !== null).map(([key, value]) => ({ firm_id: Cloud.firm, key, value }));
      const dels = batch.filter(([, v]) => v === null).map(([k]) => k);
      try {
        if (ups.length) { const r = await Cloud.sb.from('kv').upsert(ups, { onConflict: 'firm_id,key' }); if (r.error) throw r.error; }
        if (dels.length) { const r = await Cloud.sb.from('kv').delete().eq('firm_id', Cloud.firm).in('key', dels); if (r.error) throw r.error; }
        batch.forEach(([k, v]) => { if (pending[k] === v) delete pending[k]; });
        savePending(); setSync(Object.keys(pending).length ? 'saving' : 'saved');
        if (Object.keys(pending).length) queueFlush();
      } catch (e) {
        if (/row-level security|permission/i.test(e.message || '')) {
          // Not allowed for this role (for example an article changing fees): drop it, tell the user.
          batch.forEach(([k]) => delete pending[k]); savePending(); setSync('saved');
          window.APP && APP.toast('You do not have permission to change this. Ask a partner.');
        } else { setSync('offline'); clearTimeout(flushT); flushT = setTimeout(flush, 15000); }
      }
    })();
    await flushing; flushing = null;
  }
  Cloud.flush = flush;
  window.addEventListener('online', () => { if (Cloud.firm) flush(); });
  window.addEventListener('beforeunload', e => { if (Cloud.enabled && Object.keys(pending).length) { flush(); e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && Cloud.firm) flush(); });

  function setSync(s) {
    const el = $('#sync'); if (!el || !Cloud.enabled) return;
    const n = Object.keys(pending).length;
    el.hidden = false;
    el.className = 'sync ' + s;
    el.textContent = s === 'saved' ? 'Saved online' : s === 'saving' ? 'Saving...' : 'Offline' + (n ? ', ' + n + ' change' + (n > 1 ? 's' : '') + ' waiting' : '');
  }

  /* ---------- live updates from colleagues ---------- */
  function subscribeLive() {
    if (!Cloud.enabled || !Cloud.firm) return;
    Cloud.sb.channel('kv-' + Cloud.firm)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kv', filter: 'firm_id=eq.' + Cloud.firm }, p => {
        const row = p.new && p.new.key ? p.new : p.old; if (!row || !row.key) return;
        if (p.new && p.new.updated_by === Cloud.user.id) return;          // my own save
        if (pending[row.key] !== undefined) return;                       // I have newer unsaved changes
        if (p.eventType === 'DELETE') rawRemove.call(ls, row.key); else rawSet.call(ls, row.key, p.new.value);
        const who = (Cloud.members.find(m => m.user_id === (p.new && p.new.updated_by)) || {}).name || 'A colleague';
        const live = $('#live');
        live.innerHTML = `${h(who)} updated ${h(LABELS[row.key] || row.key)}. <button class="btn small" id="live-r">Refresh to see it</button> <button class="btn ghost small" id="live-x">Later</button>`;
        live.hidden = false;
        $('#live-r').onclick = () => location.reload();
        $('#live-x').onclick = () => { live.hidden = true; };
      })
      .subscribe();
  }

  /* ---------- start the original tools ---------- */
  let started = false;
  function startApp() {
    if (started) return; started = true;
    const s = document.createElement('script');
    s.textContent = document.getElementById('app-src').textContent;
    document.body.appendChild(s);
    applyRole();
    const who = $('#who');
    if (Cloud.enabled && Cloud.me) {
      who.innerHTML = h(Cloud.me.name || Cloud.user.email) + ' <span class="chip mute">' + h(Cloud.me.role) + '</span>';
      const so = $('#so-btn'); so.hidden = false; so.onclick = signOut;
      setSync(Object.keys(pending).length ? 'offline' : 'saved');
      if (Object.keys(pending).length) flush();
    } else {
      who.innerHTML = '<span class="chip warn" title="Data is saved in this browser only. Add the Supabase details in config.js to turn on logins.">This device only</span>';
    }
  }

  function applyRole() {
    const role = Cloud.me ? Cloud.me.role : 'partner';
    document.body.dataset.role = role;
    const hide = role === 'article' ? ['assign', 'settings', 'backup', 'billing'] : [];
    document.querySelectorAll('nav.tabs button').forEach(b => { b.hidden = hide.includes(b.dataset.tab); });
    if (hide.includes(location.hash.slice(1))) { location.hash = 'home'; }
  }
  Cloud.role = () => (Cloud.me ? Cloud.me.role : 'partner');

  /* ---------- boot ---------- */
  async function boot() {
    Cloud.enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
    if (!Cloud.enabled) { if (window.Store) await Store.init(); startApp(); return; }
    Cloud.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    let recovering = /type=recovery/.test(location.hash);
    Cloud.sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') { recovering = true; resetForm(); } });
    const { data } = await Cloud.sb.auth.getSession();
    if (recovering) { resetForm(); return; }
    if (data.session) afterLogin(data.session); else loginForm('signin');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
