import { Layout } from "@/components/layout/Layout";
import {
  useListVisits,
  useVerifyVisit,
  useClockIn,
  useClockOut,
  useGetVisitChecklist,
  useCompleteVisitChecklistTask,
  useSkipVisitChecklistTask,
  getListVisitsQueryKey,
  getGetVisitChecklistQueryKey,
  VisitVerificationStatus,
  ClockMethod,
  type VisitChecklistTask,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, MapPin, CheckCircle, XCircle, Pointer, Phone, Smartphone, Hand, KeyRound, ClipboardList, Camera, SkipForward, ImageIcon } from "lucide-react";

export default function Visits() {
  const [statusFilter, setStatusFilter] = useState<VisitVerificationStatus | "">("");
  const { data: visits, isLoading } = useListVisits({ status: statusFilter ? statusFilter : undefined });
  const verifyVisit = useVerifyVisit();
  const queryClient = useQueryClient();

  const handleVerify = (id: string, decision: "VERIFIED" | "REJECTED", notes: string) => {
    verifyVisit.mutate(
      { id, data: { decision, supervisorNotes: notes } },
      {
        onSuccess: () => {
          toast.success(`Visit ${decision.toLowerCase()}`);
          queryClient.invalidateQueries({ queryKey: getListVisitsQueryKey() });
        },
        onError: () => {
          toast.error("Failed to update visit verification");
        }
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Visits & EVV</h1>
            <p className="text-muted-foreground mt-1">Verification queue for electronic visit verification.</p>
          </div>
          <ManualClockDialog />
        </div>

        <Card>
          <div className="p-4 border-b flex gap-2">
            <Badge 
              variant={statusFilter === "" ? "default" : "outline"} 
              className="cursor-pointer"
              onClick={() => setStatusFilter("")}
            >
              All
            </Badge>
            <Badge 
              variant={statusFilter === "PENDING" ? "default" : "outline"} 
              className="cursor-pointer"
              onClick={() => setStatusFilter("PENDING")}
            >
              Pending
            </Badge>
            <Badge 
              variant={statusFilter === "EXCEPTION" ? "default" : "outline"} 
              className="cursor-pointer"
              onClick={() => setStatusFilter("EXCEPTION")}
            >
              Exception
            </Badge>
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caregiver</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Time (In - Out)</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Checklist</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading visits...</TableCell>
                  </TableRow>
                ) : visits?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No visits found.</TableCell>
                  </TableRow>
                ) : (
                  visits?.map((visit) => (
                    <TableRow key={visit.id}>
                      <TableCell className="font-medium">{visit.caregiverName}</TableCell>
                      <TableCell>{visit.clientName}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {visit.clockInTime ? format(new Date(visit.clockInTime), "MMM d, h:mm a") : "Missing"} - <br/>
                          {visit.clockOutTime ? format(new Date(visit.clockOutTime), "h:mm a") : "Active"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ClockMethodBadge method={visit.clockInMethod} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {visit.durationMinutes || 0}m</span>
                          <span className={`flex items-center gap-1 ${!visit.geoFenceMatch ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            <MapPin className="w-3 h-3" /> {visit.geoFenceMatch ? "Location Match" : "Location Mismatch"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          visit.verificationStatus === 'VERIFIED' ? 'default' : 
                          visit.verificationStatus === 'EXCEPTION' ? 'destructive' : 
                          visit.verificationStatus === 'REJECTED' ? 'secondary' : 'outline'
                        }>
                          {visit.verificationStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ChecklistDialog visitId={visit.id} clientName={visit.clientName} />
                      </TableCell>
                      <TableCell className="text-right">
                        {(visit.verificationStatus === 'PENDING' || visit.verificationStatus === 'EXCEPTION') && (
                          <div className="flex justify-end gap-2">
                            <VerifyDialog 
                              visitId={visit.id} 
                              onConfirm={(notes) => handleVerify(visit.id, "VERIFIED", notes)} 
                              action="Verify"
                            />
                            <VerifyDialog 
                              visitId={visit.id} 
                              onConfirm={(notes) => handleVerify(visit.id, "REJECTED", notes)} 
                              action="Reject"
                            />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function VerifyDialog({ visitId, onConfirm, action }: { visitId: string, onConfirm: (notes: string) => void, action: string }) {
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={action === "Verify" ? "default" : "secondary"} size="sm" className="h-8">
          {action === "Verify" ? <CheckCircle className="w-4 h-4 mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
          {action}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action} Visit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Supervisor Notes</label>
            <Textarea 
              placeholder="Add any verification notes here..." 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)} 
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              onConfirm(notes);
              setOpen(false);
            }}>
              Confirm {action}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChecklistDialog({ visitId, clientName }: { visitId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8">
          <ClipboardList className="w-4 h-4 mr-1" /> View
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Care plan checklist · {clientName}</DialogTitle>
        </DialogHeader>
        {open && <ChecklistBody visitId={visitId} />}
      </DialogContent>
    </Dialog>
  );
}

function ChecklistBody({ visitId }: { visitId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useGetVisitChecklist(visitId, {
    query: { queryKey: getGetVisitChecklistQueryKey(visitId), retry: false },
  });
  const complete = useCompleteVisitChecklistTask();
  const skip = useSkipVisitChecklistTask();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetVisitChecklistQueryKey(visitId) });
    qc.invalidateQueries({ queryKey: getListVisitsQueryKey() });
  };

  if (isLoading) {
    return <div className="py-10 text-center text-muted-foreground">Loading checklist…</div>;
  }
  if (error || !data) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40" />
        No checklist for this visit. Clock-ins only snapshot a checklist when the client has an active care plan.
      </div>
    );
  }

  const tasks = data.tasks ?? [];
  const grouped: Record<string, VisitChecklistTask[]> = {};
  for (const t of tasks) {
    const k = t.category || "OTHER";
    (grouped[k] ??= []).push(t);
  }
  const categories = Object.keys(grouped).sort();
  const doneCount = tasks.filter((t) => t.completed).length;
  const skippedCount = tasks.filter((t) => !t.completed && t.skippedReason).length;

  const handleComplete = (taskId: string, photoUrl: string | null) => {
    complete.mutate(
      { id: visitId, taskId, data: { photoUrl } },
      {
        onSuccess: () => {
          toast.success("Task completed");
          refresh();
        },
        onError: (e: unknown) => {
          const msg = (e as { message?: string })?.message ?? "Failed to complete task";
          toast.error(msg);
        },
      },
    );
  };

  const handleSkip = (taskId: string, reason: string) => {
    skip.mutate(
      { id: visitId, taskId, data: { reason } },
      {
        onSuccess: () => {
          toast.success("Task skipped");
          refresh();
        },
        onError: () => toast.error("Failed to skip task"),
      },
    );
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {doneCount} of {tasks.length} done
          {skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}
        </span>
        {data.carePlanVersion != null && (
          <Badge variant="outline">Care plan v{data.carePlanVersion}</Badge>
        )}
      </div>
      <ScrollArea className="max-h-[60vh] pr-3">
        <div className="space-y-4">
          {categories.map((cat) => (
            <div key={cat}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {cat}
              </div>
              <div className="space-y-2">
                {grouped[cat].map((t) => (
                  <ChecklistTaskRow
                    key={t.taskId}
                    task={t}
                    onComplete={(photoUrl) => handleComplete(t.taskId, photoUrl)}
                    onSkip={(reason) => handleSkip(t.taskId, reason)}
                    busy={complete.isPending || skip.isPending}
                  />
                ))}
              </div>
              <Separator className="mt-3" />
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ChecklistTaskRow({
  task,
  onComplete,
  onSkip,
  busy,
}: {
  task: VisitChecklistTask;
  onComplete: (photoUrl: string | null) => void;
  onSkip: (reason: string) => void;
  busy: boolean;
}) {
  const isDone = task.completed;
  const isSkipped = !task.completed && !!task.skippedReason;
  const locked = isDone || isSkipped;

  return (
    <div className={`rounded-md border p-3 ${isDone ? "bg-muted/40" : isSkipped ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium text-sm ${isDone ? "line-through text-muted-foreground" : ""}`}>
              {task.title}
            </span>
            {task.requiresPhoto && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Camera className="w-3 h-3" /> Photo required
              </Badge>
            )}
            {isDone && (
              <Badge variant="default" className="text-[10px] gap-1">
                <CheckCircle className="w-3 h-3" /> Done
              </Badge>
            )}
            {isSkipped && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <SkipForward className="w-3 h-3" /> Skipped
              </Badge>
            )}
          </div>
          {task.instructions && (
            <p className="text-xs text-muted-foreground mt-1">{task.instructions}</p>
          )}
          {task.photoUrl && (
            <a
              href={task.photoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
            >
              <ImageIcon className="w-3 h-3" /> View attached photo
            </a>
          )}
          {task.skippedReason && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
              Reason: {task.skippedReason}
            </p>
          )}
        </div>
        {!locked && (
          <div className="flex flex-col gap-2 shrink-0">
            <CompleteTaskButton task={task} onComplete={onComplete} busy={busy} />
            <SkipTaskButton onSkip={onSkip} busy={busy} />
          </div>
        )}
      </div>
    </div>
  );
}

function CompleteTaskButton({
  task,
  onComplete,
  busy,
}: {
  task: VisitChecklistTask;
  onComplete: (photoUrl: string | null) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");

  if (!task.requiresPhoto) {
    return (
      <Button size="sm" disabled={busy} onClick={() => onComplete(null)}>
        <CheckCircle className="w-4 h-4 mr-1" /> Mark done
      </Button>
    );
  }

  const handleFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPhotoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={busy}>
          <Camera className="w-4 h-4 mr-1" /> Attach & finish
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach photo for "{task.title}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">
            This task requires a photo before it can be checked off.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-medium">Take or choose a photo</label>
            <Input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Or paste a photo URL</label>
            <Input
              placeholder="https://…"
              value={photoUrl.startsWith("data:") ? "" : photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
            />
          </div>
          {photoUrl && (
            <div className="text-xs text-muted-foreground">Photo ready to attach.</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!photoUrl || busy}
            onClick={() => {
              onComplete(photoUrl);
              setOpen(false);
              setPhotoUrl("");
            }}
          >
            <CheckCircle className="w-4 h-4 mr-1" /> Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkipTaskButton({ onSkip, busy }: { onSkip: (reason: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          <SkipForward className="w-4 h-4 mr-1" /> Skip
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skip task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">
            Tell the supervisor why this task wasn't completed.
          </p>
          <Textarea
            placeholder="e.g. Client refused; medication already taken before arrival."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!reason.trim() || busy}
            onClick={() => {
              onSkip(reason.trim());
              setOpen(false);
              setReason("");
            }}
          >
            Confirm skip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClockMethodBadge({ method }: { method: ClockMethod }) {
  const meta: Record<ClockMethod, { label: string; icon: typeof Phone; className: string }> = {
    GPS: { label: "GPS", icon: Smartphone, className: "" },
    TELEPHONY: { label: "IVR Phone", icon: Phone, className: "border-amber-500 text-amber-700 dark:text-amber-400" },
    FOB: { label: "FOB", icon: KeyRound, className: "" },
    MANUAL: { label: "Manual", icon: Hand, className: "" },
  };
  const m = meta[method] ?? meta.GPS;
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={`text-xs ${m.className}`}>
      <Icon className="w-3 h-3 mr-1" /> {m.label}
    </Badge>
  );
}

// Just for demo purposes so user can create visit data
function ManualClockDialog() {
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // In a real app this would be tied to caregiver context, here we just show the action to create mock visits
  const handleSimulate = () => {
    toast.info("This is a demo UI. Caregivers would use the mobile app to clock in/out with GPS validation.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Pointer className="w-4 h-4 mr-2" /> Mobile App Simulator</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simulator</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4 text-center text-muted-foreground">
          <p>This command center UI is for office staff.</p>
          <p>Caregivers clock in and out using the companion mobile app, which records GPS coordinates to trigger exceptions if they are outside the client's geofence.</p>
          <Button className="w-full mt-4" onClick={() => setOpen(false)}>Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}