import { Layout } from "@/components/layout/Layout";
import {
  useListSchedules,
  useCreateSchedule,
  useListClients,
  useListCaregivers,
  useUpdateSchedule,
  useDryRunSchedule,
  useSuggestCaregivers,
  useGetOvertimeProjection,
  getListSchedulesQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetOvertimeProjectionQueryKey,
} from "@workspace/api-client-react";
import type {
  Schedule as ScheduleRow,
  ScheduleConflict,
  CaregiverSuggestion,
  ScheduleDryRunResult,
  Caregiver,
  Client,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus,
  AlertTriangle,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Clock,
  ArrowLeftRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";

const scheduleSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  caregiverId: z.string().min(1, "Caregiver is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  serviceCode: z.string().min(1, "Service code is required"),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_OT_THRESHOLD_MIN = 40 * 60;
const RESIZE_SNAP_MIN = 30;

type AxisMode = "caregivers-y" | "days-y";

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay();
  const offset = (day + 6) % 7;
  out.setDate(out.getDate() - offset);
  out.setHours(0, 0, 0, 0);
  return out;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
}

function dropId(caregiverId: string, day: Date): string {
  return `${caregiverId}__${day.toISOString().slice(0, 10)}`;
}

function ConflictsList({ conflicts }: { conflicts: ScheduleConflict[] }) {
  if (!conflicts.length) return null;
  return (
    <div className="space-y-2">
      {conflicts.map((c, i) => (
        <Alert
          key={i}
          variant={c.severity === "BLOCK" ? "destructive" : "default"}
          className={
            c.severity === "WARNING"
              ? "border-amber-500 text-amber-700 bg-amber-50"
              : ""
          }
        >
          {c.severity === "BLOCK" ? (
            <ShieldAlert className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4 !text-amber-500" />
          )}
          <AlertTitle>
            {c.severity === "BLOCK" ? "Compliance Block" : "Warning"} —{" "}
            {c.type.replace(/_/g, " ")}
          </AlertTitle>
          <AlertDescription>{c.message}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

type ResizeState = {
  shiftId: string;
  originalEnd: Date;
  startY: number;
  pxPerMin: number;
  newEnd: Date;
};

function DraggableShift({
  shift,
  onSuggest,
  onResizeCommit,
  resizingPreviewMin,
}: {
  shift: ScheduleRow;
  onSuggest: (s: ScheduleRow) => void;
  onResizeCommit: (shift: ScheduleRow, newEnd: Date) => void;
  resizingPreviewMin: number | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: shift.id,
    data: { shift },
  });
  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
  const previewMin = resizingPreviewMin ?? durationMin;
  const previewEnd = new Date(start.getTime() + previewMin * 60000);
  const [resizing, setResizing] = useState<ResizeState | null>(null);

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setResizing({
      shiftId: shift.id,
      originalEnd: end,
      startY: e.clientY,
      pxPerMin: 0.5, // 30 min per 15px drag
      newEnd: end,
    });
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    e.stopPropagation();
    const dy = e.clientY - resizing.startY;
    const deltaMin = Math.round((dy / resizing.pxPerMin) / RESIZE_SNAP_MIN) * RESIZE_SNAP_MIN;
    const next = new Date(resizing.originalEnd.getTime() + deltaMin * 60000);
    if (next.getTime() <= start.getTime() + 30 * 60000) return;
    setResizing({ ...resizing, newEnd: next });
  };
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    e.stopPropagation();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const final = resizing.newEnd;
    setResizing(null);
    if (final.getTime() !== end.getTime()) {
      onResizeCommit(shift, final);
    }
  };

  const liveEnd = resizing ? resizing.newEnd : previewEnd;

  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs shadow-sm hover:border-primary cursor-grab active:cursor-grabbing relative"
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="font-medium leading-tight truncate">{shift.clientName}</div>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSuggest(shift);
          }}
          className="text-primary hover:text-primary/70"
          title="Suggest caregivers"
        >
          <Sparkles className="h-3 w-3" />
        </button>
      </div>
      <div className="text-muted-foreground mt-1">
        {fmtTime(start)}–{fmtTime(liveEnd)}
        {resizing && (
          <span className="ml-1 text-amber-600 font-medium">
            ({Math.round((liveEnd.getTime() - start.getTime()) / 60000 / 60 * 10) / 10}h)
          </span>
        )}
      </div>
      <Badge variant="outline" className="mt-1 text-[10px] px-1 py-0">
        {shift.status}
      </Badge>
      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-primary/40 rounded-b-md"
        title="Drag to resize duration"
      />
    </div>
  );
}

function DayCell({
  caregiverId,
  day,
  hoverPreview,
  children,
}: {
  caregiverId: string;
  day: Date;
  hoverPreview?: { otDeltaMin: number; costDelta: number; blocked: boolean } | null;
  children: React.ReactNode;
}) {
  const id = dropId(caregiverId, day);
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { caregiverId, day: day.toISOString() },
  });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[88px] border-r border-b p-1.5 space-y-1 transition-colors relative ${
        isOver
          ? hoverPreview?.blocked
            ? "bg-rose-100"
            : "bg-primary/10"
          : "bg-background"
      }`}
    >
      {children}
      {isOver && hoverPreview && (
        <div
          className={`absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            hoverPreview.blocked
              ? "bg-rose-500 text-white"
              : hoverPreview.otDeltaMin > 0
                ? "bg-amber-500 text-white"
                : "bg-emerald-500 text-white"
          }`}
        >
          {hoverPreview.blocked
            ? "BLOCK"
            : hoverPreview.otDeltaMin > 0
              ? `+${(hoverPreview.otDeltaMin / 60).toFixed(1)}h OT • +$${hoverPreview.costDelta.toFixed(0)}`
              : "OK"}
        </div>
      )}
    </div>
  );
}

function OtBar({
  minutes,
  threshold,
}: {
  minutes: number;
  threshold: number;
}) {
  const pctReg = Math.min(100, (Math.min(minutes, threshold) / threshold) * 100);
  const overage = Math.max(0, minutes - threshold);
  const pctOt = Math.min(100, (overage / threshold) * 100);
  const hrs = (minutes / 60).toFixed(1);
  const otHrs = (overage / 60).toFixed(1);
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
      <Clock className="h-3 w-3 text-muted-foreground" />
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden flex">
        <div className="bg-emerald-500 h-full" style={{ width: `${pctReg}%` }} />
        {pctOt > 0 && (
          <div className="bg-amber-500 h-full" style={{ width: `${pctOt}%` }} />
        )}
      </div>
      <span className="tabular-nums w-20 text-right text-muted-foreground">
        {hrs}h{overage > 0 ? ` (+${otHrs}h OT)` : ""}
      </span>
    </div>
  );
}

export default function Schedule() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [axis, setAxis] = useState<AxisMode>("caregivers-y");
  const weekEnd = useMemo(
    () => new Date(weekStart.getTime() + 7 * DAY_MS),
    [weekStart],
  );

  const { data: schedules, isLoading } = useListSchedules();
  const { data: clients } = useListClients();
  const { data: caregivers } = useListCaregivers();
  const { data: otProjection } = useGetOvertimeProjection();

  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const dryRun = useDryRunSchedule();
  const suggest = useSuggestCaregivers();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createConflicts, setCreateConflicts] = useState<ScheduleConflict[]>([]);
  const [dropPreview, setDropPreview] = useState<{
    shift: ScheduleRow;
    targetCaregiverId: string;
    targetDay: Date;
    result: ScheduleDryRunResult;
  } | null>(null);
  const [suggestState, setSuggestState] = useState<{
    shift: ScheduleRow;
    suggestions: CaregiverSuggestion[] | null;
    loading: boolean;
  } | null>(null);

  // Live drag-hover OT preview
  const [hoverPreviewByDropId, setHoverPreviewByDropId] = useState<
    Record<string, { otDeltaMin: number; costDelta: number; blocked: boolean }>
  >({});
  const hoverDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoverIdRef = useRef<string | null>(null);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)),
    [weekStart],
  );
  const activeCaregivers = useMemo(
    () => (caregivers ?? []).filter((c: Caregiver) => c.status === "ACTIVE"),
    [caregivers],
  );

  const otByCaregiver = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of otProjection?.entries ?? []) {
      map.set(
        e.caregiverId,
        e.projectedRegularMinutes +
          e.projectedOvertimeMinutes +
          e.projectedDoubleTimeMinutes,
      );
    }
    return map;
  }, [otProjection]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetOvertimeProjectionQueryKey() });
  };

  const form = useForm<z.infer<typeof scheduleSchema>>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      clientId: "",
      caregiverId: "",
      startTime: "",
      endTime: "",
      serviceCode: "T1019",
    },
  });

  const onCreate = (data: z.infer<typeof scheduleSchema>) => {
    setCreateConflicts([]);
    createSchedule.mutate(
      {
        data: {
          ...data,
          startTime: new Date(data.startTime).toISOString(),
          endTime: new Date(data.endTime).toISOString(),
        },
      },
      {
        onSuccess: (res) => {
          if (res.blocked) {
            setCreateConflicts(res.conflicts);
            toast.error("Shift creation blocked by compliance rules");
            return;
          }
          if (res.conflicts.length) {
            setCreateConflicts(res.conflicts);
            toast.success("Shift created with warnings");
          } else {
            toast.success("Shift created");
          }
          setIsCreateOpen(false);
          form.reset();
          refresh();
        },
        onError: () => toast.error("Failed to create shift"),
      },
    );
  };

  // Compute proposed start/end if a shift is dropped on (caregiverId, day).
  const proposeMove = (shift: ScheduleRow, targetDay: Date) => {
    const start = new Date(shift.startTime);
    const end = new Date(shift.endTime);
    const newStart = new Date(targetDay);
    newStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
    const newEnd = new Date(newStart.getTime() + (end.getTime() - start.getTime()));
    return { newStart, newEnd };
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !active.data.current) {
      lastHoverIdRef.current = null;
      return;
    }
    const id = String(over.id);
    if (id === lastHoverIdRef.current) return;
    lastHoverIdRef.current = id;
    const shift = active.data.current.shift as ScheduleRow;
    const overData = over.data.current as { caregiverId: string; day: string };
    if (
      overData.caregiverId === shift.caregiverId &&
      overData.day.slice(0, 10) === new Date(shift.startTime).toISOString().slice(0, 10)
    ) {
      return;
    }
    if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
    hoverDebounceRef.current = setTimeout(() => {
      const { newStart, newEnd } = proposeMove(shift, new Date(overData.day));
      dryRun.mutate(
        {
          data: {
            scheduleId: shift.id,
            clientId: shift.clientId,
            caregiverId: overData.caregiverId,
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString(),
          },
        },
        {
          onSuccess: (res) => {
            setHoverPreviewByDropId((prev) => ({
              ...prev,
              [id]: {
                otDeltaMin:
                  res.otImpact.deltaOvertimeMinutes +
                  res.otImpact.deltaDoubleTimeMinutes,
                costDelta: res.otImpact.deltaCostUsd,
                blocked: res.blocked,
              },
            }));
          },
        },
      );
    }, 120);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
    setHoverPreviewByDropId({});
    lastHoverIdRef.current = null;
    const { active, over } = event;
    if (!over || !active.data.current) return;
    const shift = active.data.current.shift as ScheduleRow;
    const overData = over.data.current as { caregiverId: string; day: string };
    const targetDayDate = new Date(overData.day);
    const startIso = new Date(shift.startTime).toISOString().slice(0, 10);
    const sameDay = startIso === targetDayDate.toISOString().slice(0, 10);
    if (sameDay && shift.caregiverId === overData.caregiverId) return;

    const { newStart, newEnd } = proposeMove(shift, targetDayDate);

    try {
      const result = await dryRun.mutateAsync({
        data: {
          scheduleId: shift.id,
          clientId: shift.clientId,
          caregiverId: overData.caregiverId,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        },
      });
      setDropPreview({
        shift,
        targetCaregiverId: overData.caregiverId,
        targetDay: newStart,
        result,
      });
    } catch {
      toast.error("Could not validate move");
    }
  };

  const confirmDrop = () => {
    if (!dropPreview) return;
    const { shift, targetCaregiverId, targetDay, result } = dropPreview;
    if (result.blocked) {
      toast.error("Move is blocked by compliance");
      return;
    }
    const newStart = targetDay;
    const newEnd = new Date(
      newStart.getTime() +
        (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()),
    );
    updateSchedule.mutate(
      {
        id: shift.id,
        data: {
          caregiverId: targetCaregiverId,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        },
      },
      {
        onSuccess: (res) => {
          if (res.blocked) {
            toast.error("Move blocked");
          } else if (res.conflicts.length) {
            toast.success("Shift moved with warnings");
          } else {
            toast.success("Shift moved");
          }
          setDropPreview(null);
          refresh();
        },
        onError: () => toast.error("Failed to move shift"),
      },
    );
  };

  const onResizeCommit = async (shift: ScheduleRow, newEnd: Date) => {
    try {
      const result = await dryRun.mutateAsync({
        data: {
          scheduleId: shift.id,
          clientId: shift.clientId,
          caregiverId: shift.caregiverId,
          startTime: new Date(shift.startTime).toISOString(),
          endTime: newEnd.toISOString(),
        },
      });
      if (result.blocked) {
        toast.error(
          `Resize blocked: ${result.conflicts.find((c) => c.severity === "BLOCK")?.message ?? "compliance"}`,
        );
        return;
      }
      updateSchedule.mutate(
        {
          id: shift.id,
          data: { endTime: newEnd.toISOString() },
        },
        {
          onSuccess: () => {
            toast.success(
              `Duration changed to ${((newEnd.getTime() - new Date(shift.startTime).getTime()) / 3600000).toFixed(1)}h`,
            );
            refresh();
          },
          onError: () => toast.error("Resize failed"),
        },
      );
    } catch {
      toast.error("Could not validate resize");
    }
  };

  const openSuggest = (shift: ScheduleRow) => {
    setSuggestState({ shift, suggestions: null, loading: true });
    suggest.mutate(
      {
        data: {
          scheduleId: shift.id,
          clientId: shift.clientId,
          startTime: new Date(shift.startTime).toISOString(),
          endTime: new Date(shift.endTime).toISOString(),
        },
      },
      {
        onSuccess: (res) =>
          setSuggestState({ shift, suggestions: res.suggestions, loading: false }),
        onError: () => {
          toast.error("Failed to fetch suggestions");
          setSuggestState(null);
        },
      },
    );
  };

  const reassign = (caregiverId: string) => {
    if (!suggestState) return;
    const { shift } = suggestState;
    updateSchedule.mutate(
      {
        id: shift.id,
        data: { caregiverId },
      },
      {
        onSuccess: (res) => {
          if (res.blocked) {
            toast.error("Reassignment blocked by compliance");
          } else {
            toast.success("Caregiver reassigned");
          }
          setSuggestState(null);
          refresh();
        },
        onError: () => toast.error("Failed to reassign"),
      },
    );
  };

  const shiftsByCgDay = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const s of schedules ?? []) {
      const k = dropId(s.caregiverId, new Date(s.startTime));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return map;
  }, [schedules]);

  useEffect(
    () => () => {
      if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
    },
    [],
  );

  // Build axes
  const rows: { key: string; label: React.ReactNode; sub?: React.ReactNode }[] =
    axis === "caregivers-y"
      ? activeCaregivers.map((cg: Caregiver) => ({
          key: cg.id,
          label: (
            <>
              <div className="font-medium text-sm">
                {cg.firstName} {cg.lastName}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {cg.addressCity ?? "—"}
              </div>
            </>
          ),
          sub: (
            <OtBar
              minutes={otByCaregiver.get(cg.id) ?? 0}
              threshold={WEEKLY_OT_THRESHOLD_MIN}
            />
          ),
        }))
      : days.map((d) => ({ key: d.toISOString(), label: fmtDayLabel(d) }));
  const cols: { key: string; label: React.ReactNode }[] =
    axis === "caregivers-y"
      ? days.map((d) => ({ key: d.toISOString(), label: fmtDayLabel(d) }))
      : activeCaregivers.map((cg: Caregiver) => ({
          key: cg.id,
          label: `${cg.firstName} ${cg.lastName}`,
        }));

  const cellFor = (rowKey: string, colKey: string) => {
    const caregiverId = axis === "caregivers-y" ? rowKey : colKey;
    const dayIso = axis === "caregivers-y" ? colKey : rowKey;
    const day = new Date(dayIso);
    const k = dropId(caregiverId, day);
    return { caregiverId, day, k, shifts: shiftsByCgDay.get(k) ?? [] };
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Schedule
            </h1>
            <p className="text-muted-foreground mt-1">
              Drag shifts across caregivers and days. Compliance and OT impact validate live.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="font-medium tabular-nums">
              {weekStart.toLocaleDateString([], { month: "short", day: "numeric" })} –{" "}
              {new Date(weekEnd.getTime() - 1).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>
              This week
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setAxis((a) => (a === "caregivers-y" ? "days-y" : "caregivers-y"))
              }
              title="Swap axes"
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              {axis === "caregivers-y" ? "Caregivers ↓" : "Days ↓"}
            </Button>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Create Shift
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Schedule Shift</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onCreate)} className="space-y-4">
                    {createConflicts.length > 0 && (
                      <ConflictsList conflicts={createConflicts} />
                    )}
                    <FormField
                      control={form.control}
                      name="clientId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select client" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(clients ?? []).map((c: Client) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.firstName} {c.lastName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="caregiverId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Caregiver</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select caregiver" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {activeCaregivers.map((c: Caregiver) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.firstName} {c.lastName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="startTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Start Time</FormLabel>
                            <FormControl>
                              <Input type="datetime-local" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="endTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>End Time</FormLabel>
                            <FormControl>
                              <Input type="datetime-local" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="serviceCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Service Code</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createSchedule.isPending}
                    >
                      {createSchedule.isPending
                        ? "Validating & Creating..."
                        : "Schedule Shift"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <p className="p-6 text-muted-foreground">Loading schedule...</p>
            ) : (
              <DndContext
                sensors={sensors}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              >
                <div className="min-w-[1100px]">
                  <div
                    className="grid border-b bg-muted/40 text-xs font-medium"
                    style={{
                      gridTemplateColumns: `200px repeat(${cols.length}, minmax(0, 1fr))`,
                    }}
                  >
                    <div className="p-2 border-r">
                      {axis === "caregivers-y" ? "Caregiver" : "Day"}
                    </div>
                    {cols.map((c) => (
                      <div key={c.key} className="p-2 border-r text-center">
                        {c.label}
                      </div>
                    ))}
                  </div>
                  {rows.length === 0 && (
                    <div className="p-6 text-muted-foreground text-sm">
                      No active caregivers.
                    </div>
                  )}
                  {rows.map((r) => (
                    <div
                      key={r.key}
                      className="grid border-b"
                      style={{
                        gridTemplateColumns: `200px repeat(${cols.length}, minmax(0, 1fr))`,
                      }}
                    >
                      <div className="border-r p-2 flex flex-col justify-between">
                        <div>{r.label}</div>
                        {r.sub}
                      </div>
                      {cols.map((c) => {
                        const { caregiverId, day, k, shifts } = cellFor(r.key, c.key);
                        return (
                          <DayCell
                            key={k}
                            caregiverId={caregiverId}
                            day={day}
                            hoverPreview={hoverPreviewByDropId[k] ?? null}
                          >
                            {shifts.map((s) => (
                              <DraggableShift
                                key={s.id}
                                shift={s}
                                onSuggest={openSuggest}
                                onResizeCommit={onResizeCommit}
                                resizingPreviewMin={null}
                              />
                            ))}
                          </DayCell>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </DndContext>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drop preview modal */}
      <Dialog
        open={!!dropPreview}
        onOpenChange={(o) => !o && setDropPreview(null)}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Confirm shift move</DialogTitle>
          </DialogHeader>
          {dropPreview && (
            <div className="space-y-3 text-sm">
              <p>
                Move <b>{dropPreview.shift.clientName}</b> to{" "}
                <b>
                  {activeCaregivers.find(
                    (c: Caregiver) => c.id === dropPreview.targetCaregiverId,
                  )?.firstName ?? "caregiver"}{" "}
                  {activeCaregivers.find(
                    (c: Caregiver) => c.id === dropPreview.targetCaregiverId,
                  )?.lastName ?? ""}
                </b>{" "}
                on <b>{fmtDayLabel(dropPreview.targetDay)}</b>.
              </p>
              <div className="rounded-md border p-3 bg-muted/30">
                <div className="text-xs font-semibold mb-1">OT projection</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    Reg{" "}
                    {(dropPreview.result.otImpact.projectedRegularMinutes / 60).toFixed(1)}h
                  </div>
                  <div className="text-amber-600">
                    OT{" "}
                    {(dropPreview.result.otImpact.projectedOvertimeMinutes / 60).toFixed(1)}h
                    {dropPreview.result.otImpact.deltaOvertimeMinutes !== 0 && (
                      <span>
                        {" "}
                        ({dropPreview.result.otImpact.deltaOvertimeMinutes > 0 ? "+" : ""}
                        {(dropPreview.result.otImpact.deltaOvertimeMinutes / 60).toFixed(
                          1,
                        )}h)
                      </span>
                    )}
                  </div>
                  <div className="text-rose-600">
                    Δ ${dropPreview.result.otImpact.deltaCostUsd.toFixed(2)}
                  </div>
                </div>
              </div>
              <ConflictsList conflicts={dropPreview.result.conflicts} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDropPreview(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmDrop}
              disabled={
                !dropPreview ||
                dropPreview.result.blocked ||
                updateSchedule.isPending
              }
            >
              {dropPreview?.result.blocked ? "Blocked" : "Confirm move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suggest caregivers modal */}
      <Dialog
        open={!!suggestState}
        onOpenChange={(o) => !o && setSuggestState(null)}
      >
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>
              <Sparkles className="inline h-4 w-4 mr-1 text-primary" />
              Schedule Optimizer suggestions
            </DialogTitle>
          </DialogHeader>
          {suggestState?.loading && (
            <p className="text-sm text-muted-foreground">
              Scoring eligible caregivers…
            </p>
          )}
          {suggestState?.suggestions && (
            <div className="space-y-2">
              {suggestState.suggestions.map((s: CaregiverSuggestion) => {
                const blocked = s.blockingConflicts.length > 0;
                return (
                  <div
                    key={s.caregiverId}
                    className={`rounded-md border p-3 ${blocked ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">#{s.rank}</Badge>
                        <span className="font-medium">{s.caregiverName}</span>
                        <Badge>{s.score.toFixed(0)}/100</Badge>
                      </div>
                      <Button
                        size="sm"
                        disabled={blocked || updateSchedule.isPending}
                        onClick={() => reassign(s.caregiverId)}
                      >
                        {blocked ? "Blocked" : "Assign"}
                      </Button>
                    </div>
                    {s.reasoning && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {s.reasoning}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2 text-[11px]">
                      <Badge variant="outline">
                        Skill {s.factors.skillScore.toFixed(0)}
                      </Badge>
                      <Badge variant="outline">
                        Lang {s.factors.languageScore.toFixed(0)}
                      </Badge>
                      <Badge variant="outline">
                        Drive {s.factors.driveScore.toFixed(0)}
                        {s.factors.driveMinutes != null
                          ? ` (${s.factors.driveMinutes}m)`
                          : ""}
                      </Badge>
                      <Badge variant="outline">
                        Continuity {s.factors.continuityScore.toFixed(0)}
                        {s.factors.priorVisitsWithClient > 0
                          ? ` (${s.factors.priorVisitsWithClient}v)`
                          : ""}
                      </Badge>
                      <Badge variant="outline">
                        Avail {s.factors.availabilityScore.toFixed(0)}
                      </Badge>
                      <Badge variant="outline">
                        OT-safe {s.factors.otSafeScore.toFixed(0)}
                      </Badge>
                    </div>
                    {blocked && (
                      <div className="mt-2">
                        <ConflictsList conflicts={s.blockingConflicts} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
