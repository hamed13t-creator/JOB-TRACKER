// Offline cache. Bump VERSION on every release so phones pick up the new files.
const VERSION = "v1.1.0";
const SHELL = `shell-${VERSION}`, RUNTIME = "runtime";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./css/app.css",
  "./js/app.js", "./js/i18n.js", "./js/match.js", "./js/store.js", "./js/cvread.js", "./js/parsead.js", "./js/io.js",
  "./js/profile.js", "./js/docs.js", "./js/docx.js", "./js/ai.js",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES))));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Page loads (including share-target URLs with a query): app shell, network first.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html", { ignoreSearch: true })));
    return;
  }
  // Static files: cache first; pdf.js lands in the runtime cache on first use.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && url.pathname.includes("/vendor/")) { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); }
    return res;
  })));
});
