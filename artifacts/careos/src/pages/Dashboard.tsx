import { Layout } from "@/components/layout/Layout";
import { useGetDashboardSummary, useGetRecentActivity, useGetOvertimeProjection } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserSquare2, Calendar, Clock, AlertTriangle, Shield, Activity } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: activity, isLoading: isActivityLoading } = useGetRecentActivity();
  const { data: otProjection, isLoading: isOtLoading } = useGetOvertimeProjection();

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Today's operational snapshot.</p>
        </div>

        {isSummaryLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : summary ? (
          <>
            {summary.activeRuleName && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-primary flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Active Labor Rule: {summary.activeRuleName} ({summary.activeRuleState})
                  </h3>
                  <p className="text-sm text-muted-foreground">Compliance engine enforcing rules for this jurisdiction.</p>
                </div>
              </div>
            )}
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.activeClients}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Caregivers</CardTitle>
                  <UserSquare2 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.activeCaregivers}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Visits Today</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.completedVisitsToday} / {summary.scheduledVisitsToday}</div>
                  <p className="text-xs text-muted-foreground mt-1">Completed vs Scheduled</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Pending Exceptions</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-amber-600">{summary.pendingExceptions}</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Weekly Overtime Projection</CardTitle>
                </CardHeader>
                <CardContent>
                  {isOtLoading ? <Skeleton className="h-24 w-full" /> : otProjection ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Projected OT Hours</p>
                          <p className="text-2xl font-bold">{otProjection.totalOvertimeHours.toFixed(1)}h</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Projected OT Cost</p>
                          <p className="text-2xl font-bold text-destructive">${otProjection.totalOvertimeCost.toFixed(2)}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Based on {otProjection.ruleName} ({otProjection.ruleState}) rules.</p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No projection available.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isActivityLoading ? <Skeleton className="h-48 w-full" /> : activity && activity.length > 0 ? (
                    <div className="space-y-4">
                      {activity.slice(0, 5).map(item => (
                        <div key={item.id} className="flex items-start gap-4 text-sm">
                          <div className="w-2 h-2 mt-1.5 rounded-full bg-primary/50" />
                          <div className="flex-1">
                            <p className="font-medium text-foreground">{item.title}</p>
                            <p className="text-muted-foreground">{item.subtitle}</p>
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(item.timestamp), "h:mm a")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No recent activity.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </Layout>
  );
}