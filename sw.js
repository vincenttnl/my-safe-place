// Spotane — Service Worker
// Bump CACHE_VERSION à chaque release pour invalider l'ancien cache.
const CACHE_VERSION = 'spotane-v367-2026-08-03';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './favicon-32.png',
  './favicon-48.png',
  './apple-touch-icon.png',
  // ⚠️ v333 : les 5 captures de la visite guidée (tour/*.webp, 582 Ko) ont été RETIRÉES du précache.
  // Elles étaient téléchargées à l'installation pour un écran joué UNE SEULE FOIS, juste après
  // l'onboarding — donc quasi toujours en ligne. Le handler `fetch` ci-dessous les met déjà en cache
  // au premier affichage (même origine, non-HTML → cacheFirst sur STATIC_CACHE), et elles y restent.
  // Gain mesuré : 777 → 195 Ko à l'install (et 427 Ko du temps des JPG), sans toucher au piqué.
  // Ne les remettre ici que si la visite guidée doit marcher hors ligne AVANT d'avoir été vue une fois.
];

const CDN_PREFIXES = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/',
  'https://unpkg.com/leaflet@',
  'https://unpkg.com/leaflet.markercluster@',
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
];

const PHOTO_PREFIXES = [
  'https://images.unsplash.com/',
  'https://places.googleapis.com/v1/places/',
];

/* 📷 v351 — LES PHOTOS DU CATALOGUE SURVIVENT AU MODE AVION (chantier 9, nombre choisi par Vincent).
   ───────────────────────────────────────────────────────────────────────────────────────────────
   CAUSE EXACTE du « aucun spot ne s'affiche » signale le 29/07 : PHOTO_PREFIXES ne listait
   qu'Unsplash et Google. Les photos du Storage Supabase — c'est-a-dire la quasi-totalite du
   catalogue — n'etaient JAMAIS mises en cache. Hors reseau, chaque carte perdait son image, et une
   carte sans image se lit comme « il n'y a rien ».

   Cache DEDIE et PLAFONNE a PHOTOS_MAX (50, choix de Vincent le 30/07 : ~8 Mo sur le telephone).
   Pourquoi un cache separe du RUNTIME et pas un simple ajout a PHOTO_PREFIXES :
    · le cache runtime n'a AUCUN plafond — y verser des photos ferait grossir l'app sans limite ;
    · il est efface a chaque changement de version du SW (son nom contient CACHE_VERSION), donc les
      photos seraient reperdues a chaque livraison. Celui-ci porte un nom STABLE : il traverse les
      mises a jour, et c'est tout l'interet — les photos deja vues restent la apres un deploiement.
   Strategie « cache d'abord » : une URL de photo est immuable (le nom de fichier change quand la
   photo change), donc rien a revalider — et ca evite de re-payer une transformation d'image, quota
   deja saturé sur ce projet (2 567 pour 100 inclus, mesure du 30/07).
   Eviction : les plus ANCIENNEMENT ajoutees d'abord (cache.keys() rend l'ordre d'insertion). */
const PHOTOS_CACHE = 'spotane-photos-v1';   // nom STABLE, volontairement sans CACHE_VERSION
const PHOTOS_MAX = 50;
const PHOTO_STORAGE_MARKERS = ['/storage/v1/object/public/', '/storage/v1/render/image/public/'];
const isSpotPhoto = (url) => PHOTO_STORAGE_MARKERS.some((m) => url.includes(m));

async function photoCacheFirst(req) {
  const cache = await caches.open(PHOTOS_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const fresh = await fetch(req);
    /* ⚠️ CORRIGE APRES MESURE. J'avais ecrit `fresh.ok && fresh.status === 200`, en croyant proteger
       contre des reponses incompletes. Resultat : le cache restait VIDE, mesure a 0 entree sur 48
       photos demandees. Une image chargee par <img src> part en mode `no-cors` : la reponse est
       OPAQUE, donc `status === 0` et `ok === false` — mon garde-fou rejetait absolument tout.
       Une reponse opaque se met en cache et se ressert parfaitement : c'est le mecanisme NORMAL pour
       une image tierce. Ce qu'il faut vraiment ecarter, c'est une 206 (contenu partiel), qui rendrait
       une image tronquee. */
    const utilisable = fresh && (fresh.status === 200 || fresh.type === 'opaque') && fresh.status !== 206;
    if (utilisable) {
      await cache.put(req, fresh.clone());
      trimPhotos(cache);   // sans await : ne pas retarder l'affichage pour du menage
    }
    return fresh;
  } catch (e) {
    // Hors reseau et pas en cache : on laisse l'erreur passer. Le front a son repli (fond de
    // categorie depuis la v347), il n'affichera plus un bloc blanc.
    throw e;
  }
}

async function trimPhotos(cache) {
  try {
    const cles = await cache.keys();
    const trop = cles.length - PHOTOS_MAX;
    for (let i = 0; i < trop; i++) await cache.delete(cles[i]);
  } catch (e) { /* menage best-effort : jamais au prix d'une image non affichee */ }
}

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
  event.waitUntil((async () => {
    try {
      const c = await caches.open(STATIC_CACHE);
      await c.addAll(STATIC_ASSETS);
      // 📴 Renfort offline (№7) : précache app.js (URL hashée extraite de index.html) → le shell est
      // garanti hors-ligne DÈS l'install, sans attendre une 2e visite. Best-effort, jamais bloquant.
      try {
        const html = await (await fetch('./index.html', { cache: 'reload' })).text();
        const m = html.match(/src="(app\.js\?v=[^"]+)"/);
        if (m) { const r = await fetch(m[1]); if (r && r.ok) await c.put(m[1], r.clone()); }
      } catch (e) {}
    } catch (e) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        /* 📷 v351 — le cache des photos est EPARGNE. Sans cette exception, le menage
           d'activation le supprimait a chaque livraison (son nom ne commence pas par
           CACHE_VERSION) et les photos deja vues etaient reperdues a chaque version — le nom
           stable n'aurait servi a rien. C'est son plafond de 50 qui borne sa taille, pas la
           purge de version. */
        keys.filter((k) => !k.startsWith(CACHE_VERSION) && k !== PHOTOS_CACHE)
          .map((k) => caches.delete(k))
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

  // 📷 Photos du catalogue : cache dedie, plafonne, qui SURVIT aux mises a jour du SW.
  if (isSpotPhoto(url)) {
    event.respondWith(photoCacheFirst(req));
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

// ── 🔔 Push (socle pré-codé v10.31 — inerte tant que rien ne s'abonne, cf _explorations/plan-notifications.md) ──
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Spot 105';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
