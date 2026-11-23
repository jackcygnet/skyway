// Skyway app · Tasks: what you owe people, and what they owe you.

import * as store from '../store.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import { h, fmtDay, fmtDate, todayYmd, addDays, addMonths, daysBetween, nowIso } from '../util.js';
import { icon } from '../icons.js';
import * as actions from '../actions.js';
import {
  avatar, chip, subHead, sheetHead, sheetFoot, choiceChips, segmented, pickerBox, updatePicker, pickerEnter, syncDraft, empty
} from './parts.js';

/* ---------------------------------------------------------------- list */

let tab = 'open';
const BUCKETS = ['Overdue', 'Today', 'This week', 'Later', 'No date'];

function whoName(t) {
  const c = t.contactId ? model.getLive('Contacts', t.contactId) : null;
  return c ? c.name : '';
}

function taskCard(t) {
  const done = !model.isOpen(t);
  const late = !done && t.dueAt && daysBetween(todayYmd(), t.dueAt) < 0;
  const meta = [whoName(t), t.dueAt ? (done ? fmtDate(t.dueAt) : fmtDay(t.dueAt)) : ''].filter(Boolean).join(' · ');
  return h`<div class="card taskcard ${done ? 'done' : ''}">
    <button class="check ${done ? 'on' : ''}" data-act="${done ? 'reopen' : 'task-done'}" data-id="${t.id}"
      aria-label="${done ? 'Reopen' : 'Mark done'}: ${t.title}">${icon(done ? 'checkCircle' : 'circle', 22)}</button>
    <a class="main" href="#/tasks/${t.id}">
      <b>${t.title || 'Untitled task'}</b>
      ${meta ? h`<small class="${late ? 'late' : ''}">${meta}${late ? ' · overdue' : ''}</small>` : ''}
      ${done ? (t.status === 'Dismissed' ? h`<small>Dismissed</small>` : '')
    : h`<span class="chips inline">${chip(t.owner === 'Them' ? 'They owe' : 'You owe', t.owner === 'Them' ? 'outline' : 'soon')}</span>`}
      ${t.notes ? h`<small class="notes">${t.notes}</small>` : ''}
    </a>
  </div>`;
}

function groups(list) {
  const by = new Map(BUCKETS.map((b) => [b, []]));
  list.forEach((t) => by.get(model.taskBucket(t)).push(t));
  return BUCKETS.filter((b) => by.get(b).length).map((b) => h`<section class="block">
    <h2 class="group-label ${b === 'Overdue' ? 'late' : ''}">${b}</h2>
    <div class="stack tight">${by.get(b).map(taskCard)}</div>
  </section>`);
}

export const tasksView = {
  id: 'tasks', chrome: 'sub', navKey: 'tasks', live: true,
  title: () => 'Tasks',
  render() {
    const open = model.openTasks();
    const theirs = open.filter((t) => t.owner === 'Them');
    const done = model.doneTasks(40);
    let body;
    if (tab === 'done') {
      body = done.length ? h`<div class="stack tight">${done.map(taskCard)}</div>`
        : empty('Nothing finished yet', 'Tick a task’s circle when it’s done.');
    } else {
      const list = tab === 'theirs' ? theirs : open;
      body = list.length ? groups(list) : empty(tab === 'theirs' ? 'No one owes you anything' : 'Nothing open',
        tab === 'theirs' ? 'When someone promises an intro or a reply, add it here as “They owe it”.' : 'Add a next step when you log a conversation, or add a task here.');
      if (tab === 'open' && done.length) {
        body = h`${body}<section class="block"><h2 class="group-label">Done recently</h2>
          <div class="stack tight">${done.slice(0, 3).map(taskCard)}</div></section>`;
      }
    }
    return h`<div class="page">
      ${subHead({ title: 'Tasks', back: ui.desktop() ? '#/today' : '#/more', actions: h`<a class="btn small" href="#/tasks/new">${icon('plus', 18)}Add</a>` })}
      <div class="seg tabs" role="tablist">
        <button type="button" role="tab" data-act="tab" data-tab="open" aria-selected="${tab === 'open'}">Open · ${open.length}</button>
        <button type="button" role="tab" data-act="tab" data-tab="theirs" aria-selected="${tab === 'theirs'}">They owe · ${theirs.length}</button>
        <button type="button" role="tab" data-act="tab" data-tab="done" aria-selected="${tab === 'done'}">Done</button>
      </div>
      ${body}
    </div>`;
  },
  act: {
    tab(el) { tab = el.dataset.tab; ui.render(); },
    async 'task-done'(el) {
      const t = await actions.completeTask(el.dataset.id);
      if (t) toast('Done: ' + (t.title || 'task'));
    },
    async reopen(el) {
      await actions.reopenTask(el.dataset.id);
      toast('Reopened');
    }
  }
};

/* ---------------------------------------------------------------- form */

const DUE = [['', 'No date'], ['today', 'Today'], ['1w', '1 week'], ['2w', '2 weeks'], ['1m', '1 month'], ['date', 'Pick date']];
let draft = null;

function init(route) {
  const isNew = route.parts[1] === 'new';
  const t = isNew ? null : model.getLive('Tasks', route.parts[1]);
  const who = route.q.get('who');
  draft = {
    key: route.hash,
    id: t ? t.id : '',
    missing: !isNew && !t,
    title: t ? t.title || '' : '',
    contactId: t ? t.contactId || '' : (who && model.getLive('Contacts', who) ? who : ''),
    due: t ? (t.dueAt ? 'date' : '') : '1w',
    dueDate: t ? t.dueAt || '' : '',
    owner: t ? t.owner || 'Me' : 'Me',
    notes: t ? t.notes || '' : '',
    status: t ? t.status || 'Open' : 'Open',
    error: ''
  };
}

function dueValue() {
  const t = todayYmd();
  switch (draft.due) {
    case 'today': return t;
    case '1w': return addDays(t, 7);
    case '2w': return addDays(t, 14);
    case '1m': return addMonths(t, 1);
    case 'date': return draft.dueDate;
    default: return '';
  }
}

function whoField() {
  const c = draft.contactId ? model.getLive('Contacts', draft.contactId) : null;
  return h`<div class="field"><span class="label">Who it’s about<em>Optional</em></span>
    ${c ? h`<div class="picked">${avatar(c, 'sm')}<span class="main"><b>${c.name}</b><small>${model.contactLine(c)}</small></span>
      <button type="button" class="iconbtn" data-act="clear-who" aria-label="Remove ${c.name}">${icon('x', 18)}</button></div>`
    : pickerBox('pick-task', 'Search your contacts')}
  </div>`;
}

export const taskForm = {
  id: 'task-form', chrome: 'sheet', navKey: 'tasks', live: false,
  title: (route) => (route.parts[1] === 'new' ? 'New task' : 'Task'),
  render(route) {
    if (!draft || draft.key !== route.hash) init(route);
    if (draft.missing) {
      return h`<div class="page">${sheetHead({ title: 'Task', act: 'close' })}
        ${empty('That task isn’t in Skyway anymore', 'It may have been deleted on another device.')}</div>`;
    }
    const editing = !!draft.id;
    const open = draft.status === 'Open' || !draft.status;
    return h`<form class="sheet" data-form="task" novalidate>
      ${sheetHead({ title: editing ? 'Task' : 'New task', act: 'close' })}
      <div class="sheet-body stack">
        ${editing && !open ? h`<div class="note">${icon('checkCircle', 18)}<span>This task is ${draft.status === 'Dismissed' ? 'dismissed' : 'done'}.</span></div>` : ''}
        <label class="field"><span class="label">What needs doing</span>
          <input type="text" name="title" value="${draft.title}" ${editing ? '' : 'autofocus'} autocapitalize="sentences">
          ${draft.error ? h`<p class="error">${draft.error}</p>` : ''}</label>
        ${whoField()}
        <div class="field"><span class="label">Due</span>${choiceChips('due', DUE, draft.due, 'tint')}
          ${draft.due === 'date' ? h`<input type="date" name="dueDate" value="${draft.dueDate}" aria-label="Due date">` : ''}</div>
        ${segmented('owner', [['Me', 'I owe it'], ['Them', 'They owe it']], draft.owner)}
        <label class="field"><span class="label">Notes</span><textarea name="notes" rows="3">${draft.notes}</textarea></label>
        ${editing ? h`<div class="danger-zone">
          ${open ? h`<button type="button" class="btn secondary" data-act="mark-done">${icon('check', 18)}Mark done</button>
            <button type="button" class="btn ghost" data-act="dismiss">Dismiss</button>`
    : h`<button type="button" class="btn secondary" data-act="reopen">Reopen</button>`}
          <button type="button" class="btn ghost danger-text" data-act="delete">${icon('trash', 18)}Delete</button>
        </div>` : ''}
      </div>
      ${sheetFoot(editing ? 'Save changes' : 'Save task')}
    </form>`;
  },
  input(el) {
    if (!draft) return;
    if (el.dataset.picker !== undefined) { updatePicker(el, {}); return; }
    syncDraft(draft, el);
  },
  change(el) { if (draft && el.dataset.picker === undefined) syncDraft(draft, el); },
  keydown(el, ev) { pickerEnter(el, ev); },
  async submit() {
    if (!draft.title.trim()) {
      draft.error = 'Say what needs doing.';
      ui.render();
      return;
    }
    if (draft.due === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) {
      toast('Pick a due date, or choose No date', { warn: true });
      return;
    }
    const rec = {
      title: draft.title.trim(), contactId: draft.contactId, dueAt: dueValue(), owner: draft.owner, notes: draft.notes.trim()
    };
    if (draft.id) rec.id = draft.id;
    else Object.assign(rec, { status: 'Open', source: 'App' });
    await store.save('Tasks', rec);
    const editing = !!draft.id;
    draft = null;
    toast(editing ? 'Saved' : 'Task added');
    ui.back('#/tasks');
  },
  act: {
    close() { draft = null; ui.back('#/tasks'); },
    choose(el) {
      draft[el.dataset.name] = el.dataset.value;
      if (el.dataset.name === 'due' && el.dataset.value === 'date' && !draft.dueDate) draft.dueDate = addDays(todayYmd(), 7);
      ui.render();
    },
    pick(el) { draft.contactId = el.dataset.id; ui.render(); },
    'clear-who'() { draft.contactId = ''; ui.render(); },
    async 'mark-done'() {
      await store.save('Tasks', { id: draft.id, status: 'Done', doneAt: nowIso() });
      draft = null;
      toast('Done');
      ui.back('#/tasks');
    },
    async dismiss() {
      await store.save('Tasks', { id: draft.id, status: 'Dismissed', doneAt: nowIso() });
      draft = null;
      toast('Dismissed');
      ui.back('#/tasks');
    },
    async reopen() {
      await actions.reopenTask(draft.id);
      draft.status = 'Open';
      toast('Reopened');
      ui.render();
    },
    async delete() {
      const ok = await ask({ title: 'Delete this task?', body: 'The row stays in your Sheet with “deleted” ticked.', ok: 'Delete', danger: true });
      if (!ok) return;
      await store.remove('Tasks', draft.id);
      draft = null;
      toast('Deleted');
      ui.back('#/tasks');
    }
  }
};
