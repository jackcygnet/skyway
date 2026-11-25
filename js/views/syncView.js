// Skyway app · Sync & health: what's waiting, what the brain refused, and
// when each device last synced.

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import { h, fmtAgo, fmtDate, fmtTime, plural, todayYmd, ymdOf } from '../util.js';
import { icon } from '../icons.js';
import { subHead, recordLabel } from './parts.js';
import { devices, loadDevices, deviceDetail } from './settings.js';

const REASONS = {
  bad_value: 'The brain didn’t accept a value',
  bad_id: 'The record’s id isn’t valid',
  unknown_setting: 'The brain doesn’t know this setting. Update the brain files',
  insert_not_allowed: 'This kind of record can’t be added from the app',
  bad_record: 'The record was damaged'
};

function whenText(iso) {
  if (!iso) return 'never';
  return ymdOf(new Date(iso)) === todayYmd() ? 'today at ' + fmtTime(iso) : fmtDate(iso) + ' at ' + fmtTime(iso);
}

function headline() {
  const s = sync.syncStatus();
  if (s.failed) return { tone: 'warn', icon: 'alert', title: plural(s.failed, 'change') + ' couldn’t sync', detail: 'See below. Everything else is syncing normally.' };
  if (s.state === 'syncing') return { tone: '', icon: 'refresh', title: 'Syncing now…', detail: s.pending ? plural(s.pending, 'change') + ' to send' : 'Checking for changes' };
  if (s.state === 'offline' || navigator.onLine === false) return { tone: 'quiet', icon: 'cloudOff', title: 'Offline', detail: s.pending ? plural(s.pending, 'change') + ' saved here. They sync when you’re back online.' : 'Everything is saved on this device.' };
  if (s.state === 'error') return { tone: 'warn', icon: 'alert', title: 'Can’t reach the brain right now', detail: s.message + ' Skyway keeps trying.' };
  if (s.pending) return { tone: '', icon: 'cloud', title: plural(s.pending, 'change') + ' waiting', detail: 'They go out within a few seconds.' };
  return { tone: 'ok', icon: 'check', title: 'Everything is up to date', detail: s.lastSync ? 'Last synced ' + whenText(s.lastSync) : 'Not synced yet' };
}

function failedList() {
  const f = store.failedEntries();
  if (!f.length) return '';
  return h`<section class="block"><h2 class="group-label late">Couldn’t sync</h2>
    <div class="stack tight">${f.map((e) => h`<div class="card failed">
      <b>${recordLabel(e.t, e.r)}</b>
      <p class="muted small">${REASONS[e.failed.reason] || e.failed.reason}${e.failed.field ? ' (' + e.failed.field + ')' : ''}${e.failed.message ? ': ' + e.failed.message : '.'}</p>
      <div class="row-actions">
        <button class="btn small secondary" data-act="retry" data-k="${e.k}">Try again</button>
        <button class="btn small ghost danger-text" data-act="discard" data-k="${e.k}">Discard my change</button>
      </div>
    </div>`)}</div>
  </section>`;
}

function waitingList() {
  const w = store.outboxEntries().filter((e) => !e.failed);
  if (!w.length) return '';
  return h`<section class="block"><h2 class="group-label">Waiting to sync</h2>
    <div class="card list">${w.slice(0, 15).map((e) => h`<div class="row"><span class="main"><b>${recordLabel(e.t, e.r)}</b>
      <small>${e.r && e.r.deleted ? 'Deleted' : 'Changed'} ${fmtAgo(e.r && e.r.updatedAt)}</small></span></div>`)}
      ${w.length > 15 ? h`<p class="card-body muted small">and ${w.length - 15} more</p>` : ''}</div>
  </section>`;
}

const PART_NAMES = { reminders: 'Reminder emails', collector: 'Desktop collector', gmail: 'Gmail check' };

/**
 * A part of Skyway that reports in (the reminder timer, later the desktop
 * collector). One that has been quiet longer than healthQuietDays is
 * flagged, unless it's quiet on purpose (reminders paused or no address).
 */
export function healthPart(r) {
  const quietDays = model.settingNum('healthQuietDays');
  const last = r.lastCheckInAt ? Date.parse(r.lastCheckInAt) : 0;
  const days = last ? (Date.now() - last) / 86400000 : Infinity;
  const resting = (r.id === 'reminders' && (!model.settingBool('remindersOn') || !model.setting('reminderAddress'))) ||
    (r.id === 'gmail' && !model.settingBool('gmailOn'));
  const name = PART_NAMES[r.id] || r.id;
  const when = last ? fmtAgo(r.lastCheckInAt) : '';
  if (resting && r.id === 'gmail') return { ok: true, idle: true, name, detail: 'Off. Turn it on in Settings, under Email.', when };
  if (resting) return { ok: true, idle: true, name, detail: model.settingBool('remindersOn') ? 'No address yet, so nothing is sent' : 'Paused', when };
  if (days > quietDays) {
    return { ok: false, name, when, detail: 'Hasn’t checked in for ' + plural(Math.floor(days), 'day') + '. ' +
      (r.id === 'reminders' || r.id === 'gmail' ? 'In the Sheet, choose Skyway > Check setup.' : 'Check that it’s running.') };
  }
  return { ok: r.status === 'OK', name, detail: r.status === 'OK' ? (r.details || 'OK') : (r.lastError || r.status), when };
}

function parts() {
  const s = sync.syncStatus();
  const brainHealth = store.get('Health', 'brain');
  const rows = [];
  rows.push({
    ok: !s.failed && s.state !== 'error', name: (store.meta('deviceName') || 'This device') + ' (this device)',
    detail: s.pending ? plural(s.pending, 'change') + ' waiting' : 'Nothing waiting to sync', when: s.lastSync ? fmtAgo(s.lastSync) : 'never'
  });
  rows.push({
    ok: !brainHealth || brainHealth.status === 'OK', name: 'Brain' + (store.meta('brainVersion') ? ' ' + store.meta('brainVersion') : ''),
    detail: brainHealth ? (brainHealth.status === 'OK' ? 'Last self-test passed' : 'Last self-test: ' + (brainHealth.lastError || brainHealth.status))
      : 'Answering normally',
    when: brainHealth && brainHealth.lastCheckInAt ? fmtDate(brainHealth.lastCheckInAt) : ''
  });
  if (devices.list) {
    devices.list.filter((d) => d.active && d.id !== devices.currentId).forEach((d) => {
      rows.push({ ok: true, idle: true, name: d.name, detail: deviceDetail(d), when: d.lastSeenAt ? fmtAgo(d.lastSeenAt) : '' });
    });
  }
  model.healthRows().filter((r) => r.id !== 'brain').forEach((r) => rows.push(healthPart(r)));
  return h`<section class="card list parts">${rows.map((p) => h`<div class="row">
    <span class="part-icon ${p.ok ? 'ok' : 'bad'}">${icon(p.ok ? 'checkCircle' : 'alert', 20)}</span>
    <span class="main"><b>${p.name}</b><small>${p.detail}</small></span>
    ${p.when ? h`<span class="muted small">${p.when}</span>` : ''}
  </div>`)}
  ${!devices.list && devices.error ? h`<p class="card-body muted small">${devices.error}</p>` : ''}</section>`;
}

export default {
  id: 'sync', chrome: 'sub', navKey: 'settings', live: true,
  title: () => 'Sync & health',
  render() {
    const top = headline();
    const s = sync.syncStatus();
    return h`<div class="page narrow">
      ${subHead({ title: 'Sync & health', back: ui.desktop() ? '#/settings' : '#/more' })}
      <section class="status-card ${top.tone}">
        <span class="status-icon">${icon(top.icon, 22)}</span>
        <span class="main"><b>${top.title}</b><small>${top.detail}</small></span>
        <button class="btn small secondary" data-act="sync-now" ${s.state === 'syncing' ? 'disabled' : ''}>Sync now</button>
      </section>
      ${s.lostEdits ? h`<div class="note">${icon('alert', 18)}<span>${plural(s.lostEdits, 'edit')} made here ${s.lostEdits === 1 ? 'was' : 'were'} older than a change made on another device or in the Sheet, so the newer version was kept.</span></div>` : ''}
      ${failedList()}
      ${waitingList()}
      ${parts()}
      <section class="card">
        <div class="card-head"><h2>How syncing works</h2></div>
        <p class="card-body">Every change is saved on this device first, then sent to your Google Sheet within a few seconds whenever you’re online.
          Skyway also checks for changes from your other devices and the Sheet every 5 minutes, and each time you open it.</p>
        <p class="card-body">If two devices change the same thing, the later change wins.</p>
        <button class="btn secondary" data-act="full-sync">${icon('refresh', 16)}Download everything again</button>
      </section>
    </div>`;
  },
  mount() { loadDevices(false); },
  act: {
    async retry(el) {
      await store.retry(el.dataset.k);
      toast('Trying again…');
    },
    async discard(el) {
      const ok = await ask({ title: 'Discard this change?', body: 'This device goes back to the version in your Sheet.', ok: 'Discard', danger: true });
      if (!ok) return;
      await store.discard(el.dataset.k);
      sync.syncNow();
    },
    async 'full-sync'() {
      toast('Downloading everything…');
      await sync.syncNow({ full: true });
      if (sync.syncStatus().state === 'idle') toast('Up to date');
    }
  }
};
