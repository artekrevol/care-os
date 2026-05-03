import { Layout } from "@/components/layout/Layout";
import { useCreateCaregiver, getListCaregiversQueryKey, EmploymentType } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const caregiverSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  employmentType: z.enum([EmploymentType.W2, EmploymentType.NUMBER_1099]),
  payRate: z.coerce.number().min(0, "Pay rate must be positive"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  addressCity: z.string().optional(),
  addressState: z.string().optional(),
  hasVehicle: z.boolean().default(false),
  hireDate: z.string().optional(),
});

type FormValues = z.infer<typeof caregiverSchema>;

export default function CaregiverIntake() {
  const [, setLocation] = useLocation();
  const createCaregiver = useCreateCaregiver();
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(caregiverSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      employmentType: EmploymentType.W2,
      payRate: 15.00,
      phone: "",
      email: "",
      addressCity: "",
      addressState: "",
      hasVehicle: false,
      hireDate: new Date().toISOString().split('T')[0],
    }
  });

  const onSubmit = (data: FormValues) => {
    createCaregiver.mutate(
      { data: { ...data, email: data.email || undefined } },
      {
        onSuccess: (res) => {
          toast.success("Caregiver created successfully");
          queryClient.invalidateQueries({ queryKey: getListCaregiversQueryKey() });
          setLocation(`/caregivers/${res.id}`);
        },
        onError: () => toast.error("Failed to create caregiver")
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Caregiver Onboarding</h1>
          <p className="text-muted-foreground mt-1">Register a new caregiver workforce member.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
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
                <FormField control={form.control} name="addressCity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="addressState" render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Employment Details</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="employmentType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employment Type *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="W2">W-2 Employee</SelectItem>
                        <SelectItem value="1099">1099 Contractor</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="payRate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hourly Pay Rate ($) *</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="hireDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hire Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="hasVehicle" render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm mt-8">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Has Reliable Vehicle</FormLabel>
                      <p className="text-xs text-muted-foreground">Required for certain shift types</p>
                    </div>
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-4">
              <Button variant="outline" type="button" onClick={() => setLocation("/caregivers")}>Cancel</Button>
              <Button type="submit" disabled={createCaregiver.isPending}>
                {createCaregiver.isPending ? "Creating..." : "Complete Onboarding"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </Layout>
  );
}