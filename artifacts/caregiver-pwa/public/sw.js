const VERSION = "v2";
const SHELL_CACHE = `caregiver-shell-${VERSION}`;
const RUNTIME_CACHE = `caregiver-runtime-${VERSION}`;
const SHELL = [
  "/m/",
  "/m/index.html",
  "/m/manifest.webmanifest",
  "/m/icon-192.svg",
  "/m/icon-512.svg",
];

const RUNTIME_API_PATTERNS = [
  /^\/api\/m\/schedule(\?|$)/,
  /^\/api\/m\/visits\/active(\?|$)/,
  /^\/api\/m\/visits\/[^/?]+(\?|$)/,
  /^\/api\/m\/me(\?|$)/,
  /^\/api\/m\/profile(\?|$)/,
  /^\/api\/m\/threads(\?|$)/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

function isRuntimeApi(pathname) {
  return RUNTIME_API_PATTERNS.some((re) => re.test(pathname));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Stale-while-revalidate for whitelisted /api/m/* GETs so the PWA shows
  // last-known schedule + active visit + visit detail when offline.
  if (url.origin === self.location.origin && isRuntimeApi(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              cache.put(req, res.clone()).catch(() => undefined);
            }
            return res;
          })
          .catch(() => null);
        if (cached) {
          // Refresh in background.
          event.waitUntil(network.then(() => undefined));
          return cached;
        }
        const res = await network;
        return res || new Response('{"error":"offline"}', {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/m/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/m/index.html").then((r) => r || Response.error()),
      ),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (
            res.ok &&
            (url.pathname.endsWith(".js") ||
              url.pathname.endsWith(".css") ||
              url.pathname.endsWith(".svg") ||
              url.pathname.endsWith(".webmanifest"))
          ) {
            const copy = res.clone();
            caches
              .open(SHELL_CACHE)
              .then((c) => c.put(req, copy))
              .catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached || Response.error());
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "CareOS", body: "You have a new notification", url: "/m/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }
  const options = {
    body: payload.body,
    icon: "/m/icon-192.svg",
    badge: "/m/icon-192.svg",
    data: { url: payload.url || "/m/" },
    tag: payload.tag,
    renotify: !!payload.tag,
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/m/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          if (w.url.includes("/m/") && "focus" in w) {
            w.focus();
            if ("navigate" in w) w.navigate(target);
            return;
          }
        }
        if (self.clients.openWindow) self.clients.openWindow(target);
      }),
  );
});
