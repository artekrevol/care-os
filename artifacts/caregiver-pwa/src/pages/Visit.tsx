import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Mic,
  Square,
  AlertTriangle,
  PenLine,
  Clock,
  MapPin,
  Phone,
  ShieldAlert,
  X,
  CloudOff,
} from "lucide-react";
import { api, type Me, type VisitDetail, type ChecklistTask } from "@/lib/api";
import OfflineBanner from "@/components/OfflineBanner";
import { mutateOrQueue } from "@/lib/sync";
import { db } from "@/lib/db";
import { enqueue, subscribe as subscribeOutbox } from "@/lib/outbox";
import { useOnline } from "@/lib/online";

type Props = { visitId: string; me: Me };

const isLocalVisitId = (id: string) => id.startsWith("local_");

export default function Visit({ visitId, me }: Props) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const local = isLocalVisitId(visitId);

  // Once the queued clock-in syncs, the outbox flusher writes a localId→realId
  // mapping. Watch for it and seamlessly transition the URL to the real visit.
  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    async function checkAndRedirect() {
      const m = await db.idMap.get(visitId);
      if (m && !cancelled) {
        window.location.replace(`${import.meta.env.BASE_URL}visit/${m.realId}`);
      }
    }
    void checkAndRedirect();
    const unsub = subscribeOutbox(() => {
      void checkAndRedirect();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [local, visitId]);

  const visit = useQuery({
    queryKey: ["m", "visit", visitId],
    queryFn: async () => {
      if (local) {
        const cached = await db.visits.get(visitId);
        if (cached) return cached.data as VisitDetail;
        throw new Error("Offline visit not found");
      }
      try {
        const data = await api<VisitDetail>(`/m/visits/${visitId}`);
        // Cache for offline reload.
        await db.visits.put({
          visitId,
          data,
          fetchedAt: Date.now(),
        });
        return data;
      } catch (err) {
        // Fall back to cached detail if available (e.g. mid-visit offline drop).
        const cached = await db.visits.get(visitId);
        if (cached) return cached.data as VisitDetail;
        throw err;
      }
    },
    refetchInterval: local ? false : 30_000,
    retry: local ? false : 1,
  });

  const [tab, setTab] = useState<"plan" | "notes" | "incidents">("plan");

  if (visit.isLoading || !visit.data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[color:var(--color-muted)] text-sm">Loading visit…</div>
      </div>
    );
  }

  const v = visit.data;
  const completed = !!v.clockOutTime;
  const elapsedMin = v.clockInTime
    ? Math.round((Date.now() - new Date(v.clockInTime).getTime()) / 60000)
    : 0;

  return (
    <div className="min-h-screen safe-bottom flex flex-col">
      <header className="safe-top px-4 pb-3 sticky top-0 z-10 bg-[color:var(--color-bg)]/95 backdrop-blur border-b border-[color:var(--color-border)]">
        <div className="flex items-center gap-3 pt-2">
          <button
            aria-label="Back"
            onClick={() => setLocation("/")}
            className="p-2 -ml-2 rounded-lg hover:bg-[color:var(--color-surface)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold truncate">
              {v.client?.firstName} {v.client?.lastName}
            </div>
            <div className="text-xs text-[color:var(--color-muted)] flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" /> {elapsedMin}m elapsed
              </span>
              {v.geoFenceMatch !== null && (
                <span
                  className={`flex items-center gap-1 ${v.geoFenceMatch ? "text-emerald-400" : "text-amber-400"}`}
                >
                  <MapPin className="w-3 h-3" />
                  {v.geoFenceMatch ? "On site" : "Off site"}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>
      <OfflineBanner />

      <main className="flex-1 px-4 py-4 space-y-4 max-w-md mx-auto w-full">
        <ClientCard visit={v} />

        <div className="flex gap-1 p-1 rounded-xl bg-[color:var(--color-surface)]">
          {(["plan", "notes", "incidents"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize ${
                tab === t
                  ? "bg-[color:var(--color-surface-2)] text-[color:var(--color-fg)]"
                  : "text-[color:var(--color-muted)]"
              }`}
            >
              {t}
              {t === "incidents" && v.incidents.length > 0 && (
                <span className="ml-1 text-[10px] bg-rose-500 text-white px-1.5 rounded-full">
                  {v.incidents.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {local && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 flex items-start gap-2">
            <CloudOff className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Running offline — your work is being saved on this device and
              will sync to the office when you're back online.
            </span>
          </div>
        )}
        {tab === "plan" && <PlanTab visit={v} localVisitId={local ? visitId : undefined} disabled={completed} onChange={() => qc.invalidateQueries({ queryKey: ["m", "visit", visitId] })} />}
        {tab === "notes" && <NotesTab visit={v} localVisitId={local ? visitId : undefined} disabled={completed} onChange={() => qc.invalidateQueries({ queryKey: ["m", "visit", visitId] })} />}
        {tab === "incidents" && <IncidentsTab visit={v} localVisitId={local ? visitId : undefined} disabled={completed} onChange={() => qc.invalidateQueries({ queryKey: ["m", "visit", visitId] })} />}
      </main>

      {!completed && (
        <ClockOutBar visit={v} me={me} localVisitId={local ? visitId : undefined} onDone={() => setLocation("/")} />
      )}
      {completed && (
        <div className="safe-bottom px-4 py-4 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
          <div className="text-center text-sm text-[color:var(--color-muted)]">
            Visit complete · {v.durationMinutes ?? 0} min
          </div>
        </div>
      )}
    </div>
  );
}

function ClientCard({ visit }: { visit: VisitDetail }) {
  const c = visit.client;
  if (!c) return null;
  return (
    <div className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-4 space-y-2">
      {c.addressLine1 && (
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="w-4 h-4 mt-0.5 text-[color:var(--color-muted)]" />
          <span>
            {c.addressLine1}
            {c.city ? `, ${c.city}` : ""} {c.state ?? ""} {c.postalCode ?? ""}
          </span>
        </div>
      )}
      {c.phone && (
        <a
          href={`tel:${c.phone}`}
          className="flex items-center gap-2 text-sm text-[color:var(--color-accent)]"
        >
          <Phone className="w-4 h-4" /> {c.phone}
        </a>
      )}
      {c.allergies && (
        <div className="flex items-start gap-2 text-sm text-amber-300">
          <ShieldAlert className="w-4 h-4 mt-0.5" />
          <span>Allergies: {c.allergies}</span>
        </div>
      )}
      {c.emergencyContactName && (
        <div className="text-xs text-[color:var(--color-muted)] pt-1 border-t border-[color:var(--color-border)]">
          Emergency: {c.emergencyContactName}
          {c.emergencyContactPhone ? ` · ${c.emergencyContactPhone}` : ""}
        </div>
      )}
    </div>
  );
}

function PlanTab({
  visit,
  localVisitId,
  disabled,
  onChange,
}: {
  visit: VisitDetail;
  localVisitId?: string;
  disabled: boolean;
  onChange: () => void;
}) {
  const [tasks, setTasks] = useState<ChecklistTask[]>(
    visit.checklist?.tasks ?? [],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTasks(visit.checklist?.tasks ?? []);
  }, [visit.checklist?.id]);

  async function save(next: ChecklistTask[]) {
    setTasks(next);
    if (disabled) return;
    setSaving(true);
    try {
      // Optimistically persist the synthetic visit detail so an offline
      // reload re-renders the latest checklist state.
      if (localVisitId) {
        await db.visits.put({
          visitId: localVisitId,
          data: {
            ...visit,
            checklist: visit.checklist
              ? { ...visit.checklist, tasks: next }
              : { id: `chk_${localVisitId}`, tasks: next, completedAt: null },
          },
          fetchedAt: Date.now(),
        });
      }
      const r = await mutateOrQueue({
        kind: "checklist",
        path: `/m/visits/${visit.id}/checklist`,
        method: "PUT",
        body: { tasks: next },
        visitId: localVisitId ? undefined : visit.id,
        localVisitId,
      });
      if (r.queued) toast.message("Saved offline — will sync");
      onChange();
    } catch {
      toast.error("Couldn't save checklist");
    } finally {
      setSaving(false);
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted)]">
        No care plan tasks for this visit.
      </div>
    );
  }

  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-[color:var(--color-muted)]">
        <span>
          {done}/{tasks.length} complete
        </span>
        {saving && <span>Saving…</span>}
      </div>
      {tasks.map((t, idx) => (
        <TaskRow
          key={t.id}
          task={t}
          disabled={disabled}
          onToggle={() => {
            const next = tasks.slice();
            next[idx] = {
              ...t,
              done: !t.done,
              completedAt: !t.done ? new Date().toISOString() : undefined,
            };
            void save(next);
          }}
          onPhoto={async (b64) => {
            try {
              const url = await uploadPhotoForTask(visit.id, t.id, b64);
              const next = tasks.slice();
              next[idx] = { ...t, photoUrl: url };
              void save(next);
            } catch {
              toast.error("Photo upload failed");
            }
          }}
        />
      ))}
    </div>
  );
}

async function uploadPhotoForTask(
  _visitId: string,
  _taskId: string,
  b64: string,
): Promise<string> {
  // Photos for tasks are embedded in the checklist itself as data URLs.
  // The server stores incident photos via uploadBytes; for task photos,
  // we keep them inline as data URLs (small, JPEG) for simplicity.
  return `data:image/jpeg;base64,${b64}`;
}

function TaskRow({
  task,
  disabled,
  onToggle,
  onPhoto,
}: {
  task: ChecklistTask;
  disabled: boolean;
  onToggle: () => void;
  onPhoto: (base64: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      className={`rounded-xl border p-3 ${
        task.done
          ? "bg-emerald-500/10 border-emerald-500/30"
          : "bg-[color:var(--color-surface)] border-[color:var(--color-border)]"
      }`}
    >
      <button
        onClick={onToggle}
        disabled={disabled}
        className="w-full flex items-start gap-3 text-left"
      >
        {task.done ? (
          <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
        ) : (
          <Circle className="w-6 h-6 text-[color:var(--color-muted)] flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm font-medium ${task.done ? "line-through text-[color:var(--color-muted)]" : ""}`}
          >
            {task.label}
          </div>
          {task.completedAt && (
            <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
              Done at {format(parseISO(task.completedAt), "h:mm a")}
            </div>
          )}
        </div>
      </button>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          ref={fileRef}
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const b64 = await fileToBase64(f);
            onPhoto(b64);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          className="text-xs text-[color:var(--color-accent)] disabled:opacity-40"
        >
          {task.photoUrl ? "Retake photo" : "Add photo"}
        </button>
        {task.photoUrl && (
          <img
            src={task.photoUrl}
            alt="evidence"
            className="w-10 h-10 rounded object-cover ml-auto"
          />
        )}
      </div>
    </div>
  );
}

function NotesTab({
  visit,
  localVisitId,
  disabled,
  onChange,
}: {
  visit: VisitDetail;
  localVisitId?: string;
  disabled: boolean;
  onChange: () => void;
}) {
  const [body, setBody] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRec(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await submitVoice(blob, rec.mimeType || "audio/webm");
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Microphone unavailable");
    }
  }

  function stopRec(): void {
    recRef.current?.stop();
    setRecording(false);
  }

  async function submitVoice(blob: Blob, mime: string): Promise<void> {
    setBusy(true);
    try {
      const b64 = await blobToBase64(blob);
      const r = await mutateOrQueue({
        kind: "note",
        path: `/m/visits/${visit.id}/notes`,
        method: "POST",
        body: {
          body: body || undefined,
          voiceClipBase64: b64,
          voiceClipMime: mime,
          autoTranscribe: true,
        },
        visitId: localVisitId ? undefined : visit.id,
        localVisitId,
      });
      setBody("");
      onChange();
      toast.success(r.queued ? "Voice note saved offline" : "Voice note saved");
    } catch {
      toast.error("Couldn't save voice note");
    } finally {
      setBusy(false);
    }
  }

  async function submitText(): Promise<void> {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await mutateOrQueue({
        kind: "note",
        path: `/m/visits/${visit.id}/notes`,
        method: "POST",
        body: { body },
        visitId: localVisitId ? undefined : visit.id,
        localVisitId,
      });
      setBody("");
      onChange();
      if (r.queued) toast.message("Note saved offline — will sync");
    } catch {
      toast.error("Couldn't save note");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-3 space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note about this visit…"
            rows={3}
            className="w-full bg-transparent outline-none text-sm resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={recording ? stopRec : startRec}
              disabled={busy}
              className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-sm font-medium ${
                recording
                  ? "bg-rose-500 text-white"
                  : "bg-[color:var(--color-surface-2)] text-[color:var(--color-fg)]"
              }`}
            >
              {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {recording ? "Stop" : "Record"}
            </button>
            <button
              onClick={submitText}
              disabled={busy || !body.trim()}
              className="ml-auto px-4 h-9 rounded-lg bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] text-sm font-semibold disabled:opacity-40"
            >
              Save note
            </button>
          </div>
        </div>
      )}

      {visit.notes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted)]">
          No notes yet.
        </div>
      ) : (
        visit.notes.map((n) => (
          <div
            key={n.id}
            className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-3"
          >
            <div className="text-xs text-[color:var(--color-muted)] mb-1">
              {format(parseISO(n.createdAt), "MMM d, h:mm a")} · {n.authorRole}
            </div>
            <div className="text-sm whitespace-pre-wrap">{n.body}</div>
            {n.voiceClipUrl && (
              <audio controls src={n.voiceClipUrl} className="mt-2 w-full h-8" />
            )}
          </div>
        ))
      )}
    </div>
  );
}

function IncidentsTab({
  visit,
  localVisitId,
  disabled,
  onChange,
}: {
  visit: VisitDetail;
  localVisitId?: string;
  disabled: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState<null | string>(null);

  const QUICK = [
    { cat: "FALL", label: "Fall", severity: "HIGH" as const },
    { cat: "MEDICATION_ERROR", label: "Med error", severity: "HIGH" as const },
    { cat: "INJURY", label: "Injury", severity: "MEDIUM" as const },
    { cat: "BEHAVIORAL", label: "Behavioral", severity: "MEDIUM" as const },
    { cat: "PROPERTY_DAMAGE", label: "Property", severity: "LOW" as const },
    { cat: "OTHER", label: "Other", severity: "LOW" as const },
  ];

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-3">
          <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Quick-tap incident
          </div>
          <div className="grid grid-cols-3 gap-2">
            {QUICK.map((q) => (
              <button
                key={q.cat}
                onClick={() => setOpen(q.cat)}
                className="rounded-lg bg-[color:var(--color-surface-2)] hover:bg-[color:var(--color-border)] py-2.5 text-xs font-medium"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {visit.incidents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted)]">
          No incidents reported.
        </div>
      ) : (
        visit.incidents.map((i) => (
          <div
            key={i.id}
            className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              {i.category}
              <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-rose-500 text-white">
                {i.severity}
              </span>
            </div>
            <div className="text-xs text-[color:var(--color-muted)] mt-1">
              {format(parseISO(i.createdAt), "MMM d, h:mm a")}
            </div>
            <div className="text-sm mt-2 whitespace-pre-wrap">{i.description}</div>
            {i.photoUrls.length > 0 && (
              <div className="mt-2 flex gap-2">
                {i.photoUrls.map((u, idx) => (
                  <img key={idx} src={u} alt="" className="w-16 h-16 object-cover rounded" />
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {open && (
        <IncidentSheet
          visitId={visit.id}
          localVisitId={localVisitId}
          category={open}
          defaultSeverity={QUICK.find((q) => q.cat === open)?.severity ?? "MEDIUM"}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function IncidentSheet({
  visitId,
  localVisitId,
  category,
  defaultSeverity,
  onClose,
  onSaved,
}: {
  visitId: string;
  localVisitId?: string;
  category: string;
  defaultSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [severity, setSeverity] = useState(defaultSeverity);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function submit() {
    if (!description.trim()) {
      toast.error("Add a brief description");
      return;
    }
    setBusy(true);
    try {
      const r = await mutateOrQueue({
        kind: "incident",
        path: `/m/visits/${visitId}/incidents`,
        method: "POST",
        body: { severity, category, description, photoBase64s: photos },
        visitId: localVisitId ? undefined : visitId,
        localVisitId,
      });
      toast.success(r.queued ? "Incident saved offline" : "Incident reported");
      onSaved();
    } catch {
      toast.error("Couldn't save incident");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-[color:var(--color-surface)] rounded-t-2xl p-4 safe-bottom max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">Report: {category}</h3>
          <button onClick={onClose} className="p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs text-[color:var(--color-muted)] mb-1.5">Severity</div>
            <div className="grid grid-cols-4 gap-2">
              {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={`py-2 rounded-lg text-xs font-semibold ${
                    severity === s
                      ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]"
                      : "bg-[color:var(--color-surface-2)]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened?"
            rows={4}
            className="w-full bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded-lg p-3 text-sm outline-none"
          />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={fileRef}
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const b64 = await fileToBase64(f);
              setPhotos((p) => [...p, b64]);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-3 h-9 rounded-lg bg-[color:var(--color-surface-2)] text-sm"
            >
              Add photo ({photos.length})
            </button>
          </div>
          <button
            onClick={submit}
            disabled={busy}
            className="w-full h-12 rounded-xl bg-rose-500 text-white font-semibold disabled:opacity-50"
          >
            {busy ? "Saving…" : "Report incident"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClockOutBar({
  visit,
  me,
  localVisitId,
  onDone,
}: {
  visit: VisitDetail;
  me: Me;
  localVisitId?: string;
  onDone: () => void;
}) {
  const [signing, setSigning] = useState(false);
  return (
    <>
      <div className="safe-bottom px-4 pt-3 pb-3 sticky bottom-0 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]/95 backdrop-blur">
        <button
          onClick={() => setSigning(true)}
          className="w-full h-14 rounded-xl bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] font-bold flex items-center justify-center gap-2"
        >
          <PenLine className="w-5 h-5" />
          Clock out & sign
        </button>
      </div>
      {signing && (
        <ClockOutSheet
          visit={visit}
          me={me}
          localVisitId={localVisitId}
          onClose={() => setSigning(false)}
          onDone={onDone}
        />
      )}
    </>
  );
}

function ClockOutSheet({
  visit,
  me,
  localVisitId,
  onClose,
  onDone,
}: {
  visit: VisitDetail;
  me: Me;
  localVisitId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const online = useOnline();
  const [signerName, setSignerName] = useState(
    `${visit.client?.firstName ?? ""} ${visit.client?.lastName ?? ""}`.trim(),
  );
  const [signerRole, setSignerRole] = useState<"CLIENT" | "FAMILY" | "CAREGIVER">(
    "CLIENT",
  );
  const [declined, setDeclined] = useState(false);
  const [declinedReason, setDeclinedReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const currentRef = useRef<Array<{ x: number; y: number }>>([]);

  function pointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    currentRef.current = [pointer(e)];
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(currentRef.current[0].x, currentRef.current[0].y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const p = pointer(e);
    currentRef.current.push(p);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function end() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentRef.current.length > 1) pointsRef.current.push(currentRef.current);
    currentRef.current = [];
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    pointsRef.current = [];
  }
  function toSvg(): string | null {
    const c = canvasRef.current!;
    const strokes = pointsRef.current;
    if (strokes.length === 0) return null;
    const paths = strokes
      .map(
        (s) =>
          `<path d="M${s.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")}" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round"/>`,
      )
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.width} ${c.height}" width="${c.width}" height="${c.height}">${paths}</svg>`;
  }

  async function submit() {
    if (!declined && pointsRef.current.length === 0) {
      toast.error("Please capture a signature or mark as declined");
      return;
    }
    if (declined && !declinedReason.trim()) {
      toast.error("Reason required for declined signature");
      return;
    }
    setBusy(true);
    const occurredAt = new Date().toISOString();
    const svg = declined ? null : toSvg();
    const sigBody = {
      signerRole,
      signerName: declined ? me.firstName + " " + me.lastName : signerName,
      signatureSvg: svg ?? undefined,
      declined,
      declinedReason: declined ? declinedReason : undefined,
    };
    const coords = await new Promise<{
      latitude?: number;
      longitude?: number;
    }>((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
          }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    });
    const clockOutBody = {
      ...coords,
      caregiverNotes: notes || undefined,
    };

    if (!online || localVisitId) {
      await enqueue({
        kind: "signature",
        path: `/m/visits/${visit.id}/signature`,
        method: "POST",
        body: sigBody,
        occurredAt,
        visitId: localVisitId ? undefined : visit.id,
        localVisitId,
      });
      await enqueue({
        kind: "clock-out",
        path: `/m/visits/${visit.id}/clock-out`,
        method: "POST",
        body: clockOutBody,
        occurredAt,
        visitId: localVisitId ? undefined : visit.id,
        localVisitId,
      });
      toast.success("Saved offline — will sync when you're back online");
      setBusy(false);
      onDone();
      return;
    }

    try {
      await api(`/m/visits/${visit.id}/signature`, {
        method: "POST",
        body: JSON.stringify(sigBody),
      });
      await api(`/m/visits/${visit.id}/clock-out`, {
        method: "POST",
        body: JSON.stringify({ ...clockOutBody, occurredAt }),
      });
      toast.success("Visit complete");
      onDone();
    } catch (e) {
      // Likely transient — queue for retry so the caregiver isn't stuck.
      await enqueue({
        kind: "signature",
        path: `/m/visits/${visit.id}/signature`,
        method: "POST",
        body: sigBody,
        occurredAt,
        visitId: visit.id,
      });
      await enqueue({
        kind: "clock-out",
        path: `/m/visits/${visit.id}/clock-out`,
        method: "POST",
        body: clockOutBody,
        occurredAt,
        visitId: visit.id,
      });
      toast.error(
        e instanceof Error
          ? `${e.message} — queued for retry`
          : "Couldn't reach server — queued for retry",
      );
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end">
      <div className="w-full bg-[color:var(--color-surface)] rounded-t-2xl p-4 safe-bottom max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">Clock out</h3>
          <button onClick={onClose} className="p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs text-[color:var(--color-muted)] mb-1.5">Signer</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {(["CLIENT", "FAMILY", "CAREGIVER"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setSignerRole(r)}
                  className={`py-2 rounded-lg text-xs font-semibold ${
                    signerRole === r
                      ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]"
                      : "bg-[color:var(--color-surface-2)]"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Signer name"
              className="w-full h-11 px-3 rounded-lg bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm outline-none"
            />
          </div>

          {!declined && (
            <div>
              <div className="text-xs text-[color:var(--color-muted)] mb-1.5">
                Sign below
              </div>
              <div className="rounded-lg bg-white">
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={180}
                  className="w-full h-44 touch-none rounded-lg"
                  onPointerDown={start}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerLeave={end}
                />
              </div>
              <button
                onClick={clear}
                className="mt-1 text-xs text-[color:var(--color-muted)] underline"
              >
                Clear
              </button>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={declined}
              onChange={(e) => setDeclined(e.target.checked)}
            />
            Signature declined
          </label>
          {declined && (
            <textarea
              value={declinedReason}
              onChange={(e) => setDeclinedReason(e.target.value)}
              placeholder="Reason"
              rows={2}
              className="w-full bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded-lg p-2 text-sm outline-none"
            />
          )}

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for office (optional)"
            rows={2}
            className="w-full bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded-lg p-2 text-sm outline-none"
          />

          <button
            onClick={submit}
            disabled={busy}
            className="w-full h-12 rounded-xl bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] font-bold disabled:opacity-50"
          >
            {busy ? "Saving…" : "Complete visit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

function blobToBase64(b: Blob): Promise<string> {
  return fileToBase64(b);
}
