// Skyway app · Organizations: firms, unions, agencies, courts, schools.

import * as store from '../store.js';
import * as model from '../model.js';
import { ui, toast, ask } from '../main.js';
import { h, fmtDate, matchesQuery, safeUrl, plural } from '../util.js';
import { icon, typeIcon } from '../icons.js';
import { personRow, topHead, subHead, sheetHead, sheetFoot, syncDraft, empty, peopleCount } from './parts.js';
import { entryTitle } from './people.js';

const KINDS = ['Law firm', 'Union', 'Government agency', 'Court', 'School', 'Company', 'Nonprofit', 'Bar association', 'Other'];

function formerPeople(orgId) {
  const current = new Set(model.contactsAtOrg(orgId).map((c) => c.id));
  const seen = new Map();
  model.affiliationsAtOrg(orgId).forEach((a) => {
    if (current.has(a.contactId)) return;
    const c = model.getLive('Contacts', a.contactId);
    if (!c) return;
    const prev = seen.get(c.id);
    if (!prev || String(a.endDate || '') > String(prev.a.endDate || '')) seen.set(c.id, { c, a });
  });
  return Array.from(seen.values());
}

function lastContactAt(orgId) {
  let best = '';
  model.contactsAtOrg(orgId).forEach((c) => {
    const i = model.lastCheckIn(c.id);
    if (i && i.occurredAt > best) best = i.occurredAt;
  });
  return best;
}

/* ---------------------------------------------------------------- list */

let q = '';

function rows() {
  const list = model.orgs().filter((o) => matchesQuery([o.name, o.kind, o.city], q));
  if (!model.orgs().length) {
    return empty('No organizations yet', 'They’re added when you type one on a contact. You can also add one here.',
      h`<a class="btn" href="#/orgs/new">${icon('plus', 18)}New organization</a>`);
  }
  if (!list.length) return empty('No matches for “' + q + '”');
  return h`<div class="card list">${list.map((o) => {
    const n = model.contactsAtOrg(o.id).length;
    return h`<a class="row link" href="#/orgs/${o.id}"><span class="avatar square">${icon('building', 18)}</span>
      <span class="main"><b>${o.name}</b><small>${[o.kind, o.city, n ? peopleCount(n) : ''].filter(Boolean).join(' · ')}</small></span>
      <span class="chev">${icon('chevronRight', 18)}</span></a>`;
  })}</div>`;
}

export const orgsView = {
  id: 'orgs', chrome: 'sub', navKey: 'orgs', live: true,
  title: () => 'Organizations',
  render() {
    return h`<div class="page">
      ${ui.desktop() ? topHead({ title: 'Organizations', actions: h`<a class="btn small" href="#/orgs/new">${icon('plus', 18)}New</a>` })
    : subHead({ title: 'Organizations', back: '#/more', actions: h`<a class="btn small" href="#/orgs/new">${icon('plus', 18)}New</a>` })}
      <label class="search-box">${icon('search', 18)}<input type="search" name="q" value="${q}" placeholder="Search organizations" aria-label="Search organizations" autocomplete="off"></label>
      <div id="org-rows">${rows()}</div>
    </div>`;
  },
  input(el) {
    if (el.name !== 'q') return;
    q = el.value.trim();
    const box = document.getElementById('org-rows');
    if (box) box.innerHTML = String(rows());
  }
};

/* ------------------------------------------------------------ org page */

export const orgView = {
  id: 'org', chrome: 'sub', navKey: 'orgs', live: true,
  title(route) { const o = model.getLive('Organizations', route.parts[1]); return o ? o.name : 'Organization'; },
  render(route) {
    const o = model.getLive('Organizations', route.parts[1]);
    if (!o) {
      return h`<div class="page">${subHead({ back: '#/orgs' })}
        ${empty('This organization isn’t in Skyway anymore', 'It may have been deleted on another device.')}</div>`;
    }
    const now = model.contactsAtOrg(o.id);
    const before = formerPeople(o.id);
    const last = lastContactAt(o.id);
    const activity = now.flatMap((c) => model.interactionsOf(c.id).slice(0, 3).map((i) => ({ i, c })))
      .sort((a, b) => String(b.i.occurredAt).localeCompare(String(a.i.occurredAt))).slice(0, 5);
    const site = safeUrl(o.website);
    return h`<div class="page">
      ${subHead({ back: '#/orgs', actions: h`<a class="link strong" href="#/orgs/${o.id}/edit">Edit</a>` })}
      <div class="event-head">
        <span class="avatar square lg">${icon('building', 26)}</span>
        <h1>${o.name}</h1>
        ${o.kind || o.city ? h`<p class="line">${[o.kind, o.city].filter(Boolean).join(' · ')}</p>` : ''}
        <p class="muted">${peopleCount(now.length)}${last ? ' · last contact ' + fmtDate(last) : ''}</p>
        ${site ? h`<p><a href="${site}" target="_blank" rel="noopener">${o.website}${icon('external', 14)}</a></p>` : ''}
      </div>
      <section class="block"><h2 class="group-label">People there now</h2>
        ${now.length ? h`<div class="card list">${now.map((c) => personRow(c, { line: c.title || '' }))}</div>`
    : h`<div class="card quietcard"><span>No one yet. Set this as someone’s organization on their page.</span></div>`}
      </section>
      ${before.length ? h`<section class="block"><h2 class="group-label">People who used to work here</h2>
        <div class="card list">${before.map(({ c, a }) => {
    const span = [a.title, [String(a.startDate || '').slice(0, 4), String(a.endDate || '').slice(0, 4)].filter(Boolean).join(' to ')].filter(Boolean).join(', ');
    const nowAt = model.orgName(c.orgId);
    return personRow(c, { line: [span, nowAt ? 'now at ' + nowAt : ''].filter(Boolean).join(' · '), trailing: '' });
  })}</div></section>` : ''}
      ${activity.length ? h`<section class="block"><h2 class="group-label">Recent activity</h2>
        <div class="card list">${activity.map(({ i, c }) => h`<a class="row link" href="#/people/${c.id}">
          <span class="avatar square sm">${icon(typeIcon(i.type), 16)}</span>
          <span class="main"><b>${entryTitle(i, c).replace(/ with ([^ ]+)$/, ' with ' + c.name)}</b><small>${fmtDate(i.occurredAt)}${i.notes ? ' · ' + i.notes.slice(0, 80) : ''}</small></span></a>`)}</div>
      </section>` : ''}
      ${o.notes ? h`<section class="card"><div class="card-head"><h2>Notes</h2></div><p class="card-body text">${o.notes}</p></section>` : ''}
    </div>`;
  }
};

/* ---------------------------------------------------------------- form */

let draft = null;

function init(route) {
  const isNew = route.parts[1] === 'new';
  const o = isNew ? null : model.getLive('Organizations', route.parts[1]);
  draft = {
    key: route.hash, id: o ? o.id : '', missing: !isNew && !o,
    name: o ? o.name || '' : '', kind: o ? o.kind || '' : '', city: o ? o.city || '' : '',
    website: o ? o.website || '' : '', notes: o ? o.notes || '' : '', error: ''
  };
}

export const orgForm = {
  id: 'org-form', chrome: 'sheet', navKey: 'orgs', live: false,
  title: (route) => (route.parts[1] === 'new' ? 'New organization' : 'Edit organization'),
  render(route) {
    if (!draft || draft.key !== route.hash) init(route);
    if (draft.missing) {
      return h`<div class="page">${sheetHead({ title: 'Edit organization', act: 'close' })}
        ${empty('This organization isn’t in Skyway anymore')}</div>`;
    }
    const editing = !!draft.id;
    return h`<form class="sheet" data-form="org" novalidate>
      ${sheetHead({ title: editing ? 'Edit organization' : 'New organization', act: 'close' })}
      <div class="sheet-body stack">
        <label class="field"><span class="label">Name</span>
          <input type="text" name="name" value="${draft.name}" ${editing ? '' : 'autofocus'} autocapitalize="words">
          ${draft.error ? h`<p class="error">${draft.error}</p>` : ''}</label>
        <div class="two">
          <label class="field"><span class="label">Kind</span>
            <select name="kind"><option value="" ${!draft.kind ? 'selected' : ''}>Choose…</option>
              ${KINDS.map((k) => h`<option value="${k}" ${draft.kind === k ? 'selected' : ''}>${k}</option>`)}</select></label>
          <label class="field"><span class="label">City</span><input type="text" name="city" value="${draft.city}" autocapitalize="words"></label>
        </div>
        <label class="field"><span class="label">Website</span>
          <input type="url" name="website" value="${draft.website}" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://"></label>
        <label class="field"><span class="label">Notes</span><textarea name="notes" rows="4">${draft.notes}</textarea></label>
        ${editing ? h`<div class="danger-zone"><button type="button" class="btn ghost danger-text" data-act="delete">${icon('trash', 18)}Delete organization</button></div>` : ''}
      </div>
      ${sheetFoot(editing ? 'Save changes' : 'Save organization')}
    </form>`;
  },
  input(el) { if (draft) syncDraft(draft, el); },
  change(el) { if (draft) syncDraft(draft, el); },
  async submit() {
    const name = draft.name.trim();
    if (!name) { draft.error = 'Add a name.'; ui.render(); return; }
    const same = model.findOrgByName(name);
    if (same && same.id !== draft.id) { draft.error = 'There’s already an organization called ' + same.name + '.'; ui.render(); return; }
    const rec = { name, kind: draft.kind, city: draft.city.trim(), website: draft.website.trim(), notes: draft.notes.trim() };
    if (draft.id) rec.id = draft.id;
    const saved = await store.save('Organizations', rec);
    const editing = !!draft.id;
    draft = null;
    toast(editing ? 'Saved' : 'Added ' + name);
    if (editing) ui.backTo('#/orgs/' + saved.id);
    else ui.replace('#/orgs/' + saved.id);
  },
  act: {
    close() {
      const back = draft && draft.id ? '#/orgs/' + draft.id : '#/orgs';
      draft = null;
      ui.back(back);
    },
    async delete() {
      const o = model.getLive('Organizations', draft.id);
      if (!o) return;
      const people = model.contactsAtOrg(o.id);
      const ok = await ask({
        title: 'Delete ' + o.name + '?',
        body: (people.length ? plural(people.length, 'person lists', 'people list') + ' it as their organization. They’ll keep their other details. ' : '') +
          'The row stays in your Sheet with “deleted” ticked.',
        ok: 'Delete', danger: true
      });
      if (!ok) return;
      await store.saveMany([{ t: 'Organizations', r: { id: o.id, deleted: true } }]
        .concat(people.map((c) => ({ t: 'Contacts', r: { id: c.id, orgId: '' } }))));
      draft = null;
      toast('Deleted ' + o.name);
      ui.replace('#/orgs');
    }
  }
};
