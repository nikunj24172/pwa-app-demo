// InfoLog Mobile service worker.
// SECURITY: caches the app shell + non-sensitive build assets (JS/CSS/fonts/
// images) and page/RSC SHELLS (which hold no PII — data loads client-side via
// /api). It must NEVER cache API responses or authenticated data. Navigations
// and RSC are NETWORK-FIRST so routing is always fresh online; the cached shell
// is only used as an OFFLINE fallback.
const CACHE = "infolog-shell-v3";
const RUNTIME = "infolog-runtime-v3";
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

  // Navigations AND React Server Component payloads are NETWORK-FIRST so a
  // client-side route change never serves a stale (or wrong-auth) response
  // online. Successful responses are cached (page/RSC shells only — no PII) so
  // that OFFLINE we fall back to the real app instead of the /offline page.
  const isRSC = request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (request.mode === "navigate" || isRSC) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(RUNTIME).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request, { ignoreSearch: true })
            .then((r) => r || caches.match("/offline"))
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
