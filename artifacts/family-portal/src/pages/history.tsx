import { useAuth } from "@/lib/auth";
import { useListVisits } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Calendar, ChevronDown, CheckCircle2, History as HistoryIcon } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function History() {
  const auth = useAuth();
  const clientId = auth?.clientId || "";

  const { data: visits, isLoading } = useListVisits(
    { status: "VERIFIED" }, // In real scenario, we might want all COMPLETE visits, maybe without status filter if it isn't supported for all
    { query: { enabled: !!clientId } as any }
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const clientVisits = visits?.filter(v => v.clientId === clientId && v.clockOutTime).sort((a, b) => {
    return new Date(b.clockInTime || 0).getTime() - new Date(a.clockInTime || 0).getTime();
  });

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-3xl mx-auto w-full space-y-4">
        <Skeleton className="h-8 w-40 mb-8" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-medium text-foreground">Visit History</h1>
        <p className="text-muted-foreground mt-2">Past care visits and notes.</p>
      </div>

      {clientVisits?.length === 0 ? (
        <Card className="bg-card/50 border-dashed shadow-none">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <HistoryIcon className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No history yet</h3>
            <p className="text-muted-foreground text-sm">Past visits will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {clientVisits?.map((visit, idx) => {
            const isExpanded = expandedId === visit.id;
            const date = visit.clockInTime ? parseISO(visit.clockInTime) : new Date();
            
            return (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                key={visit.id}
              >
                <Card 
                  className={`overflow-hidden transition-all duration-200 border-border/50 hover:border-border cursor-pointer ${isExpanded ? 'ring-1 ring-primary/20 shadow-md' : 'shadow-sm'}`}
                  onClick={() => setExpandedId(isExpanded ? null : visit.id)}
                >
                  <div className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-secondary/30 flex items-center justify-center text-secondary-foreground">
                        <Calendar className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-medium text-foreground">{format(date, "EEEE, MMM d, yyyy")}</h3>
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="w-3.5 h-3.5" />
                          {visit.clockInTime ? format(parseISO(visit.clockInTime), "h:mm a") : "?"} - {visit.clockOutTime ? format(parseISO(visit.clockOutTime), "h:mm a") : "?"}
                          <span className="mx-1">•</span>
                          {visit.caregiverName}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground">
                      <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                        <ChevronDown className="w-5 h-5" />
                      </motion.div>
                    </Button>
                  </div>
                  
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t bg-card/30"
                      >
                        <div className="p-5 space-y-6">
                          {visit.caregiverNotes && (
                            <div>
                              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Caregiver Notes</h4>
                              <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                                {visit.caregiverNotes}
                              </p>
                            </div>
                          )}

                          {visit.tasksCompleted && visit.tasksCompleted.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tasks Completed</h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {visit.tasksCompleted.map((task, i) => (
                                  <div key={i} className="flex items-start gap-2 text-sm text-foreground">
                                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                                    <span>{task}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {(!visit.caregiverNotes && (!visit.tasksCompleted || visit.tasksCompleted.length === 0)) && (
                            <p className="text-sm text-muted-foreground italic">No additional details recorded for this visit.</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
