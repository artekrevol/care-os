import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, parseISO, isToday, isTomorrow } from "date-fns";
import { LogOut, ChevronRight, MapPin, Clock, RefreshCw, PlayCircle } from "lucide-react";
import { api, type Me, type ScheduleResponse, type VisitDetail } from "@/lib/api";

type Props = { me: Me; onLogout: () => void };

export default function Schedule({ me, onLogout }: Props) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const schedule = useQuery({
    queryKey: ["m", "schedule"],
    queryFn: () => api<ScheduleResponse>("/m/schedule"),
    refetchInterval: 60_000,
  });

  const active = useQuery({
    queryKey: ["m", "active"],
    queryFn: () => api<{ visit?: VisitDetail }>("/m/visits/active"),
    refetchInterval: 30_000,
  });

  async function refresh(): Promise<void> {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["m", "schedule"] }),
      qc.invalidateQueries({ queryKey: ["m", "active"] }),
    ]);
    setTimeout(() => setRefreshing(false), 400);
  }

  async function logout(): Promise<void> {
    try {
      await api("/m/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    onLogout();
  }

  const activeVisit = active.data?.visit;

  return (
    <div className="min-h-screen safe-bottom">
      <header className="safe-top px-5 pb-4 sticky top-0 z-10 bg-[color:var(--color-bg)]/95 backdrop-blur border-b border-[color:var(--color-border)]">
        <div className="flex items-center justify-between pt-2">
          <div>
            <p className="text-xs text-[color:var(--color-muted)]">
              {format(new Date(), "EEEE, MMM d")}
            </p>
            <h1 className="text-xl font-bold">Hi, {me.firstName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Refresh"
              onClick={refresh}
              className="p-2 rounded-lg hover:bg-[color:var(--color-surface)]"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              aria-label="Sign out"
              onClick={logout}
              className="p-2 rounded-lg hover:bg-[color:var(--color-surface)]"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="px-5 py-5 space-y-6 max-w-md mx-auto">
        {activeVisit && (
          <Link href={`/visit/${activeVisit.id}`}>
            <a className="block rounded-2xl p-5 bg-gradient-to-br from-[color:var(--color-accent)] to-cyan-600 text-[color:var(--color-accent-fg)] shadow-lg active:scale-[0.99] transition">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-80">
                <PlayCircle className="w-4 h-4" /> Active visit
              </div>
              <div className="mt-2 text-lg font-bold">
                {activeVisit.client?.firstName} {activeVisit.client?.lastName}
              </div>
              <div className="text-sm opacity-90">
                Clocked in{" "}
                {activeVisit.clockInTime
                  ? format(parseISO(activeVisit.clockInTime), "h:mm a")
                  : "—"}
              </div>
              <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
                Continue visit <ChevronRight className="w-4 h-4" />
              </div>
            </a>
          </Link>
        )}

        <Section title="Today">
          {schedule.isLoading ? (
            <Skeleton />
          ) : schedule.data && schedule.data.today.entries.length > 0 ? (
            schedule.data.today.entries.map((e) => (
              <ScheduleCard key={e.id} entry={e} canStart={!activeVisit} />
            ))
          ) : (
            <Empty message="No visits scheduled for today." />
          )}
        </Section>

        <Section title="Next 7 days">
          {schedule.data?.upcoming.length === 0 && (
            <Empty message="Nothing scheduled in the next week." />
          )}
          {schedule.data?.upcoming.map((day) => (
            <div key={day.date} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)] mt-3">
                {dayLabel(day.date)}
              </h3>
              {day.entries.map((e) => (
                <ScheduleCard key={e.id} entry={e} canStart={false} />
              ))}
            </div>
          ))}
        </Section>
      </main>
    </div>
  );
}

function dayLabel(d: string): string {
  const date = parseISO(d);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEE, MMM d");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-[color:var(--color-muted)] uppercase tracking-wider mb-3">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted)]">
      {message}
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <div className="h-24 rounded-xl bg-[color:var(--color-surface)] animate-pulse" />
      <div className="h-24 rounded-xl bg-[color:var(--color-surface)] animate-pulse" />
    </>
  );
}

function ScheduleCard({
  entry,
  canStart,
}: {
  entry: ScheduleResponse["today"]["entries"][number];
  canStart: boolean;
}) {
  const start = parseISO(entry.scheduledStart);
  const end = parseISO(entry.scheduledEnd);
  const status = entry.status;

  const statusBadge =
    status === "COMPLETED"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "IN_PROGRESS"
        ? "bg-cyan-500/15 text-cyan-300"
        : status === "CANCELLED"
          ? "bg-rose-500/15 text-rose-300"
          : "bg-slate-500/15 text-slate-300";

  return (
    <div className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold truncate">
              {entry.client
                ? `${entry.client.firstName} ${entry.client.lastName}`
                : "Client"}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusBadge}`}
            >
              {status.replace("_", " ")}
            </span>
          </div>
          <div className="mt-1 text-sm text-[color:var(--color-muted)] flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {format(start, "h:mm a")} – {format(end, "h:mm a")}
          </div>
          {entry.client?.addressLine1 && (
            <div className="mt-1 text-xs text-[color:var(--color-muted)] flex items-center gap-1 truncate">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">
                {entry.client.addressLine1}
                {entry.client.city ? `, ${entry.client.city}` : ""}
              </span>
            </div>
          )}
        </div>
        {status !== "COMPLETED" && status !== "CANCELLED" && (
          <ClockInButton
            scheduleId={entry.id}
            disabled={!canStart && status !== "IN_PROGRESS"}
          />
        )}
      </div>
    </div>
  );
}

function ClockInButton({ scheduleId, disabled }: { scheduleId: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function start() {
    setBusy(true);
    let coords: { latitude?: number; longitude?: number; accuracy?: number } = {};
    try {
      coords = await new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve({});
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (p) =>
            resolve({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
            }),
          () => resolve({}),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
        );
      });
    } catch {
      /* ignore */
    }
    try {
      const v = await api<VisitDetail>("/m/visits/clock-in", {
        method: "POST",
        body: JSON.stringify({ scheduleId, ...coords }),
      });
      await qc.invalidateQueries({ queryKey: ["m"] });
      window.location.assign(`${import.meta.env.BASE_URL}visit/${v.id}`);
    } catch (e) {
      // Surface error
      const { toast } = await import("sonner");
      toast.error(e instanceof Error ? e.message : "Failed to clock in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={start}
      disabled={disabled || busy}
      className="shrink-0 px-3 h-10 rounded-lg bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] text-sm font-semibold disabled:opacity-40"
    >
      {busy ? "…" : "Clock in"}
    </button>
  );
}
