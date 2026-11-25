// Skyway app · Today: who's due, what's coming up, what you owe.

import * as model from '../model.js';
import { ui, toast, syncPill } from '../main.js';
import { h, fmtHeaderDate, fmtDate, fmtTime, fmtDay, fmtAgo, plural, daysBetween, ymdOf, todayYmd, safeUrl, firstName } from '../util.js';
import { icon } from '../icons.js';
import * as actions from '../actions.js';
import { avatar, statusChip, dateBadge, personRow, peopleCount } from './parts.js';
import { reviewSummary } from './review.js';

const DUE_AHEAD = 7;

function lastContactText(c) {
  const i = model.lastCheckIn(c.id);
  return i ? fmtDate(i.occurredAt) + ' · ' + (i.type || 'Logged') : 'Never';
}

function taskLine(t) {
  const c = model.getLive('Contacts', t.contactId);
  return [c ? c.name : '', t.owner === 'Them' ? 'They owe' : 'You owe', t.dueAt ? fmtDay(t.dueAt) : '']
    .filter(Boolean).join(' · ');
}

export function taskRow(t) {
  const late = t.dueAt && daysBetween(todayYmd(), t.dueAt) < 0;
  return h`<div class="row task">
    <button class="check" data-act="task-done" data-id="${t.id}" aria-label="Mark “${t.title}” done">${icon('circle', 22)}</button>
    <a class="main" href="#/tasks/${t.id}"><b>${t.title || 'Untitled task'}</b><small class="${late ? 'late' : ''}">${taskLine(t)}</small></a>
  </div>`;
}

export async function completeTask(id) {
  const t = await actions.completeTask(id);
  if (t) toast('Done: ' + (t.title || 'task'));
}

function replyItems() {
  return model.people().map((c) => ({ c, i: model.replyOwedFor(c.id) })).filter((x) => x.i)
    .sort((a, b) => String(a.i.occurredAt).localeCompare(String(b.i.occurredAt)));
}

function eventLine(e) {
  return [fmtTime(e.startAt), e.location].filter(Boolean).join(' · ');
}

/* --------------------------------------------------------------- cards */

function comingUpCard(desktop) {
  const list = model.eventsUpcoming(DUE_AHEAD).slice(0, desktop ? 4 : 3);
  if (!list.length) return '';
  return h`<section class="${desktop ? 'card' : 'block'}">
    <div class="block-head"><h2>Coming up</h2><a class="link" href="#/events">All events</a></div>
    <div class="${desktop ? 'list' : 'card list'}">
      ${list.map((e) => h`<a class="row link" href="#/events/${e.id}">${dateBadge(e.startAt)}
        <span class="main"><b>${e.name || 'Untitled event'}</b><small>${fmtDay(e.startAt)}${eventLine(e) ? ' · ' + eventLine(e) : ''}</small></span>
        <span class="chev">${icon('chevronRight', 18)}</span></a>`)}
    </div>
  </section>`;
}

function dueBlockPhone() {
  const due = model.peopleDue(DUE_AHEAD);
  if (!due.length) {
    if (!model.people().length) return '';
    return h`<section class="block"><div class="block-head"><h2>Due for a check-in</h2></div>
      <div class="card quietcard">${icon('checkCircle', 20)}<span>No one is due this week.</span></div></section>`;
  }
  return h`<section class="block">
    <div class="block-head"><h2>Due for a check-in</h2>${due.length > 5 ? h`<a class="link" href="#/people?f=attention">See all ${due.length}</a>` : ''}</div>
    <div class="card list">${due.slice(0, 5).map((c) => personRow(c))}</div>
  </section>`;
}

function dueTableDesktop() {
  const due = model.peopleDue(DUE_AHEAD);
  if (!model.people().length) return '';
  return h`<section class="card">
    <div class="card-head"><h2>Due for a check-in</h2><span class="muted small">${peopleCount(due.length)}</span></div>
    ${due.length ? h`<table class="table">
      <thead><tr><th>Name</th><th>Tier</th><th>Last contact</th><th>Status</th><th></th></tr></thead>
      <tbody>${due.slice(0, 12).map((c) => h`<tr>
        <td><a class="who" href="#/people/${c.id}">${avatar(c, 'sm')}<span class="main"><b>${c.name}</b><small>${model.orgName(c.orgId)}</small></span></a></td>
        <td>${c.tier || '—'}</td>
        <td class="muted">${lastContactText(c)}</td>
        <td>${statusChip(c)}</td>
        <td class="end"><a class="btn small secondary" href="#/log?who=${c.id}">Log</a></td>
      </tr>`)}</tbody>
    </table>
    ${due.length > 12 ? h`<a class="card-foot link" href="#/people?f=attention">See all ${due.length}</a>` : ''}`
    : h`<p class="card-body muted">${icon('checkCircle', 18)} No one is due in the next week.</p>`}
  </section>`;
}

/** New senders, emails to sort and possible duplicates, all in the review queue. */
function reviewCard(desktop) {
  const n = model.reviewCounts();
  if (!n.total) return '';
  if (desktop) {
    return h`<section class="card">
      <div class="card-head"><h2>${icon('inbox', 18)} Review queue</h2><span class="muted small">${n.total}</span></div>
      <p class="card-body">${reviewSummary(true)}</p>
      <a class="btn block outline" href="#/review">Open review queue</a>
    </section>`;
  }
  return h`<section class="block">
    <div class="block-head"><h2>Review queue</h2></div>
    <div class="card list"><a class="row link" href="#/review"><span class="avatar square sm">${icon('inbox', 18)}</span>
      <span class="main"><b>${reviewSummary(false)}</b><small>Add, link or ignore new senders</small></span>
      <span class="chev">${icon('chevronRight', 18)}</span></a></div>
  </section>`;
}

/** What Skyway logged from your email by itself this week, so you can add notes. */
function autoCard() {
  const items = model.autoLogged(7, 5);
  if (!items.length) return '';
  return h`<section class="card">
    <div class="card-head"><h2>${icon('mail', 18)} Logged automatically</h2><span class="muted small">From Gmail</span></div>
    <div class="list">${items.map((x) => {
    if (x.kind === 'queued') {
      const name = x.r.displayName || x.r.email;
      return h`<div class="row auto"><span class="avatar square sm">${icon('mail', 16)}</span>
        <span class="main"><b>Email from ${name}</b><small>Not a contact yet · sent to the review queue</small></span>
        <span class="muted small">${fmtAgo(x.at)}</span>
        <a class="btn small secondary" href="#/review">Review</a></div>`;
    }
    const i = x.i;
    const who = firstName(x.c.name) || x.c.name;
    const title = i.direction === 'Outbound' ? 'Email to ' + x.c.name : (i.direction === 'Inbound' ? 'Email from ' + x.c.name : 'Email with ' + x.c.name);
    return h`<div class="row auto"><span class="avatar square sm">${icon('mail', 16)}</span>
      <a class="main" href="#/people/${x.c.id}"><b>${title}</b><small>${[i.subject, i.source].filter(Boolean).join(' · ')}</small></a>
      <span class="muted small">${fmtAgo(x.at)}</span>
      <a class="btn small secondary" href="#/log?iid=${i.id}" aria-label="Add notes about the email with ${who}">Add notes</a></div>`;
  })}</div>
  </section>`;
}

function replyCard(desktop) {
  const items = replyItems();
  if (!items.length) return '';
  return h`<section class="${desktop ? 'card' : 'block'}">
    <div class="block-head"><h2>Reply owed</h2><span class="muted small">${items.length}</span></div>
    <div class="${desktop ? 'list' : 'card list'}">
      ${items.slice(0, 4).map(({ c, i }) => {
    const days = daysBetween(ymdOf(new Date(i.occurredAt)), todayYmd());
    const link = safeUrl(i.link);
    const where = /^https:\/\/mail\.google\.com\//.test(link) ? 'Reply in Gmail' : 'Reply';
    return h`<div class="row reply">
        ${avatar(c)}
        <a class="main" href="#/people/${c.id}"><b>${c.name}</b><small>${i.subject || i.summary || 'Waiting on your reply'} · ${fmtDate(i.occurredAt)}</small></a>
        ${desktop ? h`<span class="row-actions">
          ${link ? h`<a class="btn small outline" href="${link}" target="_blank" rel="noopener">${where}</a>` : ''}
          <button class="btn small secondary" data-act="no-reply" data-id="${i.id}">No reply needed</button></span>`
    : h`<span class="muted small">${plural(Math.max(days, 0), 'day')}</span>`}
      </div>`;
  })}
    </div>
  </section>`;
}

function tasksCard(desktop) {
  const open = model.openTasks();
  if (!open.length && !desktop) return '';
  return h`<section class="${desktop ? 'card' : 'block'}">
    <div class="block-head"><h2>Tasks</h2>${open.length ? h`<a class="link" href="#/tasks">${desktop ? open.length + ' open' : 'See all ' + open.length}</a>` : ''}</div>
    ${open.length ? h`<div class="${desktop ? 'list' : 'card list'}">${open.slice(0, desktop ? 5 : 3).map(taskRow)}</div>`
    : h`<p class="card-body muted">Nothing open. Add a next step when you log a conversation.</p>`}
  </section>`;
}

function eventModeCard(desktop) {
  const e = model.eventMode();
  if (e) {
    return h`<section class="card eventcard on">
      <span class="ic">${icon('calendar', 20)}</span>
      <a class="main" href="#/events/${e.id}"><small>Event mode on</small><b>${e.name}</b></a>
      <button class="btn small outline" data-act="end-event-mode">End</button>
    </section>`;
  }
  if (desktop) {
    return h`<section class="card">
      <div class="card-head"><h2>${icon('calendar', 18)} Event mode</h2></div>
      <p class="card-body">Tag everyone you add or log to one event, so you can see later who was there.</p>
      <a class="btn block outline" href="#/events?pick=1">Start event mode</a>
    </section>`;
  }
  return h`<section class="card eventcard">
    <span class="ic">${icon('calendar', 20)}</span>
    <span class="main"><b>Event mode</b><small>Tag everyone you add to one event</small></span>
    <a class="btn small outline" href="#/events?pick=1">Start</a>
  </section>`;
}

function welcome() {
  return h`<section class="card welcome">
    <h2>Your network starts here</h2>
    <p>Add the people you know. Skyway reminds you when it’s been a while, keeps your notes, and remembers who introduced you.</p>
    <a class="btn" href="#/people/new">${icon('userPlus', 18)}Add your first contact</a>
    <p class="muted small">You can also paste rows into the Contacts tab of your Sheet. They show up here after the next sync.</p>
  </section>`;
}

/* --------------------------------------------------------------- screen */

function renderPhone() {
  const none = !model.people().length;
  return h`<div class="page">
    <header class="page-head top">
      <div class="titles"><p class="eyebrow">${fmtHeaderDate(new Date())}</p><h1>Today</h1></div>
      <div class="actions">${syncPill()}</div>
    </header>
    <div class="tiles2">
      <a class="tilebtn primary" href="#/log">${icon('pencil', 22)}<span>Quick log</span></a>
      <a class="tilebtn" href="#/people/new">${icon('userPlus', 22)}<span>New contact</span></a>
    </div>
    ${none ? welcome() : ''}
    ${eventModeCard(false)}
    ${comingUpCard(false)}
    ${dueBlockPhone()}
    ${replyCard(false)}
    ${tasksCard(false)}
    ${reviewCard(false)}
  </div>`;
}

function renderDesktop() {
  const none = !model.people().length;
  return h`<div class="page wide">
    <header class="page-head top">
      <div class="titles"><p class="eyebrow">${fmtHeaderDate(new Date())}</p><h1>Today</h1></div>
      <div class="actions">
        <form class="search-box head-search" data-form="search" role="search">${icon('search', 18)}
          <input type="search" name="q" placeholder="Search people, firms, notes" aria-label="Search people" data-skip></form>
        <a class="btn secondary" href="#/people/new">${icon('userPlus', 18)}New contact</a>
        <a class="btn" href="#/log">${icon('pencil', 18)}Quick log</a>
      </div>
    </header>
    <div class="grid2">
      <div class="stack">
        ${none ? welcome() : ''}
        ${dueTableDesktop()}
        ${autoCard()}
      </div>
      <aside class="stack">
        ${comingUpCard(true)}
        ${replyCard(true)}
        ${tasksCard(true)}
        ${reviewCard(true)}
        ${eventModeCard(true)}
      </aside>
    </div>
  </div>`;
}

export default {
  id: 'today', chrome: 'tabs', navKey: 'today', live: true,
  title: () => 'Today',
  render() { return ui.desktop() ? renderDesktop() : renderPhone(); },
  submit(form) {
    const q = (form.q && form.q.value || '').trim();
    ui.go('#/people' + (q ? '?q=' + encodeURIComponent(q) : ''));
  },
  act: {
    'task-done': (el) => completeTask(el.dataset.id),
    async 'no-reply'(el) {
      const undo = await actions.setReplyStatus(el.dataset.id, 'No reply needed');
      if (undo) toast('Marked no reply needed', { action: { label: 'Undo', fn: () => actions.undoReplyStatus(undo) } });
    }
  }
};
