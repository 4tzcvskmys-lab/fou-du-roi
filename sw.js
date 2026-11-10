// Service worker de Fou du Roi : fonctionnement hors ligne + mise à jour en arrière-plan.
// Les appels aux API Lichess / Chess.com (autres domaines) ne sont pas interceptés.
const CACHE = 'fdr-v2';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/analysis.js',
  'js/board.js',
  'js/engine.js',
  'js/graph.js',
  'js/importers.js',
  'js/pgn.js',
  'js/stats.js',
  'js/storage.js',
  'vendor/chess.js/chess.js',
  'vendor/stockfish/stockfish-19-lite-single.js',
  'vendor/stockfish/stockfish-19-lite-single.wasm',
  'samples/exemple.pgn',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// « Stale-while-revalidate » : réponse immédiate depuis le cache, puis mise à jour du cache
// en arrière-plan pour la prochaine ouverture.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || new Response('Hors ligne', { status: 503, statusText: 'Hors ligne' });
    })
  );
});
