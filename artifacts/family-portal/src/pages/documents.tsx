import { useAuth } from "@/lib/auth";
import { useListCarePlans } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { FileText, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function Documents() {
  const auth = useAuth();
  const clientId = auth?.clientId || "";

  // The prompt says: "Use the active care plan + any past care plans rendered as a document entry"
  const { data: carePlans, isLoading } = useListCarePlans(
    { clientId },
    { query: { enabled: !!clientId } as any }
  );

  const handleDownload = () => {
    // Fake print dialog as requested by the spec
    window.print();
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto w-full space-y-4">
        <Skeleton className="h-8 w-48 mb-8" />
        {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-medium text-foreground">Documents</h1>
        <p className="text-muted-foreground mt-2">Care plans and agency documents.</p>
      </div>

      {carePlans?.length === 0 ? (
        <Card className="bg-card/50 border-dashed shadow-none">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No documents</h3>
            <p className="text-muted-foreground text-sm">Documents will appear here when available.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {carePlans?.map((plan, idx) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              key={plan.id}
            >
              <Card className="border-none shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="w-10 h-10 rounded bg-secondary/30 flex items-center justify-center text-secondary-foreground shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate">{plan.title}</h3>
                    <p className="text-sm text-muted-foreground">Version {plan.version}</p>
                    <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                      <p>Status: <span className="font-medium text-foreground">{plan.status.replace("_", " ")}</span></p>
                      {plan.approvedAt && <p>Approved: {format(parseISO(plan.approvedAt), "MMM d, yyyy")}</p>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleDownload} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <Download className="w-5 h-5" />
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
