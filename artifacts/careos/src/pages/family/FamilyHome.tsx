import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetFamilyClientSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Calendar, AlertTriangle, FileText, CheckCircle2 } from "lucide-react";
import { FamilyLayout, loadFamilyUser, type FamilyUser } from "./FamilyLayout";

export default function FamilyHome() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<FamilyUser | null>(null);

  useEffect(() => {
    const u = loadFamilyUser();
    if (!u) {
      navigate("/family/login");
      return;
    }
    setUser(u);
  }, [navigate]);

  const { data, isLoading } = useGetFamilyClientSummary(user?.clientId ?? "", {
    query: { enabled: !!user } as never,
  });

  if (!user) return null;

  return (
    <FamilyLayout user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-family-home">
            {data?.clientName ? `${data.clientName}'s care` : "Care updates"}
          </h1>
          <p className="text-muted-foreground text-sm">
            Recent visits, notes, and incidents from the agency.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Next visit
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-semibold" data-testid="text-next-visit">
                    {data.nextScheduledVisit
                      ? format(new Date(data.nextScheduledVisit), "EEE MMM d, h:mm a")
                      : "None scheduled"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Recent visits
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold" data-testid="text-visit-count">
                    {data.recentVisits.length}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Open incidents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold" data-testid="text-open-incidents">
                    {data.openIncidentCount}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Recent visits</h2>
              {data.recentVisits.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground text-sm">
                    No visits in the last 30 days.
                  </CardContent>
                </Card>
              ) : (
                data.recentVisits.map((v) => (
                  <Card key={v.id} data-testid={`card-visit-${v.id}`}>
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start gap-3 flex-wrap">
                        <div>
                          <CardTitle className="text-base">
                            {v.clockInTime
                              ? format(new Date(v.clockInTime), "EEE MMM d, h:mm a")
                              : "Visit"}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            with {v.caregiverName}
                            {v.durationMinutes
                              ? ` · ${Math.round(v.durationMinutes / 60 * 10) / 10}h`
                              : ""}
                          </p>
                        </div>
                        <Badge
                          variant={
                            v.verificationStatus === "VERIFIED"
                              ? "default"
                              : v.verificationStatus === "EXCEPTION"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {v.verificationStatus}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {v.tasksCompleted.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            Tasks completed
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {v.tasksCompleted.map((t, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {v.notes.length > 0 && (
                        <div className="space-y-2">
                          {v.notes.map((n) => (
                            <div
                              key={n.id}
                              className="bg-muted/40 rounded-md p-3 text-sm border-l-2 border-primary"
                            >
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                <FileText className="h-3 w-3" />
                                Caregiver note
                              </div>
                              <p>{n.body}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {v.incidents.length > 0 && (
                        <div className="space-y-2">
                          {v.incidents.map((i) => (
                            <div
                              key={i.id}
                              className="bg-destructive/5 rounded-md p-3 text-sm border-l-2 border-destructive"
                              data-testid={`incident-${i.id}`}
                            >
                              <div className="flex items-center gap-2 text-xs text-destructive mb-1">
                                <AlertTriangle className="h-3 w-3" />
                                Incident · {i.severity} · {i.category}
                              </div>
                              <p>{i.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Could not load care summary.
            </CardContent>
          </Card>
        )}
      </div>
    </FamilyLayout>
  );
}
