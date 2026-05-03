import { Client as GMapsClient } from "@googlemaps/google-maps-services-js";
import { and, eq } from "drizzle-orm";
import { db, driveTimeCacheTable } from "@workspace/db";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";
import { recordSuccess, recordError } from "../health/index";

let gmaps: GMapsClient | null = null;
function getGmaps(): GMapsClient | null {
  if (!isModuleConfigured("maps")) return null;
  if (!gmaps) gmaps = new GMapsClient({});
  return gmaps;
}

export type LatLng = { lat: number; lng: number };
export type DriveTimeResult = {
  durationSeconds: number;
  distanceMeters: number;
  source: "cache" | "google" | "stub";
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function quantize(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export async function getDriveTime(
  origin: LatLng,
  dest: LatLng,
  bucketHour: number,
): Promise<DriveTimeResult> {
  const oLat = quantize(origin.lat);
  const oLng = quantize(origin.lng);
  const dLat = quantize(dest.lat);
  const dLng = quantize(dest.lng);

  const existing = await db
    .select()
    .from(driveTimeCacheTable)
    .where(
      and(
        eq(driveTimeCacheTable.originLat, String(oLat)),
        eq(driveTimeCacheTable.originLng, String(oLng)),
        eq(driveTimeCacheTable.destLat, String(dLat)),
        eq(driveTimeCacheTable.destLng, String(dLng)),
        eq(driveTimeCacheTable.bucketHour, bucketHour),
      ),
    )
    .limit(1);

  const fresh = existing.find(
    (r) => Date.now() - new Date(r.fetchedAt).getTime() < CACHE_TTL_MS,
  );
  if (fresh) {
    return {
      durationSeconds: fresh.durationSeconds,
      distanceMeters: fresh.distanceMeters,
      source: "cache",
    };
  }

  const c = getGmaps();
  if (!c) {
    // Haversine fallback at 30 mph average.
    const R = 6371000;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLatR = toRad(dLat - oLat);
    const dLngR = toRad(dLng - oLng);
    const a =
      Math.sin(dLatR / 2) ** 2 +
      Math.cos(toRad(oLat)) *
        Math.cos(toRad(dLat)) *
        Math.sin(dLngR / 2) ** 2;
    const meters = 2 * R * Math.asin(Math.sqrt(a));
    const seconds = (meters / 13.4) | 0; // ~30mph
    serviceLogger.warn(
      { module: "maps" },
      "maps not configured — returning haversine stub",
    );
    return {
      durationSeconds: seconds,
      distanceMeters: meters | 0,
      source: "stub",
    };
  }

  let resp;
  try {
    resp = await c.distancematrix({
      params: {
        origins: [`${oLat},${oLng}`],
        destinations: [`${dLat},${dLng}`],
        key: process.env["GOOGLE_MAPS_API_KEY"]!,
        departure_time: new Date(),
      },
    });
    recordSuccess("maps");
  } catch (err) {
    recordError("maps", err);
    throw err;
  }
  const elem = resp.data.rows[0]?.elements[0];
  if (!elem || elem.status !== "OK") {
    throw new Error(`distance matrix failed: ${elem?.status ?? "no result"}`);
  }
  const result = {
    durationSeconds: elem.duration.value,
    distanceMeters: elem.distance.value,
    source: "google" as const,
  };
  await db
    .insert(driveTimeCacheTable)
    .values({
      id: `dtc_${oLat}_${oLng}_${dLat}_${dLng}_${bucketHour}`.replace(
        /[^a-zA-Z0-9_]/g,
        "x",
      ),
      originLat: String(oLat),
      originLng: String(oLng),
      destLat: String(dLat),
      destLng: String(dLng),
      bucketHour,
      durationSeconds: result.durationSeconds,
      distanceMeters: result.distanceMeters,
      provider: "google",
    })
    .onConflictDoNothing();
  return result;
}

/**
 * Cheap probe: 1-row distance-matrix call between two nearby points. Records
 * success on a 200 OK from Google.
 */
export async function probe(): Promise<{ ok: boolean; message: string }> {
  const c = getGmaps();
  if (!c) return { ok: false, message: "not configured" };
  try {
    const resp = await c.distancematrix({
      params: {
        origins: ["37.7749,-122.4194"],
        destinations: ["37.7849,-122.4094"],
        key: process.env["GOOGLE_MAPS_API_KEY"]!,
      },
    });
    const elem = resp.data.rows[0]?.elements[0];
    if (elem?.status === "OK") {
      recordSuccess("maps");
      return { ok: true, message: "ok" };
    }
    recordError("maps", new Error(elem?.status ?? "no result"));
    return { ok: false, message: elem?.status ?? "no result" };
  } catch (err) {
    recordError("maps", err);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
