// Static assets use stale-while-revalidate (see fetch handler), so content
// edits propagate within one reload without a version bump. Only bump
// CACHE_VERSION if you need to force-purge every old cache at once.
const CACHE_VERSION = "salah-v3";

const SHELL = [
  "/",
  "/index.html",
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
  // Cross-origin (Google Fonts, public CORS proxies, Supabase API) — let the network handle it.
  if (url.origin !== location.origin) return;
  // Live-data proxy must always hit the network — caching it would re-introduce
  // the stale-times bug the proxy exists to fix.
  if (url.pathname.startsWith("/api/")) return;
  // Admin page is auth-gated — never serve a cached copy.
  if (url.pathname === "/admin.html" || url.pathname.endsWith("/admin.html")) return;

  const accepts = req.headers.get("accept") || "";
  const isHtml = req.mode === "navigate" || accepts.includes("text/html");

  // Stale-while-revalidate for everything (HTML shell + static assets): serve the
  // cached copy instantly for a near-instant startup, then refresh from the network
  // in the background so the next load is up to date. The shell is just chrome —
  // live prayer times are fetched separately by the page JS — so a one-load-stale
  // shell is harmless, and the page already renders from defaults before data lands.
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached || (isHtml ? caches.match("/index.html") : undefined));
        return cached || network;
      })
    )
  );
});
