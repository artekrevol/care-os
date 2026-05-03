import Pusher from "pusher";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";

let server: Pusher | null = null;

export function getPusherServer(): Pusher | null {
  if (!isModuleConfigured("realtime")) return null;
  if (!server) {
    server = new Pusher({
      appId: process.env["PUSHER_APP_ID"]!,
      key: process.env["PUSHER_KEY"]!,
      secret: process.env["PUSHER_SECRET"]!,
      cluster: process.env["PUSHER_CLUSTER"]!,
      useTLS: true,
    });
  }
  return server;
}

export type RealtimeChannel =
  | `agency-${string}`
  | `agency-${string}-visits`
  | `agency-${string}-schedule`
  | `agency-${string}-alerts`
  | `client-${string}`
  | `caregiver-${string}`
  | `private-thread-${string}`;

/** Sign a Pusher channel-auth request for a private channel. The caller is
 * responsible for verifying authorization (e.g. confirming the user is a
 * member of the thread) BEFORE calling this. Returns null when realtime is
 * not configured (dev fallback). */
export function authorizeChannel(
  socketId: string,
  channel: RealtimeChannel,
): { auth: string; channel_data?: string } | null {
  const p = getPusherServer();
  if (!p) return null;
  return p.authorizeChannel(socketId, channel);
}

export async function publish(
  channel: RealtimeChannel,
  event: string,
  payload: unknown,
): Promise<{ published: boolean }> {
  const p = getPusherServer();
  if (!p) {
    serviceLogger.warn(
      { channel, event },
      "realtime not configured — event dropped (dev fallback)",
    );
    return { published: false };
  }
  await p.trigger(channel, event, payload);
  return { published: true };
}

export function getClientCredentials(): {
  key: string;
  cluster: string;
} | null {
  if (!isModuleConfigured("realtime")) return null;
  return {
    key: process.env["PUSHER_KEY"]!,
    cluster: process.env["PUSHER_CLUSTER"]!,
  };
}
