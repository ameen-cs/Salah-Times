// Static assets use stale-while-revalidate (see fetch handler), so content
// edits propagate within one reload without a version bump. Only bump
// CACHE_VERSION if you need to force-purge every old cache at once.
const CACHE_VERSION = "salah-v2";

const SHELL = [
  "/",
  "/index.html",
  "/home.html",
  "/schedule.html",
  "/404.html",
  "/css/style.css",
  "/js/config.js",
  "/js/supabase-client.js",
  "/js/api.js",
  "/js/app.js",
  "/logo.png",
  "/favicon.svg",
  "/favicon.ico",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Cross-origin (Google Fonts, codetabs proxy, Supabase API) — let the network handle it.
  if (url.origin !== location.origin) return;
  // Admin page is auth-gated — never serve a cached copy.
  if (url.pathname === "/admin.html" || url.pathname.endsWith("/admin.html")) return;

  const accepts = req.headers.get("accept") || "";
  const isHtml = req.mode === "navigate" || accepts.includes("text/html");

  if (isHtml) {
    // Network-first: live content when online, cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
  } else {
    // Stale-while-revalidate for static assets: serve the cached copy instantly,
    // then refresh it from the network in the background. Deploys reach returning
    // visitors on their next reload without needing a CACHE_VERSION bump.
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
  }
});
