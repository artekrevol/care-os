import { useEffect, useState } from "react";
import { pendingCount, subscribe } from "./outbox";

export function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useOutboxCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      pendingCount().then((c) => {
        if (!cancelled) setN(c);
      });
    };
    refresh();
    const off = subscribe(refresh);
    const t = setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      off();
      clearInterval(t);
    };
  }, []);
  return n;
}
