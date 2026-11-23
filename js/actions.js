// Skyway app · changes more than one screen makes: finishing tasks, event
// mode, "not the same person", adding someone to an event.

import * as store from './store.js';
import * as model from './model.js';
import { nowIso } from './util.js';

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
