import { Layout } from "@/components/layout/Layout";
import {
  useGetClient,
  useCreateClientAuthorization,
  useListClientDocuments,
  useUploadClientDocument,
  getGetClientQueryKey,
  getListClientAuthorizationsQueryKey,
  getListClientDocumentsQueryKey,
  PayerType,
} from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { User, HeartPulse, FileText, Phone, Activity, Plus, Upload, Sparkles, AlertTriangle, FolderOpen } from "lucide-react";
import { CarePlanSection } from "@/components/CarePlanSection";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      resolve(r.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  const uploadDoc = useUploadClientDocument();
  const { data: clientDocs } = useListClientDocuments(id!, {
    query: {
      enabled: !!id,
      queryKey: getListClientDocumentsQueryKey(id!),
    },
  });
  const queryClient = useQueryClient();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const docFileRef = useRef<HTMLInputElement>(null);

  const docPending =
    clientDocs?.some(
      (d) =>
        d.classificationStatus === "PENDING" ||
        d.classificationStatus === "RUNNING",
    ) ?? false;

  useEffect(() => {
    if (!docPending || !id) return;
    const t = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: getListClientDocumentsQueryKey(id),
      });
    }, 2000);
    return () => clearInterval(t);
  }, [docPending, queryClient, id]);

  const handleClientDocUpload = async (file: File) => {
    if (!id) return;
    const contentBase64 = await fileToBase64(file);
    uploadDoc.mutate(
      {
        id,
        data: {
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64,
        },
      },
      {
        onSuccess: () => {
          toast.success("Document uploaded — auto-classifying…");
          queryClient.invalidateQueries({
            queryKey: getListClientDocumentsQueryKey(id),
          });
        },
        onError: () => toast.error("Upload failed"),
      },
    );
  };

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

        <CarePlanSection
          clientId={client.id}
          authorizations={(client.authorizations ?? []).map((a) => ({
            id: a.id,
            authNumber: a.authNumber,
            status: a.status,
          }))}
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Client Documents</CardTitle>
            <input
              ref={docFileRef}
              type="file"
              className="hidden"
              data-testid="input-client-doc-upload"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleClientDocUpload(f);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => docFileRef.current?.click()}
              disabled={uploadDoc.isPending}
              data-testid="button-client-doc-upload"
            >
              <Upload className="h-4 w-4 mr-1" />
              {uploadDoc.isPending ? "Uploading…" : "Upload + Auto-Classify"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {clientDocs && clientDocs.length > 0 ? (
              clientDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="space-y-1 border-b pb-2 last:border-0"
                  data-testid={`client-doc-row-${doc.id}`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="font-medium text-sm truncate">{doc.documentType.replace('_', ' ')}</span>
                      {doc.classificationStatus === "DONE" && doc.classifiedType && (
                        <Sparkles className="h-3 w-3 text-primary shrink-0" />
                      )}
                      {doc.needsReview && (
                        <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(doc.classificationStatus === "PENDING" ||
                        doc.classificationStatus === "RUNNING") && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">classifying…</Badge>
                      )}
                      {doc.classificationStatus === "DONE" &&
                        doc.classificationConfidence != null && (
                          <Badge
                            variant={
                              doc.classificationConfidence >= 0.85 ? "default" :
                              doc.classificationConfidence >= 0.7 ? "secondary" : "destructive"
                            }
                            className="text-[10px] h-4 px-1.5"
                          >
                            {(doc.classificationConfidence * 100).toFixed(0)}%
                          </Badge>
                        )}
                      <Badge variant={
                        doc.status === 'VALID' ? 'default' :
                        doc.status === 'EXPIRING' ? 'secondary' : 'destructive'
                      }>
                        {doc.status}
                      </Badge>
                    </div>
                  </div>
                  {doc.originalFilename && (
                    <p className="text-[11px] text-muted-foreground truncate">{doc.originalFilename}</p>
                  )}
                  {doc.expirationDate && (
                    <p className="text-xs text-muted-foreground flex justify-between">
                      <span>Exp: {format(new Date(doc.expirationDate), "MMM d, yyyy")}</span>
                      <span className={doc.daysUntilExpiration! < 30 ? "text-destructive" : ""}>{doc.daysUntilExpiration} days left</span>
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No documents on file. Upload to auto-classify.</p>
            )}
          </CardContent>
        </Card>

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