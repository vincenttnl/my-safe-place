// Spotane — Service Worker
// Bump CACHE_VERSION à chaque release pour invalider l'ancien cache.
const CACHE_VERSION = 'spotane-v562-2026-10-31';
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
  /* 📦 v519 (11/10/2026) — vendor/ PRÉCACHÉ : React, Leaflet, polices (copié tel quel par build.js §9bis).
     Depuis le 10/10 l'app charge React/Leaflet/Inter depuis ./vendor/ (même origine) et plus depuis les CDN :
     CDN_PREFIXES ne les voit donc plus passer. Le handler `fetch` les met bien en cache (cacheFirst, même origine,
     non-HTML) — mais seulement à partir de la 2e visite, quand la page est contrôlée. Mesuré en headless : 1re visite,
     réseau coupé, rechargement → index.html et app.js sortent du cache, `vendor/react.production.min.js` non → page
     blanche. 13 fichiers, ≈ 400 Ko, dont les 3 polices (fonts.css les référence en `fonts/fX.woff2`) et les 5 images
     de Leaflet (leaflet.css les référence en `images/`). Chemins relatifs comme le reste de la liste. */
  './vendor/react.production.min.js',
  './vendor/react-dom.production.min.js',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/fonts.css',
  './vendor/fonts/f1.woff2',
  './vendor/fonts/f2.woff2',
  './vendor/fonts/f3.woff2',
  './vendor/images/layers.png',
  './vendor/images/layers-2x.png',
  './vendor/images/marker-icon.png',
  './vendor/images/marker-icon-2x.png',
  './vendor/images/marker-shadow.png',
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
/* 📷 28/10 (C05, chasse L1) — v1 → v2 : la v1 contient des photos EN ÉCHEC mises en cache comme si elles étaient
   bonnes (réponse opaque d'une 400 Storage, voir photoCacheFirst). On ne peut pas les distinguer des bonnes :
   une réponse opaque ne dit pas son statut. Changer le nom suffit à les purger : le ménage d'`activate` supprime
   tout cache qui n'est ni de la version courante ni PHOTOS_CACHE. Coût : les ≤ 50 vignettes déjà vues se
   re-téléchargent une fois (≈ 5 Ko chacune, `_200.webp`, aucune transformation d'image). */
const PHOTOS_CACHE = 'spotane-photos-v2';   // nom STABLE, volontairement sans CACHE_VERSION
const PHOTOS_MAX = 50;
const PHOTO_STORAGE_MARKERS = ['/storage/v1/object/public/', '/storage/v1/render/image/public/'];
const isSpotPhoto = (url) => PHOTO_STORAGE_MARKERS.some((m) => url.includes(m));
/* 🧭 chantier 4 (17/10 soir, mesuré en headless) — le gazetier C1 (Storage public `gazetier/`, ≈ 700 Ko) porte le même
   marqueur `/storage/v1/object/public/` qu'une photo : il entrait dans le cache photos (cache-first, JAMAIS revalidé,
   plafonné à 50) et prenait la place d'une photo. Conséquence réelle : un gazetier régénéré n'aurait jamais été rechargé
   sur un téléphone installé, même après les 7 jours de TTL de l'app. L'app gère son propre cache (`myplace-gazetier-v1`,
   voir gazetierCharger dans index.html) : le SW laisse passer au réseau. À l'activation, on retire aussi l'entrée déjà
   présente chez les installés (sonde avant/après : sonde-sw.mjs du chantier 4). */
const GAZETIER_MARKER = '/storage/v1/object/public/gazetier/';
const isGazetier = (url) => url.includes(GAZETIER_MARKER);
async function purgeGazetierDesPhotos() {
  try {
    const cache = await caches.open(PHOTOS_CACHE);
    for (const k of await cache.keys()) if (isGazetier(k.url)) await cache.delete(k);
  } catch (e) { /* best-effort */ }
}

async function photoCacheFirst(req) {
  const cache = await caches.open(PHOTOS_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  /* 📷 28/10 (C05, chasse L1, mesuré en headless : _explorations/c05-explorer-2026-10-28/chasse/sw-404-mesure.json).
     AVANT : `fetch(req)` d'un <img> part en `no-cors` → réponse OPAQUE (status 0), qu'on mettait en cache faute de
     pouvoir lire son statut. Storage répond 400 à un objet absent (variante `_200.webp` pas encore générée…) :
     cette 400 opaque entrait dans le cache, puis était RESSERVIE en échec à chaque passage, sans jamais revalider.
     MAINTENANT : on redemande la même URL en `cors` (Storage public envoie `Access-Control-Allow-Origin: *`, vérifié
     le 28/10 sur une 200 ET sur une 400). La réponse est lisible : on ne garde que `status === 200`. Tout le reste
     (400, 404, 206…) est rendu à l'<img> sans être mis en cache → le filet `imgFallbackVariante` du front prend le relais,
     et la photo sera redemandée au prochain affichage.
     Repli : si la requête cors échoue (réseau coupé, ou CORS retiré un jour côté Storage), on retente l'ancienne requête
     no-cors pour AFFICHER l'image, mais sans la mettre en cache (on ne peut plus savoir si elle est bonne). */
  let fresh;
  try {
    const accept = req.headers.get('Accept');
    fresh = await fetch(req.url, { mode: 'cors', credentials: 'omit', headers: accept ? { Accept: accept } : {} });
  } catch (e) {
    // Hors réseau et pas en cache : cette seconde tentative échoue aussi et l'erreur passe, comme avant.
    // Le front a son repli (fond de catégorie depuis la v347), il n'affichera pas un bloc blanc.
    return fetch(req);
  }
  if (fresh && fresh.status === 200 && fresh.type !== 'opaque') {
    await cache.put(req, fresh.clone());
    trimPhotos(cache);   // sans await : ne pas retarder l'affichage pour du menage
  }
  return fresh;
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
      /* v519 : un fichier par un fichier, et pas `addAll` — `addAll` est ATOMIQUE : un seul 404 (une icône renommée,
         un fichier de vendor/ absent de deploy/) vidait TOUT le précache, et le try/catch ci-dessous le cachait. Ici,
         ce qui manque manque, le reste est en cache ; même sémantique qu'`addAll` pour chaque entrée (réponse non-ok = refusée). */
      await Promise.all(STATIC_ASSETS.map((u) => c.add(u).catch(() => {})));
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
    ).then(purgeGazetierDesPhotos).then(() => self.clients.claim())
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
  if (isGazetier(url)) return;   // 🧭 chantier 4 : réseau, l'app a son propre cache

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
