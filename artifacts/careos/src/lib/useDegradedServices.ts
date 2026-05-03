import { useEffect, useState } from "react";

export interface DegradedModule {
  module: string;
  errorCount24h: number;
  lastProbeOk: boolean | null;
  lastSuccessAt: string | null;
}

interface DegradedServicesPayload {
  degraded: DegradedModule[];
}

/**
 * Lightweight polling hook for the public `/api/health/degraded`
 * endpoint. Used by feature surfaces to render graceful-degradation
 * banners when an upstream module is unhealthy (AI parser, maps, etc.).
 * Failures are silent — degradation hints are best-effort UX, not
 * load-bearing data.
 */
export function useDegradedServices(): DegradedModule[] {
  const [degraded, setDegraded] = useState<DegradedModule[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce(): Promise<void> {
      try {
        const r = await fetch("/api/health/degraded", {
          credentials: "include",
        });
        if (!r.ok) return;
        const data = (await r.json()) as DegradedServicesPayload;
        if (!cancelled && Array.isArray(data.degraded)) {
          setDegraded(data.degraded);
        }
      } catch {
        // Best-effort — a degraded health endpoint should never break UX.
      }
    }
    void fetchOnce();
    const t = setInterval(fetchOnce, 60_000);
    return (): void => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return degraded;
}

export function isModuleDegraded(
  degraded: DegradedModule[],
  moduleName: string,
): boolean {
  return degraded.some((d) => d.module === moduleName);
}
