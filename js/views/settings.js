// Skyway app · Settings: check-in tiers, reminder emails, email, security, devices, your data.
// Also the screens for adding a device, changing the PIN, and a new
// recovery code.

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as lock from '../lock.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import { h, raw, fmtAgo, fmtDate, fmtTime, plural, describeCadence, CADENCE_CHOICES, safeUrl, validEmail, todayYmd, ymdOf } from '../util.js';
import { icon } from '../icons.js';
import { qrSvg } from '../qr.js';
import { APP_VERSION } from '../brain.js';
import { topHead, subHead, sheetHead, keypad, pinMachine, listenKeys, peopleCount } from './parts.js';
import { syncSummary } from './more.js';
import { gmail, loadGmailStatus, checkGmailNow, checkWords } from './review.js';

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

/* ------------------------------------------------------- reminder status */
// Whether the brain's hourly timer is on, and how the last run went. Asked
// for when Settings opens; the settings themselves sync like everything else.

export const reminders = { status: null, error: '', loading: false, at: 0 };

export function loadReminderStatus(force) {
  if (reminders.loading || !sync.brainAtLeast('1.2.0')) return;
  if (!force && Date.now() - reminders.at < 60000) return;
  reminders.loading = true;
  reminders.error = '';
  sync.remindersStatus().then((r) => {
    reminders.status = r;
  }).catch((err) => {
    reminders.status = null;
    reminders.error = err.code === 'offline' ? 'Connect to the internet to see whether reminders are running.' : err.message;
  }).finally(() => {
    reminders.at = Date.now();
    reminders.loading = false;
    if (/^#\/(settings|more)\b/.test(location.hash)) ui.render();
  });
}

function hourLabel(n) { return (n % 12 === 0 ? 12 : n % 12) + (n < 12 ? ' AM' : ' PM'); }

/** One line saying whether reminders are working, from the settings here and the brain's last report. */
function reminderState() {
  const st = reminders.status;
  const addr = model.setting('reminderAddress');
  if (!sync.brainAtLeast('1.2.0')) {
    return { tone: 'warn', chip: 'Needs update', text: 'Reminder emails need brain version 1.2.0. Follow step 3 of the setup guide to update it.' };
  }
  if (!validEmail(addr)) return { tone: 'warn', chip: 'Off', text: 'Add the address reminders should go to.' };
  if (!model.settingBool('remindersOn')) return { tone: 'quiet', chip: 'Paused', text: 'Paused. Nothing is lost; turn them back on any time.' };
  if (reminders.error) return { tone: 'quiet', chip: 'On', text: reminders.error };
  if (!st) return { tone: 'quiet', chip: 'On', text: 'Checking the brain…' };
  if (st.timerOn === false) return { tone: 'warn', chip: 'Timer off', text: 'The brain’s hourly timer is off. In the Sheet, choose Skyway > Set up or repair the Sheet.' };
  if (st.timerOn === null) return { tone: 'warn', chip: 'Needs setup', text: 'The brain can’t send yet. In Apps Script, run setupSkyway once and allow what it asks (setup guide, step 3).' };
  const h0 = st.health;
  if (h0 && h0.lastCheckInAt) {
    const when = ymdOf(new Date(h0.lastCheckInAt)) === todayYmd() ? 'today at ' + fmtTime(h0.lastCheckInAt) : fmtDate(h0.lastCheckInAt);
    const what = String(h0.details || '').replace(/^[A-Z][a-z]{2} \d{1,2}: /, '');
    return { tone: h0.status === 'OK' ? 'ok' : 'warn', chip: h0.status === 'OK' ? 'On' : 'Problem', text: 'Last run ' + when + ': ' + what };
  }
  return { tone: 'ok', chip: 'On', text: 'On. The first reminders go out at about ' + hourLabel(model.settingNum('reminderHour')) + '.' };
}

function switchFor(key, label) {
  return h`<button type="button" class="switch" role="switch" aria-checked="${model.settingBool(key)}" aria-label="${label}"
    data-act="toggle-setting" data-key="${key}"><span></span></button>`;
}

function numberSelect(key, label, values, word) {
  const cur = model.settingNum(key);
  const list = values.includes(cur) ? values : values.concat([cur]).sort((a, b) => a - b);
  return h`<select class="pill-select" data-setting="${key}" aria-label="${label}">
    ${list.map((n) => h`<option value="${n}" ${n === cur ? 'selected' : ''}>${word(n)}</option>`)}</select>`;
}

function remindersCard() {
  const state = reminderState();
  const ready = sync.brainAtLeast('1.2.0');
  const hours = [];
  for (let n = 0; n < 24; n++) hours.push(n);
  return h`<section class="card" id="reminders">
    <div class="card-head"><h2>Reminder emails</h2><span class="chip ${state.tone === 'warn' ? 'late' : (state.tone === 'ok' ? 'soon' : 'quiet')}">${state.chip}</span></div>
    <div class="rem-status ${state.tone}"><span>${icon(state.tone === 'warn' ? 'alert' : (state.tone === 'ok' ? 'checkCircle' : 'clock'), 18)}</span><span>${state.text}</span></div>
    <form class="addr-form" data-form="reminder-address" novalidate>
      <label class="field"><span>Send reminders to</span>
        <span class="inline-input"><input type="email" name="address" value="${model.setting('reminderAddress')}" placeholder="you@stthomas.edu"
          autocomplete="email" inputmode="email" spellcheck="false" data-skip><button class="btn small" type="submit">Save</button></span></label>
      <p class="error" id="addr-error" hidden></p>
    </form>
    ${ready ? h`
    ${setRow('Send reminder emails', 'Check-ins when someone comes due, from your Gmail', switchFor('remindersOn', 'Send reminder emails'))}
    ${setRow('Time of day', 'When each day’s reminders go out', numberSelect('reminderHour', 'Time of day', hours, (n) => 'About ' + hourLabel(n)))}
    ${setRow('One nudge after', 'If a check-in still isn’t logged', numberSelect('overdueNudgeDays', 'Nudge after', [3, 7, 10, 14, 21, 30], (n) => plural(n, 'day')))}
    ${setRow('Most per day', 'Extras wait for the next day, most overdue first', numberSelect('remindersPerDay', 'Most per day', [3, 5, 10, 15, 20, 30, 50], (n) => String(n)))}
    ${setRow('Task reminders', 'An email the day a task is due, whoever owes it', switchFor('taskReminders', 'Task reminders'))}
    ${setRow('Test email', 'A sample reminder. Its buttons work but change nothing.', h`<button class="btn small secondary" data-act="test-email">Send test</button>`)}` : ''}
  </section>`;
}

/* ---------------------------------------------------------------- email */
// Reading Gmail happens in the brain every 15 minutes. These settings sync
// like any other; the line at the top comes from the brain's last check.

const wordsUi = { editing: false };

/** One line saying whether Gmail reading works, from the settings here and the brain's last report. */
function gmailState() {
  const st = gmail.status;
  if (!sync.brainAtLeast('1.3.0')) {
    return { tone: 'warn', chip: 'Needs update', text: 'Reading Gmail needs brain version 1.3.0. Follow step 4 of the setup guide to update it.' };
  }
  if (!model.settingBool('gmailOn')) return { tone: 'quiet', chip: 'Off', text: 'Off. Skyway isn’t reading Gmail. Nothing already logged is lost.' };
  if (gmail.error) return { tone: 'quiet', chip: 'On', text: gmail.error };
  if (!st) return { tone: 'quiet', chip: 'On', text: 'Asking the brain…' };
  if (st.problem) return { tone: 'warn', chip: 'Problem', text: st.problem.message };
  if (st.timer === false) return { tone: 'warn', chip: 'Timer off', text: 'The brain’s 15-minute Gmail timer is off. In the Sheet, choose Skyway > Set up or repair the Sheet.' };
  if (!st.started) return { tone: 'quiet', chip: 'On', text: 'Waiting for the first check. It logs the last 30 days of email with your contacts.' };
  const h0 = st.health;
  const when = st.lastCheckAt ? fmtAgo(st.lastCheckAt) : '';
  const today = st.today ? 'Today: ' + plural(st.today.logged, 'email') + ' logged, ' + plural(st.today.queued, 'new sender') + ' for review.' : '';
  const warn = h0 && h0.status !== 'OK';
  return { tone: warn ? 'warn' : 'ok', chip: warn ? 'Problem' : 'On',
    text: (st.address ? 'Reading ' + st.address + ', read only. ' : '') + (when ? 'Last check ' + when + '. ' : '') + (warn ? (h0.lastError || '') : today) };
}

function filtersSummary() {
  const n = (k) => model.filtersOf(k).length;
  const parts = [model.settingBool('skipBulk') ? 'Bulk mail skipped' : 'Bulk mail not skipped'];
  const s = n('Ignore sender'), d = n('Ignore domain');
  if (s || d) parts.push([s ? plural(s, 'sender') : '', d ? plural(d, 'domain') : ''].filter(Boolean).join(' and ') + ' ignored');
  return parts.join('; ');
}

function wordsList() {
  return model.setting('replyWords').split(';').map((w) => w.trim()).filter(Boolean);
}

function wordsSummary() {
  const list = wordsList();
  return 'Questions, ' + list.slice(0, 2).map((w) => '“' + w + '”').join(', ') + (list.length > 2 ? '…' : '');
}

function labelLine() {
  const st = gmail.status;
  if (!st || st.labelFound === null || st.labelName !== model.setting('overrideLabel')) return 'Give an email this Gmail label to log it anyway';
  return st.labelFound ? 'Found in Gmail. Emails you give it are logged anyway.' : 'Not in Gmail yet. Make a Gmail label with this name when you need it.';
}

function emailCard() {
  const state = gmailState();
  const ready = sync.brainAtLeast('1.3.0');
  return h`<section class="card" id="email">
    <div class="card-head"><h2>Email</h2><span class="chip ${state.tone === 'warn' ? 'late' : (state.tone === 'ok' ? 'soon' : 'quiet')}">${state.chip}</span></div>
    <div class="rem-status ${state.tone}"><span>${icon(state.tone === 'warn' ? 'alert' : (state.tone === 'ok' ? 'checkCircle' : 'clock'), 18)}</span><span>${state.text}</span></div>
    ${ready ? h`
    ${setRow('Read Gmail', 'Logs email with your contacts every 15 minutes. Skyway can’t change or delete your mail.', switchFor('gmailOn', 'Read Gmail'))}
    ${setRow('Email filters', filtersSummary(), h`<a class="btn small secondary" href="#/filters">Manage</a>`)}
    ${setRow('Reply owed after', 'How long an email that needs your answer waits before Today flags it',
    numberSelect('replyOwedDays', 'Reply owed after', [1, 2, 3, 5, 7, 14], (n) => plural(n, 'day')))}
    ${setRow('Reply-needed words', wordsSummary(), wordsUi.editing ? '' : h`<button class="btn small secondary" data-act="edit-words">Edit</button>`)}
    ${wordsUi.editing ? h`<form class="addr-form" data-form="reply-words" novalidate>
      <label class="field"><span>One phrase per line. An email with one of these, or a question mark, needs your reply.</span>
        <textarea name="words" rows="6" spellcheck="false" data-skip>${wordsList().join('\n')}</textarea></label>
      <span class="row-actions"><button class="btn small" type="submit">Save</button>
        <button class="btn small ghost" type="button" data-act="cancel-words">Cancel</button></span>
    </form>` : ''}
    <form class="addr-form" data-form="override-label" novalidate>
      <label class="field"><span>Override label</span>
        <span class="inline-input"><input type="text" name="label" value="${model.setting('overrideLabel')}" placeholder="Skyway"
          autocomplete="off" spellcheck="false" data-skip><button class="btn small" type="submit">Save</button></span></label>
      <p class="hint">${labelLine()}</p>
    </form>
    <form class="addr-form" data-form="my-addresses" novalidate>
      <label class="field"><span>Your other addresses</span>
        <span class="inline-input"><input type="text" name="addresses" value="${model.setting('myAddresses')}" placeholder="old.address@yahoo.com"
          autocomplete="off" inputmode="email" spellcheck="false" data-skip><button class="btn small" type="submit">Save</button></span></label>
      <p class="hint">Separate them with semicolons. Mail between your own addresses is never logged. Your Gmail and reminder address count already.</p>
    </form>
    ${setRow('Check Gmail now', 'Reads new mail right away instead of waiting up to 15 minutes',
      h`<button class="btn small secondary" data-act="check-gmail" ${gmail.checking || !model.settingBool('gmailOn') ? 'disabled' : ''}>${gmail.checking ? 'Checking…' : 'Check now'}</button>`)}` : ''}
  </section>`;
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
        <div class="stack">${desktop ? syncCard() : ''}${tiersCard()}${remindersCard()}${desktop ? '' : emailCard()}${securityCard()}</div>
        <div class="stack">${desktop ? emailCard() : ''}${devicesCard()}${dataCard()}${aboutCard()}</div>
      </div>
    </div>`;
  },
  mount() {
    loadDevices(false);
    loadReminderStatus(false);
    loadGmailStatus(false);
  },
  async change(el) {
    const key = el.dataset.setting;
    if (!key) return;
    await store.save('Settings', { id: key, value: el.value });
    toast('Saved. Your other devices get it at their next sync.');
  },
  async submit(form) {
    if (form.dataset.form === 'reply-words') {
      const words = String(form.words.value || '').split(/[\n;]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
      await store.save('Settings', { id: 'replyWords', value: Array.from(new Set(words)).join('; ') });
      wordsUi.editing = false;
      toast(words.length ? 'Saved ' + plural(words.length, 'phrase') + '. They apply to new email.' : 'Saved. Only question marks count now.');
      return;
    }
    if (form.dataset.form === 'override-label') {
      const v = String(form.label.value || '').trim();
      await store.save('Settings', { id: 'overrideLabel', value: v });
      gmail.at = 0;
      toast(v ? 'Emails with the Gmail label “' + v + '” are logged anyway.' : 'No override label.');
      return;
    }
    if (form.dataset.form === 'my-addresses') {
      const list = String(form.addresses.value || '').split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
      const bad = list.filter((x) => !validEmail(x));
      if (bad.length) {
        toast('“' + bad[0] + '” doesn’t look like an email address.', { warn: true });
        return;
      }
      await store.save('Settings', { id: 'myAddresses', value: list.join('; ') });
      toast(list.length ? 'Saved. Mail with ' + (list.length === 1 ? 'that address' : 'those addresses') + ' counts as your own.' : 'Saved.');
      return;
    }
    if (form.dataset.form !== 'reminder-address') return;
    const err = form.querySelector('#addr-error');
    const v = form.address.value.trim();
    if (v && !validEmail(v)) {
      err.textContent = 'That doesn’t look like an email address.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    await store.save('Settings', { id: 'reminderAddress', value: v });
    reminders.at = 0;
    toast(v ? 'Reminders will go to ' + v + '.' : 'Removed the address, so no reminder emails go out.');
  },
  act: {
    async 'toggle-setting'(el) {
      const key = el.dataset.key;
      const on = !model.settingBool(key);
      await store.save('Settings', { id: key, value: on ? 'TRUE' : 'FALSE' });
      if (key === 'remindersOn') toast(on ? 'Reminder emails are on.' : 'Reminder emails are paused.');
      else if (key === 'gmailOn') toast(on ? 'Gmail reading is on. It starts from now at the next check.' : 'Gmail reading is off.');
      else toast('Saved. Your other devices get it at their next sync.');
    },
    'edit-words'() {
      wordsUi.editing = true;
      ui.render();
    },
    'cancel-words'() {
      wordsUi.editing = false;
      ui.render();
    },
    async 'check-gmail'() {
      try {
        const c = await checkGmailNow();
        if (c) toast(checkWords(c), { ms: 5000 });
      } catch (err) {
        toast(err.message, { warn: true, ms: 7000 });
      }
    },
    async 'test-email'(el) {
      el.disabled = true;
      try {
        if (store.pendingCount()) await sync.syncNow();
        const r = await sync.sendTestReminder();
        toast('Test email sent to ' + r.sentTo + '. Try its Snooze button.', { ms: 6000 });
      } catch (err) {
        toast(err.message, { warn: true, ms: 7000 });
      } finally {
        el.disabled = false;
      }
    },
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
