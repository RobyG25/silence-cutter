// CutSilence Service Worker
// ─────────────────────────────────────────────────────────────────
//  IMPORTANT: מזריק COOP + COEP headers לכל הבקשות
//  זה נדרש כדי ש-FFmpeg.wasm יוכל להשתמש ב-SharedArrayBuffer
//  (GitHub Pages לא מאפשר להגדיר headers ישירות)
// ─────────────────────────────────────────────────────────────────

const CACHE_NAME = 'cutsilence-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(ASSETS.map(url => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Inject COOP/COEP headers into every response ──
function addSecurityHeaders(response) {
  // Don't touch opaque responses (cross-origin no-cors)
  if (response.type === 'opaque') return response;

  const newHeaders = new Headers(response.headers);
  newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// Fetch
self.addEventListener('fetch', event => {
  // Only handle GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === location.origin;
  const isCDN = url.hostname.includes('jsdelivr.net') ||
                url.hostname.includes('unpkg.com') ||
                url.hostname.includes('cdnjs.cloudflare.com');

  event.respondWith((async () => {
    // Same-origin: cache first
    if (isSameOrigin) {
      const cached = await caches.match(event.request);
      if (cached) return addSecurityHeaders(cached);

      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return addSecurityHeaders(response);
      } catch {
        return cached || new Response('Offline', { status: 503 });
      }
    }

    // CDN (FFmpeg WASM etc): network with COEP header
    if (isCDN) {
      try {
        const response = await fetch(event.request, { mode: 'cors' });
        return addSecurityHeaders(response);
      } catch {
        return fetch(event.request);
      }
    }

    // Everything else: pass through
    return fetch(event.request);
  })());
});
