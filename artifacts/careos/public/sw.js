// CareOS caregiver PWA service worker.
// Provides app-shell caching, an offline replay queue for clock-in / clock-out,
// and Web Push handling.

const CACHE_VERSION = "careos-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

const QUEUE_DB = "careos-offline";
const QUEUE_STORE = "outbox";
const ID_MAP_STORE = "id-map";
const SYNC_TAG = "careos-replay-outbox";

// ---------- IndexedDB helpers (no external libs) ----------

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
      if (!db.objectStoreNames.contains(ID_MAP_STORE)) {
        // Maps client-generated temp visit ids ("tmp_vis_xxx") to the real
        // server-issued ids returned when the queued clock-in eventually
        // replays. Used to rewrite the URL of any pending clock-out for the
        // same visit so offline clock-in -> offline clock-out -> sync works.
        db.createObjectStore(ID_MAP_STORE, { keyPath: "tempId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putIdMap(tempId, realId) {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ID_MAP_STORE, "readwrite");
    tx.objectStore(ID_MAP_STORE).put({ tempId, realId });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getRealId(tempId) {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ID_MAP_STORE, "readonly");
    const req = tx.objectStore(ID_MAP_STORE).get(tempId);
    req.onsuccess = () => resolve(req.result ? req.result.realId : null);
    req.onerror = () => reject(req.error);
  });
}

async function listQueued() {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteQueued(id) {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function enqueue(entry) {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Install / activate ----------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(SHELL_URLS).catch(() => {
        // Best-effort: don't fail install if a shell URL is unavailable.
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => !n.startsWith(CACHE_VERSION))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// ---------- Fetch strategies ----------

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isClockRequest(req, url) {
  if (req.method !== "POST") return false;
  return (
    url.pathname === "/api/visits/clock-in" ||
    /^\/api\/visits\/[^/]+\/clock-out$/.test(url.pathname)
  );
}

function makeTempId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `tmp_${prefix}_${Date.now().toString(36)}${rand}`;
}

async function queueClockRequest(req, url) {
  const raw = await req.clone().text();
  // Inject occurredAt so the server can backdate clockInTime / clockOutTime
  // and stamp visits.offlineSyncedAt when this is replayed online.
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    // Body wasn't JSON; preserve as-is.
  }
  if (!parsed.occurredAt) parsed.occurredAt = new Date().toISOString();

  const isClockIn = url.pathname === "/api/visits/clock-in";
  const tempId = isClockIn ? makeTempId("vis") : null;

  // For offline clock-out, if the URL targets a temp clock-in id we haven't
  // replayed yet, keep the URL as-is and resolve at replay time.
  const body = JSON.stringify(parsed);
  await enqueue({
    url: req.url,
    method: req.method,
    headers: { "content-type": "application/json" },
    body,
    tempVisitId: tempId,
    queuedAt: new Date().toISOString(),
  });
  try {
    if ("sync" in self.registration) {
      await self.registration.sync.register(SYNC_TAG);
    }
  } catch {
    // Background Sync unsupported; we'll replay on next "online" message.
  }

  if (isClockIn) {
    // Synthesize a clock-in response that mirrors ClockInResponse closely
    // enough for offline UX: gives the page a temp `id` it can immediately
    // use for an offline clock-out call against /api/visits/<tempId>/clock-out.
    const synthetic = {
      id: tempId,
      caregiverId: parsed.caregiverId ?? null,
      clientId: parsed.clientId ?? null,
      scheduleId: parsed.scheduleId ?? null,
      clockInTime: parsed.occurredAt,
      clockInLat: parsed.latitude ?? null,
      clockInLng: parsed.longitude ?? null,
      clockInMethod: parsed.method ?? "GPS",
      verificationStatus: "QUEUED",
      offline: true,
      queued: true,
    };
    return new Response(JSON.stringify(synthetic), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({ queued: true, offline: true, queuedAt: parsed.occurredAt }),
    { status: 202, headers: { "content-type": "application/json" } },
  );
}

async function networkFirstNavigation(event) {
  try {
    const fresh = await fetch(event.request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put("/", fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = (await cache.match(event.request)) || (await cache.match("/"));
    if (cached) return cached;
    return new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  if (cached) {
    // Kick off revalidation but return cached immediately.
    network.catch(() => {});
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  // No cache, no network: fall back to the app shell so navigations still
  // boot, otherwise return an explicit offline response rather than
  // `undefined` (which would surface as a TypeError to the page).
  const shellCache = await caches.open(SHELL_CACHE);
  const shell = await shellCache.match("/");
  if (shell) return shell;
  return new Response("", {
    status: 504,
    statusText: "Offline and not cached",
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  if (req.method === "POST" && isClockRequest(req, url)) {
    // Clock-out targeted at an unsynced temp clock-in id must be queued —
    // sending it online would 404. Detect that and skip the network race.
    const m = url.pathname.match(/^\/api\/visits\/([^/]+)\/clock-out$/);
    if (m && m[1].startsWith("tmp_vis_")) {
      event.respondWith(queueClockRequest(req, url));
      return;
    }
    event.respondWith(
      fetch(req.clone()).catch(() => queueClockRequest(req, url)),
    );
    return;
  }

  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (isApiRequest(url)) {
    // Don't cache API responses by default — keep them fresh.
    return;
  }

  // Static assets / app shell: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(req));
});

// ---------- Background sync replay ----------

async function rewriteUrlForRealId(url) {
  // /api/visits/<tmp>/clock-out -> /api/visits/<real>/clock-out
  const m = url.match(/^(.*\/api\/visits\/)(tmp_vis_[^/]+)(\/clock-out)$/);
  if (!m) return url;
  const real = await getRealId(m[2]);
  if (!real) return null; // mapping not yet known — skip this item this round
  return `${m[1]}${real}${m[3]}`;
}

async function replayOutbox() {
  const items = await listQueued();
  // Sort so clock-ins replay before any dependent clock-outs.
  items.sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));

  for (const item of items) {
    let targetUrl = item.url;
    if (/\/api\/visits\/tmp_vis_[^/]+\/clock-out$/.test(targetUrl)) {
      const rewritten = await rewriteUrlForRealId(targetUrl);
      if (!rewritten) {
        // Real id not available yet — likely the matching clock-in failed
        // earlier in this loop and threw. Defer this item to next replay.
        continue;
      }
      targetUrl = rewritten;
    }
    let res;
    try {
      res = await fetch(targetUrl, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      });
    } catch (err) {
      // Network failure — stop and let the platform retry.
      throw err;
    }
    if (res.ok || res.status === 201 || res.status === 202) {
      // If this was a clock-in with a temp id, capture the real id from
      // the response so any pending clock-out can be rewritten.
      if (item.tempVisitId) {
        try {
          const json = await res.clone().json();
          if (json && typeof json.id === "string") {
            await putIdMap(item.tempVisitId, json.id);
          }
        } catch {
          // Ignore non-JSON responses.
        }
      }
      await deleteQueued(item.id);
    } else if (res.status >= 400 && res.status < 500) {
      // Permanent client error — drop so we don't loop forever.
      await deleteQueued(item.id);
    } else {
      throw new Error(`replay failed: ${res.status}`);
    }
  }
  const all = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of all) c.postMessage({ type: "outbox-flushed" });
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayOutbox());
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "replay-outbox") {
    event.waitUntil(replayOutbox().catch(() => {}));
  } else if (data.type === "skip-waiting") {
    self.skipWaiting();
  }
});

// ---------- Push notifications ----------

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "CareOS", body: "" };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "CareOS", body: event.data.text() };
  }
  const title = payload.title || "CareOS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: payload,
      tag: payload.tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = all.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
