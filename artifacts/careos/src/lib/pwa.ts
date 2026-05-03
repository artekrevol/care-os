// Client-side helpers for the CareOS PWA: service-worker registration,
// install-prompt management, and push-subscription bootstrap.

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredInstall: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();

function notifyInstallListeners() {
  for (const cb of installListeners) cb(deferredInstall !== null);
}

export function onInstallAvailabilityChange(
  cb: (available: boolean) => void,
): () => void {
  installListeners.add(cb);
  cb(deferredInstall !== null);
  return () => installListeners.delete(cb);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredInstall) return "unavailable";
  await deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  deferredInstall = null;
  notifyInstallListeners();
  return choice.outcome;
}

type IOSNavigator = Navigator & { standalone?: boolean };

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari uses `navigator.standalone`; everyone else uses display-mode.
  const ios = (window.navigator as IOSNavigator).standalone === true;
  const dm = window.matchMedia?.("(display-mode: standalone)").matches;
  return Boolean(ios || dm);
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    notifyInstallListeners();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[CareOS] SW registration failed:", err);
      });
  });

  // When connectivity returns, ask the SW to flush queued clock events.
  window.addEventListener("online", () => {
    void flushOutbox();
  });
}

export async function flushOutbox(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: "replay-outbox" });
}

// ---------- Push subscription ----------

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function subscribeToPush(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "Push not supported in this browser." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Notification permission denied." };
  }
  const keyRes = await fetch("/api/notifications/push/vapid-public-key");
  const { publicKey } = (await keyRes.json()) as { publicKey: string | null };
  if (!publicKey) {
    return {
      ok: false,
      reason:
        "Push not configured on the server (no VAPID key). Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.",
    };
  }
  const reg = await navigator.serviceWorker.ready;
  // Reuse an existing subscription if the browser already has one — this is
  // idempotent and avoids "already subscribed" errors.
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  const json = sub.toJSON();
  const res = await fetch("/api/notifications/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const err = await res.json();
      if (err && typeof err.error === "string") detail = err.error;
    } catch {
      // ignore
    }
    return {
      ok: false,
      reason: `Server rejected push subscription (${detail}).`,
    };
  }
  return { ok: true };
}
