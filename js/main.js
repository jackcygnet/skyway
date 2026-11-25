// Skyway app · start-up, screens, navigation, and the frame around every page.

import * as store from './store.js';
import * as sync from './sync.js';
import * as lock from './lock.js';
import * as model from './model.js';
import { h, fmtTime } from './util.js';
import { icon } from './icons.js';

import today from './views/today.js';
import { peopleView, contactView } from './views/people.js';
import contactForm from './views/contactForm.js';
import logView from './views/log.js';
import { tasksView, taskForm } from './views/tasks.js';
import { eventsView, eventView, eventForm } from './views/events.js';
import { orgsView, orgView, orgForm } from './views/orgs.js';
import mergeView from './views/merge.js';
import { reviewView, linkView, filtersView } from './views/review.js';
import moreView from './views/more.js';
import { settingsView, addDeviceView, changePinView, recoveryView } from './views/settings.js';
import syncView from './views/syncView.js';
import { connectView, pinSetupView, recoveryShowView, lockView, resetView, firstSyncView, disconnectedView } from './views/onboarding.js';

const appEl = document.getElementById('app');
const desktopMq = window.matchMedia('(min-width: 900px)');
const navStack = [];
let current = { view: null, route: null, key: '' };
let renderPending = false;
let updateWaiting = null;
let replacing = false;

export const ui = {
  desktop: () => desktopMq.matches,
  go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  back(fallback) {
    if (navStack.length > 1) history.back();
    else location.hash = fallback || '#/today';
  },
  /** Back to a known screen: the browser's Back if that's where it leads, otherwise in place of this one. */
  backTo(hash) {
    if (navStack.length > 1 && navStack[navStack.length - 2] === hash) history.back();
    else ui.replace(hash);
  },
  /** Goes to a screen in place of this one, so Back skips it (after saving a form). */
  replace(hash) {
    if (location.hash === hash) { render(); return; }
    replacing = true;
    location.replace(hash);
  },
  render: () => render(),
  toast,
  ask,
  pendingConnect: null,
  onboarding: null,
  resetting: false,
  resettingPin: false,
  recoveryToShow: null
};

/* ---------------------------------------------------------------- routes */

function parseRoute() {
  const raw0 = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw0.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || ''), hash: location.hash };
}

function resolve(route) {
  const [a, b, c] = route.parts;
  switch (a) {
    case undefined: case 'today': return today;
    case 'people':
      if (b === 'new') return contactForm;
      if (b && c === 'edit') return contactForm;
      if (b) return ui.desktop() ? peopleView : contactView;
      return peopleView;
    case 'log': return logView;
    case 'tasks': return b ? taskForm : tasksView;
    case 'events':
      if (b === 'new' || c === 'edit') return eventForm;
      return b ? eventView : eventsView;
    case 'orgs':
      if (b === 'new' || c === 'edit') return orgForm;
      return b ? orgView : orgsView;
    case 'merge': return mergeView;
    case 'review': return b === 'link' ? linkView : reviewView;
    case 'filters': return filtersView;
    case 'more': return ui.desktop() ? settingsView : moreView;
    case 'settings':
      if (b === 'add-device') return addDeviceView;
      if (b === 'pin') return changePinView;
      if (b === 'recovery') return recoveryView;
      return settingsView;
    case 'sync': return syncView;
    default: return today;
  }
}

/* Which screen to show before the app proper: connect, PIN, lock. */
function gate() {
  if (ui.onboarding) return ui.onboarding;
  if (store.meta('disconnected')) return disconnectedView;
  if (!sync.connected()) return connectView;
  if (!lock.hasPin()) return pinSetupView;
  if (store.meta('needsRecoveryShown')) return recoveryShowView;
  if (ui.resettingPin) return pinSetupView;
  if (lock.isLocked()) return ui.resetting ? resetView : lockView;
  if (!store.meta('lastSyncAt') && !store.meta('skipFirstSync')) return firstSyncView;
  return null;
}

/* ---------------------------------------------------------------- render */

function render() {
  const route = parseRoute();
  const gated = gate();
  const view = gated || resolve(route);
  const key = (gated ? 'gate:' : '') + view.id + '|' + route.hash;
  const sameScreen = current.key === key;
  const scrollY = window.scrollY;
  current = { view, route, key };
  document.title = (view.title ? view.title(route) + ' · ' : '') + 'Skyway';
  let content;
  try {
    content = view.render(route);
  } catch (err) {
    console.error(err);
    content = h`<div class="page"><div class="card empty"><h2>Something went wrong on this screen</h2>
      <p class="muted">${String(err && err.message || err)}</p>
      <button class="btn" data-act="go" data-to="#/today">Back to Today</button></div></div>`;
  }
  appEl.innerHTML = String(frame(view, content));
  appEl.dataset.chrome = view.chrome || 'tabs';
  if (view.mount) {
    try { view.mount(appEl.querySelector('#main') || appEl, route); } catch (err) { console.error(err); }
  }
  if (sameScreen) window.scrollTo(0, scrollY);
  else window.scrollTo(0, 0);
  renderPending = false;
}

function requestRender() {
  const active = document.activeElement;
  const typing = active && appEl.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  if (!current.view || current.view.live === false || typing) {
    renderPending = true;
    return;
  }
  render();
}

function frame(view, content) {
  const chrome = view.chrome || 'tabs';
  if (chrome === 'bare') return h`<div class="bare">${content}</div>`;
  return h`
    <div class="shell chrome-${chrome}">
      ${sidebar(view.navKey)}
      <div class="column">
        ${updateWaiting ? h`<div class="banner update"><span>A new version of Skyway is ready.</span>
          <button class="btn small" data-act="apply-update">Reload</button></div>` : ''}
        ${eventBanner()}
        <main id="main" class="main">${content}</main>
      </div>
      ${chrome === 'tabs' ? tabbar(view.navKey) : ''}
    </div>`;
}

function syncLine() {
  const s = sync.syncStatus();
  if (s.state === 'syncing') return { icon: 'refresh', text: 'Syncing…' };
  if (s.failed) return { icon: 'alert', text: s.failed + ' couldn’t sync', warn: true };
  if (s.state === 'offline' || navigator.onLine === false) {
    return { icon: 'cloudOff', text: s.pending ? 'Offline · ' + s.pending + ' waiting' : 'Offline' };
  }
  if (s.state === 'error') return { icon: 'alert', text: 'Sync problem', warn: true };
  if (s.pending) return { icon: 'cloud', text: s.pending + ' waiting to sync' };
  if (!s.lastSync) return { icon: 'cloud', text: 'Not synced yet' };
  return { icon: 'cloudCheck', text: 'All synced', when: fmtTime(s.lastSync) };
}

export function syncPill() {
  const l = syncLine();
  return h`<a class="pill ${l.warn ? 'warn' : ''}" href="#/sync">${icon(l.icon, 16)}<span>${l.text}</span></a>`;
}

function sidebar(active) {
  const l = syncLine();
  const item = (key, href, ic, label, badge) => h`<a class="nav-item ${active === key ? 'on' : ''}" href="${href}">
    ${icon(ic, 18)}<span>${label}</span>${badge ? h`<b class="badge">${badge}</b>` : ''}</a>`;
  return h`<aside class="sidebar">
    <a class="brand" href="#/today"><span class="logo">${icon('logo', 20)}</span>
      <span><b>Skyway</b><small>Personal network</small></span></a>
    <nav class="nav">
      ${item('today', '#/today', 'home', 'Today')}
      ${item('people', '#/people', 'people', 'People')}
      ${item('orgs', '#/orgs', 'building', 'Organizations')}
      ${item('events', '#/events', 'calendar', 'Events')}
      ${item('review', '#/review', 'inbox', 'Review queue', model.reviewCounts().total || '')}
      ${item('tasks', '#/tasks', 'list', 'Tasks', model.openTasks().length || '')}
    </nav>
    <div class="side-foot">
      <a class="side-sync ${l.warn ? 'warn' : ''}" href="#/sync">${icon(l.icon, 16)}<span>${l.text}${l.when ? ' · ' + l.when : ''}</span></a>
      <div class="side-buttons">
        <a class="btn small ghost ${active === 'settings' ? 'on' : ''}" href="#/settings">${icon('sliders', 16)}Settings</a>
        <button class="btn small ghost" data-act="lock">${icon('lock', 16)}Lock</button>
      </div>
    </div>
  </aside>`;
}

function tabbar(navKey) {
  // The review queue opens from More on a phone.
  const active = navKey === 'review' ? 'more' : navKey;
  const tab = (key, href, ic, label) => h`<a class="tab ${active === key ? 'on' : ''}" href="${href}">${icon(ic, 22)}<span>${label}</span></a>`;
  return h`<nav class="tabbar" aria-label="Main">
    ${tab('today', '#/today', 'home', 'Today')}
    ${tab('people', '#/people', 'people', 'People')}
    <a class="fab" href="#/log" aria-label="Quick log">${icon('plus', 26)}</a>
    ${tab('events', '#/events', 'calendar', 'Events')}
    ${tab('more', '#/more', 'more', 'More')}
  </nav>`;
}

function eventBanner() {
  const e = model.eventMode();
  if (!e) return '';
  return h`<div class="banner event">${icon('calendar', 18)}
    <a href="#/events/${e.id}"><small>Event mode on</small><b>${e.name}</b></a>
    <button class="btn small ghost" data-act="end-event-mode">End</button></div>`;
}

/* ---------------------------------------------------------------- events */

const globalActs = {
  go: (el) => ui.go(el.dataset.to),
  back: (el) => ui.back(el.dataset.fallback),
  lock: () => { lock.lockNow(); },
  'sync-now': () => { sync.syncNow(); toast('Syncing…'); },
  'end-event-mode': async () => {
    await store.setMeta({ eventMode: undefined });
    toast('Event mode ended');
  },
  'apply-update': () => {
    if (updateWaiting) updateWaiting.postMessage({ type: 'skip-waiting' });
  }
};

function dispatch(kind, ev) {
  const view = current.view;
  if (!view) return;
  if (kind === 'click') {
    const el = ev.target.closest('[data-act]');
    if (!el || !appEl.contains(el)) return;
    const name = el.dataset.act;
    const fn = (view.act && view.act[name]) || globalActs[name];
    if (fn) {
      ev.preventDefault();
      Promise.resolve(fn(el, ev, current.route)).catch(showError);
    }
  } else if (kind === 'submit') {
    if (view.submit) {
      ev.preventDefault();
      Promise.resolve(view.submit(ev.target, ev, current.route)).catch(showError);
    }
  } else if (view[kind]) {
    Promise.resolve(view[kind](ev.target, ev, current.route)).catch(showError);
  }
}

function showError(err) {
  console.error(err);
  toast(err && err.message ? err.message : String(err), { warn: true });
}

appEl.addEventListener('click', (ev) => dispatch('click', ev));
appEl.addEventListener('submit', (ev) => dispatch('submit', ev));
appEl.addEventListener('input', (ev) => dispatch('input', ev));
appEl.addEventListener('change', (ev) => dispatch('change', ev));
appEl.addEventListener('keydown', (ev) => dispatch('keydown', ev));
appEl.addEventListener('focusout', () => {
  setTimeout(() => { if (renderPending && current.view && current.view.live !== false) requestRender(); }, 0);
});

/* ---------------------------------------------------------- toasts, ask */

const toastsEl = document.getElementById('toasts');

/** A short message at the bottom. opts: { warn, ms, action: { label, fn } } (a button such as Undo). */
export function toast(message, opts) {
  const o = opts || {};
  const el = document.createElement('div');
  el.className = 'toast' + (o.warn ? ' warn' : '') + (o.action ? ' has-action' : '');
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  const ms = o.ms || (o.action ? 7000 : 3200);
  if (o.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = o.action.label;
    btn.addEventListener('click', () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
      Promise.resolve().then(o.action.fn).catch((err) => toast(err && err.message ? err.message : String(err), { warn: true }));
    }, { once: true });
    el.appendChild(btn);
  }
  toastsEl.appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

const modalEl = document.getElementById('modal');

/** A small "are you sure?" box. Resolves true for OK. */
export function ask(opts) {
  return new Promise((resolve) => {
    modalEl.innerHTML = String(h`<div class="scrim" data-x="cancel"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">${opts.title}</h2>
        ${opts.body ? h`<p>${opts.body}</p>` : ''}
        <div class="dialog-actions">
          <button class="btn secondary" data-x="cancel">${opts.cancel || 'Cancel'}</button>
          <button class="btn ${opts.danger ? 'danger' : ''}" data-x="ok">${opts.ok || 'OK'}</button>
        </div>
      </div>`);
    modalEl.classList.add('open');
    const okBtn = modalEl.querySelector('[data-x="ok"]');
    okBtn.focus();
    const finish = (val) => {
      modalEl.classList.remove('open');
      modalEl.innerHTML = '';
      modalEl.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey);
    modalEl.onclick = (e) => {
      const x = e.target.closest('[data-x]');
      if (x) finish(x.dataset.x === 'ok');
    };
  });
}

/* ---------------------------------------------------------------- start */

function readConnectLink() {
  const m = /^#connect=([^&]+)&code=([A-Za-z0-9-]+)/.exec(location.hash);
  if (!m) return;
  ui.pendingConnect = { brainUrl: decodeURIComponent(m[1]), code: m[2] };
  history.replaceState(null, '', location.pathname + location.search + '#/today');
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  // The very first install takes control without a reload; only a newer
  // version replacing an older one reloads the page.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const watch = (w) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          updateWaiting = w;
          render();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) { updateWaiting = reg.waiting; render(); }
    reg.addEventListener('updatefound', () => watch(reg.installing));
    // A window left open for days still hears about new versions: check when it comes back into view.
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > 3600000) {
        lastCheck = Date.now();
        reg.update().catch(() => {});
      }
    });
  }).catch((err) => console.warn('Offline support is off:', err));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}

async function disconnected(code, message) {
  const lost = store.pendingCount();
  await store.wipe();
  await store.setMeta({ disconnected: { code, message, lost, at: new Date().toISOString() } });
  lock.lockNow();
  render();
}

async function boot() {
  readConnectLink();
  try {
    await store.load();
  } catch (err) {
    appEl.innerHTML = String(h`<div class="bare"><div class="onb"><h1>Skyway can’t open its storage</h1>
      <p class="muted">${err.message}</p><p class="muted">Private or incognito windows can block it. Open Skyway in a normal window.</p></div></div>`);
    return;
  }
  if (ui.pendingConnect) {
    if (store.meta('disconnected')) await store.setMeta({ disconnected: undefined });
    if (sync.connected()) ui.onboarding = connectView;
  }
  lock.startAutoLock(() => model.settingNum('lockMinutes'));
  lock.onLockChange(() => render());
  store.subscribe(requestRender);
  sync.onStatus(() => {
    const view = current.view;
    if (view && view.live !== false) requestRender();
    else {
      const el = document.querySelector('.side-sync span');
      if (el) el.textContent = syncLine().text;
    }
  });
  sync.start({ onDisconnect: disconnected });
  window.addEventListener('hashchange', () => {
    // A connect link (from a QR code) opened in a tab where Skyway is already running.
    if (/^#connect=/.test(location.hash)) {
      readConnectLink();
      if (sync.connected()) ui.onboarding = connectView;
      if (store.meta('disconnected')) store.setMeta({ disconnected: undefined }).then(render);
      else render();
      return;
    }
    const h0 = location.hash;
    if (replacing && navStack.length) navStack[navStack.length - 1] = h0;
    else if (navStack.length && navStack[navStack.length - 2] === h0) navStack.pop();
    else navStack.push(h0);
    replacing = false;
    if (navStack.length > 50) navStack.shift();
    render();
  });
  desktopMq.addEventListener('change', () => render());
  navStack.push(location.hash);
  render();
  registerWorker();
  if (sync.connected() && !store.meta('disconnected')) sync.syncNow();
}

boot();
