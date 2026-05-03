import { Layout } from "@/components/layout/Layout";
import { useGetClient, useCreateClientAuthorization, getGetClientQueryKey, getListClientAuthorizationsQueryKey, PayerType } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { User, HeartPulse, FileText, Phone, Activity, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const authSchema = z.object({
  payer: z.enum([
    PayerType.PRIVATE_PAY, 
    PayerType.VA_CCN, 
    PayerType.MEDICAID_HCBS, 
    PayerType.COUNTY_IHSS, 
    PayerType.LTC_INSURANCE
  ]),
  authNumber: z.string().min(1, "Authorization number is required"),
  issuedDate: z.string().min(1, "Issue date is required"),
  expirationDate: z.string().min(1, "Expiration date is required"),
  approvedHoursPerWeek: z.coerce.number().min(1, "Must be positive"),
  approvedHoursTotal: z.coerce.number().min(1, "Must be positive"),
});

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: client, isLoading: isClientLoading } = useGetClient(id!, { query: { enabled: !!id, queryKey: getGetClientQueryKey(id!) } });
  
  const createAuth = useCreateClientAuthorization();
  const queryClient = useQueryClient();
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  const form = useForm<z.infer<typeof authSchema>>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      payer: PayerType.PRIVATE_PAY,
      authNumber: "",
      issuedDate: new Date().toISOString().split('T')[0],
      expirationDate: "",
      approvedHoursPerWeek: 0,
      approvedHoursTotal: 0,
    }
  });

  if (isClientLoading || !client) {
    return <Layout><div className="space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div></Layout>;
  }

  const onSubmitAuth = (data: z.infer<typeof authSchema>) => {
    createAuth.mutate(
      { id: client.id, data },
      {
        onSuccess: () => {
          toast.success("Authorization created");
          setIsAuthOpen(false);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id!) });
          queryClient.invalidateQueries({ queryKey: getListClientAuthorizationsQueryKey(id!) });
        },
        onError: () => toast.error("Failed to create authorization")
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              {client.firstName} {client.lastName}
              <Badge variant={client.status === 'ACTIVE' ? 'default' : 'secondary'}>{client.status.replace('_', ' ')}</Badge>
            </h1>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Phone className="h-4 w-4" /> {client.phone || "No phone"} &nbsp; • &nbsp; {client.addressLine1}, {client.city}
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Demographics & Care</CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Payer</p>
                <p>{client.primaryPayer.replace('_', ' ')}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">DOB</p>
                <p>{format(new Date(client.dob), "MMM d, yyyy")}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Languages</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {client.languages.map(l => <Badge key={l} variant="outline">{l}</Badge>)}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Allergies</p>
                <p className="text-destructive font-medium">{client.allergies || "None recorded"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-muted-foreground">Care Preferences</p>
                <p>{client.carePreferences || "No specific preferences"}</p>
              </div>
              <div className="sm:col-span-2 bg-muted p-3 rounded-md">
                <p className="text-sm font-medium text-muted-foreground flex items-center gap-1"><HeartPulse className="h-4 w-4"/> Emergency Contact</p>
                <p className="mt-1">{client.emergencyContactName} — {client.emergencyContactPhone}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Authorizations</CardTitle>
              <Dialog open={isAuthOpen} onOpenChange={setIsAuthOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Authorization</DialogTitle>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmitAuth)} className="space-y-4">
                      <FormField control={form.control} name="payer" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payer</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="PRIVATE_PAY">Private Pay</SelectItem>
                              <SelectItem value="VA_CCN">VA Community Care</SelectItem>
                              <SelectItem value="MEDICAID_HCBS">Medicaid HCBS</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="authNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Authorization Number</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="issuedDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Issued Date</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="expirationDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Expiration Date</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="approvedHoursPerWeek" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Hours/Week</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="approvedHoursTotal" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Total Hours</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <Button type="submit" className="w-full" disabled={createAuth.isPending}>Save Authorization</Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {client.authorizations?.map(auth => (
                <div key={auth.id} className="space-y-2 border-b pb-4 last:border-0">
                  <div className="flex justify-between">
                    <span className="font-semibold text-sm">{auth.authNumber}</span>
                    <Badge variant={auth.status === 'ACTIVE' ? 'default' : auth.status === 'EXPIRING_SOON' ? 'destructive' : 'secondary'}>{auth.status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Hours Remaining</span>
                      <span>{auth.hoursRemaining} / {auth.approvedHoursTotal}</span>
                    </div>
                    <Progress value={(auth.hoursUsed / auth.approvedHoursTotal) * 100} className="h-2" />
                  </div>
                  <p className="text-xs text-muted-foreground text-right">{auth.daysUntilExpiration} days left</p>
                </div>
              ))}
              {client.authorizations?.length === 0 && <p className="text-sm text-muted-foreground">No active authorizations.</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Recent Visits</CardTitle>
          </CardHeader>
          <CardContent>
            {client.recentVisits?.length > 0 ? (
              <div className="space-y-4">
                {client.recentVisits.map(visit => (
                  <div key={visit.id} className="flex justify-between items-center border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium">{format(new Date(visit.clockInTime || ''), "MMM d, yyyy")} with {visit.caregiverName}</p>
                      <p className="text-sm text-muted-foreground">{visit.durationMinutes} minutes • {visit.tasksCompleted.join(', ')}</p>
                    </div>
                    <Badge variant="outline">{visit.verificationStatus}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No recent visits found.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}