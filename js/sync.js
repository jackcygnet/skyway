// Skyway app · keeping this device and the brain in step.
// Sends waiting changes, then downloads everything that changed since the
// last change number this device saw, page by page.

import * as store from './store.js';
import { authed, call, ping, BrainError } from './brain.js';

const status = { state: 'idle', message: '', lastError: '', lostEdits: 0 };
const listeners = new Set();
let running = null;
let again = false;
let soonTimer = null;
let retryTimer = null;
let retryDelay = 30000;
let lastPending = 0;
let onDisconnect = () => {};

export function connected() {
  return !!(store.meta('deviceId') && store.meta('key') && store.meta('brainUrl'));
}

function creds() {
  return { brainUrl: store.meta('brainUrl'), deviceId: store.meta('deviceId'), key: store.meta('key') };
}

export function syncStatus() {
  return Object.assign({}, status, {
    pending: store.pendingCount(),
    failed: store.failedEntries().length,
    lastSync: store.meta('lastSyncAt') || null
  });
}

export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setStatus(patch) {
  Object.assign(status, patch);
  listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
}

/** Runs once a change is saved, after a short pause so quick edits go together. */
export function syncSoon(ms) {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => { syncNow(); }, ms === undefined ? 1500 : ms);
}

export function syncNow(opts) {
  if (!connected()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let full = !!(opts && opts.full);
    try {
      let rounds = 0;
      do {
        again = false;
        await runOnce(full);
        full = false;
        rounds++;
      } while (again && rounds < 20);
      retryDelay = 30000;
    } catch (err) {
      handleError(err);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runOnce(full) {
  setStatus({ state: 'syncing', message: '' });
  const since = full ? 0 : (store.meta('since') || 0);
  const batch = store.outboxEntries().filter((e) => !e.failed).slice(0, 400);
  const changes = {};
  batch.forEach((e) => { (changes[e.t] = changes[e.t] || []).push(e.r); });

  let res = await authed(creds(), 'sync', { since, changes, limit: 1000 }, 120000);
  const known = store.meta('brainId');
  if (known && res.brainId && known !== res.brainId) {
    // A different brain answered (the Sheet was rebuilt). Start over from it.
    await store.settle(batch, res.results.rejected);
    await store.setMeta({ brainId: res.brainId, since: 0 });
    again = true;
    return;
  }
  const settled = await store.settle(batch, res.results.rejected);
  await store.applyServer(res.changes, { reset: since === 0 || !!res.reset });
  let rev = res.rev;
  let pages = 0;
  while (res.more && pages < 200) {
    res = await authed(creds(), 'sync', { since: rev, changes: {}, limit: 1000 }, 120000);
    await store.applyServer(res.changes);
    rev = res.rev;
    pages++;
  }
  await store.setMeta({
    since: rev,
    brainId: res.brainId,
    brainVersion: res.version,
    lastSyncAt: new Date().toISOString()
  });
  if (batch.length >= 400 || store.pendingCount() > 0) again = true;
  setStatus({
    state: 'idle', message: '', lastError: '',
    lostEdits: status.lostEdits + (settled.lost || 0)
  });
}

function handleError(err) {
  const code = err && err.code;
  if (code === 'revoked' || code === 'unauthorized') {
    setStatus({ state: 'disconnected', message: err.message });
    onDisconnect(code, err.message);
    return;
  }
  if (code === 'offline') {
    setStatus({ state: 'offline', message: err.message });
  } else {
    setStatus({ state: 'error', message: err.message || String(err), lastError: code || 'error' });
  }
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { syncNow(); }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 10 * 60 * 1000);
}

/** Starts the background rhythm: on changes, every 5 minutes, when back online or back in view. */
export function start(handlers) {
  onDisconnect = (handlers && handlers.onDisconnect) || onDisconnect;
  store.subscribe(() => {
    const n = store.pendingCount();
    if (n > lastPending) syncSoon();
    if (n !== lastPending) setStatus({});
    lastPending = n;
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus({ state: 'offline', message: 'You’re offline. Changes are saved here and sync later.' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const last = Date.parse(store.meta('lastSyncAt') || 0);
    if (!last || Date.now() - last > 60000) syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, 5 * 60 * 1000);
  lastPending = store.pendingCount();
}

/* ------------------------------------------------------ connect a device */

/** Trades a one-time code for this device's own key. Erases anything left on this device first. */
export async function connect(brainUrl, code) {
  const p = await ping(brainUrl);
  if (!p || p.app !== 'Skyway') throw new BrainError('bad_response', 'Something answered, but it isn’t the Skyway brain.');
  if (!p.ready) throw new BrainError('setup_needed', 'The brain can’t find its Sheet tabs. In the Sheet, run Skyway > Set up or repair the Sheet.');
  const res = await call(brainUrl, { action: 'pair', code });
  await store.wipe();
  await store.setMeta({
    brainUrl, deviceId: res.deviceId, key: res.key, deviceName: res.deviceName,
    brainId: res.brainId, since: 0, connectedAt: new Date().toISOString()
  });
  try {
    const hi = await authed(creds(), 'hello', {});
    await store.setMeta({ sheetUrl: hi.sheetUrl || '', brainVersion: hi.version || '' });
  } catch (err) {
    console.warn('hello failed', err);
  }
  return res;
}

export async function refreshHello() {
  try {
    const hi = await authed(creds(), 'hello', {});
    await store.setMeta({ sheetUrl: hi.sheetUrl || '', brainVersion: hi.version || '', deviceName: hi.deviceName || store.meta('deviceName') });
    return hi;
  } catch (err) {
    if (err.code === 'revoked' || err.code === 'unauthorized') handleError(err);
    throw err;
  }
}

export function devicesList() { return authed(creds(), 'devices.list', {}); }
export function revokeDevice(id) { return authed(creds(), 'devices.revoke', { targetId: id }); }
export function makeCode(name) { return authed(creds(), 'devices.code', { name }); }

/* ------------------------------------------------------------ reminders */

export function remindersStatus() { return authed(creds(), 'reminders.status', {}); }
export function sendTestReminder() { return authed(creds(), 'reminders.test', {}); }

/** Asks the brain to email a 6-digit code that resets this device's PIN. */
export function pinResetCode() { return authed(creds(), 'pin.resetCode', {}); }
export function pinVerifyCode(code) { return authed(creds(), 'pin.verifyCode', { code }); }

/** True if the brain is at least this version, like '1.2.0'. False if it hasn't said yet. */
export function brainAtLeast(want) {
  const have = String(store.meta('brainVersion') || '').split('.').map(Number);
  const need = String(want).split('.').map(Number);
  if (!have.length || isNaN(have[0])) return false;
  for (let i = 0; i < need.length; i++) {
    const a = have[i] || 0, b = need[i] || 0;
    if (a !== b) return a > b;
  }
  return true;
}
