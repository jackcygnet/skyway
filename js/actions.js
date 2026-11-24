// Skyway app · changes more than one screen makes: finishing tasks, event
// mode, "not the same person", adding someone to an event, snoozing or
// skipping a check-in.

import * as store from './store.js';
import * as model from './model.js';
import { nowIso, todayYmd, addDays, addCadence } from './util.js';

export const SNOOZE_DAYS = 14;

export async function completeTask(id) {
  const t = model.getLive('Tasks', id);
  if (!t) return null;
  await store.save('Tasks', { id, status: 'Done', doneAt: nowIso() });
  return t;
}

export async function reopenTask(id) {
  await store.save('Tasks', { id, status: 'Open', doneAt: '' });
}

export async function dismissDuplicate(key) {
  const keys = model.notDuplicateKeys();
  if (!keys.includes(key)) keys.push(key);
  await store.save('Settings', { id: 'notDuplicates', value: keys.join(';') });
}

export async function startEventMode(eventId) {
  await store.setMeta({ eventMode: { eventId, startedAt: nowIso() } });
}

export async function endEventMode() {
  await store.setMeta({ eventMode: undefined });
}

/** Puts someone on an event's list of people, unless they're already on it. */
export function attendanceItem(eventId, contactId) {
  const already = model.attendanceOf(eventId).some((a) => a.contactId === contactId);
  return already ? null : { t: 'Attendance', r: { eventId, contactId } };
}

export async function addToEvent(eventId, contactId) {
  const item = attendanceItem(eventId, contactId);
  if (item) await store.saveMany([item]);
  return !!item;
}

export async function removeFromEvent(eventId, contactId) {
  const rows = model.attendanceOf(eventId).filter((a) => a.contactId === contactId);
  if (rows.length) await store.saveMany(rows.map((a) => ({ t: 'Attendance', r: { id: a.id, deleted: true } })));
}

/* ------------------------------------------------- snooze and skip */
// The same rows the email buttons write: a check-in reminder for this round
// with status Snoozed or Skipped. The brain reads them to decide what to send.

function latest(rows) {
  return rows.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
}

async function setRound(c, patch) {
  const r = model.round(c);
  if (!r) return null;
  const row = latest(r.rows);
  if (row) {
    const undo = { id: row.id, status: row.status || 'Scheduled', snoozeUntil: row.snoozeUntil || '' };
    await store.save('Reminders', Object.assign({ id: row.id }, patch));
    return undo;
  }
  const saved = await store.save('Reminders', Object.assign({ contactId: c.id, kind: 'Check-in', dueAt: r.due }, patch));
  return { id: saved.id, created: true };
}

/** Holds the reminder for two weeks. The due date stays the same. Returns what Undo needs. */
export async function snoozeCheckIn(c, days) {
  const until = addDays(todayYmd(), days || SNOOZE_DAYS);
  const undo = await setRound(c, { status: 'Snoozed', snoozeUntil: until });
  return undo ? Object.assign(undo, { until }) : null;
}

/** Skips this round: the next check-in is one cadence from today. */
export async function skipCheckIn(c) {
  const r = model.round(c);
  if (!r) return null;
  const next = addCadence(todayYmd(), r.cad);
  const undo = await setRound(c, { status: 'Skipped', snoozeUntil: next });
  return undo ? Object.assign(undo, { next }) : null;
}

export async function undoRound(undo) {
  if (!undo) return;
  if (undo.created) await store.save('Reminders', { id: undo.id, deleted: true });
  else await store.save('Reminders', { id: undo.id, status: undo.status, snoozeUntil: undo.snoozeUntil });
}

/** Ends a snooze now, so the person shows as due again. */
export async function endSnooze(c) {
  const r = model.round(c);
  if (!r) return;
  const rows = r.rows.filter((x) => x.status === 'Snoozed');
  if (rows.length) {
    await store.saveMany(rows.map((x) => ({ t: 'Reminders', r: { id: x.id, status: x.sentAt ? 'Sent' : 'Scheduled', snoozeUntil: '' } })));
  }
}

/** Puts back the round that was skipped most recently (from the app or an email button). */
export async function undoSkip(c) {
  const r = model.round(c);
  if (!r || !r.skip) return null;
  const row = r.skip.row;
  if (row.sentAt) await store.save('Reminders', { id: row.id, status: 'Sent', snoozeUntil: '' });
  else await store.save('Reminders', { id: row.id, deleted: true });
  return r.skip.from;
}
