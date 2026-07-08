// Spotane — Service Worker
// Bump CACHE_VERSION à chaque release pour invalider l'ancien cache.
const CACHE_VERSION = 'spotane-v41-2026-07-08';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

const CDN_PREFIXES = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/',
  'https://unpkg.com/leaflet@',
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
];

const PHOTO_PREFIXES = [
  'https://images.unsplash.com/',
  'https://places.googleapis.com/v1/places/',
];

const TILE_PREFIXES = [
  'https://basemaps.cartocdn.com/',
  'https://a.basemaps.cartocdn.com/',
  'https://b.basemaps.cartocdn.com/',
  'https://c.basemaps.cartocdn.com/',
  'https://d.basemaps.cartocdn.com/',
];

const NEVER_CACHE_PREFIXES = [
  'https://photon.komoot.io/',
  'https://nominatim.openstreetmap.org/',
  'https://overpass-api.de/',
  'https://api.allorigins.win/',
  'https://places.googleapis.com/v1/places:searchText',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function startsWithAny(url, prefixes) {
  return prefixes.some((p) => url.startsWith(p));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  if (startsWithAny(url, NEVER_CACHE_PREFIXES)) return;

  if (startsWithAny(url, CDN_PREFIXES)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  if (startsWithAny(url, PHOTO_PREFIXES) || startsWithAny(url, TILE_PREFIXES)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  const sameOrigin = new URL(url).origin === self.location.origin;
  if (sameOrigin) {
    // HTML (navigation / index.html / racine) : network-first pour que les MAJ
    // s'affichent dès le rechargement quand on est en ligne. Fallback cache offline.
    const isHtml = req.mode === 'navigate' || url.endsWith('/') || url.endsWith('/index.html');
    if (isHtml) {
      event.respondWith(networkFirst(req, STATIC_CACHE));
    } else {
      event.respondWith(cacheFirst(req, STATIC_CACHE));
    }
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || (await cache.match('./index.html')) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}
