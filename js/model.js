// Skyway app · what the data means: due dates, statuses, lists, duplicates.
// Due dates are worked out here the same way the brain does it, so they're
// right on this device even before it syncs.

import * as store from './store.js';
import {
  parseCadence, addCadence, ymdOf, todayYmd, addDays, daysBetween, fmtDate, fmtDay,
  lastNameKey, normalizeEmail, parseYmd, mailboxKey, emailDomain
} from './util.js';

const cache = new Map();

function memo(key, fn) {
  const v = store.version() + '|' + todayYmd();
  const c = cache.get(key);
  if (c && c.v === v) return c.value;
  const value = fn();
  cache.set(key, { v, value });
  return value;
}

export function live(t) {
  return memo('live:' + t, () => Array.from(store.table(t).values()).filter((r) => !r.deleted));
}

export function getLive(t, id) {
  const r = id ? store.get(t, id) : null;
  return r && !r.deleted ? r : null;
}

/* ------------------------------------------------------------- settings */

export const DEFAULTS = {
  reminderAddress: '', remindersOn: 'TRUE', reminderHour: '7', remindersPerDay: '10', taskReminders: 'TRUE',
  'cadence.Inner circle': '6w', 'cadence.Core': '3m', 'cadence.Network': '6m',
  'cadence.On file': 'none', overdueNudgeDays: '14', replyOwedDays: '3', briefingsEnabled: 'TRUE',
  briefingHour: '7', largeEventSize: '9', recurringEventsCount: 'FALSE', skipBulk: 'TRUE',
  overrideLabel: 'Skyway', lockMinutes: '5', healthQuietDays: '2', weeklyBackup: 'TRUE', brainUrl: '', appUrl: '',
  notDuplicates: '', gmailOn: 'TRUE', myAddresses: '',
  replyWords: 'let me know; can you; could you; would you; are you free; are you available; when works; what works; does that work; your thoughts; what do you think; please send; please confirm; please reply; get back to me; hear back'
};

export function setting(key) {
  const r = store.get('Settings', key);
  const v = r && r.value !== undefined && r.value !== null ? String(r.value).trim() : '';
  return v || (DEFAULTS[key] !== undefined ? DEFAULTS[key] : '');
}

export function settingNum(key) {
  const n = Number(setting(key));
  return isFinite(n) ? n : Number(DEFAULTS[key]);
}

export function settingBool(key) { return /^(true|yes|y|1)$/i.test(setting(key)); }

export const TIERS = ['Inner circle', 'Core', 'Network', 'On file'];

export function tierCadence(tier) {
  return parseCadence(setting('cadence.' + tier)) || parseCadence(DEFAULTS['cadence.' + tier]) || null;
}

export function cadenceOf(c) {
  const own = parseCadence(c.cadence);
  if (own) return own;
  return TIERS.includes(c.tier) ? tierCadence(c.tier) : null;
}

/* -------------------------------------------------------------- indexes */

function groupBy(list, key, sortFn) {
  const m = new Map();
  list.forEach((r) => {
    const k = r[key];
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  if (sortFn) m.forEach((arr) => arr.sort(sortFn));
  return m;
}

const byOccurredDesc = (a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''));

export function interactionsOf(contactId) {
  return memo('ibc', () => groupBy(live('Interactions'), 'contactId', byOccurredDesc)).get(contactId) || [];
}

export function tasksOf(contactId) {
  return memo('tbc', () => groupBy(live('Tasks'), 'contactId', byDue)).get(contactId) || [];
}

export function attendanceOf(eventId) {
  return memo('abe', () => groupBy(live('Attendance'), 'eventId')).get(eventId) || [];
}

export function attendanceByContact(contactId) {
  return memo('abc', () => groupBy(live('Attendance'), 'contactId')).get(contactId) || [];
}

export function affiliationsOf(contactId) {
  return memo('afc', () => groupBy(live('Affiliations'), 'contactId')).get(contactId) || [];
}

export function affiliationsAtOrg(orgId) {
  return memo('afo', () => groupBy(live('Affiliations'), 'orgId')).get(orgId) || [];
}

export function contactsAtOrg(orgId) {
  return memo('cbo', () => groupBy(people(), 'orgId')).get(orgId) || [];
}

export function interactionsAtEvent(eventId) {
  return memo('ibe', () => groupBy(live('Interactions'), 'eventId', byOccurredDesc)).get(eventId) || [];
}

/* ------------------------------------------------------------ check-ins */

/** The latest conversation that counts as a check-in and isn't in the future. */
export function lastCheckIn(contactId) {
  const now = Date.now();
  const list = interactionsOf(contactId);
  for (const i of list) {
    if (i.countsAsCheckIn === false) continue;
    const t = Date.parse(i.occurredAt || '');
    if (!isNaN(t) && t <= now) return i;
  }
  return null;
}

/** Check-in reminder rows (snoozes, skips, emails sent) for one person. */
export function checkInReminders(contactId) {
  return (memo('rbc', () => groupBy(live('Reminders'), 'contactId')).get(contactId) || [])
    .filter((r) => (r.kind || '') === 'Check-in');
}

/*
 * The current round, worked out the way the brain does it: the last
 * check-in (or the day they were added) plus their cadence. "Skip this
 * round" (a Skipped reminder row) moves it to the skip's date. A snooze
 * keeps the due date but holds the reminder until snoozeUntil. Rows made
 * before the round began don't count.
 */
export function round(c) {
  return memo('round:' + c.id, () => {
    const cad = cadenceOf(c);
    if (!cad || cad.none) return null;
    const last = lastCheckIn(c.id);
    const base = last ? last.occurredAt : c.createdAt;
    if (!base) return null;
    const baseMs = Date.parse(base);
    const rows = checkInReminders(c.id).filter((r) => !r.createdAt || !(Date.parse(r.createdAt) < baseMs));
    let due = addCadence(ymdOf(new Date(base)), cad);
    let skip = null;
    for (let n = 0; n < 50; n++) {
      let next = null;
      rows.forEach((r) => {
        if (r.status === 'Skipped' && r.dueAt === due && r.snoozeUntil && r.snoozeUntil > due &&
          (!next || r.snoozeUntil > next.snoozeUntil)) next = r;
      });
      if (!next) break;
      skip = { row: next, from: due };
      due = next.snoozeUntil;
    }
    const inRound = rows.filter((r) => r.dueAt === due);
    let snoozedUntil = null;
    inRound.forEach((r) => {
      if (r.status === 'Snoozed' && r.snoozeUntil && (!snoozedUntil || r.snoozeUntil > snoozedUntil)) snoozedUntil = r.snoozeUntil;
    });
    return { due, cad, base, rows: inRound, snoozedUntil, skip };
  });
}

export function nextDue(c) {
  const r = round(c);
  return r ? r.due : null;
}

/** { due, days, overdue, snoozedUntil }. snoozedUntil is set only while the snooze lasts. */
export function dueInfo(c) {
  const r = round(c);
  if (!r) return null;
  const today = todayYmd();
  const days = daysBetween(today, r.due);
  return { due: r.due, days, overdue: days < 0, snoozedUntil: r.snoozedUntil && r.snoozedUntil > today ? r.snoozedUntil : null };
}

/**
 * Whether an email waiting on your reply shows as "Reply owed" yet. One you
 * marked yourself shows right away; one Skyway read from your mail waits
 * replyOwedDays, so you have time to answer before it's flagged.
 */
export function replyOwedShows(i) {
  if (!i || i.replyStatus !== 'Reply owed') return false;
  if (i.source !== 'Gmail' && i.source !== 'Outlook') return true;
  const t = Date.parse(i.occurredAt || '');
  return isNaN(t) || Date.now() - t >= settingNum('replyOwedDays') * 86400000;
}

export function replyOwedFor(contactId) {
  return interactionsOf(contactId).find(replyOwedShows) || null;
}

/** The short status shown beside a person's name. tone: late, soon, ok, new or quiet. */
export function statusOf(c) {
  if (duplicateOf(c.id)) return { text: 'Possible duplicate', tone: 'late' };
  if (replyOwedFor(c.id)) return { text: 'Reply owed', tone: 'late' };
  const d = dueInfo(c);
  if (d && d.snoozedUntil) return { text: 'Snoozed till ' + fmtDate(d.snoozedUntil), tone: 'quiet' };
  if (d && d.days < 0) return { text: (-d.days) + (d.days === -1 ? ' day' : ' days') + ' overdue', tone: 'late' };
  if (d && d.days === 0) return { text: 'Due today', tone: 'late' };
  const created = c.createdAt ? daysBetween(ymdOf(new Date(c.createdAt)), todayYmd()) : 99;
  if (created <= 7 && !interactionsOf(c.id).length) return { text: 'New', tone: 'new' };
  if (d && d.days <= 6) return { text: 'Due ' + fmtDay(d.due).split(',')[0], tone: 'soon' };
  if (d) return { text: 'Due ' + fmtDate(d.due), tone: 'quiet' };
  return { text: '', tone: 'quiet' };
}

export function dueSentence(c) {
  const d = dueInfo(c);
  if (!d) return 'No check-in reminders';
  if (d.snoozedUntil) return 'Check-in snoozed until ' + fmtDate(d.snoozedUntil);
  if (d.days < 0) return 'Check-in ' + (-d.days) + (d.days === -1 ? ' day' : ' days') + ' overdue';
  if (d.days === 0) return 'Check-in due today';
  return 'Next check-in ' + fmtDate(d.due);
}

/* ---------------------------------------------------------------- people */

export function people() {
  return memo('people', () => live('Contacts').slice().sort((a, b) => lastNameKey(a).localeCompare(lastNameKey(b))));
}

export function peopleDue(daysAhead) {
  return memo('due-list:' + daysAhead, () => people()
    .map((c) => ({ c, d: dueInfo(c) }))
    .filter((x) => x.d && x.d.days <= daysAhead && !x.d.snoozedUntil)
    .sort((a, b) => a.d.due.localeCompare(b.d.due) || lastNameKey(a.c).localeCompare(lastNameKey(b.c)))
    .map((x) => x.c));
}

export function needsAttention(c) {
  const d = dueInfo(c);
  return !!((d && d.days <= 7 && !d.snoozedUntil) || replyOwedFor(c.id) || duplicateOf(c.id));
}

export function contactLine(c) {
  return [c.title, orgName(c.orgId)].filter(Boolean).join(' · ');
}

export function contactSearchText(c) {
  return [c.name, c.sortName, orgName(c.orgId), c.title, c.whatTheyDo, (c.emails || []).join(' '), (c.tags || []).join(' '),
    c.personalNotes, c.howMet, c.city, (c.schools || []).join(' '), c.phone];
}

/* ---------------------------------------------------------- organizations */

export function orgName(id) {
  const o = id ? store.get('Organizations', id) : null;
  return o ? o.name : '';
}

export function orgs() {
  return memo('orgs', () => live('Organizations').slice().sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })));
}

export function findOrgByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return orgs().find((o) => String(o.name || '').trim().toLowerCase() === n) || null;
}

/* ------------------------------------------------------------------- tasks */

function byDue(a, b) {
  const x = a.dueAt || '9999-99-99', y = b.dueAt || '9999-99-99';
  return x.localeCompare(y) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

export function isOpen(t) { return !t.status || t.status === 'Open'; }

export function openTasks() {
  return memo('open-tasks', () => live('Tasks').filter(isOpen).sort(byDue));
}

export function doneTasks(limit) {
  return memo('done-tasks', () => live('Tasks').filter((t) => !isOpen(t))
    .sort((a, b) => String(b.doneAt || b.updatedAt || '').localeCompare(String(a.doneAt || a.updatedAt || ''))))
    .slice(0, limit || 30);
}

export function taskBucket(t) {
  if (!t.dueAt) return 'No date';
  const days = daysBetween(todayYmd(), t.dueAt);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days <= 7) return 'This week';
  return 'Later';
}

/* ------------------------------------------------------------------ events */

function startOfToday() { return new Date(new Date().toDateString()).getTime(); }

export function eventsUpcoming(days) {
  const from = startOfToday();
  const to = days ? from + days * 86400000 : Infinity;
  return live('Events').filter((e) => {
    const t = Date.parse(e.startAt || '');
    return !isNaN(t) && t >= from && t < to;
  }).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
}

export function eventsPast() {
  const from = startOfToday();
  return live('Events').filter((e) => {
    const t = Date.parse(e.startAt || '');
    return isNaN(t) || t < from;
  }).sort((a, b) => String(b.startAt || '').localeCompare(String(a.startAt || '')));
}

/** People at an event: everyone on its attendance list or with a conversation logged to it. */
export function eventPeople(eventId) {
  const ids = new Set();
  attendanceOf(eventId).forEach((a) => ids.add(a.contactId));
  interactionsAtEvent(eventId).forEach((i) => ids.add(i.contactId));
  return Array.from(ids).map((id) => getLive('Contacts', id)).filter(Boolean)
    .sort((a, b) => lastNameKey(a).localeCompare(lastNameKey(b)));
}

export function eventsOfContact(contactId) {
  const ids = new Set();
  attendanceByContact(contactId).forEach((a) => ids.add(a.eventId));
  interactionsOf(contactId).forEach((i) => { if (i.eventId) ids.add(i.eventId); });
  return Array.from(ids).map((id) => getLive('Events', id)).filter(Boolean)
    .sort((a, b) => String(b.startAt || '').localeCompare(String(a.startAt || '')));
}

/** The event that event mode is tagging, if it's on. It switches itself off after 12 hours. */
export function eventMode() {
  const m = store.meta('eventMode');
  if (!m || !m.eventId) return null;
  if (m.startedAt && Date.now() - Date.parse(m.startedAt) > 12 * 3600 * 1000) return null;
  return getLive('Events', m.eventId);
}

/* -------------------------------------------------------------- duplicates */

function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pairs of contacts that look like the same person, minus pairs you've marked as different. */
export function duplicatePairs() {
  return memo('dupes', () => {
    const dismissed = new Set(notDuplicateKeys());
    const list = people();
    const seen = new Map();
    const add = (a, b, reason) => {
      if (a.id === b.id) return;
      const [x, y] = a.id < b.id ? [a, b] : [b, a];
      const key = x.id + '|' + y.id;
      if (dismissed.has(key) || seen.has(key)) return;
      seen.set(key, { a: x, b: y, reason, key });
    };
    const byEmail = new Map();
    list.forEach((c) => (c.emails || []).forEach((e) => {
      const k = normalizeEmail(e);
      if (!k) return;
      if (byEmail.has(k)) add(byEmail.get(k), c, 'Same email address');
      else byEmail.set(k, c);
    }));
    const byName = new Map();
    list.forEach((c) => {
      const n = normName(c.name);
      if (!n) return;
      if (byName.has(n)) add(byName.get(n), c, 'Same name');
      else byName.set(n, c);
    });
    const byLast = new Map();
    list.forEach((c) => {
      const parts = normName(c.name).split(' ');
      if (parts.length < 2) return;
      const last = parts[parts.length - 1];
      if (!byLast.has(last)) byLast.set(last, []);
      byLast.get(last).push({ c, first: parts[0] });
    });
    byLast.forEach((arr) => {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const p = arr[i], q = arr[j];
          if (p.first === q.first) continue;
          const prefix = p.first.startsWith(q.first) || q.first.startsWith(p.first);
          const sameOrg = p.c.orgId && p.c.orgId === q.c.orgId && p.first.charAt(0) === q.first.charAt(0);
          if (prefix || sameOrg) add(p.c, q.c, 'Similar name');
        }
      }
    });
    return Array.from(seen.values());
  });
}

/** Pairs marked "not the same person", kept in the Sheet's Settings tab so every device knows. */
export function notDuplicateKeys() {
  return setting('notDuplicates').split(/[;\s]+/).filter((k) => /^[a-z]{3}_\w+\|[a-z]{3}_\w+$/.test(k));
}

export function duplicateOf(id) {
  return duplicatePairs().find((p) => p.a.id === id || p.b.id === id) || null;
}

/* ------------------------------------------------------------ review queue */

/** Contacts by every address they have, the way the brain matches them. */
export function contactByEmail(email) {
  const k = mailboxKey(email);
  if (!k) return null;
  return memo('cbe', () => {
    const m = new Map();
    people().forEach((c) => (c.emails || []).forEach((e) => {
      const key = mailboxKey(e);
      if (key && !m.has(key)) m.set(key, c);
    }));
    return m;
  }).get(k) || null;
}

/**
 * New addresses waiting for you, newest first. One that's already on a
 * contact (you added them some other way) is left out; the brain marks it
 * Linked at its next check.
 */
export function reviewSenders() {
  return memo('review-senders', () => live('ReviewQueue')
    .filter((r) => (r.status || 'Pending') === 'Pending' && r.email && !contactByEmail(r.email))
    .sort((a, b) => String(b.lastSeenAt || b.createdAt || '').localeCompare(String(a.lastSeenAt || a.createdAt || ''))));
}

/** Emails from contacts where Skyway couldn't tell whether you owe a reply, newest first. */
export function unsureEmails() {
  return memo('unsure', () => live('Interactions')
    .filter((i) => i.replyStatus === 'Unsure' && getLive('Contacts', i.contactId))
    .sort(byOccurredDesc));
}

export function reviewCounts() {
  return memo('review-counts', () => {
    const senders = reviewSenders().length;
    const unsure = unsureEmails().length;
    const dupes = duplicatePairs().length;
    return { senders, unsure, dupes, total: senders + unsure + dupes };
  });
}

/** Rows on the Filters tab of one kind: Ignore sender, Ignore domain or Always allow. Newest first. */
export function filtersOf(kind) {
  return live('Filters').filter((f) => f.kind === kind && f.value)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/** The filter rule that applies to an address, as the brain decides it: 'ignore', 'allow' or ''. */
export function filterFor(email) {
  const k = mailboxKey(email);
  const domain = emailDomain(k);
  let best = null;
  live('Filters').forEach((f) => {
    if (!f.value || !['Ignore sender', 'Ignore domain', 'Always allow'].includes(f.kind)) return;
    const v = String(f.value).trim().toLowerCase().replace(/^@/, '');
    const exact = v.includes('@');
    const hit = exact ? mailboxKey(v) === k : (domain === v || domain.endsWith('.' + v));
    if (!hit) return;
    const at = Date.parse(f.updatedAt || f.createdAt || '') || 0;
    if (!best || (exact && !best.exact) || (exact === best.exact && at >= best.at)) best = { exact, at, f };
  });
  return best ? (best.f.kind === 'Always allow' ? 'allow' : 'ignore') : '';
}

/**
 * What Skyway logged by itself lately, for Today: emails from Gmail (one
 * line per email, even when several contacts were on it) and new senders
 * it sent to the review queue. Newest first.
 */
export function autoLogged(days, limit) {
  const since = Date.now() - days * 86400000;
  const items = [];
  const groups = new Set();
  live('Interactions').forEach((i) => {
    if (i.source !== 'Gmail' && i.source !== 'Outlook' && i.source !== 'Calendar') return;
    const t = Date.parse(i.occurredAt || '');
    if (isNaN(t) || t < since) return;
    if (i.groupId) {
      if (groups.has(i.groupId)) return;
      groups.add(i.groupId);
    }
    const c = getLive('Contacts', i.contactId);
    if (c) items.push({ kind: 'logged', at: i.occurredAt, i, c });
  });
  reviewSenders().forEach((r) => {
    const t = Date.parse(r.lastSeenAt || '');
    if (!isNaN(t) && t >= since) items.push({ kind: 'queued', at: r.lastSeenAt, r });
  });
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit || 5);
}

/* ------------------------------------------------------------------- misc */

export function healthRows() {
  return live('Health').slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function counts() {
  return memo('counts', () => ({
    people: people().length,
    orgs: orgs().length,
    openTasks: openTasks().length,
    events: live('Events').length
  }));
}

export function isYmd(s) { return !!parseYmd(s); }
export { addDays };
