const CACHE_NAME = 'savebook-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/pages/tuning.html',
  '/pages/track.html',
  '/pages/car.html',
  '/pages/collect.html',
  '/pages/barn-finds.html',
  '/pages/newbie.html',
  '/pages/game-systems.html',
  '/pages/system-requirements.html',
  '/pages/tools.html',
  '/pages/news.html',
  '/pages/contact.html',
  '/pages/404.html',
  '/privacy.html',
  '/about.html',
  '/css/style.css',
  '/js/main.js',
  '/js/header.js',
  '/manifest.json',
  '/logo.svg'
];

// Install - cache assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - serve from cache, fall back to network
self.addEventListener('fetch', (e) => {
  // Skip non-GET and cross-origin requests
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request).then(response => {
        // Don't cache non-successful responses or opaque responses from CDNs
        if (!response || response.status !== 200) return response;

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(e.request, responseClone);
        });

        return response;
      }).catch(() => {
        // Return offline page for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
