import { Layout } from "@/components/layout/Layout";
import { useListComplianceAlerts, useAcknowledgeAlert, useResolveAlert, getListComplianceAlertsQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert, CheckCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export default function Compliance() {
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const { data: alerts, isLoading } = useListComplianceAlerts({ status: statusFilter !== "ALL" ? (statusFilter as any) : undefined });
  const ackAlert = useAcknowledgeAlert();
  const resolveAlert = useResolveAlert();
  const queryClient = useQueryClient();

  const handleAck = (id: string) => {
    ackAlert.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Alert acknowledged");
          queryClient.invalidateQueries({ queryKey: getListComplianceAlertsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        },
        onError: () => toast.error("Failed to acknowledge")
      }
    );
  };

  const handleResolve = (id: string) => {
    resolveAlert.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Alert resolved");
          queryClient.invalidateQueries({ queryKey: getListComplianceAlertsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        },
        onError: () => toast.error("Failed to resolve")
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <ShieldAlert className="h-8 w-8 text-destructive" /> Compliance Alerts
            </h1>
            <p className="text-muted-foreground mt-1">Actionable items requiring attention.</p>
          </div>
          <div className="flex gap-2 bg-muted p-1 rounded-lg">
            {["OPEN", "ACKNOWLEDGED", "RESOLVED", "ALL"].map(status => (
              <button 
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${statusFilter === status ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {isLoading ? (
             <p className="text-muted-foreground">Loading alerts...</p>
          ) : alerts?.length === 0 ? (
            <Card>
               <CardContent className="p-8 text-center flex flex-col items-center">
                 <CheckCircle className="h-12 w-12 text-primary mb-4 opacity-50" />
                 <h3 className="text-lg font-medium">All Clear</h3>
                 <p className="text-muted-foreground">No alerts matching this filter.</p>
               </CardContent>
            </Card>
          ) : (
            alerts?.map(alert => (
              <Card key={alert.id} className={`border-l-4 ${alert.severity === 'CRITICAL' ? 'border-l-red-600' : alert.severity === 'HIGH' ? 'border-l-orange-500' : alert.severity === 'MEDIUM' ? 'border-l-amber-400' : 'border-l-blue-400'}`}>
                <CardContent className="p-4 flex flex-col md:flex-row justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={alert.severity === 'CRITICAL' || alert.severity === 'HIGH' ? 'destructive' : 'secondary'}>{alert.severity}</Badge>
                      <Badge variant="outline">{alert.status}</Badge>
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {format(new Date(alert.createdAt), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <h3 className="font-semibold text-lg mt-2">{alert.title}</h3>
                    <p className="text-muted-foreground">{alert.message}</p>
                    {alert.suggestedAction && (
                      <div className="mt-3 rounded-md border-l-2 border-primary/60 bg-primary/5 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-0.5">Suggested action</p>
                        <p className="text-sm text-foreground/90">{alert.suggestedAction}</p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">Entity: {alert.entityType} ({alert.entityId})</p>
                  </div>
                  {alert.status !== 'RESOLVED' && (
                    <div className="flex shrink-0 gap-2 w-full md:w-auto mt-4 md:mt-0">
                      {alert.status === 'OPEN' && (
                        <Button variant="outline" size="sm" onClick={() => handleAck(alert.id)}>Acknowledge</Button>
                      )}
                      <Button variant="default" size="sm" onClick={() => handleResolve(alert.id)}>Resolve</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}