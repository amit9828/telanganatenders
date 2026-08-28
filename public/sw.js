// public/sw.js
self.addEventListener('fetch', function(event) {
    // This simple fetch handler fixes the "no-op" warning
    event.respondWith(fetch(event.request));
});
