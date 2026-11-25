// Skyway app · People: the list, and each person's page.
// On a phone the list and a person's page are separate screens. On a
// computer they sit side by side.

import * as model from '../model.js';
import * as sync from '../sync.js';
import { ui, toast } from '../main.js';
import {
  h, fmtDate, fmtDay, plural, matchesQuery, describeCadence, firstName, safeUrl, fmtBirthday, ymdOf
} from '../util.js';
import { icon, typeIcon } from '../icons.js';
import * as actions from '../actions.js';
import { avatar, chip, personRow, empty, subHead, peopleCount } from './parts.js';

/* ---------------------------------------------------------------- list */

const FILTERS = [['all', 'All'], ['attention', 'Needs attention'], ['Inner circle', 'Inner circle'],
  ['Core', 'Core'], ['Network', 'Network'], ['On file', 'On file']];

const list = { q: '', f: 'all', seenHash: '' };

function adoptRoute(route) {
  if (list.seenHash === route.hash) return;
  list.seenHash = route.hash;
  if (route.q.has('q')) list.q = route.q.get('q');
  if (route.q.has('f')) list.f = route.q.get('f');
}

function filtered() {
  let out = model.people();
  if (list.f === 'attention') {
    out = out.filter(model.needsAttention).sort((a, b) => {
      const da = model.dueInfo(a), db = model.dueInfo(b);
      return (da ? da.days : 999) - (db ? db.days : 999);
    });
  } else if (list.f !== 'all') {
    out = out.filter((c) => (c.tier || '') === list.f);
  }
  if (list.q) out = out.filter((c) => matchesQuery(model.contactSearchText(c), list.q));
  return out;
}

function filterChips() {
  const total = model.people().length;
  return h`<div class="filters" role="group" aria-label="Show">
    ${FILTERS.map(([v, label]) => h`<button type="button" class="filter" data-act="filter" data-f="${v}"
      aria-pressed="${list.f === v}">${v === 'all' ? label + ' ' + total : label}</button>`)}
  </div>`;
}

function rowsHtml(selectedId) {
  const rows = filtered();
  if (!model.people().length) {
    return empty('No one here yet', 'Add someone you know, or paste rows into the Contacts tab of your Sheet.',
      h`<a class="btn" href="#/people/new">${icon('userPlus', 18)}New contact</a>`);
  }
  if (!rows.length) {
    return empty(list.q ? 'No matches for “' + list.q + '”' : 'No one in this list',
      list.q ? 'Search looks at names, organizations, titles, emails, tags and notes.' : '',
      list.q ? h`<a class="btn secondary" href="#/people/new?name=${encodeURIComponent(list.q)}">${icon('userPlus', 18)}Add “${list.q}”</a>` : '');
  }
  return h`<p class="listnote">${list.f === 'attention' ? 'Most overdue first' : 'Sorted by last name'}${list.q ? ' · ' + peopleCount(rows.length) : ''}</p>
    <div class="card list">${rows.map((c) => personRow(c, { selected: c.id === selectedId, chevron: !ui.desktop() }))}</div>`;
}

function listPane(selectedId) {
  return h`<header class="page-head top">
      <div class="titles"><h1>People</h1></div>
      <div class="actions"><a class="btn small" href="#/people/new">${icon('plus', 18)}New</a></div>
    </header>
    <label class="search-box">${icon('search', 18)}<input type="search" name="q" value="${list.q}"
      placeholder="Search people, firms, notes" aria-label="Search people" autocomplete="off"></label>
    ${filterChips()}
    <div id="people-rows">${rowsHtml(selectedId)}</div>`;
}

/* -------------------------------------------------------- person's page */

const HISTORY_FILTERS = {
  all: null,
  email: ['Email'],
  meetings: ['Coffee', 'Meeting', 'Event'],
  calls: ['Call', 'Video call', 'Text']
};
const history = { contactId: '', f: 'all' };

export function entryTitle(i, c) {
  if (i.subject) return i.subject;
  const name = firstName(c && c.name) || 'them';
  const e = i.eventId ? model.getLive('Events', i.eventId) : null;
  switch (i.type) {
    case 'Email': return i.direction === 'Inbound' ? 'Email from ' + name : 'Email to ' + name;
    case 'Call': return 'Call with ' + name;
    case 'Coffee': return 'Coffee with ' + name;
    case 'Meeting': return 'Meeting with ' + name;
    case 'Video call': return 'Video call with ' + name;
    case 'Text': return 'Texted with ' + name;
    case 'Event': return e ? 'Saw ' + name + ' at ' + e.name : 'Saw ' + name + ' at an event';
    default: return 'Talked with ' + name;
  }
}

function groupOthers(i) {
  if (!i.groupId) return [];
  return model.live('Interactions').filter((x) => x.groupId === i.groupId && x.contactId !== i.contactId)
    .map((x) => model.getLive('Contacts', x.contactId)).filter(Boolean);
}

/** For an email: who wrote, and where Skyway read it (Gmail, Outlook). */
function emailWords(i, c) {
  if (i.type !== 'Email') return '';
  const who = firstName(c && c.name) || 'them';
  const dir = i.direction === 'Inbound' ? 'from ' + who : (i.direction === 'Outbound' ? 'to ' + who : 'with ' + who + ' on it');
  return 'Email ' + dir + (i.source === 'Gmail' || i.source === 'Outlook' ? ' · ' + i.source : '');
}

function replyButtons(i) {
  if (i.replyStatus === 'Unsure') {
    return h`<span class="reply-ask"><span class="muted small">Reply needed?</span>
      <button class="btn small secondary" data-act="reply-status" data-id="${i.id}" data-status="Reply owed">Yes</button>
      <button class="btn small secondary" data-act="reply-status" data-id="${i.id}" data-status="No reply needed">No</button></span>`;
  }
  if (i.replyStatus === 'Reply owed') {
    return h`<button class="btn small secondary" data-act="reply-status" data-id="${i.id}" data-status="No reply needed">No reply needed</button>`;
  }
  return '';
}

function historyEntry(i, c) {
  const ev = i.eventId ? model.getLive('Events', i.eventId) : null;
  const others = groupOthers(i);
  const link = safeUrl(i.link);
  const meta = [fmtDay(i.occurredAt), emailWords(i, c) || i.type || 'Logged'].filter(Boolean).join(' · ');
  return h`<article class="entry">
    <span class="entry-icon">${icon(typeIcon(i.type), 18)}</span>
    <div class="entry-body">
      <p class="meta">${meta}${ev ? h` · <a href="#/events/${ev.id}">${ev.name}</a>` : ''}</p>
      <h3>${entryTitle(i, c)}</h3>
      ${others.length ? h`<p class="with">With ${others.map((o, n) => h`${n ? ', ' : ''}<a href="#/people/${o.id}">${o.name}</a>`)}</p>` : ''}
      ${i.summary ? h`<p class="text">${i.summary}</p>` : ''}
      ${i.notes ? h`<p class="text">${i.notes}</p>` : ''}
      <div class="entry-foot">
        ${i.replyStatus && i.replyStatus !== 'Unsure' ? chip(i.replyStatus, i.replyStatus === 'Reply owed' && model.replyOwedShows(i) ? 'late' : 'quiet') : ''}
        ${i.countsAsCheckIn === false && i.replyStatus !== 'Reply owed' && i.replyStatus !== 'Unsure' ? chip('Not a check-in', 'quiet') : ''}
        ${replyButtons(i)}
        ${link ? h`<a class="ext" href="${link}" target="_blank" rel="noopener">Open ${i.type === 'Email' ? 'email' : 'link'}${icon('external', 14)}</a>` : ''}
        <a class="ext" href="#/log?iid=${i.id}">Edit</a>
      </div>
    </div>
  </article>`;
}

function historySection(c) {
  if (history.contactId !== c.id) { history.contactId = c.id; history.f = 'all'; }
  const all = model.interactionsOf(c.id);
  const types = HISTORY_FILTERS[history.f];
  const shown = types ? all.filter((i) => types.includes(i.type)) : all;
  const kinds = new Set(all.map((i) => i.type));
  const showChips = all.length > 2 && kinds.size > 1;
  return h`<section class="history">
    <div class="block-head"><h2>History</h2><span class="muted small">${plural(all.length, 'entry', 'entries')}</span></div>
    ${showChips ? h`<div class="filters small" role="group" aria-label="Show">
      ${[['all', 'All'], ['email', 'Email'], ['meetings', 'Meetings'], ['calls', 'Calls']].map(([v, l]) =>
    h`<button type="button" class="filter" data-act="hist" data-f="${v}" aria-pressed="${history.f === v}">${l}</button>`)}
    </div>` : ''}
    ${all.length ? (shown.length ? h`<div class="card entries">${shown.map((i) => historyEntry(i, c))}</div>`
    : h`<p class="muted">Nothing of that kind yet.</p>`)
    : h`<div class="card quietcard">${icon('pencil', 18)}<span>Nothing logged yet. <a href="#/log?who=${c.id}">Log a conversation</a></span></div>`}
  </section>`;
}

/** Snooze and Skip show when someone is due within a week, the same window as Today’s list. */
const ROUND_ACTIONS_DAYS = 7;

function checkInCard(c) {
  const d = model.dueInfo(c);
  const cad = model.cadenceOf(c);
  const last = model.lastCheckIn(c.id);
  let headline = 'No reminders';
  let tone = 'quiet';
  if (d) {
    if (d.snoozedUntil) { headline = 'Snoozed until ' + fmtDay(d.snoozedUntil); tone = 'quiet'; }
    else if (d.days < 0) { headline = 'Was due ' + fmtDate(d.due); tone = 'late'; }
    else if (d.days === 0) { headline = 'Due today'; tone = 'late'; }
    else headline = 'Due ' + fmtDay(d.due);
  }
  const rule = !cad || cad.none ? (c.tier ? c.tier + ': no check-in reminders.' : 'No tier set, so no reminders.')
    : (model.TIERS.includes(c.tier) && !String(c.cadence || '').trim() ? c.tier + ' tier, ' : 'Custom: ') + describeCadence(cad) + '.';
  const r = model.round(c);
  const lastText = r && r.skip ? 'You skipped the round that was due ' + fmtDate(r.skip.from) +
      (r.skip.row.updatedAt ? ' (on ' + fmtDate(r.skip.row.updatedAt) + ')' : '') + '.'
    : last ? 'Last check-in ' + fmtDate(last.occurredAt) + ' (' + String(last.type || 'logged').toLowerCase() + ').'
      : (d ? 'Nothing logged yet, so it counts from when you added them' + (c.createdAt ? ' (' + fmtDate(c.createdAt) + ').' : '.') : '');
  const snoozeText = d && d.snoozedUntil ? ' Was due ' + fmtDate(d.due) + '. The reminder comes back that morning.' : '';
  let buttons = '';
  if (d && sync.brainAtLeast('1.2.0')) {
    if (r && r.skip && d.days > ROUND_ACTIONS_DAYS) {
      buttons = h`<div class="round-actions"><button class="btn small ghost" data-act="undo-skip" data-id="${c.id}">Undo skip</button></div>`;
    } else if (d.snoozedUntil) {
      buttons = h`<div class="round-actions"><button class="btn small secondary" data-act="end-snooze" data-id="${c.id}">End snooze</button></div>`;
    } else if (d.days <= ROUND_ACTIONS_DAYS) {
      buttons = h`<div class="round-actions">
        <button class="btn small secondary" data-act="snooze" data-id="${c.id}">Snooze 2 weeks</button>
        <button class="btn small secondary" data-act="skip" data-id="${c.id}">Skip this round</button>
      </div>`;
    }
  }
  return h`<section class="card checkin-card">
    <div class="card-head"><h2>Next check-in</h2></div>
    <p class="headline ${tone}">${headline}</p>
    <p class="card-body muted">${rule} ${lastText}${snoozeText}</p>
    ${buttons}
  </section>`;
}

function tasksCard(c) {
  const open = model.tasksOf(c.id).filter(model.isOpen);
  if (!open.length) return '';
  return h`<section class="card">
    <div class="card-head"><h2>Open tasks</h2><a class="link" href="#/tasks/new?who=${c.id}">Add</a></div>
    <div class="list">${open.map((t) => h`<div class="row task">
      <button class="check" data-act="task-done" data-id="${t.id}" aria-label="Mark “${t.title}” done">${icon('circle', 22)}</button>
      <a class="main" href="#/tasks/${t.id}"><b>${t.title || 'Untitled task'}</b>
        <small>${t.owner === 'Them' ? 'They owe' : 'You owe'}${t.dueAt ? ' · ' + fmtDate(t.dueAt) : ''}</small></a>
    </div>`)}</div>
  </section>`;
}

function kv(label, value) {
  if (value === '' || value === null || value === undefined || value === false) return '';
  if (Array.isArray(value) && !value.length) return '';
  return h`<div class="kv"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function backgroundCard(c) {
  const intro = c.introducedById ? model.getLive('Contacts', c.introducedById) : null;
  const introduced = model.people().filter((p) => p.introducedById === c.id);
  const linkedIn = safeUrl(c.linkedIn);
  const oneNote = safeUrl(c.oneNoteLink);
  const emails = (c.emails || []).filter(Boolean);
  const body = [
    kv(emails.length > 1 ? 'Email addresses' : 'Email', emails.length ? h`${emails.map((e) => h`<a href="mailto:${e}">${e}</a><br>`)}` : ''),
    kv('Phone', c.phone ? h`<a href="tel:${String(c.phone).replace(/[^\d+]/g, '')}">${c.phone}</a>` : ''),
    kv('LinkedIn', linkedIn ? h`<a href="${linkedIn}" target="_blank" rel="noopener">Profile${icon('external', 14)}</a>` : ''),
    kv('City', c.city),
    kv('How you met', c.howMet),
    kv('Introduced by', intro ? h`<a href="#/people/${intro.id}">${intro.name}</a>` : ''),
    kv('Introduced you to', introduced.length ? h`${introduced.map((p, n) => h`${n ? ', ' : ''}<a href="#/people/${p.id}">${p.name}</a>`)}` : ''),
    kv('Schools', (c.schools || []).join('; ')),
    kv('Birthday', fmtBirthday(c.birthday)),
    kv('Tags', (c.tags || []).length ? h`<span class="chips inline">${c.tags.map((t) => chip(t, 'quiet'))}</span>` : ''),
    kv('Personal notes', c.personalNotes ? h`<span class="text">${c.personalNotes}</span>` : ''),
    kv('OneNote', oneNote ? h`<a href="${oneNote}" target="_blank" rel="noopener">Open page${icon('external', 14)}</a>` : '')
  ].filter((x) => String(x));
  return h`<section class="card">
    <div class="card-head"><h2>Background</h2><a class="link" href="#/people/${c.id}/edit">Edit</a></div>
    ${body.length ? h`<dl class="kvs">${body}</dl>` : h`<p class="card-body muted">Add how you met, emails, schools and notes with Edit.</p>`}
  </section>`;
}

function years(a) {
  const s = (a.startDate || '').slice(0, 4);
  const e = (a.endDate || '').slice(0, 4);
  if (s && e) return s === e ? s : s + ' to ' + e;
  if (s) return s + ' to now';
  if (e) return 'until ' + e;
  return '';
}

function orgsCard(c) {
  const rows = [];
  if (c.orgId && model.getLive('Organizations', c.orgId)) {
    const cur = model.affiliationsOf(c.id).find((a) => a.orgId === c.orgId && !a.endDate);
    rows.push({ orgId: c.orgId, line: [c.title, cur && cur.startDate ? years(cur) : 'now'].filter(Boolean).join(' · ') });
  }
  model.affiliationsOf(c.id)
    .filter((a) => !(a.orgId === c.orgId && !a.endDate))
    .sort((a, b) => String(b.endDate || '9999').localeCompare(String(a.endDate || '9999')))
    .forEach((a) => rows.push({ orgId: a.orgId, line: [a.title, years(a) || (a.endDate ? '' : 'now')].filter(Boolean).join(' · ') }));
  const shown = rows.filter((r) => model.getLive('Organizations', r.orgId));
  if (!shown.length) return '';
  return h`<section class="card">
    <div class="card-head"><h2>Organizations</h2></div>
    <div class="linklist">${shown.map((r) => h`<a href="#/orgs/${r.orgId}"><b>${model.orgName(r.orgId)}</b><small>${r.line}</small></a>`)}</div>
  </section>`;
}

function eventsCard(c) {
  const evs = model.eventsOfContact(c.id);
  if (!evs.length) return '';
  return h`<section class="card">
    <div class="card-head"><h2>Events</h2></div>
    <div class="linklist">${evs.slice(0, 6).map((e) => h`<a href="#/events/${e.id}"><b>${e.name}</b>
      <small>${fmtDate(e.startAt)}${c.howMet && c.howMet.indexOf(e.name) >= 0 ? ' · where you met' : ''}</small></a>`)}</div>
  </section>`;
}

function duplicateNote(c) {
  const p = model.duplicateOf(c.id);
  if (!p) return '';
  const other = p.a.id === c.id ? p.b : p.a;
  return h`<div class="note warn dupe-note">
    <span>${icon('merge', 18)}</span>
    <div><p>This might be the same person as <a href="#/people/${other.id}">${other.name}</a> (${p.reason.toLowerCase()}).</p>
      <p class="note-actions"><a class="btn small" href="#/merge?a=${p.a.id}&b=${p.b.id}">Compare and merge</a>
      <button class="btn small ghost" data-act="not-dupe" data-key="${p.key}">Not the same person</button></p></div>
  </div>`;
}

function profileChips(c) {
  const cad = model.cadenceOf(c);
  const tierText = c.tier ? c.tier + (cad && !cad.none ? ' · ' + describeCadence(cad) : '') :
    (cad && !cad.none ? describeCadence(cad) : 'No tier');
  const d = model.dueInfo(c);
  let due = '';
  if (d && d.snoozedUntil) due = chip('Snoozed till ' + fmtDate(d.snoozedUntil), 'quiet');
  else if (d && d.days < 0) due = chip('Check-in ' + plural(-d.days, 'day') + ' overdue', 'late');
  else if (d && d.days === 0) due = chip('Check-in due today', 'late');
  else if (d && d.days <= 14) due = chip('Check-in due ' + fmtDay(d.due).split(',')[0], 'soon');
  const reply = model.replyOwedFor(c.id) ? chip('Reply owed', 'late') : '';
  return h`<div class="chips inline">${chip(tierText, 'outline')}${due}${reply}</div>`;
}

function actionButtons(c, desktop) {
  const email = (c.emails || []).find(Boolean);
  return h`<div class="actions-row ${desktop ? 'desktop' : ''}">
    <a class="btn" href="#/log?who=${c.id}">${icon('pencil', 18)}Log</a>
    ${email ? h`<a class="btn secondary" href="mailto:${email}">${icon('mail', 18)}Email</a>` : ''}
    <a class="btn secondary" href="#/tasks/new?who=${c.id}">${icon('plus', 18)}${desktop ? 'Add task' : 'Task'}</a>
    ${desktop ? h`<a class="btn secondary" href="#/people/${c.id}/edit">Edit</a>` : ''}
  </div>`;
}

function profileLine(c) {
  const org = c.orgId ? model.getLive('Organizations', c.orgId) : null;
  return h`${c.title || ''}${c.title && org ? ' · ' : ''}${org ? h`<a href="#/orgs/${org.id}">${org.name}</a>` : ''}`;
}

function missing(back) {
  return h`<div class="page">${subHead({ back })}
    ${empty('This person isn’t in Skyway anymore', 'They may have been merged into someone else or removed.',
    h`<a class="btn secondary" href="#/people">All people</a>`)}</div>`;
}

function phonePage(c) {
  return h`<div class="page">
    ${subHead({ back: '#/people', actions: h`<a class="link strong" href="#/people/${c.id}/edit">Edit</a>` })}
    <div class="profile">
      ${avatar(c, 'xl')}
      <h1>${c.name || 'No name'}</h1>
      ${c.title || c.orgId ? h`<p class="line">${profileLine(c)}</p>` : ''}
      ${c.whatTheyDo ? h`<p class="muted">${c.whatTheyDo}</p>` : ''}
      ${profileChips(c)}
    </div>
    ${duplicateNote(c)}
    ${actionButtons(c, false)}
    ${checkInCard(c)}
    ${tasksCard(c)}
    ${backgroundCard(c)}
    ${orgsCard(c)}
    ${eventsCard(c)}
    ${historySection(c)}
  </div>`;
}

function desktopDetail(c) {
  const email = (c.emails || []).find(Boolean);
  return h`<div class="detail">
    <div class="profile wide">
      ${avatar(c, 'xl')}
      <div>
        <h1>${c.name || 'No name'}</h1>
        ${c.title || c.orgId ? h`<p class="line">${profileLine(c)}</p>` : ''}
        ${c.whatTheyDo || email ? h`<p class="muted">${[c.whatTheyDo, email].filter(Boolean).join(' · ')}</p>` : ''}
        ${profileChips(c)}
      </div>
    </div>
    ${duplicateNote(c)}
    ${actionButtons(c, true)}
    <div class="grid2 detail-grid">
      <div class="stack">${historySection(c)}</div>
      <aside class="stack">
        ${checkInCard(c)}
        ${tasksCard(c)}
        ${backgroundCard(c)}
        ${orgsCard(c)}
        ${eventsCard(c)}
      </aside>
    </div>
  </div>`;
}

/* --------------------------------------------------------------- views */

const sharedActs = {
  'task-done': async (el) => {
    const t = await actions.completeTask(el.dataset.id);
    if (t) toast('Done: ' + (t.title || 'task'));
  },
  async 'not-dupe'(el) {
    await actions.dismissDuplicate(el.dataset.key);
    toast('Got it. They’re different people.');
  },
  hist(el) {
    history.f = el.dataset.f;
    ui.render();
  },
  async snooze(el) {
    const c = model.getLive('Contacts', el.dataset.id);
    if (!c) return;
    const undo = await actions.snoozeCheckIn(c);
    if (undo) toast('Snoozed until ' + fmtDate(undo.until) + '. The reminder comes back that morning.', { action: { label: 'Undo', fn: () => actions.undoRound(undo) } });
  },
  async skip(el) {
    const c = model.getLive('Contacts', el.dataset.id);
    if (!c) return;
    const undo = await actions.skipCheckIn(c);
    if (undo) toast('Skipped. Next check-in ' + fmtDate(undo.next) + '.', { action: { label: 'Undo', fn: () => actions.undoRound(undo) } });
  },
  async 'undo-skip'(el) {
    const c = model.getLive('Contacts', el.dataset.id);
    if (!c) return;
    const from = await actions.undoSkip(c);
    if (from) toast('Skip undone. The check-in is due ' + fmtDate(from) + ' again.');
  },
  async 'end-snooze'(el) {
    const c = model.getLive('Contacts', el.dataset.id);
    if (!c) return;
    await actions.endSnooze(c);
    toast('Snooze ended. ' + firstName(c.name) + ' shows as due again.');
  },
  async 'reply-status'(el) {
    const undo = await actions.setReplyStatus(el.dataset.id, el.dataset.status);
    if (!undo) return;
    toast(el.dataset.status === 'Reply owed' ? 'Marked reply owed.' : 'Marked no reply needed. It counts as a check-in.',
      { action: { label: 'Undo', fn: () => actions.undoReplyStatus(undo) } });
  }
};

export const peopleView = {
  id: 'people', chrome: 'tabs', navKey: 'people', live: true,
  title(route) {
    const c = route.parts[1] ? model.getLive('Contacts', route.parts[1]) : null;
    return c ? c.name : 'People';
  },
  render(route) {
    adoptRoute(route);
    const id = route.parts[1] || '';
    if (!ui.desktop()) return h`<div class="page">${listPane('')}</div>`;
    const c = id ? model.getLive('Contacts', id) : null;
    return h`<div class="two-pane">
      <div class="pane-list">${listPane(id)}</div>
      <div class="pane-detail">${c ? desktopDetail(c) : (id ? empty('This person isn’t in Skyway anymore', 'They may have been merged into someone else or removed.')
    : empty(model.people().length ? 'Pick someone' : 'Your network starts here',
      model.people().length ? 'Their history, tasks and notes show up here.' : 'Add the first person you want to keep in touch with.'))}</div>
    </div>`;
  },
  input(el) {
    if (el.name !== 'q') return;
    list.q = el.value.trim();
    const box = document.getElementById('people-rows');
    if (box) box.innerHTML = String(rowsHtml(ui.desktop() ? (location.hash.split('/')[2] || '').split('?')[0] : ''));
  },
  keydown(el, ev) {
    if (el.name === 'q' && ev.key === 'Enter') {
      ev.preventDefault();
      const first = document.querySelector('#people-rows a.row');
      if (first) first.click();
    }
  },
  act: Object.assign({
    filter(el) {
      list.f = el.dataset.f;
      ui.render();
    }
  }, sharedActs)
};

export const contactView = {
  id: 'contact', chrome: 'sub', navKey: 'people', live: true,
  title(route) {
    const c = model.getLive('Contacts', route.parts[1]);
    return c ? c.name : 'Person';
  },
  render(route) {
    const c = model.getLive('Contacts', route.parts[1]);
    return c ? phonePage(c) : missing('#/people');
  },
  act: sharedActs
};

// Used by other screens to show "last contact" consistently.
export function lastContactLine(c) {
  const i = model.lastCheckIn(c.id);
  return i ? 'Last contact ' + fmtDate(i.occurredAt) : (c.createdAt ? 'Added ' + fmtDate(ymdOf(new Date(c.createdAt))) : '');
}
