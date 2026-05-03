import { Layout } from "@/components/layout/Layout";
import { useListSchedules, useCreateSchedule, useListClients, useListCaregivers, getListSchedulesQueryKey, getGetDashboardSummaryQueryKey, getGetOvertimeProjectionQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Plus, AlertTriangle, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const scheduleSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  caregiverId: z.string().min(1, "Caregiver is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  serviceCode: z.string().min(1, "Service code is required"),
});

export default function Schedule() {
  const { data: schedules, isLoading } = useListSchedules();
  const { data: clients } = useListClients();
  const { data: caregivers } = useListCaregivers();
  
  const createSchedule = useCreateSchedule();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [conflicts, setConflicts] = useState<any[]>([]);

  const form = useForm<z.infer<typeof scheduleSchema>>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      clientId: "",
      caregiverId: "",
      startTime: "",
      endTime: "",
      serviceCode: "T1019",
    }
  });

  const onSubmit = (data: z.infer<typeof scheduleSchema>) => {
    setConflicts([]);
    createSchedule.mutate(
      { data },
      {
        onSuccess: (res) => {
          if (res.conflicts && res.conflicts.length > 0) {
            setConflicts(res.conflicts);
            // If there's a blocking conflict, don't close modal, just show errors.
            const hasBlock = res.conflicts.some(c => c.severity === 'BLOCK');
            if (!hasBlock) {
              toast.success("Shift created with warnings");
              setIsOpen(false);
              form.reset();
              refreshData();
            } else {
              toast.error("Shift creation blocked by compliance rules");
            }
          } else {
            toast.success("Shift created successfully");
            setIsOpen(false);
            form.reset();
            refreshData();
          }
        },
        onError: () => toast.error("Failed to create shift")
      }
    );
  };

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetOvertimeProjectionQueryKey() });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Schedule</h1>
            <p className="text-muted-foreground mt-1">Master calendar and shifts.</p>
          </div>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Create Shift</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Schedule Shift</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {conflicts.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {conflicts.map((c, i) => (
                        <Alert variant={c.severity === 'BLOCK' ? "destructive" : "default"} key={i} className={c.severity === 'WARNING' ? "border-amber-500 text-amber-600 bg-amber-50" : ""}>
                          {c.severity === 'BLOCK' ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4 !text-amber-500" />}
                          <AlertTitle>{c.severity === 'BLOCK' ? 'Compliance Block' : 'Warning'}</AlertTitle>
                          <AlertDescription>{c.message}</AlertDescription>
                        </Alert>
                      ))}
                    </div>
                  )}
                  <FormField control={form.control} name="clientId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="caregiverId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Caregiver</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select caregiver" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {caregivers?.map(c => <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="startTime" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Time</FormLabel>
                        <FormControl><Input type="datetime-local" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="endTime" render={({ field }) => (
                      <FormItem>
                        <FormLabel>End Time</FormLabel>
                        <FormControl><Input type="datetime-local" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="serviceCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service Code</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={createSchedule.isPending}>
                    {createSchedule.isPending ? "Validating & Creating..." : "Schedule Shift"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent className="p-6">
            {isLoading ? (
              <p className="text-muted-foreground">Loading schedule...</p>
            ) : schedules?.length === 0 ? (
              <p className="text-muted-foreground">No shifts scheduled.</p>
            ) : (
              <div className="space-y-4">
                {schedules?.map((shift) => (
                  <div key={shift.id} className="flex justify-between items-center p-4 border rounded-lg bg-card">
                    <div>
                      <p className="font-semibold text-lg">{format(new Date(shift.startTime), "MMM d, yyyy h:mm a")} - {format(new Date(shift.endTime), "h:mm a")}</p>
                      <p className="text-muted-foreground">{shift.clientName} • {shift.caregiverName}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{shift.status}</Badge>
                      <p className="text-sm mt-1">{shift.serviceCode}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}