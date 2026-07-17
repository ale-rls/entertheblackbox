/**
 * App-shell service worker (plan §9): the SW handles ONLY the
 * application shell. Media sync and Blob creation are controlled
 * explicitly by the display application via Cache Storage — /media/
 * requests are never intercepted here.
 *
 * HTML entry points stay network-first (no-cache semantics, plan §7);
 * hashed /assets/ files are cache-first (immutable).
 */

const SHELL_CACHE = "smartphonecracy-shell-v1";

// The SW is served from the bundle mount (e.g. /display/sw.js), so the
// app shell's hashed assets live under <mount>/assets/, not /assets/.
const ASSETS_PREFIX = new URL("./assets/", self.location.href).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("smartphonecracy-shell-") && n !== SHELL_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Video responses, including bundled attract-loop MP4s under /assets/,
  // must stay out of the shell cache. Browsers may issue range requests for
  // media, which Cache Storage's whole-response handling cannot satisfy.
  if (event.request.destination === "video" || url.pathname.toLowerCase().endsWith(".mp4")) {
    return;
  }

  // App shell ONLY: hashed assets and page navigations. Everything else
  // (media, media-manifest, /api/*, /ws, health endpoints) passes
  // through untouched — the SW must never sit between the app and the
  // server's live surfaces (review finding, plan §9).
  if (url.pathname.startsWith(ASSETS_PREFIX)) {
    // Hashed, immutable: cache-first.
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      })(),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    // HTML entry points: network-first (no-cache semantics, plan §7)
    // with cache fallback so a brief server outage still boots the shell.
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const response = await fetch(event.request);
          if (response.ok) await cache.put(event.request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(event.request);
          if (cached) return cached;
          throw new Error("offline and not cached");
        }
      })(),
    );
  }
});
