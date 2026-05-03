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

export async function ensurePushSubscription(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (Notification.permission === "denied") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let perm: NotificationPermission = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") return false;
    const { publicKey } = await api<{ publicKey: string | null }>(
      "/m/push/vapid-public-key",
    );
    if (!publicKey) return false;
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
    return true;
  } catch (err) {
    console.warn("push subscription failed", err);
    return false;
  }
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
