// public/sw.js

// 🚀 FIX: Force this new (fixed) Service Worker to take over immediately instead of
// waiting for every open tab to be closed first. Without this, the old aggressive SW
// (already installed in MD/employee/client browsers) would keep running — sometimes
// for days — and users would keep hitting the 3-5 minute lag despite the source fix
// being deployed.
self.addEventListener('install', function(event) {
    self.skipWaiting();
});

// 🚀 FIX: As soon as this SW activates, claim control of all open clients (tabs)
// right away, so the fixed fetch behavior applies without requiring a manual reload
// or the user closing/reopening their browser.
self.addEventListener('activate', function(event) {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
    const url = new URL(event.request.url);

    // 🚀 FIX: Never let the Service Worker intercept dynamic routes — API calls,
    // the Admin/Employee dashboards, or PDF downloads must always hit the network
    // directly. Routing these through the SW added an extra hop that caused the
    // 3-5 minute Admin Dashboard lag and PDF fetch failures. Using url.pathname
    // (not the full URL) keeps this working on any domain, including production.
    if (
        url.pathname.includes('/api/') ||
        url.pathname.startsWith('/admin') ||
        url.pathname.startsWith('/employee') ||
        url.pathname.endsWith('.pdf')
    ) {
        return; // Bypass the SW entirely — no respondWith() means the browser handles it natively.
    }

    // This simple fetch handler fixes the "no-op" warning for everything else
    // (static assets, public pages, etc.) while staying resilient to network errors
    // so a single failed fetch never crashes the Service Worker thread.
    event.respondWith(
        fetch(event.request).catch(() => new Response('', { status: 504, statusText: 'Gateway Timeout' }))
    );
});
