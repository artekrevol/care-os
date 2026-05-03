import { Layout } from "@/components/layout/Layout";
import { useListPayPeriods } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { format } from "date-fns";

export default function Payroll() {
  const { data: payPeriods, isLoading } = useListPayPeriods();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Payroll</h1>
            <p className="text-muted-foreground mt-1">Manage pay periods and time exports.</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Caregivers</TableHead>
                  <TableHead className="text-right">Total Hours</TableHead>
                  <TableHead className="text-right">Gross Pay</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading pay periods...</TableCell>
                  </TableRow>
                ) : payPeriods?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No pay periods found.</TableCell>
                  </TableRow>
                ) : (
                  payPeriods?.map((period) => (
                    <TableRow key={period.id}>
                      <TableCell className="font-medium">
                        {format(new Date(period.startDate), "MMM d")} - {format(new Date(period.endDate), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          period.status === 'OPEN' ? 'default' : 
                          period.status === 'CLOSED' ? 'secondary' : 'outline'
                        }>
                          {period.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{period.caregiverCount}</TableCell>
                      <TableCell className="text-right">
                        {(period.totalRegularHours + period.totalOvertimeHours + period.totalDoubleTimeHours).toFixed(2)}h
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${period.totalGrossPay.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/payroll/${period.id}`}>View</Link>
                        </Button>
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