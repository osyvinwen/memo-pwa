/* 备忘录 PWA · Service Worker：离线缓存 + 锁屏推送 */
const CACHE = "memo-cache-v1";
const ASSETS = [
  ".",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-180.png",
  "icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

/* ===== 锁屏推送 ===== */
self.addEventListener("push", (e) => {
  let data = { title: "备忘录提醒", body: "", tag: "memo" };
  try {
    if (e.data) data = Object.assign(data, e.data.json());
  } catch (_) {}
  const opts = {
    body: data.body || "",
    tag: data.tag || "memo",
    icon: "icon-512.png",
    badge: "icon-192.png",
    vibrate: [200, 100, 200],
    data: { url: "." },
  };
  e.waitUntil(self.registration.showNotification(data.title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(".");
    })
  );
});
