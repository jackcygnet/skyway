// Skyway app · talking to the brain (the Apps Script web app attached to your Sheet).
// Requests go as text/plain JSON: Apps Script can't answer the extra "pre-check"
// request browsers send first for application/json.

export const APP_VERSION = '1.2.0';

export class BrainError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const BRAIN_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/\s]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;
const DEV_RE = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}\/[A-Za-z0-9_/-]*$/;

function devHost() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

export function cleanBrainUrl(s) {
  return String(s || '').trim().replace(/\?.*$/, '');
}

export function brainUrlProblem(url) {
  if (!url) return 'Paste the brain address.';
  if (/\/dev$/.test(url)) return 'That’s the editor’s test address (it ends in /dev). Use the Web app URL, which ends in /exec.';
  if (BRAIN_RE.test(url) || (devHost() && DEV_RE.test(url))) return '';
  return 'That doesn’t look like the brain address. It starts with https://script.google.com/macros/s/ and ends with /exec.';
}

async function request(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 45000);
  let res;
  try {
    res = await fetch(url, Object.assign({ redirect: 'follow', cache: 'no-store', signal: ctrl.signal }, init));
  } catch (err) {
    throw new BrainError('offline', navigator.onLine === false ?
      'You’re offline. Changes are saved on this device and will sync later.' :
      'Couldn’t reach the brain. Check your connection and the brain address.');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    if (res.status === 404) throw new BrainError('not_found', 'The brain address answered “not found”. Check it against Deploy > Manage deployments.');
    if (/accounts\.google\.com|ServiceLogin/i.test(text)) {
      throw new BrainError('sign_in', 'The brain asked for a Google sign-in. In Apps Script, set the deployment’s “Who has access” to Anyone.');
    }
    throw new BrainError('bad_response', 'The brain answered with something that isn’t data. Check the brain address.');
  }
  if (!data || data.ok !== true) {
    const e = (data && data.error) || {};
    throw new BrainError(e.code || 'error', e.message || 'The brain sent back an error.');
  }
  return data;
}

export function ping(url) {
  return request(url + '?action=ping', { method: 'GET' }, 30000);
}

export function call(url, body, timeoutMs) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ appVersion: APP_VERSION }, body))
  }, timeoutMs);
}

/** Calls an action that needs this device's key. */
export function authed(meta, action, body, timeoutMs) {
  return call(meta.brainUrl, Object.assign({ action, deviceId: meta.deviceId, key: meta.key }, body || {}), timeoutMs);
}
