// Service worker: web push only (plan A). It caches nothing, so the app is always the current version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "Grok Bot · now", { body: d.body || "", icon: "icons/icon-192.png", data: { url: d.url || null } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;   // the FOMO URL exactly as links.py made it
  e.waitUntil(url ? self.clients.openWindow(url) : self.clients.openWindow("./"));
});
