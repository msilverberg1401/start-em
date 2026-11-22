// Start 'Em service worker: makes the site installable, caches the app shell, shows daily reminders.
const CACHE = "start-em-v2";
const SHELL = ["./", "index.html", "style.css", "app.js", "share.js", "teams.js", "config.js", "icon-192.png", "icon-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// network first for our own files (so updates show up), cache as the offline fallback; never touch API calls
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // no-cache: always check with the server (cheap 304 if unchanged) so new versions show up right away
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
    const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});

// daily reminder push
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Today's Daily is live", {
    body: d.body || "Seven new teams are waiting. Who are you starting?",
    icon: "icon-192.png", badge: "icon-192.png", tag: "daily", renotify: true, data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(target); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
