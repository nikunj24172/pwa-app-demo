// InfoLog Mobile service worker.
// SECURITY: caches only the static app shell + non-sensitive build assets
// (JS/CSS/fonts/images). It must NEVER cache API responses, authenticated data,
// or navigation/RSC payloads ("no local sensitive storage") — those are always
// network-first so routing never serves stale data.
const CACHE = "infolog-shell-v2";
const RUNTIME = "infolog-runtime-v2";
const SHELL = ["/", "/login", "/offline", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== RUNTIME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:js|css|woff2?|ttf|png|jpe?g|gif|svg|ico|webp|webmanifest)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never touch API/auth traffic — always network, no caching.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations AND React Server Component payloads must be NETWORK-FIRST so a
  // client-side route change never serves a stale (or wrong-auth) response.
  // (Serving these cache-first was the "routing needs a reload" bug.)
  const isRSC = request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (request.mode === "navigate" || isRSC) {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match("/offline"))
      )
    );
    return;
  }

  // Immutable build assets (hashed) + icons/fonts: cache-first + runtime cache.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              caches.open(RUNTIME).then((c) => c.put(request, copy));
            }
            return response;
          })
          .catch(() => cached || Response.error());
      })
    );
    return;
  }

  // Everything else: network, fall back to cache only when offline.
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((r) => r || Response.error()))
  );
});
