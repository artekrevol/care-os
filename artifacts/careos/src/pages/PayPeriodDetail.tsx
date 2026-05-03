import { Layout } from "@/components/layout/Layout";
import { useGetPayPeriod, useClosePayPeriod, getGetPayPeriodQueryKey, getListPayPeriodsQueryKey } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Lock, Calendar } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function PayPeriodDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: period, isLoading } = useGetPayPeriod(id!, { query: { enabled: !!id, queryKey: getGetPayPeriodQueryKey(id!) } });
  const closePeriod = useClosePayPeriod();
  const queryClient = useQueryClient();

  if (isLoading || !period) {
    return <Layout><div className="space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div></Layout>;
  }

  const handleClose = () => {
    closePeriod.mutate(
      { id: period.id },
      {
        onSuccess: () => {
          toast.success("Pay period closed");
          queryClient.invalidateQueries({ queryKey: getGetPayPeriodQueryKey(id!) });
          queryClient.invalidateQueries({ queryKey: getListPayPeriodsQueryKey() });
        },
        onError: () => toast.error("Failed to close pay period")
      }
    );
  };

  const handleExport = () => {
    const url = `${import.meta.env.BASE_URL}api/pay-periods/${id}/export`;
    window.location.href = url;
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              Pay Period Details
              <Badge variant={period.status === 'OPEN' ? 'default' : 'secondary'}>{period.status}</Badge>
            </h1>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Calendar className="h-4 w-4" /> {format(new Date(period.startDate), "MMM d")} - {format(new Date(period.endDate), "MMM d, yyyy")}
            </p>
          </div>
          <div className="flex gap-2">
            {period.status === 'OPEN' && (
              <Button variant="secondary" onClick={handleClose} disabled={closePeriod.isPending}>
                <Lock className="w-4 h-4 mr-2" /> Close Period
              </Button>
            )}
            <Button variant="outline" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium text-muted-foreground mb-1">Total Caregivers</div>
              <div className="text-2xl font-bold">{period.caregiverCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium text-muted-foreground mb-1">Regular Hours</div>
              <div className="text-2xl font-bold">{period.totalRegularHours.toFixed(2)}h</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium text-muted-foreground mb-1">Premium Hours</div>
              <div className="text-2xl font-bold text-amber-600">
                {(period.totalOvertimeHours + period.totalDoubleTimeHours).toFixed(2)}h
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium text-muted-foreground mb-1">Gross Pay</div>
              <div className="text-2xl font-bold">${period.totalGrossPay.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Caregiver Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caregiver</TableHead>
                  <TableHead className="text-right">Reg Hrs</TableHead>
                  <TableHead className="text-right">OT Hrs</TableHead>
                  <TableHead className="text-right">DT Hrs</TableHead>
                  <TableHead className="text-right">Total Pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {period.byCaregiver.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No caregiver records.</TableCell>
                  </TableRow>
                ) : (
                  period.byCaregiver.map(cg => (
                    <TableRow key={cg.caregiverId}>
                      <TableCell className="font-medium">{cg.caregiverName}</TableCell>
                      <TableCell className="text-right">{(cg.regularMinutes / 60).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-amber-600">{(cg.overtimeMinutes / 60).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-destructive">{(cg.doubleTimeMinutes / 60).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-bold">${cg.totalPay.toFixed(2)}</TableCell>
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