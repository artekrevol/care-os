import { Layout } from "@/components/layout/Layout";
import { useGetCaregiver, useCreateCaregiverDocument, getGetCaregiverQueryKey, getListCaregiverDocumentsQueryKey, DocumentType } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserSquare2, FileCheck, MapPin, Plus } from "lucide-react";
import { format } from "date-fns";
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

const docSchema = z.object({
  documentType: z.enum([
    DocumentType.BACKGROUND_CHECK, 
    DocumentType.TB_TEST, 
    DocumentType.CPR, 
    DocumentType.TRAINING, 
    DocumentType.LICENSE, 
    DocumentType.I9, 
    DocumentType.W4, 
    DocumentType.DIRECT_DEPOSIT
  ]),
  issuedDate: z.string().optional(),
  expirationDate: z.string().optional(),
});

export default function CaregiverDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: caregiver, isLoading } = useGetCaregiver(id!, { query: { enabled: !!id, queryKey: getGetCaregiverQueryKey(id!) } });
  
  const createDoc = useCreateCaregiverDocument();
  const queryClient = useQueryClient();
  const [isDocOpen, setIsDocOpen] = useState(false);

  const form = useForm<z.infer<typeof docSchema>>({
    resolver: zodResolver(docSchema),
    defaultValues: {
      documentType: DocumentType.BACKGROUND_CHECK,
      issuedDate: new Date().toISOString().split('T')[0],
      expirationDate: "",
    }
  });

  if (isLoading || !caregiver) {
    return <Layout><div className="space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div></Layout>;
  }

  const onSubmitDoc = (data: z.infer<typeof docSchema>) => {
    createDoc.mutate(
      { id: caregiver.id, data: { ...data, issuedDate: data.issuedDate || undefined, expirationDate: data.expirationDate || undefined } },
      {
        onSuccess: () => {
          toast.success("Document added");
          setIsDocOpen(false);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getGetCaregiverQueryKey(id!) });
          queryClient.invalidateQueries({ queryKey: getListCaregiverDocumentsQueryKey(id!) });
        },
        onError: () => toast.error("Failed to add document")
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              {caregiver.firstName} {caregiver.lastName}
              <Badge variant={caregiver.status === 'ACTIVE' ? 'default' : 'secondary'}>{caregiver.status}</Badge>
            </h1>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <MapPin className="h-4 w-4" /> {caregiver.addressCity}, {caregiver.addressState} &nbsp; • &nbsp; {caregiver.phone}
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserSquare2 className="h-5 w-5" /> Profile & Employment</CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Employment Type</p>
                <p>{caregiver.employmentType}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Hire Date</p>
                <p>{caregiver.hireDate ? format(new Date(caregiver.hireDate), "MMM d, yyyy") : "-"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pay Rate</p>
                <p>${caregiver.payRate.toFixed(2)}/h</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Vehicle Access</p>
                <p>{caregiver.hasVehicle ? "Yes" : "No"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-muted-foreground">Skills</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {caregiver.skills.map(s => <Badge key={s} variant="secondary">{s}</Badge>)}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2"><FileCheck className="h-5 w-5" /> Credentials</CardTitle>
              <Dialog open={isDocOpen} onOpenChange={setIsDocOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Document</DialogTitle>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmitDoc)} className="space-y-4">
                      <FormField control={form.control} name="documentType" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Document Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              {Object.values(DocumentType).map(type => (
                                <SelectItem key={type} value={type}>{type.replace('_', ' ')}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
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
                      <Button type="submit" className="w-full" disabled={createDoc.isPending}>Add Document</Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {caregiver.documents?.map(doc => (
                <div key={doc.id} className="space-y-1 border-b pb-2 last:border-0">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm">{doc.documentType.replace('_', ' ')}</span>
                    <Badge variant={
                      doc.status === 'VALID' ? 'default' : 
                      doc.status === 'EXPIRING' ? 'secondary' : 'destructive'
                    }>
                      {doc.status}
                    </Badge>
                  </div>
                  {doc.expirationDate && (
                    <p className="text-xs text-muted-foreground flex justify-between">
                      <span>Exp: {format(new Date(doc.expirationDate), "MMM d, yyyy")}</span>
                      <span className={doc.daysUntilExpiration! < 30 ? "text-destructive" : ""}>{doc.daysUntilExpiration} days left</span>
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}