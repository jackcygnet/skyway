// Skyway app · adding or editing a person.

import * as store from '../store.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import {
  h, newId, nowIso, todayYmd, splitList, validEmail, normalizeEmail, describeCadence, defaultSortName,
  CADENCE_CHOICES, parseCadence, firstName
} from '../util.js';
import { icon } from '../icons.js';
import { attendanceItem } from '../actions.js';
import { avatar, sheetHead, sheetFoot, pickerBox, updatePicker, pickerEnter, syncDraft, empty } from './parts.js';

let draft = null;
let focusEmail = -1;

function routeEvent(route) {
  const id = route.q.get('event');
  const e = id ? model.getLive('Events', id) : null;
  return e || model.eventMode();
}

function init(route) {
  const editing = route.parts[1] !== 'new';
  const c = editing ? model.getLive('Contacts', route.parts[1]) : null;
  const ev = editing ? null : routeEvent(route);
  const autoSort = c ? (!String(c.sortName || '').trim() || c.sortName === defaultSortName(c.name)) : true;
  draft = {
    key: route.hash,
    id: c ? c.id : '',
    missing: editing && !c,
    eventId: ev ? ev.id : '',
    name: c ? c.name || '' : (route.q.get('name') || ''),
    orgName: c ? model.orgName(c.orgId) : '',
    title: c ? c.title || '' : '',
    whatTheyDo: c ? c.whatTheyDo || '' : '',
    howMet: c ? c.howMet || '' : (ev ? ev.name : ''),
    emails: c && (c.emails || []).length ? c.emails.slice() : [''],
    phone: c ? c.phone || '' : '',
    linkedIn: c ? c.linkedIn || '' : '',
    city: c ? c.city || '' : '',
    introducedById: c ? c.introducedById || '' : '',
    schools: c ? (c.schools || []).join('; ') : '',
    birthday: c ? c.birthday || '' : '',
    tags: c ? (c.tags || []).join('; ') : '',
    oneNoteLink: c ? c.oneNoteLink || '' : '',
    sortName: c && !autoSort ? c.sortName : '',
    tier: c ? c.tier || '' : 'Network',
    cadence: c ? String(c.cadence || '').trim().toLowerCase() : '',
    personalNotes: c ? c.personalNotes || '' : '',
    alsoLog: !editing && !!ev,
    errors: {}
  };
  draft.more = !!(c && (draft.emails.some(Boolean) || draft.phone || draft.linkedIn || draft.city || draft.introducedById ||
    draft.schools || draft.birthday || draft.tags || draft.oneNoteLink || draft.sortName));
}

function err(name) {
  return draft.errors[name] ? h`<p class="error">${draft.errors[name]}</p>` : '';
}

function tierTiles() {
  return h`<div class="tiles" role="group" aria-label="Check-in tier">
    ${model.TIERS.map((t) => {
    const cad = model.tierCadence(t);
    const d = !cad || cad.none ? 'No reminders' : describeCadence(cad).replace(/^every/, 'Every');
    return h`<button type="button" class="tile" data-act="tier" data-tier="${t}" aria-pressed="${draft.tier === t}">
        <b>${t}</b><small>${d}</small></button>`;
  })}
  </div>`;
}

function cadenceSelect() {
  const tierCad = model.TIERS.includes(draft.tier) ? model.tierCadence(draft.tier) : null;
  const choices = CADENCE_CHOICES.slice();
  if (draft.cadence && !choices.some(([v]) => v === draft.cadence) && parseCadence(draft.cadence)) {
    choices.unshift([draft.cadence, describeCadence(draft.cadence).replace(/^every/, 'Every') + ' (custom)']);
  }
  return h`<label class="field"><span class="label">Reminders for this person</span>
    <select name="cadence">
      <option value="" ${!draft.cadence ? 'selected' : ''}>Same as the tier${tierCad ? ' (' + describeCadence(tierCad) + ')' : ''}</option>
      ${choices.map(([v, l]) => h`<option value="${v}" ${draft.cadence === v ? 'selected' : ''}>${l}</option>`)}
    </select></label>`;
}

function introField() {
  const p = draft.introducedById ? model.getLive('Contacts', draft.introducedById) : null;
  return h`<div class="field"><span class="label">Introduced by</span>
    ${p ? h`<div class="picked">${avatar(p, 'sm')}<span class="main"><b>${p.name}</b><small>${model.contactLine(p)}</small></span>
      <button type="button" class="iconbtn" data-act="clear-intro" aria-label="Remove ${p.name}">${icon('x', 18)}</button></div>`
    : pickerBox('pick-intro', 'Search your contacts')}
  </div>`;
}

function emailFields() {
  return h`<div class="field"><span class="label">Email addresses</span>
    ${draft.emails.map((e, i) => h`<div class="inline-input">
      <input type="email" name="email" data-i="${i}" value="${e}" inputmode="email" autocomplete="off" autocapitalize="off"
        spellcheck="false" placeholder="name@example.com" aria-label="Email address ${i + 1}">
      ${draft.emails.length > 1 ? h`<button type="button" class="iconbtn" data-act="drop-email" data-i="${i}" aria-label="Remove this email">${icon('x', 18)}</button>` : ''}
    </div>`)}
    ${err('emails')}
    <button type="button" class="link" data-act="add-email">${icon('plus', 16)}Add another email</button>
    <p class="hint">Mail from any of these is logged to this person once email logging is on (step 3).</p>
  </div>`;
}

function text(name, label, attrs, hint) {
  return h`<label class="field"><span class="label">${label}${hint ? h`<em>${hint}</em>` : ''}</span>
    <input type="text" name="${name}" value="${draft[name]}" ${attrs || ''}>${err(name)}</label>`;
}

function form(route) {
  const editing = !!draft.id;
  const ev = draft.eventId ? model.getLive('Events', draft.eventId) : null;
  const c = editing ? model.getLive('Contacts', draft.id) : null;
  return h`<form class="sheet" data-form="contact" novalidate>
    ${sheetHead({ title: editing ? 'Edit ' + (firstName(c && c.name) || 'contact') : 'New contact', act: 'close', close: editing ? '#/people/' + draft.id : '#/people' })}
    <div class="sheet-body stack">
      ${ev && !editing ? h`<div class="note">${icon('calendar', 18)}<span>Adding to <b>${ev.name}</b>. They’ll show up on the event’s list.</span></div>` : ''}
      <label class="field"><span class="label">Name</span>
        <input type="text" name="name" value="${draft.name}" autocomplete="off" autocapitalize="words" required ${editing ? '' : 'autofocus'}>${err('name')}</label>
      <div class="two">
        <label class="field"><span class="label">Organization</span>
          <input type="text" name="orgName" value="${draft.orgName}" list="org-list" autocomplete="off" autocapitalize="words"></label>
        ${text('title', 'Title', 'autocapitalize="words"')}
      </div>
      <datalist id="org-list">${model.orgs().map((o) => h`<option value="${o.name}"></option>`)}</datalist>
      ${text('whatTheyDo', 'What they do')}
      ${text('howMet', 'How you met', '', ev && !editing && draft.howMet === ev.name ? 'Filled in by event mode' : '')}
      <details class="more" ${draft.more ? 'open' : ''} data-more>
        <summary>${icon('plus', 18)}<span><b>More details</b> · email, phone, introduced by, schools</span></summary>
        <div class="stack">
          ${emailFields()}
          <div class="two">
            ${text('phone', 'Phone', 'inputmode="tel" autocomplete="off"')}
            ${text('city', 'City', 'autocapitalize="words"')}
          </div>
          ${introField()}
          ${text('schools', 'Schools', '', 'Separate with semicolons')}
          <div class="two">
            ${text('birthday', 'Birthday', 'placeholder="MM-DD"', '')}
            ${text('tags', 'Tags', '', 'Semicolons')}
          </div>
          ${text('linkedIn', 'LinkedIn profile', 'inputmode="url" autocapitalize="off" spellcheck="false"')}
          ${text('oneNoteLink', 'OneNote page link', 'inputmode="url" autocapitalize="off" spellcheck="false"', 'Right-click a page > Copy link')}
          ${text('sortName', 'Sort name', 'placeholder="' + (defaultSortName(draft.name) || 'Last, First') + '"', 'Blank sorts by last name')}
        </div>
      </details>
      <div class="field"><span class="label">Check-in tier</span>${tierTiles()}</div>
      ${cadenceSelect()}
      <label class="field"><span class="label">Notes</span>
        <textarea name="personalNotes" rows="4" placeholder="Family, interests, things to ask about next time">${draft.personalNotes}</textarea></label>
      ${!editing ? h`<label class="checkrow"><input type="checkbox" name="alsoLog" ${draft.alsoLog ? 'checked' : ''}>
        <span>${ev ? 'Also log that you met at ' + ev.name : 'Log a conversation with them next'}</span></label>` : ''}
      ${editing ? h`<div class="danger-zone">
        <a class="btn secondary" href="#/merge?a=${draft.id}">${icon('merge', 18)}Merge with another contact</a>
        <button type="button" class="btn ghost danger-text" data-act="delete">${icon('trash', 18)}Delete contact</button>
      </div>` : ''}
    </div>
    ${sheetFoot(editing ? 'Save changes' : 'Save contact')}
  </form>`;
}

function validate() {
  const e = {};
  if (!draft.name.trim()) e.name = 'Add a name.';
  const bad = draft.emails.map((x) => x.trim()).filter((x) => x && !validEmail(x));
  if (bad.length) e.emails = '“' + bad[0] + '” doesn’t look like an email address.';
  const b = draft.birthday.trim();
  if (b && !/^(\d{4}-)?\d{1,2}-\d{1,2}$/.test(b)) e.birthday = 'Use MM-DD, like 03-14, or YYYY-MM-DD.';
  if (draft.cadence && !parseCadence(draft.cadence)) e.cadence = 'Pick a reminder choice.';
  draft.errors = e;
  return !Object.keys(e).length;
}

async function save() {
  if (!validate()) {
    if (draft.errors.emails || draft.errors.birthday) draft.more = true;
    ui.render();
    const first = document.querySelector('.field .error');
    if (first) first.scrollIntoView({ block: 'center' });
    return;
  }
  const editing = !!draft.id;
  const prev = editing ? model.getLive('Contacts', draft.id) : null;
  if (editing && !prev) throw new Error('This person was removed on another device.');
  const id = editing ? draft.id : newId('con');
  const emails = [];
  draft.emails.map((x) => x.trim()).filter(Boolean).forEach((x) => {
    if (!emails.some((y) => normalizeEmail(y) === normalizeEmail(x))) emails.push(x);
  });

  // Someone else already has one of these addresses?
  const clash = model.people().find((p) => p.id !== id && (p.emails || []).some((x) => emails.some((y) => normalizeEmail(x) === normalizeEmail(y))));
  if (clash) {
    const ok = await ask({
      title: clash.name + ' already has that email',
      body: 'Save anyway? Skyway will list them as a possible duplicate so you can merge them later.',
      ok: 'Save anyway', cancel: 'Go back'
    });
    if (!ok) return;
  }

  const items = [];
  let orgId = '';
  const orgName = draft.orgName.trim();
  if (orgName) {
    const found = model.findOrgByName(orgName);
    if (found) orgId = found.id;
    else {
      orgId = newId('org');
      items.push({ t: 'Organizations', r: { id: orgId, name: orgName } });
    }
  }

  const name = draft.name.trim().replace(/\s+/g, ' ');
  const rec = {
    id, name,
    sortName: draft.sortName.trim() || defaultSortName(name),
    emails, orgId,
    phone: draft.phone.trim(), linkedIn: draft.linkedIn.trim(), city: draft.city.trim(),
    title: draft.title.trim(), whatTheyDo: draft.whatTheyDo.trim(), howMet: draft.howMet.trim(),
    introducedById: draft.introducedById === id ? '' : draft.introducedById,
    schools: draft.schools.split(/[;\n]/).map((x) => x.trim()).filter(Boolean),
    tags: splitList(draft.tags), birthday: draft.birthday.trim(), oneNoteLink: draft.oneNoteLink.trim(),
    tier: draft.tier, cadence: draft.cadence, personalNotes: draft.personalNotes.trim()
  };
  if (!editing) rec.source = 'App';
  items.push({ t: 'Contacts', r: rec });

  // Moving to a new organization keeps the old one in their history.
  if (prev && prev.orgId && prev.orgId !== orgId && model.getLive('Organizations', prev.orgId)) {
    const open = model.affiliationsOf(id).find((a) => a.orgId === prev.orgId && !a.endDate);
    if (open) items.push({ t: 'Affiliations', r: { id: open.id, endDate: todayYmd(), title: open.title || prev.title || '' } });
    else items.push({ t: 'Affiliations', r: { contactId: id, orgId: prev.orgId, title: prev.title || '', endDate: todayYmd() } });
  }

  const ev = !editing && draft.eventId ? model.getLive('Events', draft.eventId) : null;
  if (ev) {
    const a = attendanceItem(ev.id, id);
    if (a) items.push(a);
    if (draft.alsoLog) {
      items.push({ t: 'Interactions', r: {
        contactId: id, occurredAt: nowIso(), type: 'Event', eventId: ev.id, source: 'App', countsAsCheckIn: true
      } });
    }
  }

  await store.saveMany(items);
  const logNext = !editing && !ev && draft.alsoLog;
  draft = null;
  toast(editing ? 'Saved' : 'Added ' + name);
  if (editing) ui.backTo('#/people/' + id);
  else ui.replace(logNext ? '#/log?who=' + id : '#/people/' + id);
}

export default {
  id: 'contact-form', chrome: 'sheet', navKey: 'people', live: false,
  title: (route) => (route.parts[1] === 'new' ? 'New contact' : 'Edit contact'),
  render(route) {
    if (!draft || draft.key !== route.hash) init(route);
    if (draft.missing) {
      return h`<div class="page">${sheetHead({ title: 'Edit contact', act: 'close', close: '#/people' })}
        ${empty('This person isn’t in Skyway anymore', 'They may have been merged into someone else or removed.')}</div>`;
    }
    return form(route);
  },
  mount(el) {
    if (focusEmail >= 0) {
      const inp = el.querySelector('input[name="email"][data-i="' + focusEmail + '"]');
      if (inp) inp.focus();
      focusEmail = -1;
    }
    const det = el.querySelector('details[data-more]');
    if (det) det.addEventListener('toggle', () => { if (draft) draft.more = det.open; });
  },
  input(el) {
    if (!draft) return;
    if (el.name === 'email') { draft.emails[Number(el.dataset.i)] = el.value; return; }
    if (el.dataset.picker !== undefined) {
      updatePicker(el, { exclude: new Set([draft.id]) });
      return;
    }
    syncDraft(draft, el);
  },
  change(el) {
    if (!draft) return;
    if (el.name === 'email' || el.dataset.picker !== undefined) return;
    syncDraft(draft, el);
  },
  keydown(el, ev) { pickerEnter(el, ev); },
  submit() { return save(); },
  act: {
    close() {
      const back = draft && draft.id ? '#/people/' + draft.id : '#/people';
      draft = null;
      ui.back(back);
    },
    tier(el) {
      draft.tier = el.dataset.tier;
      ui.render();
    },
    'add-email'() {
      draft.emails.push('');
      draft.more = true;
      focusEmail = draft.emails.length - 1;
      ui.render();
    },
    'drop-email'(el) {
      draft.emails.splice(Number(el.dataset.i), 1);
      if (!draft.emails.length) draft.emails.push('');
      ui.render();
    },
    pick(el) {
      draft.introducedById = el.dataset.id;
      ui.render();
    },
    'clear-intro'() {
      draft.introducedById = '';
      ui.render();
    },
    async delete() {
      const c = model.getLive('Contacts', draft.id);
      if (!c) return;
      const n = model.interactionsOf(c.id).length;
      const ok = await ask({
        title: 'Delete ' + c.name + '?',
        body: (n ? 'Their ' + (n === 1 ? 'logged conversation stays' : n + ' logged conversations stay') + ' in the Sheet but won’t show in the app. ' : '') +
          'The row stays in your Sheet with “deleted” ticked, so you can bring them back there.',
        ok: 'Delete', danger: true
      });
      if (!ok) return;
      await store.remove('Contacts', c.id);
      draft = null;
      toast('Deleted ' + c.name);
      ui.replace('#/people');
    }
  }
};
