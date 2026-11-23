// Skyway app · the PIN, the recovery code, and locking after time away.
// The PIN is a privacy screen for this device, not encryption. Both the PIN
// and the recovery code are stored only as salted, slow hashes (PBKDF2).

import * as store from './store.js';
import { randomHex } from './util.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ITERATIONS = 150000;
const ACTIVE_KEY = 'skyway.activeAt';

let locked = true;
let lastActive = Date.now();
let hiddenAt = null;
const listeners = new Set();

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function slowHash(secret, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hasPin() { return !!store.meta('pin'); }

export async function setPin(pin) {
  const salt = randomHex(16);
  await store.setMeta({ pin: { salt, hash: await slowHash(pin, salt) }, pinFails: 0, lockoutUntil: 0 });
}

/** { ok } or { ok: false, waitMs } after too many wrong tries (30 seconds, doubling, at most 15 minutes). */
export async function checkPin(pin) {
  const until = store.meta('lockoutUntil') || 0;
  if (Date.now() < until) return { ok: false, waitMs: until - Date.now() };
  const p = store.meta('pin');
  if (!p) return { ok: true };
  if (same(await slowHash(pin, p.salt), p.hash)) {
    await store.setMeta({ pinFails: 0, lockoutUntil: 0 });
    return { ok: true };
  }
  const fails = (store.meta('pinFails') || 0) + 1;
  const wait = fails >= 5 ? Math.min(30000 * Math.pow(2, fails - 5), 15 * 60 * 1000) : 0;
  await store.setMeta({ pinFails: fails, lockoutUntil: wait ? Date.now() + wait : 0 });
  return { ok: false, fails, waitMs: wait };
}

export function formatRecovery(code) {
  return code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8, 12);
}

/** Makes a new recovery code; the old one stops working. Returns it formatted as XXXX-XXXX-XXXX. */
export async function makeRecoveryCode() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < bytes.length && code.length < 12; i++) {
    if (bytes[i] < 248) code += ALPHABET.charAt(bytes[i] % 31);
  }
  const salt = randomHex(16);
  await store.setMeta({ recovery: { salt, hash: await slowHash(code, salt) } });
  return formatRecovery(code);
}

export function normalizeRecovery(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function checkRecovery(input) {
  const r = store.meta('recovery');
  const code = normalizeRecovery(input);
  if (!r || code.length !== 12) return false;
  return same(await slowHash(code, r.salt), r.hash);
}

/* --------------------------------------------------------------- locking */

export function onLockChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } }); }

export function isLocked() { return hasPin() && locked; }

export function lockNow() {
  locked = true;
  try { localStorage.removeItem(ACTIVE_KEY); } catch (err) { /* private mode */ }
  notify();
}

export function unlock() {
  locked = false;
  markActive(true);
  notify();
}

let lastWrite = 0;
function markActive(force) {
  lastActive = Date.now();
  if (!locked && (force || lastActive - lastWrite > 10000)) {
    lastWrite = lastActive;
    try { localStorage.setItem(ACTIVE_KEY, String(lastActive)); } catch (err) { /* private mode */ }
  }
}

/** Locks after getMinutes() minutes away or idle. A reload within that time stays unlocked. */
export function startAutoLock(getMinutes) {
  const limit = () => Math.max(1, Number(getMinutes()) || 5) * 60000;
  try {
    const at = Number(localStorage.getItem(ACTIVE_KEY) || 0);
    if (at && Date.now() - at < limit()) locked = false;
  } catch (err) { /* private mode */ }
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => {
    window.addEventListener(ev, () => markActive(false), { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      markActive(true);
    } else {
      if (hiddenAt && Date.now() - hiddenAt > limit() && hasPin() && !locked) lockNow();
      hiddenAt = null;
    }
  });
  setInterval(() => {
    if (hasPin() && !locked && Date.now() - lastActive > limit()) lockNow();
  }, 15000);
}
