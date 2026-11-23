// Skyway app · line icons on a 24-unit grid, drawn for Skyway.
import { raw } from './util.js';

const P = {
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4M18 14.8c2 .8 3.2 2.5 3.5 5.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  pencil: '<path d="M14.5 5.5 18.5 9.5M4 20l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19z"/>',
  userPlus: '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c.6-3.6 3.2-5.5 6.5-5.5 1.6 0 3 .4 4.1 1.2M18.5 13v6M15.5 16h6"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.3"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 5.5 5.5 0 0 1 10.6 1.3 3.9 3.9 0 0 1 .4 7.7z"/>',
  cloudCheck: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 5.5 5.5 0 0 1 10.6 1.3 3.9 3.9 0 0 1 .4 7.7z"/><path d="m9.5 13.5 1.8 1.8 3.4-3.6"/>',
  cloudOff: '<path d="M4 4l16 16M9.5 6.2A5.5 5.5 0 0 1 17 10.8a3.9 3.9 0 0 1 2.4 6.6M15 18.5H7a4.5 4.5 0 0 1-1.2-8.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 4.8-5.1"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  phone: '<path d="M7.2 3.5h2.4l1.3 4-1.9 1.3a11 11 0 0 0 6.2 6.2l1.3-1.9 4 1.3v2.4a2 2 0 0 1-2.2 2A16 16 0 0 1 5.2 5.7a2 2 0 0 1 2-2.2z"/>',
  building: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 7.5h1.5M13.5 7.5H15M9 11h1.5M13.5 11H15M9 14.5h1.5M13.5 14.5H15M10.5 20.5V18h3v2.5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" stroke-width="2.2"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M11 3.5v2M14 3.5v2"/>',
  video: '<rect x="3.5" y="6.5" width="12" height="11" rx="2"/><path d="m15.5 10.5 5-3v9l-5-3"/>',
  message: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z"/>',
  meeting: '<circle cx="8" cy="9" r="2.7"/><circle cx="16" cy="9" r="2.7"/><path d="M3.5 19c.5-2.8 2.2-4.3 4.5-4.3s4 1.5 4.5 4.3M11.5 19c.5-2.8 2.2-4.3 4.5-4.3s4 1.5 4.5 4.3"/>',
  alert: '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 13.5v5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7h5"/>',
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 13.5h5l1 2h5l1-2h5"/>',
  merge: '<path d="M6 4.5v4a5 5 0 0 0 5 5h2a5 5 0 0 1 5 5v1M18 4.5v4a5 5 0 0 1-3 4.6M15 16.5l3 3 3-3" transform="translate(-1.5 0)"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  backspace: '<path d="M9 5.5h10.5A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5H9L3 12z"/><path d="m12 9.5 5 5M17 9.5l-5 5"/>',
  logo: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.3 2.8-5.1 5.5-5.1s4.9 1.8 5.5 5.1"/><path d="M15.2 5.4a3.1 3.1 0 0 1 0 6.1M17.6 14.6c1.8.8 2.6 2.4 2.9 4.9"/>',
  sparkle: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5 9 15M15 9l2.5-2.5"/>',
  logout: '<path d="M14.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3.5M10 8l-4 4 4 4M6 12h9.5"/>'
};

export function icon(name, size = 20, cls = '') {
  const body = P[name] || P.circle;
  return raw('<svg class="ic ' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    body + '</svg>');
}

/** Icon for an interaction type. */
export function typeIcon(type) {
  switch (type) {
    case 'Email': return 'mail';
    case 'Call': return 'phone';
    case 'Coffee': return 'coffee';
    case 'Video call': return 'video';
    case 'Text': return 'message';
    case 'Event': return 'calendar';
    case 'Meeting': return 'meeting';
    default: return 'pencil';
  }
}
