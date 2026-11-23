// Skyway app · small building blocks the screens share: avatars, chips,
// headers, the person picker, the PIN keypad, and form helpers.

import { h, initials, matchesQuery, fmtDate, plural } from '../util.js';
import { icon } from '../icons.js';
import * as model from '../model.js';

/* ------------------------------------------------------------- display */

export function avatar(c, size) {
  return h`<span class="avatar ${size || ''}" aria-hidden="true">${initials(c && c.name)}</span>`;
}

export function chip(text, tone) {
  return text ? h`<span class="chip ${tone || ''}">${text}</span>` : '';
}

export function statusChip(c) {
  const s = model.statusOf(c);
  if (!s.text) return '';
  return s.tone === 'quiet' ? h`<span class="status-text">${s.text}</span>` : chip(s.text, s.tone);
}

/** "MON 23" date badge. */
export function dateBadge(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return h`<span class="datebadge" aria-hidden="true"><small>—</small><b>?</b></span>`;
  const wk = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
  const mo = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  const near = Math.abs(d.getTime() - Date.now()) < 6 * 86400000;
  return h`<span class="datebadge" aria-hidden="true"><small>${near ? wk : mo}</small><b>${d.getDate()}</b></span>`;
}

/** A person as a tappable row: avatar, name, title and organization, status. */
export function personRow(c, opts) {
  const o = opts || {};
  const href = o.href || '#/people/' + c.id;
  const line = o.line !== undefined ? o.line : model.contactLine(c);
  return h`<a class="row link ${o.selected ? 'on' : ''}" href="${href}">
    ${avatar(c)}
    <span class="main"><b>${c.name || 'No name'}</b>${line ? h`<small>${line}</small>` : ''}</span>
    ${o.trailing !== undefined ? o.trailing : statusChip(c)}
    ${o.chevron === false ? '' : h`<span class="chev">${icon('chevronRight', 18)}</span>`}
  </a>`;
}

export function empty(title, body, action) {
  return h`<div class="empty">
    <b>${title}</b>${body ? h`<p>${body}</p>` : ''}${action || ''}
  </div>`;
}

/* -------------------------------------------------------------- headers */

/**
 * The top of a screen.
 *   top:   { title, eyebrow, actions }             big title, no back button
 *   sub:   { title, back, actions, bare }          back arrow, smaller title
 *   sheet: { title, close }                        X button, for forms
 */
export function topHead(o) {
  return h`<header class="page-head top">
    <div class="titles">${o.eyebrow ? h`<p class="eyebrow">${o.eyebrow}</p>` : ''}<h1>${o.title}</h1></div>
    ${o.actions ? h`<div class="actions">${o.actions}</div>` : ''}
  </header>`;
}

export function subHead(o) {
  return h`<header class="page-head sub">
    <button class="iconbtn" data-act="back" data-fallback="${o.back || '#/today'}" aria-label="Back">${icon('arrowLeft', 22)}</button>
    ${o.title ? h`<h1>${o.title}</h1>` : h`<span class="grow"></span>`}
    ${o.actions ? h`<div class="actions">${o.actions}</div>` : ''}
  </header>`;
}

export function sheetHead(o) {
  return h`<header class="sheet-head">
    <button class="iconbtn" data-act="${o.act || 'back'}" data-fallback="${o.close || '#/today'}" aria-label="Close">${icon('x', 22)}</button>
    <h1>${o.title}</h1>
    ${o.actions ? h`<div class="actions">${o.actions}</div>` : ''}
  </header>`;
}

export function sheetFoot(label, opts) {
  const o = opts || {};
  return h`<footer class="sheet-foot">
    <button class="btn block big" type="submit" ${o.disabled ? 'disabled' : ''}>${label}</button>
    <p class="savenote">${icon('cloud', 14)}Saves on this device first, then syncs</p>
  </footer>`;
}

/* ---------------------------------------------------------- form pieces */

/** Pill buttons where one is chosen. options: [[value, label]] */
export function choiceChips(name, options, value, style) {
  return h`<div class="chips" role="group">
    ${options.map(([v, label]) => h`<button type="button" class="chipbtn ${style || 'solid'}" data-act="choose"
      data-name="${name}" data-value="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`)}
  </div>`;
}

/** Two or three side-by-side choices. */
export function segmented(name, options, value) {
  return h`<div class="seg" role="group">
    ${options.map(([v, label]) => h`<button type="button" data-act="choose" data-name="${name}" data-value="${v}"
      aria-pressed="${String(v) === String(value)}">${label}</button>`)}
  </div>`;
}

export function toggleRow(name, on, label, detail) {
  return h`<div class="toggle-row">
    <span class="main"><b>${label}</b>${detail ? h`<small>${detail}</small>` : ''}</span>
    <button type="button" class="switch" role="switch" aria-checked="${!!on}" aria-label="${label}"
      data-act="toggle" data-name="${name}"><span></span></button>
  </div>`;
}

/** Copies a changed input into a draft object. Returns true if it was a draft field. */
export function syncDraft(draft, el) {
  if (!el || !el.name || el.dataset.picker !== undefined || el.dataset.skip !== undefined) return false;
  draft[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  return true;
}

/* ------------------------------------------------------- person picker */

export function pickerBox(name, placeholder, opts) {
  const o = opts || {};
  return h`<div class="picker ${o.dashed ? 'dashed' : ''}">
    <label class="search-box">${icon('search', 18)}<input type="search" name="${name}" data-picker="${name}"
      placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off" autocapitalize="words" spellcheck="false"
      enterkeyhint="done" ${o.autofocus ? 'autofocus' : ''}></label>
    <div class="picker-results" data-results="${name}" hidden></div>
  </div>`;
}

export function pickerMatches(q, exclude, limit) {
  const query = String(q || '').trim();
  if (!query) return [];
  return model.people().filter((c) => !(exclude && exclude.has(c.id)) &&
    matchesQuery([c.name, c.sortName, model.orgName(c.orgId), (c.emails || []).join(' ')], query))
    .slice(0, limit || 6);
}

/** Fills in the results under a picker as you type. opts: { exclude: Set, allowNew } */
export function updatePicker(input, opts) {
  const o = opts || {};
  const box = input.closest('.picker').querySelector('.picker-results');
  const q = input.value.trim();
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const list = pickerMatches(q, o.exclude);
  box.innerHTML = String(h`
    ${list.map((c) => h`<button type="button" class="pick" data-act="pick" data-picker="${input.name}" data-id="${c.id}">
      ${avatar(c, 'sm')}<span class="main"><b>${c.name}</b>${model.contactLine(c) ? h`<small>${model.contactLine(c)}</small>` : ''}</span></button>`)}
    ${o.allowNew ? h`<button type="button" class="pick new" data-act="pick-new" data-picker="${input.name}" data-name="${q}">
      <span class="avatar sm add">${icon('userPlus', 16)}</span><span class="main"><b>Add “${q}”</b><small>New contact</small></span></button>` : ''}
    ${!list.length && !o.allowNew ? h`<p class="pick-none">No one in Skyway matches “${q}”.</p>` : ''}`);
  box.hidden = false;
}

/** Enter in a picker picks the first result instead of submitting the form. */
export function pickerEnter(el, ev) {
  if (ev.key !== 'Enter' || el.dataset.picker === undefined) return false;
  ev.preventDefault();
  const first = el.closest('.picker').querySelector('.pick');
  if (first) first.click();
  return true;
}

/* ------------------------------------------------------------- keypad */
// Used by the PIN screens. Digits by tap or keyboard; four digits finish.

export function keypad(filled, message, tone) {
  const dots = [0, 1, 2, 3].map((i) => h`<span class="dot ${i < filled ? 'on' : ''}"></span>`);
  const key = (k) => h`<button type="button" class="key" data-act="key" data-k="${k}" aria-label="${k}">${k}</button>`;
  return h`<div class="dots ${tone || ''}" aria-label="${filled} of 4 digits">${dots}</div>
    <p class="pin-msg ${tone || ''}" role="status">${message || ''}</p>
    <div class="keypad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key)}
      <span></span>${key('0')}
      <button type="button" class="key quiet" data-act="key" data-k="back" aria-label="Delete">${icon('backspace', 24)}</button>
    </div>`;
}

export function pinMachine(onComplete) {
  let digits = '';
  let busy = false;
  const api = {
    get value() { return digits; },
    reset() { digits = ''; },
    async press(k) {
      if (busy) return;
      if (k === 'back') digits = digits.slice(0, -1);
      else if (/^\d$/.test(k) && digits.length < 4) digits += k;
      api.paint();
      if (digits.length === 4) {
        busy = true;
        try { await onComplete(digits); } finally { busy = false; }
      }
    },
    paint(message, tone) {
      document.querySelectorAll('.dots .dot').forEach((d, i) => d.classList.toggle('on', i < digits.length));
      if (message !== undefined) {
        const m = document.querySelector('.pin-msg');
        if (m) { m.textContent = message; m.className = 'pin-msg ' + (tone || ''); }
        const ds = document.querySelector('.dots');
        if (ds) ds.className = 'dots ' + (tone || '');
      }
    }
  };
  return api;
}

let keyHandler = null;
/** Lets a physical keyboard type into whichever keypad is on screen. */
export function listenKeys(machine) {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = (e) => {
    if (!document.querySelector('.keypad')) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
      return;
    }
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); machine.press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); machine.press('back'); }
  };
  document.addEventListener('keydown', keyHandler);
}

/* ------------------------------------------------------------- records */

/** A short human label for any record, used in sync messages. */
export function recordLabel(t, r) {
  if (!r) return '';
  const who = (id) => { const c = id && model.getLive('Contacts', id); return c ? c.name : 'someone'; };
  switch (t) {
    case 'Contacts': return r.name || 'A contact';
    case 'Organizations': return r.name || 'An organization';
    case 'Events': return r.name || 'An event';
    case 'Tasks': return 'Task: ' + (r.title || 'untitled');
    case 'Interactions': return (r.type || 'Conversation') + ' with ' + who(r.contactId) + (r.occurredAt ? ', ' + fmtDate(r.occurredAt) : '');
    case 'Attendance': { const e = model.getLive('Events', r.eventId); return who(r.contactId) + ' at ' + (e ? e.name : 'an event'); }
    case 'Affiliations': return who(r.contactId) + ' at ' + (model.orgName(r.orgId) || 'an organization');
    case 'Settings': return 'Setting: ' + r.id;
    default: return t + ' ' + r.id;
  }
}

export function peopleCount(n) { return plural(n, 'person', 'people'); }
