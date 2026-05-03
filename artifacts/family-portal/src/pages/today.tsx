import { useAuth } from "@/lib/auth";
import { useListSchedules, useListVisits } from "@workspace/api-client-react";
import { format, isToday, startOfToday, endOfToday, differenceInMinutes, parseISO } from "date-fns";
import { Clock, CheckCircle2, MapPin, Calendar, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

export default function Today() {
  const auth = useAuth();
  const clientId = auth?.clientId || "";

  const todayStart = startOfToday().toISOString();
  const todayEnd = endOfToday().toISOString();

  const { data: schedules, isLoading: loadingSchedules } = useListSchedules(
    { clientId, from: todayStart, to: todayEnd },
    { query: { enabled: !!clientId, refetchInterval: 3000 } as any }
  );

  const { data: visits, isLoading: loadingVisits } = useListVisits(
    { from: todayStart, to: todayEnd },
    { query: { enabled: !!clientId, refetchInterval: 3000 } as any }
  );

  const isLoading = loadingSchedules || loadingVisits;

  // Status derivation: prefer the schedule whose visit is currently
  // in-progress (clocked in, not yet out), then the next upcoming schedule
  // by start time. Falls back to the first returned schedule.
  const clientVisits = visits?.filter(v => v.clientId === clientId) ?? [];
  const activeVisit = clientVisits.find(v => v.clockInTime && !v.clockOutTime);
  const sortedSchedules = (schedules ?? [])
    .slice()
    .sort((a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime());
  const activeSchedule = activeVisit
    ? sortedSchedules.find(s => s.id === activeVisit.scheduleId)
    : undefined;
  const nowMs = Date.now();
  const upcomingSchedule = sortedSchedules.find(s => parseISO(s.endTime).getTime() >= nowMs);
  const schedule = activeSchedule ?? upcomingSchedule ?? sortedSchedules[0];
  const visit = activeVisit
    ?? (schedule ? clientVisits.find(v => v.scheduleId === schedule.id) : undefined)
    ?? clientVisits[0];
  
  let status = "NO_VISIT_SCHEDULED";
  let statusLabel = "No visit scheduled";
  let StatusIcon = Calendar;
  let statusColor = "text-muted-foreground";
  let statusBg = "bg-muted";

  const now = new Date();

  if (schedule) {
    const startTime = parseISO(schedule.startTime);
    const minsToStart = differenceInMinutes(startTime, now);

    if (visit?.clockOutTime) {
      status = "COMPLETE";
      statusLabel = "Visit Complete";
      StatusIcon = CheckCircle2;
      statusColor = "text-primary";
      statusBg = "bg-primary/10";
    } else if (visit?.clockInTime) {
      status = "ON_SITE";
      statusLabel = "Caregiver On Site";
      StatusIcon = Activity;
      statusColor = "text-blue-600 dark:text-blue-400";
      statusBg = "bg-blue-50 dark:bg-blue-900/20";
    } else if (minsToStart <= 30 && minsToStart >= -120) { // arbitrary buffer
      status = "EN_ROUTE";
      statusLabel = "Caregiver En Route";
      StatusIcon = MapPin;
      statusColor = "text-orange-600 dark:text-orange-400";
      statusBg = "bg-orange-50 dark:bg-orange-900/20";
    } else {
      status = "SCHEDULED";
      statusLabel = "Scheduled";
      StatusIcon = Clock;
      statusColor = "text-secondary-foreground";
      statusBg = "bg-secondary";
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto w-full space-y-6">
        <Skeleton className="h-10 w-48 mb-2" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-48 w-full mt-8 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto w-full">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-10">
          <h1 className="text-3xl font-serif font-medium text-foreground mb-2">Today's Care</h1>
          <p className="text-muted-foreground">{format(now, "EEEE, MMMM do")}</p>
        </div>

        {status === "NO_VISIT_SCHEDULED" ? (
          <Card className="bg-card/50 border-dashed border-2 shadow-none">
            <CardContent className="flex flex-col items-center justify-center p-12 text-center">
              <Calendar className="w-12 h-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-1">No visits today</h3>
              <p className="text-muted-foreground text-sm">Your loved one has no scheduled care visits for today.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="overflow-hidden border-none shadow-md">
              <div className={`p-4 flex items-center gap-3 ${statusBg}`}>
                <div className={`p-2 rounded-full bg-white/50 dark:bg-black/20 ${statusColor}`}>
                  <StatusIcon className="w-5 h-5" />
                </div>
                <div>
                  <p className={`text-sm font-semibold uppercase tracking-wider ${statusColor}`}>
                    Status
                  </p>
                  <p className="text-lg font-medium text-foreground">{statusLabel}</p>
                </div>
              </div>
              
              <CardContent className="p-6 bg-card">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Caregiver</p>
                    <p className="text-xl font-medium">{schedule?.caregiverName || visit?.caregiverName || "Unassigned"}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Scheduled Window</p>
                    <p className="text-lg">
                      {schedule ? `${format(parseISO(schedule.startTime), "h:mm a")} - ${format(parseISO(schedule.endTime), "h:mm a")}` : "N/A"}
                    </p>
                  </div>

                  {visit?.clockInTime && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Arrived At</p>
                      <p className="text-lg">{format(parseISO(visit.clockInTime), "h:mm a")}</p>
                    </div>
                  )}

                  {visit?.clockOutTime && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Completed At</p>
                      <p className="text-lg">{format(parseISO(visit.clockOutTime), "h:mm a")}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {(visit?.tasksCompleted && visit.tasksCompleted.length > 0) && (
              <div className="mt-8">
                <h3 className="text-lg font-medium mb-4">Completed Tasks</h3>
                <div className="space-y-3">
                  {visit.tasksCompleted.map((task, idx) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      key={idx} 
                      className="flex items-start gap-3 bg-card p-4 rounded-lg shadow-sm border"
                    >
                      <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-foreground">{task}</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
