// CareOS caregiver PWA service worker — placeholder scaffold.
// The Caregiver Mobile PWA Core task will replace this with the real
// offline cache, background sync, and Web Push handlers.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass-through. Real caching strategy comes in the PWA task.
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "CareOS", body: "" };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "CareOS", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(self.clients.openWindow(url));
});
