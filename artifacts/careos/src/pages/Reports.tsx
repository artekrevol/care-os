import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import {
  useGetCaregiverUtilizationReport,
  useGetClientHoursReport,
  useGetDocumentComplianceReport,
  useGetOvertimeForecastReport,
  useGetVisitVerificationReport,
  useGetAuthorizationPipelineReport,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileBarChart, Download, FileText } from "lucide-react";

interface SharedFilters {
  from: string;
  to: string;
  caregiverId: string;
  clientId: string;
  payer: string;
}

function buildQS(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function downloadUrl(path: string): string {
  return `${import.meta.env.BASE_URL}api${path}`;
}

function ExportButtons({
  endpoint,
  qs,
}: {
  endpoint: string;
  qs: string;
}) {
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        asChild
        data-testid={`btn-export-csv-${endpoint}`}
      >
        <a href={downloadUrl(`/reports/${endpoint}.csv${qs}`)}>
          <Download className="h-4 w-4 mr-2" /> CSV
        </a>
      </Button>
      <Button
        variant="outline"
        size="sm"
        asChild
        data-testid={`btn-export-pdf-${endpoint}`}
      >
        <a href={downloadUrl(`/reports/${endpoint}.pdf${qs}`)}>
          <FileText className="h-4 w-4 mr-2" /> PDF
        </a>
      </Button>
    </div>
  );
}

function FiltersBar({
  filters,
  setFilters,
  show,
}: {
  filters: SharedFilters;
  setFilters: (f: SharedFilters) => void;
  show: {
    dates?: boolean;
    caregiver?: boolean;
    client?: boolean;
    payer?: boolean;
  };
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      {show.dates && (
        <>
          <div>
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) =>
                setFilters({ ...filters, from: e.target.value })
              }
              data-testid="input-from"
              className="h-9 w-40"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              data-testid="input-to"
              className="h-9 w-40"
            />
          </div>
        </>
      )}
      {show.caregiver && (
        <div>
          <Label className="text-xs text-muted-foreground">Caregiver ID</Label>
          <Input
            value={filters.caregiverId}
            onChange={(e) =>
              setFilters({ ...filters, caregiverId: e.target.value })
            }
            placeholder="Optional"
            className="h-9 w-48"
            data-testid="input-caregiver"
          />
        </div>
      )}
      {show.client && (
        <div>
          <Label className="text-xs text-muted-foreground">Client ID</Label>
          <Input
            value={filters.clientId}
            onChange={(e) =>
              setFilters({ ...filters, clientId: e.target.value })
            }
            placeholder="Optional"
            className="h-9 w-48"
            data-testid="input-client"
          />
        </div>
      )}
      {show.payer && (
        <div>
          <Label className="text-xs text-muted-foreground">Payer</Label>
          <Input
            value={filters.payer}
            onChange={(e) => setFilters({ ...filters, payer: e.target.value })}
            placeholder="Optional"
            className="h-9 w-40"
            data-testid="input-payer"
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

// ---------------- Reports ----------------

function CaregiverUtilizationTab({ filters }: { filters: SharedFilters }) {
  const params = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    caregiverId: filters.caregiverId || undefined,
  };
  const qs = buildQS(params);
  const { data, isLoading } = useGetCaregiverUtilizationReport(params);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.rangeStart} → ${data.rangeEnd}` : "Loading…"}
        </p>
        <ExportButtons endpoint="caregiver-utilization" qs={qs} />
      </div>
      {data && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="Scheduled Hrs"
            value={data.totals.scheduledHours}
          />
          <StatCard
            label="Delivered Hrs"
            value={data.totals.deliveredHours}
          />
          <StatCard label="Overtime Hrs" value={data.totals.overtimeHours} />
          <StatCard label="Missed Visits" value={data.totals.missedVisits} />
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caregiver</TableHead>
                <TableHead className="text-right">Sched Hrs</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Util %</TableHead>
                <TableHead className="text-right">OT Hrs</TableHead>
                <TableHead className="text-right">OT %</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Missed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r) => (
                <TableRow key={r.caregiverId} data-testid={`row-cg-util-${r.caregiverId}`}>
                  <TableCell className="font-medium">{r.caregiverName}</TableCell>
                  <TableCell className="text-right">{r.scheduledHours}</TableCell>
                  <TableCell className="text-right">{r.deliveredHours}</TableCell>
                  <TableCell className="text-right">{r.utilizationPct}%</TableCell>
                  <TableCell className="text-right">{r.overtimeHours}</TableCell>
                  <TableCell className="text-right">{r.overtimePct}%</TableCell>
                  <TableCell className="text-right">{r.visitsCompleted}</TableCell>
                  <TableCell className="text-right">{r.missedVisits}</TableCell>
                </TableRow>
              ))}
              {data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No data
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ClientHoursTab({ filters }: { filters: SharedFilters }) {
  const params = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    clientId: filters.clientId || undefined,
    payer: filters.payer || undefined,
  };
  const qs = buildQS(params);
  const { data, isLoading } = useGetClientHoursReport(params);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.rangeStart} → ${data.rangeEnd}` : "Loading…"}
        </p>
        <ExportButtons endpoint="client-hours" qs={qs} />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Auth #</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="text-right">Drawdown %</TableHead>
                <TableHead className="text-right">Weekly Burn</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Projected Out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r) => (
                <TableRow key={r.authNumber} data-testid={`row-client-hours-${r.authNumber}`}>
                  <TableCell className="font-medium">{r.clientName}</TableCell>
                  <TableCell>{r.payer}</TableCell>
                  <TableCell className="font-mono text-xs">{r.authNumber}</TableCell>
                  <TableCell className="text-right">{r.approvedHoursTotal}</TableCell>
                  <TableCell className="text-right">{r.hoursDelivered}</TableCell>
                  <TableCell className="text-right">{r.hoursRemaining}</TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        r.drawdownPct >= 90
                          ? "destructive"
                          : r.drawdownPct >= 75
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {r.drawdownPct}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{r.weeklyBurnHours}</TableCell>
                  <TableCell>{r.expirationDate}</TableCell>
                  <TableCell>{r.projectedExhaustionDate ?? "—"}</TableCell>
                </TableRow>
              ))}
              {data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                    No data
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentComplianceTab({ filters }: { filters: SharedFilters }) {
  const params = { caregiverId: filters.caregiverId || undefined };
  const qs = buildQS(params);
  const { data, isLoading } = useGetDocumentComplianceReport(params);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {data ? `As of ${data.rangeEnd}` : "Loading…"}
        </p>
        <ExportButtons endpoint="document-compliance" qs={qs} />
      </div>
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Expired" value={data.totals.expired} />
          <StatCard label="Expiring (30d)" value={data.totals.expiring} />
          <StatCard
            label="Overdue Training"
            value={data.totals.overdueTraining}
          />
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caregiver</TableHead>
                <TableHead>Document Type</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead className="text-right">Days Until</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r, i) => (
                <TableRow key={`${r.caregiverId}-${r.documentType}-${i}`}>
                  <TableCell className="font-medium">{r.caregiverName}</TableCell>
                  <TableCell>{r.documentType}</TableCell>
                  <TableCell>{r.expirationDate ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {r.daysUntilExpiration ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "EXPIRED" || r.status === "OVERDUE_TRAINING"
                          ? "destructive"
                          : r.status === "EXPIRING"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    All documents current
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function OvertimeForecastTab({ filters }: { filters: SharedFilters }) {
  const params = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    caregiverId: filters.caregiverId || undefined,
  };
  const qs = buildQS(params);
  const { data, isLoading } = useGetOvertimeForecastReport(params);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {data
            ? `${data.rangeStart} → ${data.rangeEnd} • Rule: ${data.ruleName}`
            : "Loading…"}
        </p>
        <ExportButtons endpoint="overtime-forecast" qs={qs} />
      </div>
      {data && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="This Pd OT Hrs"
            value={data.totals.thisPeriodOvertimeHours}
          />
          <StatCard
            label="This Pd OT Cost"
            value={`$${data.totals.thisPeriodOvertimeCost.toFixed(2)}`}
          />
          <StatCard
            label="Next Pd OT Hrs"
            value={data.totals.nextPeriodOvertimeHours}
          />
          <StatCard
            label="Next Pd OT Cost"
            value={`$${data.totals.nextPeriodOvertimeCost.toFixed(2)}`}
          />
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caregiver</TableHead>
                <TableHead className="text-right">This Pd OT Hrs</TableHead>
                <TableHead className="text-right">This Pd OT $</TableHead>
                <TableHead className="text-right">Next Pd OT Hrs</TableHead>
                <TableHead className="text-right">Next Pd OT $</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r) => (
                <TableRow key={r.caregiverId}>
                  <TableCell className="font-medium">{r.caregiverName}</TableCell>
                  <TableCell className="text-right">{r.thisPeriodOvertimeHours}</TableCell>
                  <TableCell className="text-right">${r.thisPeriodOvertimeCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{r.nextPeriodOvertimeHours}</TableCell>
                  <TableCell className="text-right">${r.nextPeriodOvertimeCost.toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No projected overtime
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function VisitVerificationTab({ filters }: { filters: SharedFilters }) {
  const params = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    caregiverId: filters.caregiverId || undefined,
    clientId: filters.clientId || undefined,
  };
  const qs = buildQS(params);
  const { data, isLoading } = useGetVisitVerificationReport(params);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.rangeStart} → ${data.rangeEnd}` : "Loading…"}
        </p>
        <ExportButtons endpoint="visit-verification" qs={qs} />
      </div>
      {data && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="Total" value={data.totalVisits} />
          <StatCard label="Verified" value={data.verifiedCount} />
          <StatCard label="Exception" value={data.exceptionCount} />
          <StatCard
            label="Verify Rate"
            value={`${data.verificationRatePct}%`}
          />
          <StatCard
            label="Avg Min To Verify"
            value={data.averageMinutesToVerify ?? "—"}
          />
        </div>
      )}
      {data && data.exceptionTypes.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Exception Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.exceptionTypes.map((b) => (
                <Badge key={b.reason} variant="secondary">
                  {b.reason}: {b.count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caregiver</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Min To Verify</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.slice(0, 200).map((r) => (
                <TableRow key={r.visitId}>
                  <TableCell>{r.caregiverName}</TableCell>
                  <TableCell>{r.clientName}</TableCell>
                  <TableCell>{r.workDate}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "VERIFIED"
                          ? "outline"
                          : r.status === "EXCEPTION" || r.status === "REJECTED"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.exceptionReason ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.minutesToVerify ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No visits in range
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthorizationPipelineTab({ filters }: { filters: SharedFilters }) {
  const params = {
    clientId: filters.clientId || undefined,
    payer: filters.payer || undefined,
  };
  const qs = buildQS(params);
  const { data, isLoading } = useGetAuthorizationPipelineReport(params);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {data ? `As of ${data.rangeEnd}` : "Loading…"}
        </p>
        <ExportButtons endpoint="authorization-pipeline" qs={qs} />
      </div>
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Renewed" value={data.totals.renewed} />
          <StatCard label="Pending" value={data.totals.pending} />
          <StatCard label="At Risk" value={data.totals.atRisk} />
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Auth #</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead className="text-right">Days Until</TableHead>
                <TableHead className="text-right">Hrs Remaining</TableHead>
                <TableHead>Renewal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {data?.rows.map((r) => (
                <TableRow key={r.authorizationId}>
                  <TableCell className="font-medium">{r.clientName}</TableCell>
                  <TableCell>{r.payer}</TableCell>
                  <TableCell className="font-mono text-xs">{r.authNumber}</TableCell>
                  <TableCell>{r.expirationDate}</TableCell>
                  <TableCell className="text-right">{r.daysUntilExpiration}</TableCell>
                  <TableCell className="text-right">{r.hoursRemaining}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.renewalStatus === "AT_RISK"
                          ? "destructive"
                          : r.renewalStatus === "PENDING"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {r.renewalStatus}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No authorizations expiring soon
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState("caregiver-utilization");
  const [filters, setFilters] = useState<SharedFilters>({
    from: "",
    to: "",
    caregiverId: "",
    clientId: "",
    payer: "",
  });

  const filterShows: Record<
    string,
    { dates?: boolean; caregiver?: boolean; client?: boolean; payer?: boolean }
  > = {
    "caregiver-utilization": { dates: true, caregiver: true },
    "client-hours": { dates: true, client: true, payer: true },
    "document-compliance": { caregiver: true },
    "overtime-forecast": { dates: true, caregiver: true },
    "visit-verification": { dates: true, caregiver: true, client: true },
    "authorization-pipeline": { client: true, payer: true },
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FileBarChart className="h-8 w-8" /> Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            Operational and financial reports with CSV/PDF export.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="caregiver-utilization" data-testid="tab-cg-util">
              Caregiver Utilization
            </TabsTrigger>
            <TabsTrigger value="client-hours" data-testid="tab-client-hours">
              Client Hours
            </TabsTrigger>
            <TabsTrigger value="document-compliance" data-testid="tab-doc-compliance">
              Document Compliance
            </TabsTrigger>
            <TabsTrigger value="overtime-forecast" data-testid="tab-ot-forecast">
              OT Forecast
            </TabsTrigger>
            <TabsTrigger value="visit-verification" data-testid="tab-visit-verif">
              Visit Verification
            </TabsTrigger>
            <TabsTrigger value="authorization-pipeline" data-testid="tab-auth-pipeline">
              Auth Pipeline
            </TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <FiltersBar
              filters={filters}
              setFilters={setFilters}
              show={filterShows[tab] ?? {}}
            />
          </div>

          <TabsContent value="caregiver-utilization">
            <CaregiverUtilizationTab filters={filters} />
          </TabsContent>
          <TabsContent value="client-hours">
            <ClientHoursTab filters={filters} />
          </TabsContent>
          <TabsContent value="document-compliance">
            <DocumentComplianceTab filters={filters} />
          </TabsContent>
          <TabsContent value="overtime-forecast">
            <OvertimeForecastTab filters={filters} />
          </TabsContent>
          <TabsContent value="visit-verification">
            <VisitVerificationTab filters={filters} />
          </TabsContent>
          <TabsContent value="authorization-pipeline">
            <AuthorizationPipelineTab filters={filters} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
