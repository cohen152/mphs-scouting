const CACHE = 'scout-v8-layout-check';
const ASSETS = ['./', 'index.html', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'logo-white.png', 'login-background.jpeg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const store = r => { if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; };

  // Fonts and the QR tool libraries: cache first so the look survives no signal.
  if (['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'cdnjs.cloudflare.com'].includes(u.hostname)) {
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(store)));
    return;
  }
  if (u.origin !== location.origin) return;

  // App files: network first (updates arrive), cache fallback (works offline).
  e.respondWith(
    fetch(req).then(store).catch(() =>
      caches.match(req).then(m => m || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
