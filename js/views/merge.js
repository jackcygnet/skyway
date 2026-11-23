// Skyway app · merging two records of the same person.
// The record with more history stays; the other is ticked deleted, and its
// conversations, tasks, events and organizations move over.

import * as store from '../store.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import { h, fmtDate, plural, describeCadence, defaultSortName, normalizeEmail, ymdOf } from '../util.js';
import { icon } from '../icons.js';
import * as actions from '../actions.js';
import { avatar, subHead, pickerBox, updatePicker, pickerEnter, empty } from './parts.js';

const FIELDS = [
  ['name', 'Name', 'one'], ['orgId', 'Organization', 'one'], ['title', 'Title', 'one'],
  ['emails', 'Email addresses', 'list'], ['phone', 'Phone', 'one'], ['whatTheyDo', 'What they do', 'long'],
  ['howMet', 'How you met', 'long'], ['introducedById', 'Introduced by', 'one'], ['tier', 'Tier', 'one'],
  ['cadence', 'Reminders', 'one'], ['city', 'City', 'one'], ['schools', 'Schools', 'list'], ['tags', 'Tags', 'list'],
  ['birthday', 'Birthday', 'one'], ['linkedIn', 'LinkedIn', 'one'], ['oneNoteLink', 'OneNote page', 'one'],
  ['personalNotes', 'Personal notes', 'long']
];

let m = null;

function shown(f, v) {
  if (Array.isArray(v)) return v.join('; ');
  if (f === 'orgId') return model.orgName(v);
  if (f === 'introducedById') { const c = v && model.getLive('Contacts', v); return c ? c.name : ''; }
  if (f === 'cadence') return v ? describeCadence(v) : '';
  return v || '';
}

function blank(v) { return Array.isArray(v) ? !v.filter(Boolean).length : !String(v || '').trim(); }

function same(f, a, b) {
  if (f === 'emails') {
    const x = (a || []).map(normalizeEmail).sort().join(';'), y = (b || []).map(normalizeEmail).sort().join(';');
    return x === y;
  }
  if (Array.isArray(a) || Array.isArray(b)) return (a || []).join(';').toLowerCase() === (b || []).join(';').toLowerCase();
  return String(a || '').trim() === String(b || '').trim();
}

function historyCount(id) { return model.interactionsOf(id).length; }

function init(route) {
  const a = model.getLive('Contacts', route.q.get('a'));
  const b = model.getLive('Contacts', route.q.get('b'));
  m = { key: route.hash, a, b, choice: {}, lists: {} };
  if (!a || !b || a.id === b.id) return;
  const ha = historyCount(a.id), hb = historyCount(b.id);
  m.keep = ha !== hb ? (ha > hb ? 'a' : 'b') : (String(a.createdAt || '') <= String(b.createdAt || '') ? 'a' : 'b');
  FIELDS.forEach(([f, , kind]) => {
    const va = a[f], vb = b[f];
    if (kind === 'list') {
      const vals = [];
      (m.keep === 'a' ? [va, vb] : [vb, va]).forEach((arr) => (arr || []).forEach((x) => {
        if (x && !vals.some((y) => (f === 'emails' ? normalizeEmail(y) === normalizeEmail(x) : y.toLowerCase() === String(x).toLowerCase()))) vals.push(x);
      }));
      m.lists[f] = { all: vals, on: new Set(vals) };
      return;
    }
    const keepSide = m.keep;
    const other = keepSide === 'a' ? 'b' : 'a';
    const kv = keepSide === 'a' ? va : vb;
    m.choice[f] = blank(kv) ? other : keepSide;
  });
}

function sideHead(c) {
  const n = historyCount(c.id);
  return h`<div class="side-head">${avatar(c, 'sm')}<span class="main"><b>${c.name}</b>
    <small>${c.createdAt ? 'Since ' + fmtDate(ymdOf(new Date(c.createdAt))) + ' · ' : ''}${plural(n, 'history entry', 'history entries')}</small></span></div>`;
}

function fieldRow([f, label, kind]) {
  const a = m.a[f], b = m.b[f];
  if (blank(a) && blank(b)) return '';
  if (kind === 'list') {
    const l = m.lists[f];
    return h`<div class="merge-field list">
      <span class="mf-label">${label}</span>
      <div class="mf-opts wide">${l.all.map((v) => h`<label class="opt"><input type="checkbox" data-list="${f}" value="${v}" ${l.on.has(v) ? 'checked' : ''}>
        <span>${v}</span></label>`)}
        <small class="muted">${f === 'emails' ? 'Keep every address they use, so mail to any of them is logged.' : 'Ticked ones are kept.'}</small></div>
    </div>`;
  }
  if (same(f, a, b)) {
    return h`<div class="merge-field same"><span class="mf-label">${label}</span>
      <div class="mf-opts wide"><span class="opt fixed">${icon('check', 16)}<span>${shown(f, a)}</span></span></div></div>`;
  }
  const opt = (side, v) => h`<label class="opt ${blank(v) ? 'blank' : ''}"><input type="radio" name="f-${f}" value="${side}" ${m.choice[f] === side ? 'checked' : ''}>
    <span>${blank(v) ? '(blank)' : shown(f, v)}</span></label>`;
  return h`<div class="merge-field">
    <span class="mf-label">${label}</span>
    <div class="mf-opts">${opt('a', a)}${opt('b', b)}
      ${kind === 'long' && !blank(a) && !blank(b) ? h`<label class="opt both"><input type="radio" name="f-${f}" value="both" ${m.choice[f] === 'both' ? 'checked' : ''}><span>Keep both</span></label>` : ''}
    </div>
  </div>`;
}

function result() {
  const A = m.a, B = m.b;
  const keep = m.keep === 'a' ? A : B;
  const rec = { id: keep.id };
  FIELDS.forEach(([f, , kind]) => {
    if (kind === 'list') {
      const l = m.lists[f];
      rec[f] = l.all.filter((v) => l.on.has(v));
      return;
    }
    const c = m.choice[f];
    if (c === 'both') rec[f] = [A[f], B[f]].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n');
    else rec[f] = (c === 'a' ? A : B)[f] === undefined ? '' : (c === 'a' ? A : B)[f];
  });
  const nameSrc = m.choice.name === 'a' ? A : B;
  rec.sortName = String(nameSrc.sortName || '').trim() && nameSrc.sortName !== defaultSortName(nameSrc.name) ? nameSrc.sortName : defaultSortName(rec.name);
  if (rec.introducedById === A.id || rec.introducedById === B.id) rec.introducedById = '';
  return rec;
}

function summary() {
  const rec = result();
  const gone = m.keep === 'a' ? m.b : m.a;
  const hist = historyCount(m.a.id) + historyCount(m.b.id);
  const tasks = model.tasksOf(m.a.id).concat(model.tasksOf(m.b.id)).filter(model.isOpen).length;
  const cad = model.cadenceOf(rec);
  const emails = (rec.emails || []).length;
  return h`<aside class="card merge-summary">
    <div class="card-head"><h2>After the merge</h2></div>
    <div class="row">${avatar(rec)}<span class="main"><b>${rec.name}</b><small>${[rec.title, model.orgName(rec.orgId)].filter(Boolean).join(' · ')}</small></span></div>
    <ul class="bullets">
      ${emails ? h`<li>${plural(emails, 'email address', 'email addresses')}${emails > 1 ? ', so mail to any of them is logged to them' : ''}</li>` : ''}
      <li>${rec.tier || 'No tier'}${cad && !cad.none ? ', ' + describeCadence(cad) : ', no reminders'}</li>
      <li>${plural(hist, 'history entry', 'history entries')} from both records${tasks ? ', and ' + plural(tasks, 'open task') : ''}</li>
    </ul>
    <p class="muted small">The separate ${gone.name} record goes away. Its row stays in your Sheet with “deleted” ticked.</p>
    <div class="actions-row two">
      <button class="btn" data-act="merge">Merge contacts</button>
      <button class="btn secondary" data-act="back" data-fallback="#/people/${m.a.id}">Cancel</button>
    </div>
    <button class="link small" data-act="not-same">They’re not the same person</button>
  </aside>`;
}

async function doMerge() {
  const A = m.a, B = m.b;
  const keep = m.keep === 'a' ? A : B;
  const gone = m.keep === 'a' ? B : A;
  if (!model.getLive('Contacts', keep.id) || !model.getLive('Contacts', gone.id)) throw new Error('One of these records was changed on another device. Open them again.');
  const items = [{ t: 'Contacts', r: result() }, { t: 'Contacts', r: { id: gone.id, deleted: true } }];
  const move = (t, field) => model.live(t).filter((r) => r[field] === gone.id)
    .forEach((r) => items.push({ t, r: { id: r.id, [field]: keep.id } }));
  move('Interactions', 'contactId');
  move('Tasks', 'contactId');
  move('Affiliations', 'contactId');
  move('Reminders', 'contactId');
  move('ReviewQueue', 'suggestedContactId');
  move('ReviewQueue', 'resolvedContactId');
  model.people().filter((c) => c.introducedById === gone.id && c.id !== keep.id)
    .forEach((c) => items.push({ t: 'Contacts', r: { id: c.id, introducedById: keep.id } }));
  const keptEvents = new Set(model.attendanceByContact(keep.id).map((x) => x.eventId));
  model.attendanceByContact(gone.id).forEach((x) => {
    items.push({ t: 'Attendance', r: keptEvents.has(x.eventId) ? { id: x.id, deleted: true } : { id: x.id, contactId: keep.id } });
  });
  await store.saveMany(items);
  m = null;
  toast('Merged into ' + items[0].r.name);
  ui.replace('#/people/' + keep.id);
}

/* ---------------------------------------------------------------- view */

function pickScreen(a) {
  return h`<div class="page narrow">
    ${subHead({ title: 'Merge ' + a.name + ' with…', back: '#/people/' + a.id })}
    <p class="muted">Choose the other record for the same person. You’ll pick which details to keep next.</p>
    ${pickerBox('pick-merge', 'Search contacts', { autofocus: true })}
  </div>`;
}

export default {
  id: 'merge', chrome: 'sub', navKey: 'people', live: false,
  title: () => 'Merge contacts',
  render(route) {
    const a = model.getLive('Contacts', route.q.get('a'));
    if (a && !route.q.get('b')) return pickScreen(a);
    if (!m || m.key !== route.hash) init(route);
    if (!m.a || !m.b || m.a.id === m.b.id) {
      return h`<div class="page">${subHead({ back: '#/people' })}
        ${empty('Nothing to merge', 'One of these records isn’t in Skyway anymore. It may have been merged already.')}</div>`;
    }
    return h`<div class="page wide">
      ${subHead({ title: 'Merge contacts', back: '#/people/' + m.a.id })}
      <p class="muted lede">Pick which details to keep. History, tasks and events from both records are kept either way.</p>
      <div class="grid2 merge-grid">
        <section class="card merge-table">
          <div class="merge-field headrow"><span class="mf-label">Field</span><div class="mf-opts">${sideHead(m.a)}${sideHead(m.b)}</div></div>
          ${FIELDS.map(fieldRow)}
        </section>
        ${summary()}
      </div>
    </div>`;
  },
  mount(el) {
    const p = el.querySelector('input[data-picker]');
    if (p) p.focus();
  },
  input(el, ev, route) {
    if (el.dataset.picker !== undefined) updatePicker(el, { exclude: new Set([route.q.get('a')]) });
  },
  keydown(el, ev) { pickerEnter(el, ev); },
  change(el) {
    if (!m) return;
    if (el.dataset.list) {
      const l = m.lists[el.dataset.list];
      if (el.checked) l.on.add(el.value); else l.on.delete(el.value);
    } else if (el.name && el.name.indexOf('f-') === 0) {
      m.choice[el.name.slice(2)] = el.value;
    }
    const s = document.querySelector('.merge-summary');
    if (s) s.outerHTML = String(summary());
  },
  act: {
    pick(el, ev, route) {
      ui.replace('#/merge?a=' + route.q.get('a') + '&b=' + el.dataset.id);
    },
    async merge() {
      const gone = m.keep === 'a' ? m.b : m.a;
      const ok = await ask({ title: 'Merge into one record?', body: 'The app can’t undo a merge. ' + gone.name + '’s old row stays in the Sheet, ticked deleted.', ok: 'Merge' });
      if (ok) await doMerge();
    },
    async 'not-same'() {
      const key = [m.a.id, m.b.id].sort().join('|');
      await actions.dismissDuplicate(key);
      const back = '#/people/' + m.a.id;
      m = null;
      toast('Got it. They’re different people.');
      ui.replace(back);
    }
  }
};
