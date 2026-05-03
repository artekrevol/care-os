import { Layout } from "@/components/layout/Layout";
import { useCreateClient, getListClientsQueryKey, PayerType } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const clientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  dob: z.string().min(1, "Date of birth is required"),
  primaryPayer: z.enum([
    PayerType.PRIVATE_PAY, 
    PayerType.VA_CCN, 
    PayerType.MEDICAID_HCBS, 
    PayerType.COUNTY_IHSS, 
    PayerType.LTC_INSURANCE
  ]),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  carePreferences: z.string().optional(),
  allergies: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
});

type FormValues = z.infer<typeof clientSchema>;

export default function ClientIntake() {
  const [, setLocation] = useLocation();
  const createClient = useCreateClient();
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      dob: "",
      primaryPayer: PayerType.PRIVATE_PAY,
      phone: "",
      email: "",
      addressLine1: "",
      city: "",
      state: "",
      postalCode: "",
      carePreferences: "",
      allergies: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
    }
  });

  const onSubmit = (data: FormValues) => {
    createClient.mutate(
      { data: { ...data, email: data.email || undefined } },
      {
        onSuccess: (res) => {
          toast.success("Client created successfully");
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setLocation(`/clients/${res.id}`);
        },
        onError: () => toast.error("Failed to create client")
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Client Intake</h1>
          <p className="text-muted-foreground mt-1">Register a new care recipient into the system.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dob" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Birth *</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="primaryPayer" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary Payer *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select payer" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="PRIVATE_PAY">Private Pay</SelectItem>
                        <SelectItem value="VA_CCN">VA Community Care</SelectItem>
                        <SelectItem value="MEDICAID_HCBS">Medicaid HCBS</SelectItem>
                        <SelectItem value="COUNTY_IHSS">County IHSS</SelectItem>
                        <SelectItem value="LTC_INSURANCE">LTC Insurance</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="sm:col-span-2">
                  <FormField control={form.control} name="addressLine1" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="state" render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="postalCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>ZIP Code</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Care Details</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <FormField control={form.control} name="carePreferences" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Care Preferences & Notes</FormLabel>
                      <FormControl><Textarea {...field} rows={3} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="sm:col-span-2">
                  <FormField control={form.control} name="allergies" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Allergies</FormLabel>
                      <FormControl><Input {...field} placeholder="e.g. Penicillin, Peanuts" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="emergencyContactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency Contact Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="emergencyContactPhone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency Contact Phone</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-4">
              <Button variant="outline" type="button" onClick={() => setLocation("/clients")}>Cancel</Button>
              <Button type="submit" disabled={createClient.isPending}>
                {createClient.isPending ? "Creating..." : "Complete Intake"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </Layout>
  );
}