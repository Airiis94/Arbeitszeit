// Service Worker: stellt die App-Dateien offline bereit. Er speichert KEINE Arbeitszeitdaten –
// die liegen in IndexedDB. Bei jeder Änderung an App-Dateien VERSION erhöhen.

const VERSION = 'v1.0.0';
const CACHE = `arbeitszeit-${VERSION}`;

// Vollständige Liste aller App-Dateien (wird durch tests/unit/sw.test.js geprüft).
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/main.js',
  './js/core/backup-format.js',
  './js/core/calc.js',
  './js/core/csv.js',
  './js/core/model.js',
  './js/core/nachweis.js',
  './js/core/rounding.js',
  './js/core/schedule.js',
  './js/core/state.js',
  './js/core/time.js',
  './js/core/validate.js',
  './js/core/xlsx.js',
  './js/db/db.js',
  './js/db/repo.js',
  './js/ui/account.js',
  './js/ui/activities.js',
  './js/ui/backup.js',
  './js/ui/calendar.js',
  './js/ui/common.js',
  './js/ui/day.js',
  './js/ui/dom.js',
  './js/ui/editors.js',
  './js/ui/help.js',
  './js/ui/settings.js',
  './js/ui/today.js',
];

self.addEventListener('install', (event) => {
  // Alles oder nichts: schlägt eine Datei fehl, wird die neue Version nicht installiert
  // und die bisherige bleibt aktiv.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('arbeitszeit-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Die neue Version übernimmt erst, wenn der Nutzer „Aktualisieren“ antippt.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Cache zuerst (offline-fähig, schnell). Navigationsanfragen fallen auf index.html zurück.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
