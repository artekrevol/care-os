import { Layout } from "@/components/layout/Layout";
import { useListLaborRules, useGetActiveLaborRule, useSetActiveLaborRule, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Scale, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function LaborRules() {
  const { data: rules, isLoading: isRulesLoading } = useListLaborRules();
  const { data: activeRule, isLoading: isActiveLoading } = useGetActiveLaborRule();
  const setActiveRule = useSetActiveLaborRule();
  const queryClient = useQueryClient();

  const handleSetActive = (ruleId: string) => {
    setActiveRule.mutate(
      { data: { ruleId } },
      {
        onSuccess: () => {
          toast.success("Active labor rule updated successfully");
          queryClient.invalidateQueries({ queryKey: ['/api/labor-rules'] });
          queryClient.invalidateQueries({ queryKey: ['/api/labor-rules/active'] });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        },
        onError: () => {
          toast.error("Failed to update active labor rule");
        }
      }
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="bg-primary text-primary-foreground p-8 rounded-xl shadow-lg relative overflow-hidden">
          <div className="absolute right-0 top-0 opacity-10 pointer-events-none transform translate-x-1/4 -translate-y-1/4">
            <Scale className="w-64 h-64" />
          </div>
          <div className="relative z-10 max-w-3xl">
            <h1 className="text-3xl font-bold tracking-tight mb-2">State Labor Compliance Engine</h1>
            <p className="text-primary-foreground/80 text-lg leading-relaxed">
              This is CareOS's operational wedge. Unlike standard scheduling tools that hardcode a simple 40-hour week, our engine respects state-specific nuances — like California's 9-hour daily overtime for domestic workers, 7th consecutive day rules, and double-time thresholds. When scheduling shifts, this engine prevents costly violations before they happen.
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {isRulesLoading || isActiveLoading ? (
            <p className="text-muted-foreground">Loading rules...</p>
          ) : rules?.map((rule) => {
            const isActive = activeRule?.id === rule.id;
            
            return (
              <Card key={rule.id} className={isActive ? "border-primary shadow-md" : ""}>
                <CardHeader>
                  <div className="flex justify-between items-start mb-2">
                    <Badge variant={isActive ? "default" : "outline"} className="font-semibold">
                      {rule.state}
                    </Badge>
                    {isActive && <CheckCircle2 className="h-5 w-5 text-primary" />}
                  </div>
                  <CardTitle>{rule.name}</CardTitle>
                  <CardDescription>{rule.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Weekly Overtime</span>
                      <span className="font-medium">{rule.overtimeThresholdWeeklyMinutes ? `${rule.overtimeThresholdWeeklyMinutes / 60}h` : 'None'}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Daily Overtime</span>
                      <span className="font-medium">{rule.overtimeThresholdDailyMinutes ? `${rule.overtimeThresholdDailyMinutes / 60}h` : 'None'}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Daily Double-Time</span>
                      <span className="font-medium">{rule.doubleTimeThresholdDailyMinutes ? `${rule.doubleTimeThresholdDailyMinutes / 60}h` : 'None'}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">7th Day Consecutive Rule</span>
                      <span className="font-medium">{rule.seventhDayConsecutiveRule ? 'Yes' : 'No'}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Travel Time Billable</span>
                      <span className="font-medium">{rule.travelTimeBillable ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    variant={isActive ? "secondary" : "default"} 
                    className="w-full"
                    disabled={isActive || setActiveRule.isPending}
                    onClick={() => handleSetActive(rule.id)}
                  >
                    {isActive ? "Currently Active" : "Set as Active Rule"}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}