const CACHE_NAME = 'torbox-theater-v1';
const ASSETS = [
    './',
    './index.html',
    './script.js',
    './style.css' // Include this since it's linked in your HTML!
];

// Install: Cache the UI Shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

// Fetch: Serve UI from cache, let API and Videos pass through the internet
self.addEventListener('fetch', (event) => {
    // Only intercept local files (HTML, JS, CSS)
    if (!event.request.url.startsWith(self.location.origin)) {
        return; 
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request);
        })
    );
});