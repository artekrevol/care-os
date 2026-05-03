import { useAuth } from "@/lib/auth";
import { useListCarePlans, useAcknowledgeCarePlan, getListCarePlansQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { ShieldAlert, CheckCircle, ClipboardList, Target, AlertTriangle, HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function CarePlan() {
  const auth = useAuth();
  const clientId = auth?.clientId || "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: carePlans, isLoading } = useListCarePlans(
    { clientId },
    { query: { enabled: !!clientId } as any }
  );

  const acknowledgeCarePlan = useAcknowledgeCarePlan();

  const activeOrPendingPlan = carePlans?.find(p => p.status === "SUBMITTED" || p.status === "APPROVED");

  const handleApprove = () => {
    if (!activeOrPendingPlan || !auth?.familyUserId) return;

    acknowledgeCarePlan.mutate(
      { id: activeOrPendingPlan.id, data: { familyUserId: auth.familyUserId } },
      {
        onSuccess: () => {
          toast({ title: "Care Plan Acknowledged", description: "Thank you for reviewing the care plan." });
          queryClient.invalidateQueries({ queryKey: getListCarePlansQueryKey({ clientId }) });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to acknowledge care plan. Please try again.", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto w-full space-y-6">
        <Skeleton className="h-8 w-48 mb-8" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!activeOrPendingPlan) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-serif font-medium text-foreground mb-8">Care Plan</h1>
        <Card className="bg-card/50 border-dashed shadow-none">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <ClipboardList className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No active care plan</h3>
            <p className="text-muted-foreground text-sm">A care plan has not been established yet.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { title, version, status, goals, tasks, riskFactors, preferences } = activeOrPendingPlan;

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto w-full pb-24">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-medium text-foreground mb-2">Care Plan</h1>
            <p className="text-muted-foreground">Version {version} • {title}</p>
          </div>
          
          {status === "SUBMITTED" && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-4 rounded-lg flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-orange-800 dark:text-orange-300">Pending Review</p>
                <p className="text-xs text-orange-700/80 dark:text-orange-400/80">Please acknowledge this updated care plan.</p>
              </div>
              <Button 
                onClick={handleApprove} 
                disabled={acknowledgeCarePlan.isPending}
                className="bg-orange-600 hover:bg-orange-700 text-white shrink-0"
              >
                {acknowledgeCarePlan.isPending ? "Acknowledging..." : "Acknowledge"}
              </Button>
            </div>
          )}
          
          {status === "APPROVED" && (
            <div className="flex items-center gap-2 text-primary bg-primary/10 px-3 py-1.5 rounded-full text-sm font-medium">
              <CheckCircle className="w-4 h-4" />
              Active Plan
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card className="border-none shadow-md overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b flex items-center gap-2">
              <Target className="w-5 h-5 text-secondary-foreground" />
              <h2 className="font-medium text-foreground text-lg">Care Goals</h2>
            </div>
            <CardContent className="p-0">
              {goals && goals.length > 0 ? (
                <ul className="divide-y">
                  {goals.map((goal, idx) => (
                    <li key={goal.id || idx} className="p-4 flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-sm font-medium mt-0.5">
                        {idx + 1}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{goal.title}</p>
                        {goal.description && <p className="text-sm text-muted-foreground mt-1">{goal.description}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-muted-foreground text-sm">No specific goals listed.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-none shadow-md">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-muted-foreground" />
                  Routine Tasks
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {tasks && tasks.length > 0 ? (
                  <div className="space-y-4">
                    {tasks.map((task, idx) => (
                      <div key={task.id || idx} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground text-sm">{task.title}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-secondary/50 text-secondary-foreground">
                            {task.frequency || "As needed"}
                          </span>
                        </div>
                        {task.instructions && <span className="text-xs text-muted-foreground">{task.instructions}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No tasks specified.</p>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-none shadow-md bg-orange-50/50 dark:bg-orange-950/10">
                <CardHeader className="pb-3 border-b border-orange-100 dark:border-orange-900">
                  <CardTitle className="text-lg flex items-center gap-2 text-orange-800 dark:text-orange-400">
                    <AlertTriangle className="w-5 h-5" />
                    Risk Factors
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  {riskFactors && riskFactors.length > 0 ? (
                    <ul className="list-disc pl-5 space-y-1 text-sm text-orange-900 dark:text-orange-300">
                      {riskFactors.map((risk, idx) => (
                        <li key={idx}>{risk}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">None identified.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-none shadow-md">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <HeartPulse className="w-5 h-5 text-muted-foreground" />
                    Preferences & Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  {preferences && Object.keys(preferences).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(preferences).map(([k, v]) => (
                        <div key={k}>
                          <span className="font-medium text-foreground capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}: </span>
                          <span>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>No special preferences noted.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
