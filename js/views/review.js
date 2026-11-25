// Skyway app · the review queue: new email addresses to add, link or ignore,
// emails that might need a reply, and possible duplicates. Also the screens
// for linking an address to someone you know, and the email filters.

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as model from '../model.js';
import * as actions from '../actions.js';
import { ui, toast } from '../main.js';
import { h, fmtDate, fmtAgo, plural, firstName, matchesQuery, safeUrl, validEmail, emailDomain, SHARED_MAIL_DOMAINS } from '../util.js';
import { icon } from '../icons.js';
import { avatar, topHead, subHead, empty, chip } from './parts.js';

/* --------------------------------------------------------- Gmail status */
// What the brain says about Gmail: whether it's reading, its last check,
// and the bulk mail it skipped this week. Asked for when these screens or
// Settings open; it isn't part of the Sheet, so it doesn't sync.

export const gmail = { status: null, error: '', loading: false, at: 0, checking: false, screen: '' };

/** Asks again on opening a screen, and at most once a minute while it stays open. */
export function loadGmailStatus(force) {
  if (gmail.loading || !sync.brainAtLeast('1.3.0')) return;
  const screen = location.hash.split('?')[0];
  if (!force && screen === gmail.screen && Date.now() - gmail.at < 60000) return;
  gmail.screen = screen;
  gmail.loading = true;
  gmail.error = '';
  sync.gmailStatus().then((r) => {
    gmail.status = r;
  }).catch((err) => {
    gmail.error = err.code === 'offline' ? 'Connect to the internet to see what Gmail reading is doing.' : err.message;
  }).finally(() => {
    gmail.at = Date.now();
    gmail.loading = false;
    if (/^#\/(review|filters|settings|today|more)\b/.test(location.hash) || !location.hash || location.hash === '#/') ui.render();
  });
}

/** Runs a Gmail check now, then syncs so what it logged shows up here. */
export async function checkGmailNow() {
  if (gmail.checking) return null;
  gmail.checking = true;
  ui.render();
  try {
    if (store.pendingCount()) await sync.syncNow();
    const r = await sync.gmailCheck();
    gmail.status = r;
    gmail.at = Date.now();
    await sync.syncNow();
    return r.check || null;
  } finally {
    gmail.checking = false;
    ui.render();
  }
}

/** "2 emails logged, 1 new sender for review" from a check's result. */
export function checkWords(c) {
  if (!c) return '';
  if (!c.ran) return c.message || 'Gmail reading is off.';
  const parts = [];
  if (c.logged) parts.push(plural(c.logged, 'email') + ' logged');
  if (c.queued) parts.push(plural(c.queued, 'new sender') + ' for review');
  if (c.skipped) parts.push(plural(c.skipped, 'bulk email') + ' skipped');
  return parts.length ? 'Gmail checked: ' + parts.join(', ') + '.' : 'Gmail checked. Nothing new.';
}

/* ---------------------------------------------------------------- parts */

function senderName(r) {
  return String(r.displayName || '').trim() || String(r.email || '').split('@')[0];
}

function senderMeta(r) {
  const n = Number(r.messageCount) || 1;
  return [plural(n, 'email'), (n > 1 ? 'last ' : '') + fmtDate(r.lastSeenAt || r.createdAt), r.source || 'Gmail']
    .filter(Boolean).join(' · ');
}

function suggestionFor(r) {
  const c = r.suggestedContactId ? model.getLive('Contacts', r.suggestedContactId) : null;
  return c || null;
}

function sameWords(a, b) {
  const w = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return { a: w(a), b: w(b) };
}

/** Why Skyway thinks a new address is this person, in a few words. */
function matchReason(r, c) {
  const { a, b } = sameWords(r.displayName, c.name);
  let why = '';
  if (a.length && a.join(' ') === b.join(' ')) why = 'Same name.';
  else if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1].charAt(0) === b[b.length - 1].charAt(0)) why = 'Same first name and last initial.';
  else why = 'The address looks like their name.';
  const have = (c.emails || []).filter(Boolean);
  if (have.length) why += ' Already has ' + have[0] + (have.length > 1 ? ' and ' + plural(have.length - 1, 'other') : '') + '.';
  return why;
}

const ignoring = { id: '' };

function ignoreChoices(r) {
  const domain = emailDomain(r.email);
  const shared = SHARED_MAIL_DOMAINS.includes(domain);
  return h`<div class="ignore-choices" role="group" aria-label="Ignore ${senderName(r)}">
    <p class="small">Ignore future email from:</p>
    <div class="row-actions wrap">
      <button class="btn small secondary" data-act="ignore" data-id="${r.id}" data-scope="sender">Just ${r.email}</button>
      ${shared ? '' : h`<button class="btn small secondary" data-act="ignore" data-id="${r.id}" data-scope="domain">Everyone at @${domain}</button>`}
      <button class="btn small ghost" data-act="ignore-cancel">Cancel</button>
    </div>
  </div>`;
}

function senderCard(r) {
  const s = suggestionFor(r);
  const name = senderName(r);
  const add = '#/people/new?rq=' + encodeURIComponent(r.id) + '&name=' + encodeURIComponent(r.displayName || '') + '&email=' + encodeURIComponent(r.email);
  return h`<article class="card qcard" data-id="${r.id}">
    <div class="qhead">${avatar({ name })}
      <div class="main"><b>${name}</b><small>${r.email}</small></div></div>
    ${r.lastSubject ? h`<p class="qsubject">${r.lastSubject}</p>` : ''}
    <p class="muted small">${senderMeta(r)}</p>
    ${s ? h`<div class="qmatch">${icon('link', 16)}<span>Looks like <a href="#/people/${s.id}">${s.name}</a>${model.orgName(s.orgId) ? ', ' + model.orgName(s.orgId) : ''}</span></div>` : ''}
    <div class="row-actions wrap">
      ${s ? h`<button class="btn small" data-act="link" data-id="${r.id}" data-contact="${s.id}">Link to ${s.name}</button>
        <a class="btn small secondary" href="${add}">Add as new</a>`
    : h`<a class="btn small" href="${add}">${icon('userPlus', 16)}Add as contact</a>
        <a class="btn small secondary" href="#/review/link/${r.id}">Link to a contact</a>`}
      <button class="btn small ghost" data-act="ignore-open" data-id="${r.id}" aria-expanded="${ignoring.id === r.id}">${ui.desktop() ? 'Ignore…' : 'Ignore'}</button>
    </div>
    ${ignoring.id === r.id ? ignoreChoices(r) : ''}
  </article>`;
}

function unsureCard(i) {
  const c = model.getLive('Contacts', i.contactId);
  const link = safeUrl(i.link);
  return h`<article class="card qcard">
    <div class="qhead">${avatar(c)}
      <a class="main" href="#/people/${c.id}"><b>${c.name}</b><small>${[fmtDate(i.occurredAt), i.source, i.subject].filter(Boolean).join(' · ')}</small></a></div>
    ${i.summary ? h`<blockquote class="qquote">${i.summary}</blockquote>` : ''}
    <p class="muted small">Couldn’t tell whether this needs an answer. Until you decide, it doesn’t restart ${firstName(c.name) || 'their'}’s clock.</p>
    <div class="row-actions wrap">
      <button class="btn small secondary" data-act="reply-status" data-id="${i.id}" data-status="Reply owed">Reply needed</button>
      <button class="btn small secondary" data-act="reply-status" data-id="${i.id}" data-status="No reply needed">No reply needed</button>
      ${link ? h`<a class="link small" href="${link}" target="_blank" rel="noopener">Open email${icon('external', 14)}</a>` : ''}
    </div>
  </article>`;
}

function dupeCard(p) {
  const line = (c) => [c.emails && c.emails[0], model.contactLine(c)].filter(Boolean).join(' · ');
  return h`<article class="card qcard">
    <div class="dupe-pair">
      <a class="qhead" href="#/people/${p.a.id}">${avatar(p.a)}<span class="main"><b>${p.a.name}</b><small>${line(p.a)}</small></span></a>
      <a class="qhead" href="#/people/${p.b.id}">${avatar(p.b)}<span class="main"><b>${p.b.name}</b><small>${line(p.b)}</small></span></a>
    </div>
    <p class="muted small">${p.reason}.</p>
    <div class="row-actions wrap">
      <a class="btn small" href="#/merge?a=${p.a.id}&b=${p.b.id}">Review merge</a>
      <button class="btn small ghost" data-act="not-dupe" data-key="${p.key}">Not the same person</button>
    </div>
  </article>`;
}

function skippedStrip() {
  const st = gmail.status;
  if (!st || !st.skippedThisWeek) return '';
  return h`<a class="strip" href="#/filters">${icon('inbox', 18)}<span><b>${plural(st.skippedThisWeek, 'bulk email')} skipped</b> this week</span>
    <span class="link">See them</span></a>`;
}

/** A line about Gmail reading when it isn't working, so an empty queue isn't misleading. */
function gmailNote() {
  if (!sync.brainAtLeast('1.3.0')) {
    return h`<div class="note">${icon('mail', 18)}<span>New senders show up here once Skyway reads Gmail. That needs brain version 1.3.0: follow step 4 of the setup guide.</span></div>`;
  }
  if (!model.settingBool('gmailOn')) {
    return h`<div class="note">${icon('mail', 18)}<span>Gmail reading is off, so no new senders arrive. Turn it on in <a href="#/settings">Settings</a>, under Email.</span></div>`;
  }
  const st = gmail.status;
  if (st && st.problem) return h`<div class="note warn">${icon('alert', 18)}<span>${st.problem.message}</span></div>`;
  return '';
}

function section(title, n, body) {
  if (!n) return '';
  return h`<section class="block qsection"><div class="block-head"><h2>${title}</h2><span class="count">${n}</span></div>
    <div class="stack tight">${body}</div></section>`;
}

/* --------------------------------------------------------------- screen */

export const reviewView = {
  id: 'review', chrome: 'tabs', navKey: 'review', live: true,
  title: () => 'Review queue',
  render() {
    const desktop = ui.desktop();
    const senders = model.reviewSenders();
    const unsure = model.unsureEmails();
    const dupes = model.duplicatePairs();
    const none = !senders.length && !unsure.length && !dupes.length;
    const canCheck = sync.brainAtLeast('1.3.0') && model.settingBool('gmailOn');
    // On a phone the button is just an icon, so the title has room.
    const actionsEl = !canCheck ? '' : desktop ?
      h`<button class="btn small secondary" data-act="check-gmail" ${gmail.checking ? 'disabled' : ''}>${icon('refresh', 16)}${gmail.checking ? 'Checking…' : 'Check Gmail now'}</button>` :
      h`<button class="iconbtn ${gmail.checking ? 'spin' : ''}" data-act="check-gmail" aria-label="Check Gmail now" title="Check Gmail now" ${gmail.checking ? 'disabled' : ''}>${icon('refresh', 22)}</button>`;
    return h`<div class="page">
      ${desktop ? topHead({ title: 'Review queue', actions: actionsEl }) : subHead({ title: 'Review queue', back: '#/more', actions: actionsEl })}
      <p class="lede muted">People who emailed you but aren’t contacts yet, emails that might need a reply, and possible duplicates.</p>
      ${skippedStrip()}
      ${gmailNote()}
      ${none ? h`<div class="card">${empty('All caught up', 'New email addresses show up here as Skyway reads your Gmail. Nothing is added to your contacts until you say so.')}</div>` : ''}
      ${section('New senders', senders.length, senders.map(senderCard))}
      ${section('Reply needed?', unsure.length, unsure.slice(0, 30).map(unsureCard))}
      ${section('Possible duplicates', dupes.length, dupes.map(dupeCard))}
    </div>`;
  },
  mount() { loadGmailStatus(false); },
  act: {
    'ignore-open'(el) {
      ignoring.id = ignoring.id === el.dataset.id ? '' : el.dataset.id;
      ui.render();
    },
    'ignore-cancel'() {
      ignoring.id = '';
      ui.render();
    },
    async ignore(el) {
      const undo = await actions.ignoreSender(el.dataset.id, el.dataset.scope);
      ignoring.id = '';
      if (!undo) return;
      const what = el.dataset.scope === 'domain' ? 'everyone at @' + undo.value : undo.value;
      toast('Ignored ' + what + '. Their email won’t come back here.', { action: { label: 'Undo', fn: () => actions.undoIgnore(undo) } });
    },
    async link(el) {
      const c = await actions.linkSender(el.dataset.id, el.dataset.contact);
      if (c) toast('Linked to ' + c.name + '. Their email from this address is logged within 15 minutes.', { ms: 5000 });
    },
    async 'reply-status'(el) {
      const undo = await actions.setReplyStatus(el.dataset.id, el.dataset.status);
      if (!undo) return;
      // Today flags an email reply owed only once it's replyOwedDays old, so say when.
      const owed = el.dataset.status === 'Reply owed';
      const i = model.getLive('Interactions', el.dataset.id);
      const now = owed && i && model.replyOwedShows(Object.assign({}, i, { replyStatus: 'Reply owed' }));
      toast(owed ? (now ? 'Marked reply owed. It shows on Today.' :
        'Marked reply owed. It shows on Today once it’s ' + plural(model.settingNum('replyOwedDays'), 'day') + ' old.') :
        'Marked no reply needed. It counts as a check-in.',
        { action: { label: 'Undo', fn: () => actions.undoReplyStatus(undo) } });
    },
    async 'not-dupe'(el) {
      await actions.dismissDuplicate(el.dataset.key);
      toast('Got it. They’re different people.');
    },
    async 'check-gmail'() {
      try {
        const c = await checkGmailNow();
        if (c) toast(checkWords(c), { ms: 5000 });
      } catch (err) {
        toast(err.message, { warn: true, ms: 7000 });
      }
    }
  }
};

/* ------------------------------------------------------------ link screen */

const linkState = { q: '', id: '' };

function linkRows(r) {
  const s = suggestionFor(r);
  const list = model.people().filter((c) => (!s || c.id !== s.id) && matchesQuery(model.contactSearchText(c), linkState.q));
  if (!list.length) return h`<p class="card-body muted">${linkState.q ? 'No one matches “' + linkState.q + '”.' : 'No contacts yet.'}</p>`;
  return h`${list.slice(0, 40).map((c) => h`<button class="row link" data-act="link-to" data-contact="${c.id}">
    ${avatar(c)}<span class="main"><b>${c.name}</b><small>${model.contactLine(c) || (c.emails || [])[0] || ''}</small></span>
    <span class="chev">${icon('chevronRight', 18)}</span></button>`)}
    ${list.length > 40 ? h`<p class="card-body muted small">Type a name to narrow the list.</p>` : ''}`;
}

export const linkView = {
  id: 'review-link', chrome: 'sub', navKey: 'review', live: true,
  title: () => 'Link to a contact',
  render(route) {
    const id = route.parts[2];
    if (linkState.id !== id) { linkState.id = id; linkState.q = ''; }
    const r = model.getLive('ReviewQueue', id);
    if (!r || (r.status || 'Pending') !== 'Pending') {
      return h`<div class="page narrow">${subHead({ title: 'Link to a contact', back: '#/review' })}
        ${empty('Already handled', 'This address isn’t waiting in the review queue anymore.', h`<a class="btn secondary" href="#/review">Back to the review queue</a>`)}</div>`;
    }
    const s = suggestionFor(r);
    return h`<div class="page narrow">
      ${subHead({ title: 'Link to a contact', back: '#/review' })}
      <section class="card">
        <p class="eyebrow">New address</p>
        <p class="qaddr">${r.email}</p>
        <p class="muted small">${r.displayName ? 'Signed “' + r.displayName + '” · ' : ''}${senderMeta(r)}</p>
      </section>
      ${s ? h`<section class="block"><h2 class="group-label">Best match</h2>
        <div class="card stack tight">
          <div class="qhead">${avatar(s)}<span class="main"><b>${s.name}</b><small>${model.contactLine(s)}</small></span></div>
          <p class="muted small">${matchReason(r, s)}</p>
          <button class="btn block" data-act="link-to" data-contact="${s.id}">Link to ${s.name}</button>
        </div></section>` : ''}
      <section class="block"><h2 class="group-label">${s ? 'Or choose someone else' : 'Choose who this is'}</h2>
        <label class="search-box">${icon('search', 18)}<input type="search" name="q" value="${linkState.q}" placeholder="Search your contacts" aria-label="Search your contacts" data-skip></label>
        <div class="card list" id="link-rows">${linkRows(r)}</div>
      </section>
      <p class="muted small">Future emails from this address will be logged to the contact you choose, and both addresses stay on their record.</p>
    </div>`;
  },
  input(el) {
    if (el.name !== 'q') return;
    linkState.q = el.value.trim();
    const r = model.getLive('ReviewQueue', linkState.id);
    const box = document.getElementById('link-rows');
    if (box && r) box.innerHTML = String(linkRows(r));
  },
  act: {
    async 'link-to'(el) {
      const c = await actions.linkSender(linkState.id, el.dataset.contact);
      if (!c) return;
      toast('Linked to ' + c.name + '. Their email from this address is logged within 15 minutes.', { ms: 5000 });
      ui.backTo('#/review');
    }
  }
};

/* ----------------------------------------------------------- email filters */

const filterUi = { showAll: false, error: '' };

function sinceText(f) { return f.createdAt ? 'since ' + fmtDate(f.createdAt) : ''; }

function skippedList() {
  const st = gmail.status;
  if (!sync.brainAtLeast('1.3.0')) return h`<p class="card-body muted">Skipped mail shows here once the brain reads Gmail (brain 1.3.0, setup guide step 4).</p>`;
  if (!st) return h`<p class="card-body muted">${gmail.error || 'Asking the brain…'}</p>`;
  if (!st.skipped.length) return h`<p class="card-body muted">Nothing skipped in the last week.</p>`;
  const list = filterUi.showAll ? st.skipped : st.skipped.slice(0, 5);
  return h`${list.map((x) => {
    const allowed = model.filterFor(x.email) === 'allow';
    return h`<div class="row">
      <span class="main"><b>${x.subject || '(no subject)'}</b><small>${[x.name, x.email, x.count > 1 ? plural(x.count, 'email') : ''].filter(Boolean).join(' · ')}</small></span>
      ${allowed ? chip('Allowed', 'soon') : h`<button class="btn small secondary" data-act="allow" data-email="${x.email}" data-name="${x.name}">Always allow</button>`}
    </div>`;
  })}
  ${st.skipped.length > 5 && !filterUi.showAll ? h`<button class="row link more-link" data-act="show-all"><span class="main"><b class="link">Show all ${st.skipped.length}</b></span></button>` : ''}`;
}

function ruleRows(kind) {
  const list = model.filtersOf(kind);
  if (!list.length) return '';
  const label = kind === 'Ignore sender' ? 'Ignored senders' : (kind === 'Ignore domain' ? 'Ignored domains' : 'Always allowed');
  return h`<section class="block"><h2 class="group-label">${label} · ${list.length}</h2>
    <div class="card list wrap">${list.map((f) => {
    const v = String(f.value).replace(/^@/, '');
    const title = kind === 'Ignore domain' ? '@' + v : (f.note || v);
    const detail = kind === 'Ignore domain' ? ['Every sender at this domain', sinceText(f)].filter(Boolean).join(' · ') :
      [f.note ? v : '', sinceText(f)].filter(Boolean).join(' · ');
    return h`<div class="row"><span class="main"><b>${title}</b>${detail ? h`<small>${detail}</small>` : ''}</span>
      <button class="btn small ghost" data-act="remove-filter" data-id="${f.id}">${kind === 'Always allow' ? 'Remove' : 'Undo'}</button></div>`;
  })}</div></section>`;
}

export const filtersView = {
  id: 'filters', chrome: 'sub', navKey: 'settings', live: true,
  title: () => 'Email filters',
  render() {
    const st = gmail.status;
    const count = st ? st.skippedThisWeek : 0;
    return h`<div class="page narrow">
      ${subHead({ title: 'Email filters', back: '#/settings' })}
      <section class="card">
        <div class="setrow first"><span class="main"><b>Skip bulk mail</b><small>Newsletters, mailing lists and automatic notices are skipped, even from people in Skyway</small></span>
          <button type="button" class="switch" role="switch" aria-checked="${model.settingBool('skipBulk')}" aria-label="Skip bulk mail"
            data-act="toggle-bulk"><span></span></button></div>
      </section>
      <section class="block"><h2 class="group-label">Skipped this week${count ? ' · ' + count : ''}</h2>
        <div class="card list">${skippedList()}</div>
        <p class="hint">Always allow lets a sender’s mail through, even if it looks like bulk mail.</p>
      </section>
      ${ruleRows('Ignore sender')}
      ${ruleRows('Ignore domain')}
      ${ruleRows('Always allow')}
      <form class="card stack tight" data-form="ignore-rule" novalidate>
        <label class="field"><span class="label">Ignore a sender or domain</span>
          <span class="inline-input"><input type="text" name="rule" placeholder="news@firm.com or firm.com" autocomplete="off"
            autocapitalize="none" spellcheck="false" data-skip><button class="btn small" type="submit">Ignore</button></span></label>
        ${filterUi.error ? h`<p class="error">${filterUi.error}</p>` : h`<p class="hint">Ignoring never hides mail from people in Skyway.</p>`}
      </form>
    </div>`;
  },
  mount() { loadGmailStatus(false); },
  async submit(form) {
    const v = String(form.rule.value || '').trim().toLowerCase().replace(/^@/, '');
    const isAddr = v.includes('@');
    if (!v || (isAddr && !validEmail(v)) || (!isAddr && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v))) {
      filterUi.error = 'Type an address like news@firm.com, or a domain like firm.com.';
      ui.render();
      return;
    }
    if (!isAddr && SHARED_MAIL_DOMAINS.includes(v)) {
      filterUi.error = 'Ignoring all of ' + v + ' would hide real people. Ignore single addresses instead.';
      ui.render();
      return;
    }
    filterUi.error = '';
    const kind = await actions.addIgnoreRule(v);
    toast(kind === 'Ignore sender' ? 'Ignoring ' + v + '.' : 'Ignoring everyone at @' + v + '.');
  },
  act: {
    async 'toggle-bulk'() {
      const on = !model.settingBool('skipBulk');
      await store.save('Settings', { id: 'skipBulk', value: on ? 'TRUE' : 'FALSE' });
      toast(on ? 'Bulk mail is skipped again.' : 'Bulk mail now reaches the review queue too.');
    },
    async allow(el) {
      await actions.allowSender(el.dataset.email, el.dataset.name);
      toast('Mail from ' + el.dataset.email + ' will reach the review queue.');
    },
    'show-all'() {
      filterUi.showAll = true;
      ui.render();
    },
    async 'remove-filter'(el) {
      const f = await actions.removeFilter(el.dataset.id);
      if (!f) return;
      const v = String(f.value).replace(/^@/, '');
      toast(f.kind === 'Always allow' ? 'Removed. ' + v + ' is treated like anyone else.' :
        'Undone. Mail from ' + (f.kind === 'Ignore domain' ? '@' + v : v) + ' shows up in the review queue again.');
    }
  }
};

/* ---------------------------------------------------------- for Today */

/** "3 new senders · 1 email to sort · 1 duplicate" */
export function reviewSummary(long) {
  const n = model.reviewCounts();
  const parts = [];
  if (n.senders) parts.push(plural(n.senders, 'new sender'));
  if (n.unsure) parts.push(long ? plural(n.unsure, 'email') + ' that may need a reply' : plural(n.unsure, 'email') + ' to sort');
  if (n.dupes) parts.push(long ? plural(n.dupes, 'possible duplicate') : plural(n.dupes, 'duplicate'));
  if (!long) return parts.join(' · ');
  if (parts.length < 2) return parts.join('') + '.';
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] + '.';
}

export function lastCheckLine() {
  const st = gmail.status;
  return st && st.lastCheckAt ? 'Gmail last checked ' + fmtAgo(st.lastCheckAt) : '';
}
