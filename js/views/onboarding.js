// Skyway app · screens before the app: connect, PIN, recovery code, lock, first download.

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as lock from '../lock.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import { h, plural } from '../util.js';
import { icon } from '../icons.js';
import { cleanBrainUrl, brainUrlProblem } from '../brain.js';
import { keypad, pinMachine, listenKeys } from './parts.js';

function fmtCode(c) {
  const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length > 4 ? s.slice(0, 4) + '-' + s.slice(4, 8) : s;
}

function logo() { return h`<div class="onb-logo">${icon('logo', 28)}</div>`; }

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

/* --------------------------------------------------------------- connect */

export const connectView = {
  id: 'connect', chrome: 'bare', live: false,
  title: () => 'Connect',
  render() {
    const p = ui.pendingConnect || {};
    const already = sync.connected();
    return h`<div class="onb">
      ${logo()}
      <h1>Connect this device</h1>
      <p class="muted">Skyway keeps your network in your Google Sheet. A one-time code connects this device to it.</p>
      ${already ? h`<div class="note warn">This device is already connected as ${store.meta('deviceName') || 'a device'}.
        Connecting again starts it over, and anything not yet synced here is lost.</div>` : ''}
      <form class="stack" autocomplete="off">
        <label class="field"><span>Brain address</span>
          <input name="brainUrl" type="url" inputmode="url" spellcheck="false" autocapitalize="off"
            placeholder="https://script.google.com/macros/s/…/exec" value="${p.brainUrl || ''}"></label>
        <label class="field"><span>One-time code</span>
          <input name="code" class="code-input" spellcheck="false" autocapitalize="characters" maxlength="9"
            placeholder="XXXX-XXXX" value="${fmtCode(p.code)}"></label>
        <p class="error" id="connect-error" hidden></p>
        <button class="btn block" type="submit" id="connect-btn">Connect</button>
        ${already ? h`<button class="btn secondary block" type="button" data-act="keep">Keep the current connection</button>` : ''}
      </form>
      <details class="help">
        <summary>Where do I get these?</summary>
        <p>On a device that’s already connected: Settings, then Add a device. It shows a QR code for your phone’s camera.</p>
        <p>Or in your Google Sheet: the Skyway menu, then Add a device. Click its link, or copy the address and code.</p>
      </details>
    </div>`;
  },
  mount(el) {
    const f = el.querySelector('form');
    if (f && f.brainUrl.value && !f.code.value) f.code.focus();
  },
  input(el) {
    if (el.name === 'code') {
      const pos = el.value.length;
      el.value = fmtCode(el.value);
      if (pos >= el.value.length) el.setSelectionRange(el.value.length, el.value.length);
    }
  },
  async submit(form) {
    const url = cleanBrainUrl(form.brainUrl.value);
    const code = form.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const problem = brainUrlProblem(url);
    if (problem) return showError('connect-error', problem);
    if (code.length !== 8) return showError('connect-error', 'The code has 8 letters and numbers, like K7QM-3XPA.');
    if (sync.connected()) {
      const lost = store.pendingCount();
      const ok = await ask({
        title: 'Start this device over?',
        body: lost ? plural(lost, 'change') + ' on this device haven’t synced and will be lost.' : 'Everything comes back from your Sheet.',
        ok: 'Start over', danger: !!lost
      });
      if (!ok) return;
    }
    const btn = document.getElementById('connect-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    showError('connect-error', '');
    try {
      await sync.connect(url, code);
      ui.pendingConnect = null;
      ui.onboarding = null;
      lock.lockNow();
      ui.render();
      sync.syncNow();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Connect';
      showError('connect-error', err.message);
    }
  },
  act: {
    keep() {
      ui.pendingConnect = null;
      ui.onboarding = null;
      ui.render();
    }
  }
};

/* ------------------------------------------------------------ choose PIN */

let setupStage = 'first';
let firstPin = '';
const setupMachine = pinMachine(async (pin) => {
  if (setupStage === 'first') {
    firstPin = pin;
    setupStage = 'confirm';
    setupMachine.reset();
    ui.render();
    return;
  }
  if (pin !== firstPin) {
    setupStage = 'first';
    firstPin = '';
    setupMachine.reset();
    ui.render();
    setupMachine.paint('Those didn’t match. Choose your PIN again.', 'bad');
    return;
  }
  await lock.setPin(pin);
  setupStage = 'first';
  firstPin = '';
  setupMachine.reset();
  if (ui.resettingPin) {
    ui.resettingPin = false;
    ui.resetting = false;
    lock.unlock();
    toast('Your new PIN is set');
    return;
  }
  ui.recoveryToShow = await lock.makeRecoveryCode();
  await store.setMeta({ needsRecoveryShown: true });
  lock.unlock();
});

export const pinSetupView = {
  id: 'pin-setup', chrome: 'bare', live: false,
  title: () => 'Choose a PIN',
  render() {
    const confirm = setupStage === 'confirm';
    return h`<div class="onb center">
      ${logo()}
      <h1>${confirm ? 'Enter it again' : (ui.resettingPin ? 'Choose a new PIN' : 'Choose a 4-digit PIN')}</h1>
      <p class="muted">${confirm ? 'To make sure.' : 'You’ll enter it to open Skyway on this device.'}</p>
      ${keypad(setupMachine.value.length)}
      ${ui.resettingPin ? h`<button class="link" data-act="cancel-reset">Cancel</button>` : ''}
    </div>`;
  },
  mount() { listenKeys(setupMachine); },
  act: {
    key: (el) => setupMachine.press(el.dataset.k),
    ['cancel-reset']() {
      ui.resettingPin = false;
      setupStage = 'first';
      firstPin = '';
      setupMachine.reset();
      ui.render();
    }
  }
};

/* --------------------------------------------------------- recovery code */

export const recoveryShowView = {
  id: 'recovery-show', chrome: 'bare', live: false,
  title: () => 'Recovery code',
  render() {
    const code = ui.recoveryToShow;
    return h`<div class="onb">
      ${logo()}
      <h1>Save your recovery code</h1>
      <p class="muted">If you forget your PIN, this code lets you choose a new one on this device.
        Save it somewhere safe, like OneNote or a password manager.</p>
      ${code ? h`<div class="bigcode" id="rcode">${code}</div>
        <button class="btn secondary block" data-act="copy">${icon('copy', 18)}Copy code</button>`
    : h`<div class="note">Make one any time in Settings, then Recovery code.</div>`}
      <button class="btn block" data-act="done">I saved it</button>
    </div>`;
  },
  act: {
    async copy() {
      try {
        await navigator.clipboard.writeText(ui.recoveryToShow);
        toast('Copied');
      } catch (err) {
        toast('Select the code and copy it by hand');
      }
    },
    async done() {
      ui.recoveryToShow = null;
      await store.setMeta({ needsRecoveryShown: undefined });
      ui.render();
    }
  }
};

/* ------------------------------------------------------------------ lock */

const lockMachine = pinMachine(async (pin) => {
  const r = await lock.checkPin(pin);
  lockMachine.reset();
  if (r.ok) {
    lock.unlock();
    return;
  }
  let msg = 'Wrong PIN. Try again.';
  if (r.waitMs) msg = 'Too many tries. Wait ' + Math.ceil(r.waitMs / 1000) + ' seconds.';
  lockMachine.paint(msg, 'bad');
});

export const lockView = {
  id: 'lock', chrome: 'bare', live: false,
  title: () => 'Locked',
  render() {
    const mins = model.settingNum('lockMinutes');
    return h`<div class="onb center">
      ${logo()}
      <h1 class="brandname">Skyway</h1>
      <p class="muted">Enter your PIN</p>
      ${keypad(0)}
      <button class="link" data-act="forgot">Forgot your PIN?</button>
      <p class="small muted">Locks after ${plural(mins, 'minute')} away</p>
    </div>`;
  },
  mount() {
    lockMachine.reset();
    listenKeys(lockMachine);
  },
  act: {
    key: (el) => lockMachine.press(el.dataset.k),
    forgot() {
      ui.resetting = true;
      ui.render();
    }
  }
};

/* -------------------------------------------------------------- reset PIN */

export const resetView = {
  id: 'reset', chrome: 'bare', live: false,
  title: () => 'Reset your PIN',
  render() {
    const lost = store.pendingCount();
    return h`<div class="onb">
      <button class="iconbtn back" data-act="cancel" aria-label="Back">${icon('arrowLeft', 22)}</button>
      <h1>Reset your PIN</h1>
      <p class="muted">Use either option. Your contacts, notes and history stay exactly as they are in your Sheet.</p>
      <form class="card stack" data-form="recovery">
        <h2>Use your recovery code</h2>
        <p class="muted small">You saved this code when you set up Skyway on this device.</p>
        <label class="field"><span>Recovery code</span>
          <input name="code" class="code-input" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX"></label>
        <p class="error" id="reset-error" hidden></p>
        <button class="btn block" type="submit">Reset PIN</button>
      </form>
      <div class="or"><span>or</span></div>
      <div class="card stack">
        <h2>Start over on this device</h2>
        <p class="muted small">Erase Skyway here and connect again with a new one-time code from your Sheet.
          ${lost ? h`<b>${plural(lost, 'change')} made here haven’t synced and will be lost.</b>` : 'Nothing is waiting to sync, so nothing is lost.'}</p>
        <button class="btn secondary block" data-act="start-over">Start over</button>
      </div>
    </div>`;
  },
  async submit(form) {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const ok = await lock.checkRecovery(form.code.value);
    btn.disabled = false;
    if (!ok) return showError('reset-error', 'That code doesn’t match. Check it and try again.');
    // The old PIN stays in place until a new one is chosen, so closing the
    // app halfway through still needs the old PIN or the code again.
    ui.resetting = false;
    ui.resettingPin = true;
    ui.render();
  },
  act: {
    cancel() {
      ui.resetting = false;
      ui.render();
    },
    async ['start-over']() {
      const lost = store.pendingCount();
      const ok = await ask({
        title: 'Erase Skyway on this device?',
        body: lost ? plural(lost, 'change') + ' here will be lost. Everything else comes back from your Sheet.' :
          'Everything comes back from your Sheet when you connect again.',
        ok: 'Erase and start over', danger: true
      });
      if (!ok) return;
      ui.resetting = false;
      await store.wipe();
      ui.render();
    }
  }
};

/* --------------------------------------------------------- first download */

export const firstSyncView = {
  id: 'first-sync', chrome: 'bare', live: true,
  title: () => 'Downloading',
  render() {
    const s = sync.syncStatus();
    const n = model.people().length;
    const failed = s.state === 'error' || s.state === 'offline';
    return h`<div class="onb center">
      ${logo()}
      <h1>${failed ? 'Couldn’t download yet' : 'Getting your network'}</h1>
      <p class="muted">${failed ? s.message : (n ? plural(n, 'person', 'people') + ' so far…' : 'Downloading from your Sheet…')}</p>
      ${failed ? h`<button class="btn block" data-act="retry">Try again</button>
        <button class="btn secondary block" data-act="skip">Continue without it</button>` : h`<div class="spinner" aria-hidden="true"></div>`}
    </div>`;
  },
  act: {
    retry() { sync.syncNow(); },
    async skip() { await store.setMeta({ skipFirstSync: true }); }
  }
};

/* ------------------------------------------------------------ disconnected */

export const disconnectedView = {
  id: 'disconnected', chrome: 'bare', live: false,
  title: () => 'Disconnected',
  render() {
    const d = store.meta('disconnected') || {};
    return h`<div class="onb">
      ${logo()}
      <h1>This device was disconnected</h1>
      <p class="muted">${d.code === 'revoked' ? 'It was revoked from Skyway’s device list, so its copy of your network was erased.'
    : 'The brain no longer recognizes this device, so its copy of your network was erased.'}</p>
      ${d.lost ? h`<div class="note warn">${plural(d.lost, 'change')} made here hadn’t synced and couldn’t be kept.</div>` : ''}
      <button class="btn block" data-act="again">Connect again</button>
    </div>`;
  },
  act: {
    async again() {
      await store.setMeta({ disconnected: undefined });
      ui.render();
    }
  }
};
