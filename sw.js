const CACHE_NAME = 'torbox-theater-v8'; //Change on changes :)
const ASSETS = [
    './',
    './index.html',
    './style.css',
    
    // Core App Logic
    './script.js',
    './api.js',
    './player.js',
    
    // External Libraries (Downloaded locally)
    './artplayer.js',
    './ptt.js',
    
    // MKV Engine (Make absolutely sure these match your actual folder spelling!)
    './engine/mkv_lib.js',
    './engine/streaming-engine.js', // Changed dash to underscore!
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
    // 1. VIP LANE: Ignore local device files (blobs) completely
    if (event.request.url.startsWith('blob:')) {
        return; 
    }

    // 2. VIP LANE: Ignore Video Chunking (Range requests)
    // If the WASM engine asks for a piece of a video, let the browser handle it!
    if (event.request.headers.has('range')) {
        return;
    }

    // 3. Ignore external APIs (like TorBox)
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // 4. Standard Cache for HTML, CSS, JS, and WASM files
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request);
        })
    );
});