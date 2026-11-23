// Skyway app · Settings: check-in tiers, security, devices, your data.
// Also the screens for adding a device, changing the PIN, and a new
// recovery code.

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as lock from '../lock.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import { h, raw, fmtAgo, fmtDate, fmtTime, plural, describeCadence, CADENCE_CHOICES, safeUrl } from '../util.js';
import { icon } from '../icons.js';
import { qrSvg } from '../qr.js';
import { APP_VERSION } from '../brain.js';
import { topHead, subHead, sheetHead, keypad, pinMachine, listenKeys, peopleCount } from './parts.js';
import { syncSummary } from './more.js';

/* -------------------------------------------------------------- devices */
// The device list lives in the Sheet's Devices tab, which never syncs, so
// it's fetched when a screen needs it.

export const devices = { list: null, currentId: '', error: '', loading: false, at: 0 };

export function loadDevices(force) {
  if (devices.loading) return;
  if (!force && Date.now() - devices.at < 60000) return;
  devices.loading = true;
  devices.error = '';
  sync.devicesList().then((r) => {
    devices.list = r.devices || [];
    devices.currentId = r.currentId || '';
  }).catch((err) => {
    devices.error = err.code === 'offline' ? 'Connect to the internet to see your devices.' : err.message;
  }).finally(() => {
    devices.at = Date.now();
    devices.loading = false;
    if (/^#\/(settings|sync|more)\b/.test(location.hash)) ui.render();
  });
}

export function deviceDetail(d) {
  if (!d.active) return 'Disconnected ' + fmtDate(d.revokedAt);
  if (d.id === devices.currentId) return 'This device';
  if (!d.lastSeenAt) return 'Not seen yet';
  const days = (Date.now() - Date.parse(d.lastSeenAt)) / 86400000;
  if (days < 1) return 'Synced ' + fmtAgo(d.lastSeenAt);
  return 'Last synced ' + fmtDate(d.lastSeenAt) + (days > 3 ? '. That’s fine if you haven’t used it.' : '');
}

/* ------------------------------------------------------------- settings */

const LOCK_CHOICES = [1, 2, 5, 10, 15, 30, 60];

function setRow(label, detail, control) {
  return h`<div class="setrow"><span class="main"><b>${label}</b>${detail ? h`<small>${detail}</small>` : ''}</span>${control || ''}</div>`;
}

function cadenceControl(tier) {
  const key = 'cadence.' + tier;
  const cur = String(model.setting(key) || '').toLowerCase();
  const choices = CADENCE_CHOICES.slice();
  if (cur && !choices.some(([v]) => v === cur)) choices.unshift([cur, describeCadence(cur).replace(/^every/, 'Every')]);
  return h`<select class="pill-select" data-setting="${key}" aria-label="${tier} cadence">
    ${choices.map(([v, l]) => h`<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`)}</select>`;
}

function syncCard() {
  const s = syncSummary();
  return h`<section class="card">
    <div class="card-head"><h2>Sync & health</h2><span class="chip ${s.warn ? 'late' : 'soon'}">${icon(s.icon, 14)}${s.title}</span></div>
    ${setRow('This device', s.detail || '', h`<a class="btn small secondary" href="#/sync">Details</a>`)}
    ${setRow('Brain', store.meta('brainVersion') ? 'Version ' + store.meta('brainVersion') : 'Version not known yet', '')}
  </section>`;
}

function tiersCard() {
  const people = model.people();
  return h`<section class="card">
    <div class="card-head"><h2>Check-in tiers</h2></div>
    <p class="card-body muted small">How often Skyway reminds you to reach out. A person’s own setting overrides their tier.</p>
    ${model.TIERS.map((t) => {
    const n = people.filter((c) => c.tier === t).length;
    return setRow(t, n ? peopleCount(n) : 'No one yet', cadenceControl(t));
  })}
  </section>`;
}

function securityCard() {
  const mins = model.settingNum('lockMinutes');
  return h`<section class="card">
    <div class="card-head"><h2>Security</h2></div>
    ${setRow('PIN', 'Four digits, asked for on this device', h`<a class="btn small secondary" href="#/settings/pin">Change</a>`)}
    ${setRow('Lock after', 'Time away before the PIN is asked again, on every device', h`<select class="pill-select" data-setting="lockMinutes" aria-label="Lock after">
      ${(LOCK_CHOICES.includes(mins) ? LOCK_CHOICES : LOCK_CHOICES.concat([mins]).sort((a, b) => a - b)).map((n) =>
    h`<option value="${n}" ${n === mins ? 'selected' : ''}>${plural(n, 'minute')}</option>`)}</select>`)}
    ${setRow('Recovery code', 'Make a new one; the old one stops working', h`<a class="btn small secondary" href="#/settings/recovery">New code</a>`)}
  </section>`;
}

function devicesCard() {
  let body;
  if (devices.list) {
    const active = devices.list.filter((d) => d.active).sort((a, b) => (b.id === devices.currentId) - (a.id === devices.currentId) ||
      String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
    const gone = devices.list.length - active.length;
    body = h`${active.map((d) => setRow(d.name || 'Unnamed device', deviceDetail(d), d.id === devices.currentId ? '' :
      h`<button class="btn small secondary" data-act="revoke" data-id="${d.id}" data-name="${d.name}">Revoke</button>`))}
      ${gone ? h`<p class="card-body muted small">${plural(gone, 'disconnected device')} not shown.</p>` : ''}`;
  } else if (devices.error) {
    body = h`<p class="card-body muted">${devices.error}</p>`;
  } else {
    body = h`<p class="card-body muted">Loading your devices…</p>`;
  }
  return h`<section class="card">
    <div class="card-head"><h2>Devices</h2>${devices.list ? h`<button class="link small" data-act="reload-devices">Refresh</button>` : ''}</div>
    ${body}
    ${setRow('Add a device', 'Shows a one-time code and a QR code for your phone', h`<a class="btn small" href="#/settings/add-device">Add</a>`)}
    ${setRow('Disconnect this device', 'Erases Skyway here. Your Sheet keeps everything.', h`<button class="btn small ghost danger-text" data-act="disconnect-self">Disconnect</button>`)}
  </section>`;
}

function dataCard() {
  const sheet = safeUrl(store.meta('sheetUrl'));
  return h`<section class="card">
    <div class="card-head"><h2>Your data</h2></div>
    ${setRow('Google Sheet', 'Where everything is stored', sheet ? h`<a class="btn small secondary" href="${sheet}" target="_blank" rel="noopener">Open${icon('external', 14)}</a>` : '')}
    ${setRow('Download everything again', 'Refreshes this device’s copy from the Sheet. Changes waiting here are kept.', h`<button class="btn small secondary" data-act="full-sync">Download</button>`)}
  </section>`;
}

function aboutCard() {
  const connected = store.meta('connectedAt');
  return h`<section class="card">
    <div class="card-head"><h2>About</h2></div>
    ${setRow('Skyway app', 'Version ' + APP_VERSION, '')}
    ${setRow('This device', (store.meta('deviceName') || 'Unnamed') + (connected ? ' · connected ' + fmtDate(connected) : ''), '')}
  </section>`;
}

export const settingsView = {
  id: 'settings', chrome: 'sub', navKey: 'settings', live: true,
  title: () => 'Settings',
  render() {
    const desktop = ui.desktop();
    return h`<div class="page ${desktop ? 'wide' : ''}">
      ${desktop ? topHead({ title: 'Settings' }) : subHead({ title: 'Settings', back: '#/more' })}
      <div class="${desktop ? 'cols2' : 'stack'}">
        <div class="stack">${desktop ? syncCard() : ''}${tiersCard()}${securityCard()}</div>
        <div class="stack">${devicesCard()}${dataCard()}${aboutCard()}</div>
      </div>
    </div>`;
  },
  mount() { loadDevices(false); },
  async change(el) {
    const key = el.dataset.setting;
    if (!key) return;
    await store.save('Settings', { id: key, value: el.value });
    toast('Saved. Your other devices get it at their next sync.');
  },
  act: {
    'reload-devices'() { loadDevices(true); ui.render(); },
    async revoke(el) {
      const ok = await ask({
        title: 'Revoke ' + (el.dataset.name || 'this device') + '?',
        body: 'It stops syncing right away and erases its copy the next time it connects. To use it again, add it with a new code.',
        ok: 'Revoke', danger: true
      });
      if (!ok) return;
      const r = await sync.revokeDevice(el.dataset.id);
      devices.list = r.devices || devices.list;
      toast('Revoked ' + (el.dataset.name || 'the device'));
      ui.render();
    },
    async 'disconnect-self'() {
      const lost = store.pendingCount();
      const ok = await ask({
        title: 'Disconnect this device?',
        body: (lost ? plural(lost, 'change') + ' here haven’t synced and will be lost. ' : '') +
          'Skyway is erased on this device. Everything stays in your Sheet, and you can connect again with a new code.',
        ok: 'Disconnect', danger: true
      });
      if (!ok) return;
      const id = store.meta('deviceId');
      try { await sync.revokeDevice(id); } catch (err) {
        toast('Couldn’t reach the brain, so the device is still listed in the Sheet. Revoke it there if you like.', { warn: true, ms: 6000 });
      }
      await store.wipe();
      lock.lockNow();
      ui.go('#/today');
      ui.render();
    },
    async 'full-sync'() {
      toast('Downloading everything…');
      await sync.syncNow({ full: true });
      const s = sync.syncStatus();
      if (s.state === 'idle') toast('Up to date');
    }
  }
};

/* ---------------------------------------------------------- add device */

const pairing = { name: '', result: null, error: '', busy: false, timer: null };

function pairLink(r) {
  const base = location.origin + location.pathname;
  return base + '#connect=' + encodeURIComponent(r.brainUrl || store.meta('brainUrl')) + '&code=' + r.display;
}

function minutesLeft(r) {
  return Math.max(0, Math.ceil((Date.parse(r.expiresAt) - Date.now()) / 60000));
}

export const addDeviceView = {
  id: 'add-device', chrome: 'sub', navKey: 'settings', live: false,
  title: () => 'Add a device',
  render() {
    const r = pairing.result;
    if (!r) {
      return h`<div class="page narrow">
        ${subHead({ title: 'Add a device', back: '#/settings' })}
        <form class="stack" data-form="pair">
          <p class="muted">Name the new device so you can tell your devices apart later.</p>
          <label class="field"><span class="label">Device name</span>
            <input type="text" name="name" value="${pairing.name}" placeholder="Samsung phone" autocomplete="off" autocapitalize="words" autofocus></label>
          <div class="chips">${['Samsung phone', 'Laptop', 'Desktop PC'].map((n) => h`<button type="button" class="chipbtn tint" data-act="name" data-name="${n}">${n}</button>`)}</div>
          ${pairing.error ? h`<p class="error">${pairing.error}</p>` : ''}
          <button class="btn block" type="submit" ${pairing.busy ? 'disabled' : ''}>${pairing.busy ? 'Making a code…' : 'Make a one-time code'}</button>
        </form>
      </div>`;
    }
    const left = minutesLeft(r);
    const link = pairLink(r);
    return h`<div class="page narrow">
      ${subHead({ title: 'Add ' + r.name, back: '#/settings' })}
      ${left ? h`<div class="pair">
        <div class="qr">${raw(qrSvg(link, 'QR code to connect ' + r.name))}</div>
        <ol class="steps">
          <li><b>A phone:</b> open its camera, point it at this code, and tap the link it finds.
            <b>A computer:</b> use Copy link below, send it to yourself, and open it there.</li>
          <li>Skyway opens with everything filled in. Tap <b>Connect</b>, then choose a PIN for that device.</li>
        </ol>
        <p class="muted small">Or open <b>${location.origin + location.pathname}</b> on ${r.name} and type this code:</p>
        <div class="bigcode" aria-label="One-time code">${r.display}</div>
        <p class="muted small center">Works once, for ${plural(left, 'more minute')} (until ${fmtTime(r.expiresAt)}).</p>
        <details class="help"><summary>Brain address, for typing it in</summary>
          <p class="mono">${r.brainUrl || store.meta('brainUrl')}</p>
          <button class="btn small secondary" data-act="copy" data-text="${r.brainUrl || store.meta('brainUrl')}">${icon('copy', 16)}Copy address</button></details>
        <div class="actions-row two">
          <button class="btn secondary" data-act="copy" data-text="${link}">${icon('link', 16)}Copy link</button>
          <button class="btn" data-act="done">Done</button>
        </div>
      </div>` : h`<div class="card empty"><b>That code has expired</b><p>Codes work for 15 minutes.</p>
        <button class="btn" data-act="again">Make a new code</button></div>`}
    </div>`;
  },
  mount() {
    clearInterval(pairing.timer);
    if (pairing.result) {
      pairing.timer = setInterval(() => {
        if (!location.hash.startsWith('#/settings/add-device')) { clearInterval(pairing.timer); return; }
        ui.render();
      }, 30000);
    }
  },
  input(el) { if (el.name === 'name') pairing.name = el.value; },
  async submit(form) {
    const name = String(form.name.value || '').trim();
    if (!name) { pairing.error = 'Give it a name, like “Samsung phone”.'; ui.render(); return; }
    pairing.name = name;
    pairing.busy = true;
    pairing.error = '';
    ui.render();
    try {
      pairing.result = await sync.makeCode(name);
    } catch (err) {
      pairing.error = err.message;
    }
    pairing.busy = false;
    ui.render();
  },
  act: {
    name(el) { pairing.name = el.dataset.name; ui.render(); },
    async copy(el) {
      try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch (err) { toast('Couldn’t copy. Select it and copy by hand.', { warn: true }); }
    },
    done() {
      pairing.result = null;
      pairing.name = '';
      loadDevices(true);
      ui.back('#/settings');
    },
    again() { pairing.result = null; ui.render(); }
  }
};

/* ------------------------------------------------------------ change PIN */

const change = { stage: 'current', first: '' };
const changeMachine = pinMachine(async (pin) => {
  if (change.stage === 'current') {
    const r = await lock.checkPin(pin);
    changeMachine.reset();
    if (!r.ok) {
      changeMachine.paint(r.waitMs ? 'Too many tries. Wait ' + Math.ceil(r.waitMs / 1000) + ' seconds.' : 'That’s not your current PIN.', 'bad');
      return;
    }
    change.stage = 'new';
    ui.render();
    return;
  }
  if (change.stage === 'new') {
    change.first = pin;
    change.stage = 'confirm';
    changeMachine.reset();
    ui.render();
    return;
  }
  changeMachine.reset();
  if (pin !== change.first) {
    change.stage = 'new';
    change.first = '';
    ui.render();
    changeMachine.paint('Those didn’t match. Choose your new PIN again.', 'bad');
    return;
  }
  await lock.setPin(pin);
  change.stage = 'current';
  change.first = '';
  toast('PIN changed on this device');
  ui.back('#/settings');
});

export const changePinView = {
  id: 'change-pin', chrome: 'sheet', navKey: 'settings', live: false,
  title: () => 'Change PIN',
  render() {
    const t = { current: 'Enter your current PIN', new: 'Choose a new PIN', confirm: 'Enter it again' }[change.stage];
    return h`<div class="page narrow">
      ${sheetHead({ title: 'Change PIN', act: 'cancel' })}
      <div class="onb center inset"><h2>${t}</h2>
        <p class="muted">${change.stage === 'current' ? 'The PIN is for this device. Each device has its own.' : 'Four digits.'}</p>
        ${keypad(changeMachine.value.length)}</div>
    </div>`;
  },
  mount() { listenKeys(changeMachine); },
  act: {
    key: (el) => changeMachine.press(el.dataset.k),
    cancel() {
      change.stage = 'current';
      change.first = '';
      changeMachine.reset();
      ui.back('#/settings');
    }
  }
};

/* --------------------------------------------------------- recovery code */

const rec = { stage: 'pin', code: '' };
const recMachine = pinMachine(async (pin) => {
  const r = await lock.checkPin(pin);
  recMachine.reset();
  if (!r.ok) {
    recMachine.paint(r.waitMs ? 'Too many tries. Wait ' + Math.ceil(r.waitMs / 1000) + ' seconds.' : 'That’s not your PIN.', 'bad');
    return;
  }
  rec.code = await lock.makeRecoveryCode();
  rec.stage = 'show';
  ui.render();
});

export const recoveryView = {
  id: 'recovery', chrome: 'sheet', navKey: 'settings', live: false,
  title: () => 'Recovery code',
  render() {
    if (rec.stage === 'show') {
      return h`<div class="page narrow">
        ${sheetHead({ title: 'New recovery code', act: 'finish' })}
        <div class="stack inset">
          <p>Your old code no longer works. Save this one somewhere safe, like OneNote or a password manager.</p>
          <div class="bigcode">${rec.code}</div>
          <button class="btn secondary block" data-act="copy">${icon('copy', 18)}Copy code</button>
          <button class="btn block" data-act="finish">I saved it</button>
        </div>
      </div>`;
    }
    return h`<div class="page narrow">
      ${sheetHead({ title: 'New recovery code', act: 'finish' })}
      <div class="onb center inset"><h2>Enter your PIN</h2>
        <p class="muted">Then Skyway makes a new recovery code for this device. The old one stops working.</p>
        ${keypad(recMachine.value.length)}</div>
    </div>`;
  },
  mount() { if (rec.stage === 'pin') listenKeys(recMachine); },
  act: {
    key: (el) => recMachine.press(el.dataset.k),
    async copy() {
      try { await navigator.clipboard.writeText(rec.code); toast('Copied'); } catch (err) { toast('Select the code and copy it by hand'); }
    },
    finish() {
      rec.stage = 'pin';
      rec.code = '';
      recMachine.reset();
      ui.back('#/settings');
    }
  }
};
