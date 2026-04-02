const CACHE_NAME = 'torbox-theater-v4'; //Change on changes :)
const ASSETS = [
    './',
    './index.html',
    './script.js',
    './style.css',

    './engine/mkv_lib.js',
    './engine/streaming-engine.js',
    './engine/streaming_engine.wasm'
];

// Install: Cache the UI Shell and force update
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Forces the browser to activate this new version immediately
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

// Activate: Delete any old versions (v1) of the cache
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName); // Wipes out the old proxy code!
                    }
                })
            );
        })
    );
    self.clients.claim(); // Take control of the page immediately
});

// Fetch: Serve UI from cache, let API and Videos pass through
self.addEventListener('fetch', (event) => {
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request);
        })
    );
});