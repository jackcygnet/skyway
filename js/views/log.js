// Skyway app · logging a conversation (one person or several), with an
// optional next step. Also edits a conversation logged earlier.

import * as store from '../store.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import {
  h, newId, nowIso, randomHex, fmtWhen, toLocalInput, fromLocalInput, addDays, addMonths, todayYmd,
  cadenceSpan, firstName, defaultSortName, fmtDate, plural
} from '../util.js';
import { icon } from '../icons.js';
import { attendanceItem } from '../actions.js';
import {
  avatar, sheetHead, sheetFoot, choiceChips, segmented, toggleRow, pickerBox, updatePicker, pickerEnter, syncDraft, empty
} from './parts.js';

const TYPES = ['Call', 'Coffee', 'Meeting', 'Video call', 'Event', 'Text', 'Email', 'Other'];
const DUE = [['1w', '1 week'], ['2w', '2 weeks'], ['1m', '1 month'], ['date', 'Pick date']];

let draft = null;
let focusPicker = false;

function init(route) {
  const iid = route.q.get('iid') || '';
  const it = iid ? model.getLive('Interactions', iid) : null;
  const ev = route.q.get('event') ? model.getLive('Events', route.q.get('event')) : model.eventMode();
  const who = it ? [it.contactId] : String(route.q.get('who') || '').split(',')
    .filter((id) => model.getLive('Contacts', id));
  draft = {
    key: route.hash,
    iid: it ? it.id : '',
    missing: !!iid && !it,
    who,
    newNames: {},
    type: it ? it.type || 'Other' : (ev ? 'Event' : 'Call'),
    direction: it ? it.direction || '' : 'Outbound',
    // An email someone else sent that this person was copied on has no direction. Editing keeps it that way.
    blankDirection: !!(it && it.type === 'Email' && !it.direction),
    whenIso: it ? it.occurredAt : '',
    changingWhen: false,
    subject: it ? it.subject || '' : '',
    notes: it ? it.notes || '' : '',
    eventId: it ? it.eventId || '' : (ev ? ev.id : ''),
    nextTitle: '', nextDue: '1w', nextDate: '', nextOwner: 'Me',
    counts: it ? it.countsAsCheckIn !== false : true,
    errors: {}
  };
  focusPicker = !who.length;
}

function personName(id) {
  if (draft.newNames[id]) return draft.newNames[id];
  const c = model.getLive('Contacts', id);
  return c ? c.name : 'Someone';
}

function whoBlock() {
  const fixed = !!draft.iid;
  return h`<div class="field"><span class="label">Who</span>
    ${draft.who.map((id) => {
    const c = model.getLive('Contacts', id);
    const isNew = !!draft.newNames[id];
    return h`<div class="picked">${avatar({ name: personName(id) })}
        <span class="main"><b>${personName(id)}</b><small>${isNew ? 'New contact' : model.contactLine(c)}</small></span>
        ${fixed ? '' : h`<button type="button" class="iconbtn" data-act="drop-who" data-id="${id}" aria-label="Remove ${personName(id)}">${icon('x', 18)}</button>`}
      </div>`;
  })}
    ${fixed ? '' : pickerBox('pick-who', draft.who.length ? 'Add another person' : 'Who did you talk to?', { dashed: true })}
    ${draft.errors.who ? h`<p class="error">${draft.errors.who}</p>` : ''}
  </div>`;
}

function whenBlock() {
  const label = draft.whenIso ? fmtWhen(draft.whenIso) : (draft.iid ? '' : 'Now');
  if (draft.changingWhen) {
    return h`<label class="field"><span class="label">When</span>
      <input type="datetime-local" name="whenLocal" value="${toLocalInput(draft.whenIso || new Date())}" data-skip></label>`;
  }
  return h`<div class="when-row">
    <span>${icon('clock', 18)}<span class="muted">When </span>${label}</span>
    <button type="button" class="link strong" data-act="change-when">Change</button>
  </div>`;
}

function nearbyEvents() {
  const now = Date.now();
  return model.live('Events').filter((e) => {
    const t = Date.parse(e.startAt || '');
    return !isNaN(t) && t > now - 21 * 86400000 && t < now + 3 * 86400000;
  }).sort((a, b) => Math.abs(Date.parse(a.startAt) - now) - Math.abs(Date.parse(b.startAt) - now));
}

function eventBlock() {
  const cur = draft.eventId ? model.getLive('Events', draft.eventId) : null;
  const list = nearbyEvents();
  if (cur && !list.some((e) => e.id === cur.id)) list.unshift(cur);
  if (!list.length) return '';
  return h`<label class="field"><span class="label">Event<em>Optional</em></span>
    <select name="eventId">
      <option value="" ${!draft.eventId ? 'selected' : ''}>Not at an event</option>
      ${list.map((e) => h`<option value="${e.id}" ${draft.eventId === e.id ? 'selected' : ''}>${e.name} · ${fmtDate(e.startAt)}</option>`)}
    </select></label>`;
}

function countsDetail() {
  if (!draft.counts) return 'Logged, but it won’t restart anyone’s check-in clock';
  if (draft.who.length > 1) return 'Restarts the check-in clock for ' + plural(draft.who.length, 'person', 'people');
  const c = draft.who[0] ? model.getLive('Contacts', draft.who[0]) : null;
  if (!c) return draft.who.length ? 'Starts their check-in clock' : 'Restarts their check-in clock';
  const cad = model.cadenceOf(c);
  if (!cad || cad.none) return firstName(c.name) + ' has no check-in reminders';
  return 'Restarts ' + firstName(c.name) + '’s ' + cadenceSpan(cad) + ' clock';
}

function form() {
  const editing = !!draft.iid;
  return h`<form class="sheet" data-form="log" novalidate>
    ${sheetHead({ title: editing ? 'Edit conversation' : 'Log an interaction', act: 'close' })}
    <div class="sheet-body stack">
      ${whoBlock()}
      <div class="field"><span class="label">What kind</span>${choiceChips('type', TYPES.map((t) => [t, t]), draft.type)}</div>
      ${draft.type === 'Email' ? h`
        ${segmented('direction', [['Outbound', 'I wrote'], ['Inbound', 'They wrote']], draft.direction || 'Outbound')}
        <label class="field"><span class="label">Subject</span><input type="text" name="subject" value="${draft.subject}"></label>` : ''}
      ${whenBlock()}
      ${eventBlock()}
      <label class="field"><span class="label">Notes</span>
        <textarea name="notes" rows="4" placeholder="What you talked about, what to remember">${draft.notes}</textarea></label>
      ${draft.type !== 'Email' && draft.subject ? h`<label class="field"><span class="label">Title</span><input type="text" name="subject" value="${draft.subject}"></label>` : ''}
      <div class="nextstep">
        <div class="label-row"><span class="label">Next step</span><span class="muted small">Optional</span></div>
        <input type="text" name="nextTitle" value="${draft.nextTitle}" placeholder="Send a thank-you note" aria-label="Next step">
        ${draft.nextTitle.trim() ? h`
          ${choiceChips('nextDue', DUE, draft.nextDue, 'tint')}
          ${draft.nextDue === 'date' ? h`<input type="date" name="nextDate" value="${draft.nextDate}" aria-label="Due date">` : ''}
          ${segmented('nextOwner', [['Me', 'I owe it'], ['Them', 'They owe it']], draft.nextOwner)}` : ''}
      </div>
      ${toggleRow('counts', draft.counts, 'Counts as a check-in', countsDetail())}
      ${editing ? h`<div class="danger-zone"><button type="button" class="btn ghost danger-text" data-act="delete">${icon('trash', 18)}Delete this entry</button></div>` : ''}
    </div>
    ${sheetFoot(editing ? 'Save changes' : 'Save log')}
  </form>`;
}

function dueFor(choice, date) {
  const t = todayYmd();
  if (choice === '1w') return addDays(t, 7);
  if (choice === '2w') return addDays(t, 14);
  if (choice === '1m') return addMonths(t, 1);
  if (choice === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
  return '';
}

async function save() {
  draft.errors = {};
  if (!draft.who.length) {
    draft.errors.who = 'Choose who you talked to.';
    ui.render();
    return;
  }
  if (draft.nextTitle.trim() && draft.nextDue === 'date' && !draft.nextDate) {
    toast('Pick a date for the next step, or choose 1 week', { warn: true });
    return;
  }
  const occurredAt = draft.whenIso || nowIso();
  if (Date.parse(occurredAt) > Date.now() + 5 * 60000) {
    const ok = await ask({ title: 'That time is in the future', body: 'It won’t count as a check-in until then. Save it anyway?', ok: 'Save' });
    if (!ok) return;
  }
  const ev = draft.eventId ? model.getLive('Events', draft.eventId) : null;
  const items = [];
  const fields = {
    occurredAt, type: draft.type, subject: draft.subject.trim(), notes: draft.notes.trim(),
    eventId: ev ? ev.id : '', countsAsCheckIn: !!draft.counts,
    direction: draft.type === 'Email' ? (draft.direction || (draft.blankDirection ? '' : 'Outbound')) : ''
  };
  let firstInteractionId = '';
  if (draft.iid) {
    items.push({ t: 'Interactions', r: Object.assign({ id: draft.iid }, fields) });
    firstInteractionId = draft.iid;
  } else {
    const groupId = draft.who.length > 1 ? 'grp_' + randomHex(6) : '';
    draft.who.forEach((cid) => {
      if (draft.newNames[cid]) {
        const name = draft.newNames[cid];
        items.push({ t: 'Contacts', r: {
          id: cid, name, sortName: defaultSortName(name), tier: 'Network', source: 'App', howMet: ev ? ev.name : ''
        } });
      }
      if (ev) {
        const a = attendanceItem(ev.id, cid);
        if (a) items.push(a);
      }
      const iid = newId('int');
      if (!firstInteractionId) firstInteractionId = iid;
      items.push({ t: 'Interactions', r: Object.assign({ id: iid, contactId: cid, groupId, source: 'App' }, fields) });
    });
  }
  const title = draft.nextTitle.trim();
  if (title) {
    items.push({ t: 'Tasks', r: {
      contactId: draft.who[0], title, dueAt: dueFor(draft.nextDue, draft.nextDate), owner: draft.nextOwner,
      status: 'Open', source: 'App', interactionId: firstInteractionId
    } });
  }
  await store.saveMany(items);
  const n = draft.who.length;
  const back = '#/people/' + draft.who[0];
  const editing = !!draft.iid;
  const added = Object.keys(draft.newNames).length;
  draft = null;
  toast(editing ? 'Saved' : (n > 1 ? 'Logged for ' + plural(n, 'person', 'people') : 'Logged') +
    (added ? ' · added ' + plural(added, 'new contact') : '') + (title ? ' · next step saved' : ''));
  ui.back(back);
}

export default {
  id: 'log', chrome: 'sheet', navKey: 'today', live: false,
  title: () => 'Log',
  render(route) {
    if (!draft || draft.key !== route.hash) init(route);
    if (draft.missing) {
      return h`<div class="page">${sheetHead({ title: 'Edit conversation', act: 'close' })}
        ${empty('That entry isn’t in Skyway anymore', 'It may have been deleted on another device.')}</div>`;
    }
    return form();
  },
  mount(el) {
    if (focusPicker) {
      const p = el.querySelector('input[data-picker]');
      if (p && !('ontouchstart' in window)) p.focus();
      focusPicker = false;
    }
    const w = el.querySelector('input[name="whenLocal"]');
    if (w) w.focus();
  },
  input(el) {
    if (!draft) return;
    if (el.dataset.picker !== undefined) {
      updatePicker(el, { exclude: new Set(draft.who), allowNew: true });
      return;
    }
    if (el.name === 'whenLocal') {
      const iso = fromLocalInput(el.value);
      if (iso) draft.whenIso = iso;
      return;
    }
    const before = draft.nextTitle.trim();
    syncDraft(draft, el);
    // The due-date choices appear once a next step is typed.
    if (el.name === 'nextTitle' && !!before !== !!draft.nextTitle.trim()) {
      ui.render();
      const inp = document.querySelector('input[name="nextTitle"]');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  },
  change(el) {
    if (!draft || el.dataset.picker !== undefined) return;
    if (el.name === 'whenLocal') {
      const iso = fromLocalInput(el.value);
      if (iso) draft.whenIso = iso;
      draft.changingWhen = false;
      ui.render();
      return;
    }
    syncDraft(draft, el);
    if (el.name === 'eventId') {
      if (el.value && draft.type !== 'Event' && !draft.iid) draft.type = 'Event';
      ui.render();
    }
  },
  keydown(el, ev) { pickerEnter(el, ev); },
  submit() { return save(); },
  act: {
    close() {
      const back = draft && draft.who[0] ? '#/people/' + draft.who[0] : '#/today';
      draft = null;
      ui.back(back);
    },
    choose(el) {
      draft[el.dataset.name] = el.dataset.value;
      ui.render();
    },
    toggle(el) {
      draft[el.dataset.name] = !draft[el.dataset.name];
      ui.render();
    },
    'change-when'() {
      draft.changingWhen = true;
      ui.render();
    },
    pick(el) {
      if (!draft.who.includes(el.dataset.id)) draft.who.push(el.dataset.id);
      draft.errors.who = '';
      focusPicker = true;
      ui.render();
    },
    'pick-new'(el) {
      const name = String(el.dataset.name || '').trim().replace(/\s+/g, ' ');
      if (!name) return;
      const id = newId('con');
      draft.newNames[id] = name;
      draft.who.push(id);
      draft.errors.who = '';
      ui.render();
    },
    'drop-who'(el) {
      draft.who = draft.who.filter((id) => id !== el.dataset.id);
      delete draft.newNames[el.dataset.id];
      ui.render();
    },
    async delete() {
      const it = model.getLive('Interactions', draft.iid);
      if (!it) return;
      const ok = await ask({ title: 'Delete this entry?', body: 'It disappears from their history. The row stays in your Sheet with “deleted” ticked.', ok: 'Delete', danger: true });
      if (!ok) return;
      await store.remove('Interactions', it.id);
      const back = '#/people/' + it.contactId;
      draft = null;
      toast('Deleted');
      ui.back(back);
    }
  }
};
