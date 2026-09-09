// Bridgewater Bocce - service worker
// Strategy: network-first (so schedule/standings updates always win when online),
// falling back to the last cached copy when offline.
const CACHE_NAME = "bwb-pwa-v1";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/registration.html",
  "/team-rosters.html",
  "/schedule.html",
  "/standings.html",
  "/contact.html",
  "/style.css",
  "/logo-home.png",
  "/logo-home-cropped.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
