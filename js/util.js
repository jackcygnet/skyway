// Skyway app · shared helpers: safe HTML, dates, ids, cadences.

/* ------------------------------------------------------------ safe HTML */
// h`...` escapes every value it's given unless the value came from h`` or raw().
// Arrays are joined. null, undefined and false print nothing.

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export function raw(s) { return new Safe(String(s)); }

export function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function piece(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(piece).join('');
  return esc(v);
}

export function h(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += piece(vals[i]) + strings[i + 1];
  return new Safe(out);
}

/* ---------------------------------------------------------------- ids */

export function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix) { return prefix + '_' + randomHex(8); }

export const ID_RE = /^[a-z]{3}_[A-Za-z0-9]{6,40}$/;

/* --------------------------------------------------------------- dates */
// Times are ISO text in UTC. Days are YYYY-MM-DD in this device's own time zone.

export function nowIso() { return new Date().toISOString(); }

export function pad2(n) { return (n < 10 ? '0' : '') + n; }

export function ymdOf(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
}

export function todayYmd() { return ymdOf(new Date()); }

export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

export function ymdToLocalDate(ymd) {
  const p = parseYmd(ymd);
  return p ? new Date(p.y, p.m - 1, p.d) : null;
}

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function addMonths(ymd, n) {
  const p = parseYmd(ymd);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return y + '-' + pad2(m) + '-' + pad2(Math.min(p.d, daysInMonth(y, m)));
}

export function addDays(ymd, n) {
  const p = parseYmd(ymd);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * 86400000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/** Whole days from a to b (b later is positive). */
export function daysBetween(a, b) {
  const pa = parseYmd(a), pb = parseYmd(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

function asDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const p = parseYmd(v);
  if (p) return new Date(p.y, p.m - 1, p.d);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** "Nov 20", or "Nov 20, 2025" when not this year. */
export function fmtDate(v) {
  const d = asDate(v);
  if (!d) return '';
  const s = MONTHS[d.getMonth()] + ' ' + d.getDate();
  return d.getFullYear() === new Date().getFullYear() ? s : s + ', ' + d.getFullYear();
}

/** "Fri, Nov 27" */
export function fmtDay(v) {
  const d = asDate(v);
  return d ? DAYS[d.getDay()] + ', ' + fmtDate(d) : '';
}

/** "Friday, Nov 20" */
export function fmtLongDay(v) {
  const d = asDate(v);
  return d ? LONG_DAYS[d.getDay()] + ', ' + fmtDate(d) : '';
}

export function fmtHeaderDate(d) {
  return LONG_DAYS[d.getDay()] + ', ' + LONG_MONTHS[d.getMonth()] + ' ' + d.getDate();
}

/** "7:44 PM" */
export function fmtTime(v) {
  const d = asDate(v);
  if (!d) return '';
  let hr = d.getHours();
  const ap = hr < 12 ? 'AM' : 'PM';
  hr = hr % 12 || 12;
  return hr + ':' + pad2(d.getMinutes()) + ' ' + ap;
}

/** "Today, 7:44 PM", "Yesterday, 3:10 PM", "Fri, Nov 20, 5:30 PM" */
export function fmtWhen(v) {
  const d = asDate(v);
  if (!d) return '';
  const ymd = ymdOf(d), t = todayYmd();
  if (ymd === t) return 'Today, ' + fmtTime(d);
  if (ymd === addDays(t, -1)) return 'Yesterday, ' + fmtTime(d);
  if (ymd === addDays(t, 1)) return 'Tomorrow, ' + fmtTime(d);
  return fmtDay(d) + ', ' + fmtTime(d);
}

/** "just now", "4 min ago", "2 hr ago", then a date. */
export function fmtAgo(v) {
  const d = asDate(v);
  if (!d) return 'never';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 50) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 6 * 3600) return Math.round(s / 3600) + ' hr ago';
  if (ymdOf(d) === todayYmd()) return 'today at ' + fmtTime(d);
  return fmtDate(d);
}

/** Value for <input type="datetime-local"> */
export function toLocalInput(v) {
  const d = asDate(v) || new Date();
  return ymdOf(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function fromLocalInput(s) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* ------------------------------------------------------------ cadences */

export function parseCadence(v) {
  const s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'none' || s === 'never' || s === 'off' || s === '0') return { none: true };
  const m = /^(\d{1,3})\s*(d|days?|w|wks?|weeks?|m|mos?|months?|y|yrs?|years?)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (n <= 0) return { none: true };
  return { n, unit: m[2].charAt(0) };
}

export function addCadence(ymd, cad) {
  switch (cad.unit) {
    case 'd': return addDays(ymd, cad.n);
    case 'w': return addDays(ymd, cad.n * 7);
    case 'm': return addMonths(ymd, cad.n);
    case 'y': return addMonths(ymd, cad.n * 12);
  }
  return null;
}

/** "every 3 months", "every 6 weeks", "no reminders" */
export function describeCadence(v) {
  const c = typeof v === 'string' ? parseCadence(v) : v;
  if (!c || c.none) return 'no reminders';
  const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[c.unit];
  return c.n === 1 ? 'every ' + unit : 'every ' + c.n + ' ' + unit + 's';
}

/** "3 months", "6 weeks" (for "Restarts Maria's 3-month clock") */
export function cadenceSpan(v) {
  const c = typeof v === 'string' ? parseCadence(v) : v;
  if (!c || c.none) return '';
  const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[c.unit];
  return c.n + '-' + unit;
}

export const CADENCE_CHOICES = [
  ['2w', 'Every 2 weeks'], ['1m', 'Every month'], ['6w', 'Every 6 weeks'], ['2m', 'Every 2 months'],
  ['3m', 'Every 3 months'], ['4m', 'Every 4 months'], ['6m', 'Every 6 months'], ['1y', 'Every year'],
  ['none', 'No reminders']
];

/* --------------------------------------------------------------- names */

export function initials(name) {
  const parts = String(name || '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/** "Maria Ortega" becomes "Ortega, Maria". Suffixes like Jr. stay at the end. Same rule as the brain. */
export function defaultSortName(name) {
  name = String(name || '').replace(/\s+/g, ' ').trim();
  if (name.indexOf(',') >= 0) return name;
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv|esq\.?|ph\.?d\.?|j\.?d\.?|m\.?d\.?)$/i;
  let last = parts.length - 1;
  while (last > 0 && suffix.test(parts[last])) last--;
  if (last === 0) return name;
  const tail = parts.slice(last + 1).join(' ');
  return parts[last] + ', ' + parts.slice(0, last).join(' ') + (tail ? ' ' + tail : '');
}

export function lastNameKey(c) {
  const s = String(c.sortName || '').trim();
  return (s || defaultSortName(c.name)).toLowerCase();
}

export function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* ---------------------------------------------------------------- misc */

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

export function splitList(s) {
  return String(s || '').split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
}

export function normalizeEmail(s) { return String(s || '').trim().toLowerCase(); }

export function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

export function matchesQuery(fields, q) {
  if (!q) return true;
  const hay = fields.filter(Boolean).join(' \u0001 ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/**
 * A link that is safe to put in an href: web, mail, phone and OneNote
 * addresses only. A bare address like linkedin.com/in/x gets https:// added.
 * Anything else (a javascript: link typed into the Sheet, say) gives ''.
 */
export function safeUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|onenote:)/i.test(s)) return /\s/.test(s) && !/^onenote:/i.test(s) ? '' : s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '';
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return 'https://' + s;
  return '';
}

/** "Mar 14" or "Mar 14, 1990" from MM-DD or YYYY-MM-DD. */
export function fmtBirthday(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return MONTHS[+m[2] - 1] ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : s;
  m = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return MONTHS[+m[1] - 1] ? MONTHS[+m[1] - 1] + ' ' + (+m[2]) : s;
  return s;
}
