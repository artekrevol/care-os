import { api } from "./api";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

function bufferToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export type PushStatus =
  | "subscribed"
  | "unsupported"
  | "denied"
  | "dismissed"
  | "no-vapid-key"
  | "error";

/**
 * Ensure a push subscription exists for the current device. Returns a
 * structured status so the UI can surface the right graceful-degradation
 * message — when the user denies permission we silently fall back to
 * email notifications on the server side, but we want to tell them.
 */
export async function ensurePushSubscriptionStatus(): Promise<PushStatus> {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    let perm: NotificationPermission = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm === "denied") return "denied";
    if (perm !== "granted") return "dismissed";
    const { publicKey } = await api<{ publicKey: string | null }>(
      "/m/push/vapid-public-key",
    );
    if (!publicKey) return "no-vapid-key";
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // Copy into a fresh ArrayBuffer to satisfy lib.dom's BufferSource typing
      // (Uint8Array<ArrayBufferLike> is not directly assignable in some
      // TypeScript+lib.dom combinations).
      const keyBytes = urlBase64ToUint8Array(publicKey);
      const appServerKey = new ArrayBuffer(keyBytes.byteLength);
      new Uint8Array(appServerKey).set(keyBytes);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
    }
    const json = sub.toJSON();
    await api("/m/push/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? bufferToBase64(sub.getKey("p256dh")),
        auth: json.keys?.auth ?? bufferToBase64(sub.getKey("auth")),
        userAgent: navigator.userAgent,
      }),
    });
    return "subscribed";
  } catch (err) {
    console.warn("push subscription failed", err);
    return "error";
  }
}

/**
 * Backward-compatible wrapper. Returns true when the device is fully
 * subscribed, false otherwise. Prefer `ensurePushSubscriptionStatus`
 * in new code so the UI can render the right fallback message.
 */
export async function ensurePushSubscription(): Promise<boolean> {
  const status = await ensurePushSubscriptionStatus();
  return status === "subscribed";
}

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}sw.js`,
      { scope: import.meta.env.BASE_URL },
    );
  } catch (err) {
    console.warn("sw register failed", err);
  }
}
