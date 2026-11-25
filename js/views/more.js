// Skyway app · More (phone): review queue, tasks, organizations, settings, sync, lock.

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as model from '../model.js';
import { h, fmtAgo, safeUrl } from '../util.js';
import { icon } from '../icons.js';
import { APP_VERSION } from '../brain.js';
import { topHead } from './parts.js';

function item(href, ic, label, detail) {
  return h`<a class="row link" href="${href}"><span class="avatar square sm">${icon(ic, 18)}</span>
    <span class="main"><b>${label}</b></span>${detail !== '' && detail !== undefined ? h`<span class="muted small">${detail}</span>` : ''}
    <span class="chev">${icon('chevronRight', 18)}</span></a>`;
}

export function syncSummary() {
  const s = sync.syncStatus();
  if (s.failed) return { icon: 'alert', title: s.failed + ' change' + (s.failed === 1 ? '' : 's') + ' couldn’t sync', detail: 'Tap to see what happened', warn: true };
  if (s.state === 'syncing') return { icon: 'refresh', title: 'Syncing…', detail: s.pending ? s.pending + ' waiting' : '' };
  if (s.state === 'offline' || navigator.onLine === false) return { icon: 'cloudOff', title: 'Offline', detail: s.pending ? s.pending + ' saved here, waiting to sync' : 'Everything is saved on this device' };
  if (s.state === 'error') return { icon: 'alert', title: 'Sync problem', detail: s.message, warn: true };
  if (s.pending) return { icon: 'cloud', title: s.pending + ' waiting to sync', detail: 'Last synced ' + fmtAgo(s.lastSync) };
  return { icon: 'cloudCheck', title: 'All synced', detail: s.lastSync ? 'Last synced ' + fmtAgo(s.lastSync) : 'Not synced yet' };
}

export default {
  id: 'more', chrome: 'tabs', navKey: 'more', live: true,
  title: () => 'More',
  render() {
    const c = model.counts();
    const s = syncSummary();
    const sheet = safeUrl(store.meta('sheetUrl'));
    return h`<div class="page">
      ${topHead({ title: 'More' })}
      <div class="card list">
        ${item('#/review', 'inbox', 'Review queue', model.reviewCounts().total ? model.reviewCounts().total + ' to review' : '')}
        ${item('#/tasks', 'list', 'Tasks', c.openTasks ? c.openTasks + ' open' : '')}
        ${item('#/orgs', 'building', 'Organizations', c.orgs || '')}
        ${item('#/settings', 'sliders', 'Settings', '')}
      </div>
      <div class="card list">
        <a class="row link ${s.warn ? 'warn' : ''}" href="#/sync"><span class="avatar square sm">${icon(s.icon, 18)}</span>
          <span class="main"><b>${s.title}</b>${s.detail ? h`<small>${s.detail}</small>` : ''}</span>
          <span class="chev">${icon('chevronRight', 18)}</span></a>
        <button class="row link" data-act="lock"><span class="avatar square sm">${icon('lock', 18)}</span>
          <span class="main"><b>Lock now</b></span></button>
        ${sheet ? h`<a class="row link" href="${sheet}" target="_blank" rel="noopener"><span class="avatar square sm">${icon('external', 18)}</span>
          <span class="main"><b>Open your Google Sheet</b></span></a>` : ''}
      </div>
      <p class="muted small center">Skyway ${APP_VERSION} · ${store.meta('deviceName') || 'this device'}</p>
    </div>`;
  }
};
