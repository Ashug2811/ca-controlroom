/* Record store for invoices, payments and time entries: one row per record, so
   several people can save at the same moment without overwriting each other.
   Online: Supabase table "records" with live updates and an offline queue.
   This device only: kept in localStorage under ca.rec.<kind>. */
(function () {
  'use strict';
  const ls = window.localStorage;
  const cache = {};                // kind -> Map(id -> data)
  const listeners = new Set();
  let cloud = false, queue = [];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const emit = kind => listeners.forEach(f => { try { f(kind); } catch (e) { console.error(e); } });
  const mapOf = k => cache[k] || (cache[k] = new Map());

  function localLoad() {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i); if (!k || !k.startsWith('ca.rec.')) continue;
      try { const kind = k.slice(7), arr = JSON.parse(ls.getItem(k)) || []; const m = mapOf(kind); arr.forEach(r => m.set(r.id, r)); } catch (e) { }
    }
  }
  const localSave = kind => ls.setItem('ca.rec.' + kind, JSON.stringify([...mapOf(kind).values()]));
  const saveQueue = () => Storage.prototype.setItem.call(ls, 'cloud.recq', JSON.stringify(queue));

  async function push(op) {
    const sb = Cloud.sb;
    const r = await sb.from('records').upsert({ firm_id: Cloud.firm, kind: op.kind, id: op.id, data: op.data, deleted: !!op.deleted }, { onConflict: 'firm_id,kind,id' });
    if (r.error) throw r.error;
  }
  let busy = false;
  async function flushQueue() {
    if (busy) return; busy = true;
    try { await drain(); } finally { busy = false; }
  }
  async function drain() {
    while (queue.length) {
      try { await push(queue[0]); queue.shift(); saveQueue(); }
      catch (e) { if (/row-level security|permission/i.test(e.message || '')) { queue.shift(); saveQueue(); window.APP && APP.toast('You do not have permission to change that record.'); } else { setTimeout(flushQueue, 15000); return; } }
    }
  }

  const Store = window.Store = {
    uid,
    async init() {
      cloud = !!(window.Cloud && Cloud.enabled && Cloud.firm);
      if (!cloud) { localLoad(); return; }
      try { queue = JSON.parse(ls.getItem('cloud.recq') || '[]'); } catch (e) { queue = []; }
      const all = []; let from = 0;
      for (; ;) {
        const r = await Cloud.sb.from('records').select('kind,id,data,deleted').eq('firm_id', Cloud.firm).eq('deleted', false).range(from, from + 999);
        if (r.error) break; all.push(...r.data); if (r.data.length < 1000) break; from += 1000;
      }
      all.forEach(r => mapOf(r.kind).set(r.id, r.data));
      queue.forEach(op => op.deleted ? mapOf(op.kind).delete(op.id) : mapOf(op.kind).set(op.id, op.data));
      // Records brought in from a backup file (or from "this device only" use) move to the online store.
      const keys = []; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith('ca.rec.')) keys.push(k); }
      keys.forEach(k => { const kind = k.slice(7); let arr = []; try { arr = JSON.parse(ls.getItem(k)) || []; } catch (e) { }
        arr.forEach(d => { if (d && d.id && !mapOf(kind).has(d.id)) { mapOf(kind).set(d.id, d); queue.push({ kind, id: d.id, data: d }); } }); ls.removeItem(k); });
      saveQueue();
      if (queue.length) flushQueue();
      window.addEventListener('online', flushQueue);
      Cloud.sb.channel('rec-' + Cloud.firm)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: 'firm_id=eq.' + Cloud.firm }, p => {
          const r = p.new && p.new.kind ? p.new : null; if (!r) return;
          if (queue.some(q => q.kind === r.kind && q.id === r.id)) return;
          if (r.deleted) mapOf(r.kind).delete(r.id); else mapOf(r.kind).set(r.id, r.data);
          emit(r.kind);
        }).subscribe();
    },
    list(kind) { return [...mapOf(kind).values()]; },
    get(kind, id) { return mapOf(kind).get(id); },
    save(kind, data) {
      data = Object.assign({}, data); if (!data.id) data.id = uid();
      data.updatedAt = new Date().toISOString();
      mapOf(kind).set(data.id, data);
      if (cloud) { queue.push({ kind, id: data.id, data }); saveQueue(); flushQueue(); } else localSave(kind);
      emit(kind); return data;
    },
    remove(kind, id) {
      const d = mapOf(kind).get(id); mapOf(kind).delete(id);
      if (cloud) { queue.push({ kind, id, data: d || {}, deleted: true }); saveQueue(); flushQueue(); } else localSave(kind);
      emit(kind);
    },
    on(f) { listeners.add(f); },
    kinds() { return Object.keys(cache); },
    pending: () => queue.length
  };
  // Backup file: include invoices, payments and time entries as well as the lists.
  document.addEventListener('app:start', () => {
    const b = document.getElementById('bk-exp'); if (!b) return;
    b.onclick = () => {
      const o = {};
      for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k.startsWith('ca.') && !/^ca\.(pin|key|mid|t0)$/.test(k)) o[k] = ls.getItem(k); }
      Store.kinds().forEach(k => { o['ca.rec.' + k] = JSON.stringify(Store.list(k)); });
      APP.saveFile('ca-controlroom-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(o, null, 1));
    };
  });
})();
