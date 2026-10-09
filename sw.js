// ── Tournixo User App: Service Worker ──
// • Navigations (pages/*.html): network-first → আপডেট সাথে সাথে দেখা যায়,
//   offline হলে cache থেকে shell আসে
// • Same-origin static assets (scripts/styles/components/icons/manifest): cache-first
// • Firebase / Firestore / Auth / Fonts / OneSignal / Cloudinary: কখনো cache না
// ⚠️ প্রতিটা release-এ CACHE-এর নাম বদলে দাও (পুরনো cache auto-clean হবে)।

const CACHE = 'tournixo-user-v7-3';

const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebaseio.com',
  'firebasedatabase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'googleapis.com',
  'gstatic.com',
  'onesignal.com',
  'cdn.onesignal.com',
  'cloudinary.com',
  'res.cloudinary.com'
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function shouldBypass(url) {
  return BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin → browser handles
  if (shouldBypass(url)) return;                   // Firebase/Auth/Fonts/OneSignal → network only

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // App shell: network first (fresh updates), offline → cached copy
    if (req.mode === 'navigate') {
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached = await cache.match(req)
          || await cache.match(new URL('index.html', self.registration.scope));
        if (cached) return cached;
        throw e;
      }
    }

    // Static assets: cache first
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  })());
});
