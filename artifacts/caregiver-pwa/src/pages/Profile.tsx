import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  LogOut,
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  ShieldCheck,
  BellOff,
  Bell,
} from "lucide-react";
import {
  ensurePushSubscriptionStatus,
  type PushStatus,
} from "@/lib/push";
import { api, type Me } from "@/lib/api";
import OfflineBanner from "@/components/OfflineBanner";
import BottomNav from "@/components/BottomNav";

type ProfileResponse = {
  caregiver: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    addressCity: string | null;
    addressState: string | null;
    hireDate: string | null;
    employmentType: string;
    languages: string[];
    skills: string[];
    certifications: string[];
    payRate: number;
  };
  credentials: Array<{
    id: string;
    documentType: string;
    classifiedType: string | null;
    issuedDate: string | null;
    expirationDate: string | null;
    status: "VALID" | "EXPIRING" | "EXPIRED";
    classificationStatus: string;
    needsReview: boolean;
    fileUrl: string | null;
    originalFilename: string | null;
  }>;
};

type PaySummary = {
  periods: Array<{
    payPeriodId: string;
    startDate: string;
    endDate: string;
    status: string;
    regularMinutes: number;
    overtimeMinutes: number;
    regularPay: number;
    overtimePay: number;
    doubleTimePay: number;
    travelPay: number;
    totalPay: number;
    entryCount: number;
  }>;
};

type Props = { me: Me; onLogout: () => void };

export default function Profile({ me, onLogout }: Props) {
  const qc = useQueryClient();
  const profile = useQuery({
    queryKey: ["m", "profile"],
    queryFn: () => api<ProfileResponse>("/m/profile"),
  });
  const pay = useQuery({
    queryKey: ["m", "pay"],
    queryFn: () => api<PaySummary>("/m/pay-summary"),
  });

  async function logout() {
    try {
      await api("/m/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    onLogout();
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="safe-top px-5 pb-3 sticky top-0 z-10 bg-[color:var(--color-bg)]/95 backdrop-blur border-b border-[color:var(--color-border)]">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-xl font-bold">Profile</h1>
          <button
            onClick={logout}
            aria-label="Sign out"
            className="p-2 rounded-lg hover:bg-[color:var(--color-surface)]"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>
      <OfflineBanner />
      <main className="flex-1 px-5 py-5 space-y-5 max-w-md mx-auto w-full">
        <section className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-4">
          <div className="text-base font-bold">
            {me.firstName} {me.lastName}
          </div>
          <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
            {profile.data?.caregiver.phone ?? me.phone ?? "—"}
          </div>
          {profile.data?.caregiver && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <Stat label="Pay rate" value={`$${profile.data.caregiver.payRate.toFixed(2)}/hr`} />
              <Stat label="Type" value={profile.data.caregiver.employmentType} />
              {profile.data.caregiver.hireDate && (
                <Stat
                  label="Hired"
                  value={format(parseISO(profile.data.caregiver.hireDate), "MMM d, yyyy")}
                />
              )}
              {profile.data.caregiver.addressCity && (
                <Stat
                  label="Based in"
                  value={`${profile.data.caregiver.addressCity}${profile.data.caregiver.addressState ? `, ${profile.data.caregiver.addressState}` : ""}`}
                />
              )}
            </div>
          )}
        </section>

        <PushStatusSection />

        <CredentialsSection
          credentials={profile.data?.credentials ?? []}
          loading={profile.isLoading}
          onChanged={() => qc.invalidateQueries({ queryKey: ["m", "profile"] })}
        />

        <PaySection summary={pay.data} loading={pay.isLoading} />
      </main>
      <BottomNav />
    </div>
  );
}

/**
 * Persistent, always-visible push notification status. When push is
 * denied, unsupported, or otherwise unsubscribed, we tell the caregiver
 * exactly what is happening and what the fallback is, in plain language.
 * This replaces the previous one-shot toast — caregivers can come back
 * to this section at any time to see why a notification did or did not
 * arrive on their device.
 */
function PushStatusSection() {
  const [status, setStatus] = useState<PushStatus | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    void ensurePushSubscriptionStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return (): void => {
      cancelled = true;
    };
  }, []);

  async function retry(): Promise<void> {
    setStatus("checking");
    const next = await ensurePushSubscriptionStatus();
    setStatus(next);
    if (next === "subscribed") {
      toast.success("Notifications enabled");
    }
  }

  if (status === "checking" || status === "subscribed") {
    return (
      <section
        aria-label="Notification status"
        className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-4 flex items-start gap-3"
      >
        <Bell className="w-5 h-5 mt-0.5 text-[color:var(--color-success,#16a34a)]" />
        <div className="text-sm">
          <div className="font-semibold">Push notifications</div>
          <div className="text-[color:var(--color-muted)] mt-0.5">
            {status === "checking"
              ? "Checking your device…"
              : "You'll get shift reminders and alerts on this device."}
          </div>
        </div>
      </section>
    );
  }

  const headline =
    status === "denied"
      ? "Push notifications are blocked"
      : status === "unsupported"
        ? "This device does not support push"
        : status === "no-vapid-key"
          ? "Push is not configured for this account"
          : status === "dismissed"
            ? "Push notifications are not enabled"
            : "We could not enable push on this device";

  const detail =
    status === "denied"
      ? "You blocked notifications for this app. Until you allow them again in your browser or device settings, we will email you for shift reminders, schedule changes, and incident follow-ups."
      : status === "unsupported"
        ? "Your browser or device cannot receive push notifications. We will email you instead for shift reminders, schedule changes, and incident follow-ups."
        : status === "no-vapid-key"
          ? "Your office has not finished setting up push notifications yet. We will email you instead until they do."
          : status === "dismissed"
            ? "You haven't allowed push yet. Tap Try again to grant permission, or we'll keep emailing you instead."
            : "Something went wrong subscribing this device. We will keep emailing you while we retry.";

  return (
    <section
      aria-label="Notification status"
      role="status"
      data-testid="push-status-section"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3"
    >
      <BellOff className="w-5 h-5 mt-0.5 text-amber-700 shrink-0" />
      <div className="text-sm flex-1">
        <div className="font-semibold text-amber-900">{headline}</div>
        <p className="text-amber-900/90 mt-1 leading-snug">{detail}</p>
        {(status === "dismissed" || status === "error") && (
          <button
            type="button"
            onClick={() => void retry()}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700"
          >
            <Bell className="w-3.5 h-3.5" /> Try again
          </button>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function CredentialsSection({
  credentials,
  loading,
  onChanged,
}: {
  credentials: ProfileResponse["credentials"];
  loading: boolean;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [docType, setDocType] = useState<string>("OTHER");
  const [busy, setBusy] = useState(false);

  async function uploadFile(file: File) {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      await api("/m/documents/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64: b64,
          documentType: docType,
        }),
      });
      toast.success("Uploaded — auto-classifying");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">
          Credentials
        </h2>
        <span className="text-xs text-[color:var(--color-muted)]">
          {credentials.length} on file
        </span>
      </div>

      <div className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-4 mb-3">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1">
          <Upload className="w-3.5 h-3.5" /> Upload a credential
        </div>
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className="w-full h-10 px-3 rounded-lg bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm mb-2"
        >
          <option value="OTHER">Other</option>
          <option value="CPR">CPR</option>
          <option value="HHA">HHA certificate</option>
          <option value="CNA">CNA license</option>
          <option value="TB_TEST">TB test</option>
          <option value="DRIVERS_LICENSE">Driver's license</option>
          <option value="AUTO_INSURANCE">Auto insurance</option>
          <option value="BACKGROUND_CHECK">Background check</option>
          <option value="VACCINATION">Vaccination record</option>
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
          }}
          className="hidden"
        />
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="w-full h-11 rounded-lg bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Upload className="w-4 h-4" />
          {busy ? "Uploading…" : "Choose file or take photo"}
        </button>
      </div>

      <div className="space-y-2">
        {loading && <div className="h-16 rounded-xl bg-[color:var(--color-surface)] animate-pulse" />}
        {!loading && credentials.length === 0 && (
          <div className="rounded-xl border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted)]">
            No credentials on file yet.
          </div>
        )}
        {credentials.map((c) => (
          <CredentialCard key={c.id} doc={c} />
        ))}
      </div>
    </section>
  );
}

function CredentialCard({ doc }: { doc: ProfileResponse["credentials"][number] }) {
  const status =
    doc.status === "EXPIRED"
      ? { label: "Expired", color: "bg-rose-500/15 text-rose-300", icon: AlertTriangle }
      : doc.status === "EXPIRING"
        ? { label: "Expiring soon", color: "bg-amber-500/15 text-amber-300", icon: AlertTriangle }
        : { label: "Valid", color: "bg-emerald-500/15 text-emerald-300", icon: CheckCircle2 };
  const StatusIcon = status.icon;
  const cls = doc.classificationStatus;
  return (
    <div className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <FileText className="w-4 h-4 mt-0.5 text-[color:var(--color-muted)] shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {doc.classifiedType ?? doc.documentType}
            </div>
            <div className="text-xs text-[color:var(--color-muted)] truncate">
              {doc.originalFilename ?? "—"}
            </div>
            {doc.expirationDate && (
              <div className="text-[10px] mt-1 text-[color:var(--color-muted)]">
                Expires {format(parseISO(doc.expirationDate), "MMM d, yyyy")}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 ${status.color}`}>
            <StatusIcon className="w-3 h-3" />
            {status.label}
          </span>
          {(cls === "PENDING" || cls === "RUNNING") && (
            <span className="text-[10px] text-cyan-300 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Classifying…
            </span>
          )}
          {doc.needsReview && (
            <span className="text-[10px] text-amber-300">Needs review</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PaySection({
  summary,
  loading,
}: {
  summary: PaySummary | undefined;
  loading: boolean;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
        Pay history
      </h2>
      {loading && <div className="h-16 rounded-xl bg-[color:var(--color-surface)] animate-pulse" />}
      {!loading && (!summary || summary.periods.length === 0) && (
        <div className="rounded-xl border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted)]">
          No pay periods yet.
        </div>
      )}
      <div className="space-y-2">
        {summary?.periods.map((p) => {
          const hours = (p.regularMinutes + p.overtimeMinutes) / 60;
          return (
            <div
              key={p.payPeriodId}
              className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-3"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold flex items-center gap-1.5">
                  <CircleDollarSign className="w-4 h-4 text-emerald-400" />
                  {format(parseISO(p.startDate), "MMM d")} –{" "}
                  {format(parseISO(p.endDate), "MMM d, yyyy")}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-300">
                  {p.status}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Stat label="Hours" value={hours.toFixed(1)} />
                <Stat label="OT min" value={String(p.overtimeMinutes)} />
                <Stat label="Total pay" value={`$${p.totalPay.toFixed(2)}`} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
