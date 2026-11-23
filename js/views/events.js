// Skyway app · Events: the list, each event's page, event mode, and the form.

import * as store from '../store.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import {
  h, fmtDay, fmtLongDay, fmtTime, plural, toLocalInput, fromLocalInput, safeUrl, nowIso, ymdOf, todayYmd
} from '../util.js';
import { icon } from '../icons.js';
import * as actions from '../actions.js';
import {
  avatar, dateBadge, topHead, subHead, sheetHead, sheetFoot, pickerBox, updatePicker, pickerEnter, syncDraft, empty, peopleCount
} from './parts.js';

function whenLine(e) {
  return [fmtLongDay(e.startAt), fmtTime(e.startAt), e.location].filter(Boolean).join(' · ');
}

function eventRow(e) {
  const n = model.eventPeople(e.id).length;
  const bits = [fmtDay(e.startAt).split(',')[0], fmtTime(e.startAt), e.location, n ? peopleCount(n) : ''].filter(Boolean);
  return h`<a class="row link" href="#/events/${e.id}">${dateBadge(e.startAt)}
    <span class="main"><b>${e.name || 'Untitled event'}</b><small>${bits.join(' · ')}</small></span>
    <span class="chev">${icon('chevronRight', 18)}</span></a>`;
}

/** Events happening today, or within a few hours either side. */
function eventsNow() {
  const now = Date.now();
  const t = todayYmd();
  return model.live('Events').filter((e) => {
    const s = Date.parse(e.startAt || '');
    if (isNaN(s)) return false;
    const end = Date.parse(e.endAt || '') || s + 3 * 3600000;
    return ymdOf(new Date(s)) === t || (s - 6 * 3600000 < now && end + 3 * 3600000 > now);
  }).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
}

/* ---------------------------------------------------------------- list */

let picking = false;
let pastShown = 20;
let seenHash = '';

function eventModeCard() {
  const on = model.eventMode();
  if (on) {
    return h`<section class="card eventcard on">
      <span class="ic">${icon('calendar', 20)}</span>
      <a class="main" href="#/events/${on.id}"><small>Event mode on</small><b>${on.name}</b></a>
      <button class="btn small outline" data-act="end-event-mode">End</button>
    </section>`;
  }
  if (!picking) {
    return h`<section class="card eventcard">
      <span class="main"><b>At an event right now?</b><small>Event mode tags everyone you add or log</small></span>
      <button class="btn small outline" data-act="pick">Start</button>
    </section>`;
  }
  const now = eventsNow();
  return h`<section class="card chooser">
    <div class="card-head"><h2>Which event are you at?</h2><button class="iconbtn" data-act="unpick" aria-label="Cancel">${icon('x', 18)}</button></div>
    <p class="card-body muted">Everyone you add or log until you end event mode is tagged to it. It ends by itself after 12 hours.</p>
    <div class="list">
      ${now.map((e) => h`<button class="row link" data-act="start-mode" data-id="${e.id}">${dateBadge(e.startAt)}
        <span class="main"><b>${e.name}</b><small>${[fmtTime(e.startAt), e.location].filter(Boolean).join(' · ')}</small></span>
        <span class="btn small">Start</span></button>`)}
      <a class="row link" href="#/events/new?mode=1"><span class="avatar add">${icon('plus', 18)}</span>
        <span class="main"><b>${now.length ? 'Somewhere else' : 'Name this event'}</b><small>Makes a new event, then starts event mode</small></span>
        <span class="chev">${icon('chevronRight', 18)}</span></a>
    </div>
  </section>`;
}

export const eventsView = {
  id: 'events', chrome: 'tabs', navKey: 'events', live: true,
  title: () => 'Events',
  render(route) {
    if (seenHash !== route.hash) {
      seenHash = route.hash;
      picking = route.q.get('pick') === '1' && !model.eventMode();
    }
    const up = model.eventsUpcoming();
    const past = model.eventsPast();
    return h`<div class="page">
      ${topHead({ title: 'Events', actions: h`<a class="btn small" href="#/events/new">${icon('plus', 18)}New</a>` })}
      ${eventModeCard()}
      ${!up.length && !past.length ? empty('No events yet', 'Add the mixers, lectures and coffees you go to. Event mode tags everyone you meet there.',
    h`<a class="btn" href="#/events/new">${icon('plus', 18)}New event</a>`) : ''}
      ${up.length ? h`<section class="block"><h2 class="group-label">Upcoming</h2>
        <div class="card list">${up.map(eventRow)}</div></section>` : ''}
      ${past.length ? h`<section class="block"><h2 class="group-label">Past</h2>
        <div class="card list">${past.slice(0, pastShown).map(eventRow)}</div>
        ${past.length > pastShown ? h`<button class="btn secondary block" data-act="more-past">Show ${Math.min(20, past.length - pastShown)} more</button>` : ''}
      </section>` : ''}
    </div>`;
  },
  act: {
    pick() { picking = true; ui.render(); },
    unpick() { picking = false; ui.render(); },
    async 'start-mode'(el) {
      await actions.startEventMode(el.dataset.id);
      picking = false;
      toast('Event mode on');
      ui.go('#/events/' + el.dataset.id);
    },
    'more-past'() { pastShown += 20; ui.render(); }
  }
};

/* ---------------------------------------------------------- event page */

let adding = false;
let addingFor = '';

function personCard(c, e) {
  const talks = model.interactionsOf(c.id).filter((i) => i.eventId === e.id);
  const last = talks[0];
  const onList = model.attendanceOf(e.id).some((a) => a.contactId === c.id);
  return h`<div class="card person-at">
    <a class="row link" href="#/people/${c.id}">${avatar(c)}
      <span class="main"><b>${c.name}</b><small>${model.contactLine(c)}</small></span></a>
    ${last && (last.notes || last.summary) ? h`<p class="text">${last.notes || last.summary}</p>` : ''}
    <div class="person-foot">
      <span class="muted small">${last ? (talks.length > 1 ? plural(talks.length, 'conversation') + ' logged' : 'Logged ' + fmtTime(last.occurredAt)) : 'Not logged yet'}</span>
      <span class="row-actions">
        ${onList && !talks.length ? h`<button class="btn small ghost" data-act="remove-person" data-id="${c.id}">Remove</button>` : ''}
        <a class="btn small outline" href="#/log?who=${c.id}&event=${e.id}">Log</a>
      </span>
    </div>
  </div>`;
}

export const eventView = {
  id: 'event', chrome: 'sub', navKey: 'events', live: true,
  title(route) { const e = model.getLive('Events', route.parts[1]); return e ? e.name : 'Event'; },
  render(route) {
    const e = model.getLive('Events', route.parts[1]);
    if (!e) {
      return h`<div class="page">${subHead({ back: '#/events' })}
        ${empty('This event isn’t in Skyway anymore', 'It may have been deleted on another device.')}</div>`;
    }
    if (addingFor !== e.id) { adding = false; addingFor = e.id; }
    const people = model.eventPeople(e.id);
    const talks = model.interactionsAtEvent(e.id).length;
    const on = model.eventMode();
    const isOn = on && on.id === e.id;
    const link = safeUrl(e.link);
    return h`<div class="page">
      ${subHead({ back: '#/events', actions: h`<a class="link strong" href="#/events/${e.id}/edit">Edit</a>` })}
      <div class="event-head">
        <p class="eyebrow">Event</p>
        <h1>${e.name || 'Untitled event'}</h1>
        <p class="line">${whenLine(e)}</p>
        <p class="muted">${peopleCount(people.length)} · ${plural(talks, 'conversation')} logged</p>
      </div>
      <div class="actions-row two">
        <button class="btn" data-act="add">${icon('userPlus', 18)}Add someone</button>
        ${isOn ? h`<button class="btn secondary" data-act="end-event-mode">End event mode</button>`
    : h`<button class="btn secondary" data-act="start-here">Start event mode</button>`}
      </div>
      ${adding ? h`<div class="card adder">
        ${pickerBox('pick-event', 'Search contacts, or type a new name', { autofocus: true })}
        <p class="hint">Pick someone already in Skyway, or add a new person. They’re tagged to this event.</p>
      </div>` : ''}
      <section class="block">
        <h2 class="group-label">People you met here</h2>
        ${people.length ? h`<div class="stack tight">${people.map((c) => personCard(c, e))}</div>`
    : h`<div class="card quietcard">${icon('people', 18)}<span>No one yet. Add the people you meet, or log a conversation and pick this event.</span></div>`}
      </section>
      ${e.notes || link ? h`<section class="card">
        <div class="card-head"><h2>Event notes</h2></div>
        ${e.notes ? h`<p class="card-body text">${e.notes}</p>` : ''}
        ${link ? h`<p class="card-body"><a href="${link}" target="_blank" rel="noopener">Open the invitation${icon('external', 14)}</a></p>` : ''}
      </section>` : ''}
    </div>`;
  },
  mount(el) {
    const p = el.querySelector('input[data-picker]');
    if (p) p.focus();
  },
  input(el, ev, route) {
    if (el.dataset.picker === undefined) return;
    const e = model.getLive('Events', route.parts[1]);
    const already = new Set(e ? model.eventPeople(e.id).map((c) => c.id) : []);
    updatePicker(el, { exclude: already, allowNew: true });
  },
  keydown(el, ev) { pickerEnter(el, ev); },
  act: {
    add() { adding = !adding; ui.render(); },
    async pick(el, ev, route) {
      const c = model.getLive('Contacts', el.dataset.id);
      await actions.addToEvent(route.parts[1], el.dataset.id);
      adding = false;
      toast('Added ' + (c ? c.name : 'them'));
      ui.render();
    },
    'pick-new'(el, ev, route) {
      adding = false;
      ui.go('#/people/new?event=' + route.parts[1] + '&name=' + encodeURIComponent(el.dataset.name || ''));
    },
    async 'remove-person'(el, ev, route) {
      await actions.removeFromEvent(route.parts[1], el.dataset.id);
      toast('Removed from this event');
    },
    async 'start-here'(el, ev, route) {
      await actions.startEventMode(route.parts[1]);
      toast('Event mode on');
    }
  }
};

/* ---------------------------------------------------------------- form */

let draft = null;

function init(route) {
  const isNew = route.parts[1] === 'new';
  const e = isNew ? null : model.getLive('Events', route.parts[1]);
  const start = new Date();
  if (isNew && route.q.get('mode') !== '1') {
    start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  }
  draft = {
    key: route.hash,
    id: e ? e.id : '',
    missing: !isNew && !e,
    startMode: isNew && route.q.get('mode') === '1',
    name: e ? e.name || '' : '',
    start: e ? (e.startAt ? toLocalInput(e.startAt) : '') : toLocalInput(start),
    end: e && e.endAt ? toLocalInput(e.endAt) : '',
    location: e ? e.location || '' : '',
    link: e ? e.link || '' : '',
    notes: e ? e.notes || '' : '',
    error: ''
  };
}

export const eventForm = {
  id: 'event-form', chrome: 'sheet', navKey: 'events', live: false,
  title: (route) => (route.parts[1] === 'new' ? 'New event' : 'Edit event'),
  render(route) {
    if (!draft || draft.key !== route.hash) init(route);
    if (draft.missing) {
      return h`<div class="page">${sheetHead({ title: 'Edit event', act: 'close' })}
        ${empty('This event isn’t in Skyway anymore', 'It may have been deleted on another device.')}</div>`;
    }
    const editing = !!draft.id;
    return h`<form class="sheet" data-form="event" novalidate>
      ${sheetHead({ title: editing ? 'Edit event' : 'New event', act: 'close' })}
      <div class="sheet-body stack">
        ${draft.startMode ? h`<div class="note">${icon('calendar', 18)}<span>Event mode starts when you save.</span></div>` : ''}
        <label class="field"><span class="label">Name</span>
          <input type="text" name="name" value="${draft.name}" placeholder="L&E Section winter mixer" ${editing ? '' : 'autofocus'} autocapitalize="words">
          ${draft.error ? h`<p class="error">${draft.error}</p>` : ''}</label>
        <div class="two">
          <label class="field"><span class="label">Starts</span><input type="datetime-local" name="start" value="${draft.start}"></label>
          <label class="field"><span class="label">Ends<em>Optional</em></span><input type="datetime-local" name="end" value="${draft.end}"></label>
        </div>
        <label class="field"><span class="label">Where</span><input type="text" name="location" value="${draft.location}" autocapitalize="words"></label>
        <label class="field"><span class="label">Link<em>Optional</em></span>
          <input type="url" name="link" value="${draft.link}" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://"></label>
        <label class="field"><span class="label">Notes</span><textarea name="notes" rows="3">${draft.notes}</textarea></label>
        ${editing ? h`<div class="danger-zone"><button type="button" class="btn ghost danger-text" data-act="delete">${icon('trash', 18)}Delete event</button></div>` : ''}
      </div>
      ${sheetFoot(editing ? 'Save changes' : (draft.startMode ? 'Save and start event mode' : 'Save event'))}
    </form>`;
  },
  input(el) { if (draft) syncDraft(draft, el); },
  change(el) { if (draft) syncDraft(draft, el); },
  async submit() {
    if (!draft.name.trim()) {
      draft.error = 'Give the event a name.';
      ui.render();
      return;
    }
    const startAt = fromLocalInput(draft.start) || nowIso();
    const endAt = draft.end ? fromLocalInput(draft.end) : '';
    if (endAt && Date.parse(endAt) < Date.parse(startAt)) {
      toast('The end is before the start', { warn: true });
      return;
    }
    const rec = { name: draft.name.trim(), startAt, endAt: endAt || '', location: draft.location.trim(), link: draft.link.trim(), notes: draft.notes.trim() };
    if (draft.id) rec.id = draft.id;
    else rec.source = 'App';
    const saved = await store.save('Events', rec);
    const startMode = draft.startMode;
    const editing = !!draft.id;
    draft = null;
    if (startMode) {
      await actions.startEventMode(saved.id);
      toast('Event mode on');
    } else toast(editing ? 'Saved' : 'Event added');
    if (editing) ui.backTo('#/events/' + saved.id);
    else ui.replace('#/events/' + saved.id);
  },
  act: {
    close() {
      const back = draft && draft.id ? '#/events/' + draft.id : '#/events';
      draft = null;
      ui.back(back);
    },
    async delete() {
      const e = model.getLive('Events', draft.id);
      if (!e) return;
      const ok = await ask({
        title: 'Delete ' + (e.name || 'this event') + '?',
        body: 'Conversations logged there stay in each person’s history. The row stays in your Sheet with “deleted” ticked.',
        ok: 'Delete', danger: true
      });
      if (!ok) return;
      const on = model.eventMode();
      if (on && on.id === e.id) await actions.endEventMode();
      await store.remove('Events', e.id);
      draft = null;
      toast('Deleted');
      ui.replace('#/events');
    }
  }
};
