import { CloudOff, RefreshCw } from "lucide-react";
import { useOnline, useOutboxCount } from "@/lib/online";
import { flush } from "@/lib/outbox";
import { useState } from "react";

export default function OfflineBanner() {
  const online = useOnline();
  const outbox = useOutboxCount();
  const [busy, setBusy] = useState(false);
  if (online && outbox === 0) return null;
  return (
    <div
      className={`px-4 py-2 text-xs font-medium flex items-center justify-between gap-2 ${
        online
          ? "bg-amber-500/15 text-amber-300"
          : "bg-rose-500/20 text-rose-200"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <CloudOff className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          {online
            ? `${outbox} change${outbox === 1 ? "" : "s"} waiting to sync`
            : `Offline${outbox > 0 ? ` · ${outbox} queued` : ""}`}
        </span>
      </div>
      {online && outbox > 0 && (
        <button
          onClick={async () => {
            setBusy(true);
            try {
              await flush();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/30 hover:bg-amber-500/40 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
          Sync now
        </button>
      )}
    </div>
  );
}
