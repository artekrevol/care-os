import { Layout } from "@/components/layout/Layout";
import { useListVisits, useVerifyVisit, useClockIn, useClockOut, getListVisitsQueryKey, VisitVerificationStatus, ClockMethod } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, MapPin, CheckCircle, XCircle, Pointer } from "lucide-react";

export default function Visits() {
  const [statusFilter, setStatusFilter] = useState<VisitVerificationStatus | "">("");
  const { data: visits, isLoading } = useListVisits({ status: statusFilter ? statusFilter : undefined });
  const verifyVisit = useVerifyVisit();
  const queryClient = useQueryClient();

  const handleVerify = (id: string, decision: "VERIFIED" | "REJECTED", notes: string) => {
    verifyVisit.mutate(
      { id, data: { decision, supervisorNotes: notes } },
      {
        onSuccess: () => {
          toast.success(`Visit ${decision.toLowerCase()}`);
          queryClient.invalidateQueries({ queryKey: getListVisitsQueryKey() });
        },
        onError: () => {
          toast.error("Failed to update visit verification");
        }
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Visits & EVV</h1>
            <p className="text-muted-foreground mt-1">Verification queue for electronic visit verification.</p>
          </div>
          <ManualClockDialog />
        </div>

        <Card>
          <div className="p-4 border-b flex gap-2">
            <Badge 
              variant={statusFilter === "" ? "default" : "outline"} 
              className="cursor-pointer"
              onClick={() => setStatusFilter("")}
            >
              All
            </Badge>
            <Badge 
              variant={statusFilter === "PENDING" ? "default" : "outline"} 
              className="cursor-pointer"
              onClick={() => setStatusFilter("PENDING")}
            >
              Pending
            </Badge>
            <Badge 
              variant={statusFilter === "EXCEPTION" ? "default" : "outline"} 
              className="cursor-pointer"
              onClick={() => setStatusFilter("EXCEPTION")}
            >
              Exception
            </Badge>
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caregiver</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Time (In - Out)</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading visits...</TableCell>
                  </TableRow>
                ) : visits?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No visits found.</TableCell>
                  </TableRow>
                ) : (
                  visits?.map((visit) => (
                    <TableRow key={visit.id}>
                      <TableCell className="font-medium">{visit.caregiverName}</TableCell>
                      <TableCell>{visit.clientName}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {visit.clockInTime ? format(new Date(visit.clockInTime), "MMM d, h:mm a") : "Missing"} - <br/>
                          {visit.clockOutTime ? format(new Date(visit.clockOutTime), "h:mm a") : "Active"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {visit.durationMinutes || 0}m</span>
                          <span className={`flex items-center gap-1 ${!visit.geoFenceMatch ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            <MapPin className="w-3 h-3" /> {visit.geoFenceMatch ? "Location Match" : "Location Mismatch"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          visit.verificationStatus === 'VERIFIED' ? 'default' : 
                          visit.verificationStatus === 'EXCEPTION' ? 'destructive' : 
                          visit.verificationStatus === 'REJECTED' ? 'secondary' : 'outline'
                        }>
                          {visit.verificationStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {(visit.verificationStatus === 'PENDING' || visit.verificationStatus === 'EXCEPTION') && (
                          <div className="flex justify-end gap-2">
                            <VerifyDialog 
                              visitId={visit.id} 
                              onConfirm={(notes) => handleVerify(visit.id, "VERIFIED", notes)} 
                              action="Verify"
                            />
                            <VerifyDialog 
                              visitId={visit.id} 
                              onConfirm={(notes) => handleVerify(visit.id, "REJECTED", notes)} 
                              action="Reject"
                            />
                          </div>
                        )}
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

function VerifyDialog({ visitId, onConfirm, action }: { visitId: string, onConfirm: (notes: string) => void, action: string }) {
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={action === "Verify" ? "default" : "secondary"} size="sm" className="h-8">
          {action === "Verify" ? <CheckCircle className="w-4 h-4 mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
          {action}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action} Visit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Supervisor Notes</label>
            <Textarea 
              placeholder="Add any verification notes here..." 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)} 
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              onConfirm(notes);
              setOpen(false);
            }}>
              Confirm {action}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Just for demo purposes so user can create visit data
function ManualClockDialog() {
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // In a real app this would be tied to caregiver context, here we just show the action to create mock visits
  const handleSimulate = () => {
    toast.info("This is a demo UI. Caregivers would use the mobile app to clock in/out with GPS validation.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Pointer className="w-4 h-4 mr-2" /> Mobile App Simulator</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simulator</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4 text-center text-muted-foreground">
          <p>This command center UI is for office staff.</p>
          <p>Caregivers clock in and out using the companion mobile app, which records GPS coordinates to trigger exceptions if they are outside the client's geofence.</p>
          <Button className="w-full mt-4" onClick={() => setOpen(false)}>Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}