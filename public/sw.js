// InfoLog Mobile service worker.
// SECURITY: caches the app shell + non-sensitive build assets (JS/CSS/fonts/
// images) and page/RSC SHELLS (which hold no PII — data loads client-side via
// /api). It must NEVER cache API responses or authenticated data. Navigations
// and RSC are NETWORK-FIRST so routing is always fresh online; caches are only
// an OFFLINE fallback.
//
// ROUTING CORRECTNESS: HTML documents and RSC (router data) payloads live in
// SEPARATE caches, both keyed by pathname. A navigation is only ever answered
// with a document and an RSC fetch only ever with an RSC payload — serving one
// where the other is expected makes Next.js bail into a hard reload of the
// current page (the "click did nothing" bug).
const CACHE = "infolog-shell-v5";
const RUNTIME = "infolog-runtime-v5";
const PAGES = "infolog-pages-v5"; // offline fallback: HTML documents, keyed by pathname
const RSC = "infolog-rsc-v5"; // offline fallback: RSC payloads, keyed by pathname
const KEEP = [CACHE, RUNTIME, PAGES, RSC];
const SHELL = [
  "/",
  "/login",
  "/offline",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Warm the offline document cache for key routes (sent by AppShell when the
// app is online + authenticated). Pages reached only via client-side routing
// never produce a full-document request, so without this, an offline hard
// navigation to e.g. /profile would dead-end in the browser error page.
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "WARM_PAGES" || !Array.isArray(msg.paths)) return;
  event.waitUntil(
    caches.open(PAGES).then((c) =>
      Promise.all(
        msg.paths.map((p) =>
          fetch(p, { credentials: "same-origin" })
            .then((r) => {
              // Never cache redirects (e.g. an expired session bouncing to /login).
              if (r.ok && !r.redirected && r.type === "basic") return c.put(new Request(p), r);
            })
            .catch(() => {})
        )
      )
    )
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:js|css|woff2?|ttf|png|jpe?g|gif|svg|ico|webp|webmanifest)$/i.test(url.pathname)
  );
}

/** Network-first for a navigation/RSC request; fall back to its OWN cache. */
async function pageOrRsc(request, url) {
  const isNav = request.mode === "navigate";
  const cacheName = isNav ? PAGES : RSC;
  // One entry per route: strip ?_rsc=… and other params so offline lookups hit.
  const key = new Request(url.pathname);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      caches.open(cacheName).then((c) => c.put(key, copy));
    }
    return response;
  } catch {
    const hit = await (await caches.open(cacheName)).match(key);
    if (hit) return hit;
    if (isNav) {
      // Pre-cached shell (/, /login, /offline) or the offline page — never RSC.
      const shell = await (await caches.open(CACHE)).match(key, { ignoreSearch: true });
      if (shell) return shell;
      const offline = await caches.match("/offline");
      if (offline) return offline;
    }
    // For RSC with no cached payload: fail the fetch. Next.js then retries as a
    // full navigation, which the branch above handles with a real document.
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Local dev: never serve from cache. Dev asset URLs (CSS especially) are not
  // content-hashed, so cache-first would keep serving STALE styles/chunks after
  // an edit — the classic "new markup, old CSS" bug.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return;

  // Never touch API/auth traffic — always network, no caching.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations AND React Server Component payloads: network-first so a route
  // change never serves a stale (or wrong-auth) response online.
  const isRSC = request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (request.mode === "navigate" || isRSC) {
    event.respondWith(pageOrRsc(request, url));
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
