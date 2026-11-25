// Skyway app · changes more than one screen makes: finishing tasks, event
// mode, "not the same person", adding someone to an event, snoozing or
// skipping a check-in, the review queue, email filters, reply status.

import * as store from './store.js';
import * as model from './model.js';
import { nowIso, todayYmd, addDays, addCadence, mailboxKey, emailDomain } from './util.js';

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

/* ---------------------------------------------------------- reply status */

/**
 * Whether an email still needs your answer. Reply owed doesn't restart the
 * person's check-in clock; No reply needed and Replied do, from the day of
 * the email.
 */
export async function setReplyStatus(interactionId, status) {
  const i = model.getLive('Interactions', interactionId);
  if (!i) return null;
  const undo = { id: i.id, replyStatus: i.replyStatus || '', countsAsCheckIn: i.countsAsCheckIn !== false };
  await store.save('Interactions', { id: i.id, replyStatus: status, countsAsCheckIn: status !== 'Reply owed' });
  return undo;
}

export async function undoReplyStatus(undo) {
  if (undo) await store.save('Interactions', { id: undo.id, replyStatus: undo.replyStatus, countsAsCheckIn: undo.countsAsCheckIn });
}

/* ---------------------------------------------------------- review queue */
// New addresses wait on the ReviewQueue tab. Adding, linking or ignoring one
// is a change to that row plus a contact or a filter, saved together.

/** Changes that take away an "Ignore sender" rule for this exact address (you just added or linked them). */
function dropIgnoreRules(email) {
  const k = mailboxKey(email);
  return model.filtersOf('Ignore sender').filter((f) => mailboxKey(f.value) === k)
    .map((f) => ({ t: 'Filters', r: { id: f.id, deleted: true } }));
}

/** The queue-row change for a person you just added from the review queue. Saved with the new contact. */
export function addedItems(queueId, contactId) {
  const row = model.getLive('ReviewQueue', queueId);
  if (!row) return [];
  return [{ t: 'ReviewQueue', r: { id: row.id, status: 'Added', resolvedContactId: contactId, resolvedAt: nowIso() } }]
    .concat(dropIgnoreRules(row.email));
}

/** Adds a new address to someone you already have. Future and earlier email from it is logged to them. */
export async function linkSender(queueId, contactId) {
  const row = model.getLive('ReviewQueue', queueId);
  const c = model.getLive('Contacts', contactId);
  if (!row || !c) return null;
  const emails = (c.emails || []).slice();
  if (!emails.some((e) => mailboxKey(e) === mailboxKey(row.email))) emails.push(row.email);
  await store.saveMany([
    { t: 'Contacts', r: { id: c.id, emails } },
    { t: 'ReviewQueue', r: { id: row.id, status: 'Linked', resolvedContactId: c.id, resolvedAt: nowIso() } }
  ].concat(dropIgnoreRules(row.email)));
  return c;
}

/**
 * Ignores a new sender, or everyone at their domain. Ignoring a domain also
 * clears that domain's other waiting senders. Returns what Undo needs.
 */
export async function ignoreSender(queueId, scope) {
  const row = model.getLive('ReviewQueue', queueId);
  if (!row) return null;
  const domain = emailDomain(row.email);
  const value = scope === 'domain' ? domain : String(row.email).trim().toLowerCase();
  const rows = scope === 'domain' ? model.reviewSenders().filter((r) => emailDomain(r.email) === domain) : [row];
  const items = [{ t: 'Filters', r: { kind: scope === 'domain' ? 'Ignore domain' : 'Ignore sender', value, note: row.displayName || '' } }]
    .concat(rows.map((r) => ({ t: 'ReviewQueue', r: { id: r.id, status: 'Ignored', resolvedContactId: '', resolvedAt: nowIso() } })));
  const saved = await store.saveMany(items);
  return { filterId: saved[0].id, rows: rows.map((r) => r.id), value };
}

export async function undoIgnore(undo) {
  if (!undo) return;
  await store.saveMany([{ t: 'Filters', r: { id: undo.filterId, deleted: true } }]
    .concat(undo.rows.map((id) => ({ t: 'ReviewQueue', r: { id, status: 'Pending', resolvedAt: '' } }))));
}

/* --------------------------------------------------------------- filters */

/** Ignores an address or a whole domain typed on the Email filters screen. */
export async function addIgnoreRule(value) {
  const v = String(value || '').trim().toLowerCase().replace(/^@/, '');
  const kind = v.includes('@') ? 'Ignore sender' : 'Ignore domain';
  const items = [{ t: 'Filters', r: { kind, value: v } }];
  model.reviewSenders().forEach((r) => {
    const hit = kind === 'Ignore sender' ? mailboxKey(r.email) === mailboxKey(v) :
      (emailDomain(r.email) === v || emailDomain(r.email).endsWith('.' + v));
    if (hit) items.push({ t: 'ReviewQueue', r: { id: r.id, status: 'Ignored', resolvedAt: nowIso() } });
  });
  await store.saveMany(items);
  return kind;
}

/**
 * Takes a filter away. An ignored sender's queue row goes back to Pending,
 * so their next email shows up for you to decide again.
 */
export async function removeFilter(filterId) {
  const f = model.getLive('Filters', filterId);
  if (!f) return null;
  const items = [{ t: 'Filters', r: { id: f.id, deleted: true } }];
  const v = String(f.value).trim().toLowerCase().replace(/^@/, '');
  if (f.kind !== 'Always allow') {
    const stillIgnored = (r) => model.filtersOf('Ignore sender').some((g) => g.id !== f.id && mailboxKey(g.value) === mailboxKey(r.email));
    model.live('ReviewQueue').forEach((r) => {
      if (r.status !== 'Ignored' || !r.email) return;
      const hit = f.kind === 'Ignore sender' ? mailboxKey(r.email) === mailboxKey(v) :
        (emailDomain(r.email) === v || emailDomain(r.email).endsWith('.' + v));
      if (hit && !stillIgnored(r)) items.push({ t: 'ReviewQueue', r: { id: r.id, status: 'Pending', resolvedAt: '' } });
    });
  }
  await store.saveMany(items);
  return f;
}

/** Lets mail from a skipped sender reach the review queue, even when it looks like bulk mail. */
export async function allowSender(email, name) {
  const v = String(email || '').trim().toLowerCase();
  await store.saveMany([{ t: 'Filters', r: { kind: 'Always allow', value: v, note: name || '' } }].concat(dropIgnoreRules(v)));
}
