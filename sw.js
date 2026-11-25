// Skyway app · offline support. Keeps a copy of the app's own files so it
// opens without a connection. Calls to the brain are never cached.
// BUILD changes whenever any app file changes, which is how a new version
// reaches your devices: they download it in the background, then show
// "A new version of Skyway is ready".

const BUILD = '1.2.0-f6f34ad256';
const CACHE = 'skyway-' + BUILD;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js', 'js/store.js', 'js/sync.js', 'js/brain.js', 'js/lock.js', 'js/model.js',
  'js/util.js', 'js/icons.js', 'js/qr.js', 'js/actions.js', 'js/boot-check.js',
  'js/views/parts.js', 'js/views/today.js', 'js/views/people.js', 'js/views/contactForm.js',
  'js/views/log.js', 'js/views/tasks.js', 'js/views/events.js', 'js/views/orgs.js',
  'js/views/merge.js', 'js/views/more.js', 'js/views/settings.js', 'js/views/syncView.js',
  'js/views/onboarding.js', 'js/views/review.js',
  'fonts/inter-latin-400-normal.woff2', 'fonts/inter-latin-500-normal.woff2', 'fonts/inter-latin-600-normal.woff2',
  'fonts/inter-latin-ext-400-normal.woff2', 'fonts/inter-latin-ext-500-normal.woff2', 'fonts/inter-latin-ext-600-normal.woff2',
  'fonts/space-grotesk-latin-500-normal.woff2', 'fonts/space-grotesk-latin-600-normal.woff2',
  'fonts/space-grotesk-latin-ext-500-normal.woff2', 'fonts/space-grotesk-latin-ext-600-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('skyway-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the brain, and anything else, goes straight to the network
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
