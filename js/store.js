// Skyway app · the copy of your data kept on this device (IndexedDB), so the
// app works offline. Every change is saved here first and queued in the
// outbox; sync.js sends the outbox to the brain and brings back what changed.

import { nowIso, newId } from './util.js';

export const PUSH_TABLES = ['Organizations', 'Contacts', 'Affiliations', 'Events', 'Attendance',
  'Interactions', 'Tasks', 'Reminders', 'ReviewQueue', 'Filters', 'Settings'];
export const TABLES = PUSH_TABLES.concat(['Health']);
export const PREFIX = {
  Contacts: 'con', Organizations: 'org', Affiliations: 'aff', Events: 'evt', Attendance: 'att',
  Interactions: 'int', Tasks: 'tsk', Reminders: 'rem', ReviewQueue: 'rvq', Filters: 'flt'
};

const DB_NAME = 'skyway';
const DB_VERSION = 1;

const state = { tables: {}, outbox: new Map(), meta: {}, version: 0 };
TABLES.forEach((t) => { state.tables[t] = new Map(); });
const listeners = new Set();

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        ['records', 'outbox', 'meta'].forEach((name) => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'k' });
        });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Skyway is open in another tab with an older version. Close the other tab.'));
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The save was cancelled.'));
  });
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function bump() {
  state.version++;
  listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
}

/* ------------------------------------------------------------- reading */

export async function load() {
  const db = await openDb();
  const tx = db.transaction(['records', 'outbox', 'meta'], 'readonly');
  const [records, outbox, meta] = await Promise.all([
    getAll(tx.objectStore('records')), getAll(tx.objectStore('outbox')), getAll(tx.objectStore('meta'))
  ]);
  TABLES.forEach((t) => state.tables[t].clear());
  records.forEach((e) => { if (state.tables[e.t]) state.tables[e.t].set(e.r.id, e.r); });
  state.outbox = new Map(outbox.map((e) => [e.k, e]));
  state.meta = {};
  meta.forEach((e) => { state.meta[e.k] = e.v; });
  bump();
}

export function version() { return state.version; }
export function table(t) { return state.tables[t]; }
export function get(t, id) { return state.tables[t] ? state.tables[t].get(id) : undefined; }
export function meta(k) { return state.meta[k]; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function outboxEntries() {
  return Array.from(state.outbox.values()).sort((a, b) => a.seq - b.seq);
}
export function pendingCount() { return outboxEntries().filter((e) => !e.failed).length; }
export function failedEntries() { return outboxEntries().filter((e) => e.failed); }
export function isPending(t, id) { return state.outbox.has(t + ':' + id); }

/* ------------------------------------------------------------- writing */

export async function setMeta(values) {
  const db = await openDb();
  const tx = db.transaction(['meta'], 'readwrite');
  const st = tx.objectStore('meta');
  Object.keys(values).forEach((k) => {
    if (values[k] === undefined) st.delete(k); else st.put({ k, v: values[k] });
  });
  await done(tx);
  Object.keys(values).forEach((k) => {
    if (values[k] === undefined) delete state.meta[k]; else state.meta[k] = values[k];
  });
  bump();
}

/** A time later than both now and the record's last edit, so this edit wins over the version you saw. */
function editTime(prev) {
  const now = Date.now();
  const before = prev && prev.updatedAt ? Date.parse(prev.updatedAt) : 0;
  return new Date(before >= now ? before + 1000 : now).toISOString();
}

/** Saves records here and queues them for the brain. items: [{ t: 'Contacts', r: {...} }] */
export async function saveMany(items) {
  const now = nowIso();
  let seq = state.meta.outboxSeq || 0;
  // Two changes to the same record in one batch are combined into one.
  const byKey = new Map();
  items.forEach(({ t, r }) => {
    if (!PUSH_TABLES.includes(t)) throw new Error('Can’t change ' + t + ' from the app.');
    const id = r.id || newId(PREFIX[t]);
    const k = t + ':' + id;
    const pending = byKey.get(k);
    if (pending) {
      Object.assign(pending.r, r, { id });
      return;
    }
    const prev = state.tables[t].get(id);
    const rec = Object.assign({}, prev || {}, r, { id });
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = editTime(prev);
    seq += 1;
    byKey.set(k, { k, t, id, r: rec, seq });
  });
  const out = Array.from(byKey.values());
  const db = await openDb();
  const tx = db.transaction(['records', 'outbox', 'meta'], 'readwrite');
  out.forEach((e) => {
    tx.objectStore('records').put({ k: e.k, t: e.t, r: e.r });
    tx.objectStore('outbox').put(e);
  });
  tx.objectStore('meta').put({ k: 'outboxSeq', v: seq });
  await done(tx);
  state.meta.outboxSeq = seq;
  out.forEach((e) => {
    state.tables[e.t].set(e.id, e.r);
    state.outbox.set(e.k, e);
  });
  bump();
  return out.map((e) => e.r);
}

export async function save(t, r) {
  const list = await saveMany([{ t, r }]);
  return list[0];
}

/** Marks a record deleted (rows are never removed, so every device learns it's gone). */
export async function remove(t, id) {
  const prev = state.tables[t].get(id);
  if (!prev) return null;
  return save(t, { id, deleted: true });
}

/** Rows from the brain. Rows with a local change still waiting keep the local version. */
export async function applyServer(changes, opts) {
  const reset = !!(opts && opts.reset);
  const db = await openDb();
  const tx = db.transaction(['records'], 'readwrite');
  const st = tx.objectStore('records');
  const incoming = [];
  if (reset) {
    st.clear();
    state.outbox.forEach((e) => st.put({ k: e.k, t: e.t, r: e.r }));
  }
  Object.keys(changes || {}).forEach((t) => {
    if (!state.tables[t]) return;
    (changes[t] || []).forEach((r) => {
      if (!r || !r.id) return;
      const k = t + ':' + r.id;
      if (state.outbox.has(k)) return;
      st.put({ k, t, r });
      incoming.push([t, r]);
    });
  });
  await done(tx);
  if (reset) {
    TABLES.forEach((t) => state.tables[t].clear());
    state.outbox.forEach((e) => state.tables[e.t].set(e.id, e.r));
  }
  incoming.forEach(([t, r]) => state.tables[t].set(r.id, r));
  if (incoming.length || reset) bump();
  return incoming.length;
}

/**
 * After a push: drop the outbox entries the brain took, take the brain's
 * version where a newer edit won, and set aside entries it refused.
 * An entry edited again while the push was under way stays queued.
 */
export async function settle(sent, rejected) {
  const byKey = new Map((rejected || []).map((x) => [x.table + ':' + x.id, x]));
  const db = await openDb();
  const tx = db.transaction(['records', 'outbox'], 'readwrite');
  const ob = tx.objectStore('outbox');
  const rs = tx.objectStore('records');
  const changes = [];
  sent.forEach((e) => {
    const cur = state.outbox.get(e.k);
    if (!cur || cur.seq !== e.seq) return;
    const rej = byKey.get(e.k);
    if (!rej) {
      ob.delete(e.k);
      changes.push(['del', e]);
    } else if (rej.reason === 'older' && rej.current) {
      ob.delete(e.k);
      rs.put({ k: e.k, t: e.t, r: rej.current });
      changes.push(['older', e, rej.current]);
    } else {
      const failed = Object.assign({}, cur, {
        failed: { reason: rej.reason, field: rej.field || '', message: rej.message || '', at: nowIso() }
      });
      ob.put(failed);
      changes.push(['failed', failed]);
    }
  });
  await done(tx);
  let lost = 0;
  changes.forEach(([kind, e, current]) => {
    if (kind === 'del') state.outbox.delete(e.k);
    else if (kind === 'older') {
      state.outbox.delete(e.k);
      state.tables[e.t].set(e.id, current);
      lost++;
    } else state.outbox.set(e.k, e);
  });
  if (changes.length) bump();
  return { lost };
}

/** Drops a change the brain refused. The next sync brings back the brain's version. */
export async function discard(k) {
  const db = await openDb();
  const tx = db.transaction(['outbox', 'meta'], 'readwrite');
  tx.objectStore('outbox').delete(k);
  tx.objectStore('meta').put({ k: 'since', v: 0 });
  await done(tx);
  state.outbox.delete(k);
  state.meta.since = 0;
  bump();
}

/** Sends a refused change again (after the Sheet or the brain was fixed). */
export async function retry(k) {
  const cur = state.outbox.get(k);
  if (!cur || !cur.failed) return;
  const next = Object.assign({}, cur);
  delete next.failed;
  const db = await openDb();
  const tx = db.transaction(['outbox'], 'readwrite');
  tx.objectStore('outbox').put(next);
  await done(tx);
  state.outbox.set(k, next);
  bump();
}

/** Erases everything on this device: data, waiting changes, keys, PIN. */
export async function wipe() {
  const db = await openDb();
  const tx = db.transaction(['records', 'outbox', 'meta'], 'readwrite');
  ['records', 'outbox', 'meta'].forEach((n) => tx.objectStore(n).clear());
  await done(tx);
  TABLES.forEach((t) => state.tables[t].clear());
  state.outbox = new Map();
  state.meta = {};
  bump();
}
