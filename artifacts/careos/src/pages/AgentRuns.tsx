import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useListAgentRuns } from "@workspace/api-client-react";
import { Bot, Clock, DollarSign, ExternalLink, Activity } from "lucide-react";
import { format } from "date-fns";

export default function AgentRuns() {
  const { data: runs, isLoading } = useListAgentRuns(undefined, {
    query: { refetchInterval: 4000 },
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" /> Agent Runs
          </h1>
          <p className="text-muted-foreground mt-1">
            Every AI invocation with model, prompt version, latency, and cost.
            Background queues live at{" "}
            <a
              href="/admin/jobs"
              target="_blank"
              rel="noreferrer"
              className="underline inline-flex items-center gap-1"
            >
              /admin/jobs <ExternalLink className="h-3 w-3" />
            </a>
            .
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> Recent runs
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {isLoading && (
              <p className="text-sm text-muted-foreground py-4">Loading…</p>
            )}
            {runs?.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                No agent runs yet. Upload a referral or document to trigger
                one.
              </p>
            )}
            {runs?.map((r) => (
              <div
                key={r.id}
                className="py-3 flex items-center justify-between gap-3"
                data-testid={`row-agent-run-${r.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.agentName}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {r.promptVersion}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {r.model}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {r.outputSummary ?? r.inputSummary ?? "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  {r.latencyMs != null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {(r.latencyMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  {r.costUsd != null && (
                    <span className="inline-flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {r.costUsd.toFixed(4)}
                    </span>
                  )}
                  {r.confidence != null && (
                    <Badge
                      variant={
                        r.confidence >= 0.85
                          ? "default"
                          : r.confidence >= 0.7
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {(r.confidence * 100).toFixed(0)}%
                    </Badge>
                  )}
                  <Badge
                    variant={
                      r.status === "SUCCEEDED"
                        ? "default"
                        : r.status === "FAILED"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="hidden sm:inline">
                    {format(new Date(r.startedAt), "MMM d, HH:mm:ss")}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
