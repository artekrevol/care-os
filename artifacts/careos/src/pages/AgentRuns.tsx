import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useListAgentRuns,
  useGetAgentRunCostSummary,
  useRetryAgentRun,
  useGetAgentRunOutput,
  getListAgentRunsQueryKey,
  getGetAgentRunOutputQueryKey,
} from "@workspace/api-client-react";
import {
  Bot,
  Clock,
  DollarSign,
  ExternalLink,
  Activity,
  RefreshCw,
  Filter,
} from "lucide-react";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";

const STATUS_FILTERS = [
  "SUCCEEDED",
  "FAILED",
  "TIMEOUT",
  "LOW_CONFIDENCE",
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

type Range = "24h" | "7d" | "30d";

export default function AgentRuns() {
  const { toast } = useToast();
  const [statuses, setStatuses] = useState<Set<StatusFilter>>(new Set());
  const [agentName, setAgentName] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [range, setRange] = useState<Range>("24h");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(0);
  const [adminToken] = useState<string>(
    () => localStorage.getItem("careos.adminToken") ?? "",
  );

  const adminHeaders: Record<string, string> = adminToken
    ? { Authorization: `Bearer ${adminToken}` }
    : { "x-careos-role": "OWNER" };

  const params = useMemo(() => {
    const p: Record<string, unknown> = {
      limit: pageSize,
      offset: page * pageSize,
    };
    const s = Array.from(statuses);
    if (s.length > 0) p["status"] = s;
    if (agentName.trim()) p["agentName"] = agentName.trim();
    if (from) p["from"] = new Date(from).toISOString();
    if (to) p["to"] = new Date(to).toISOString();
    return p;
  }, [statuses, agentName, from, to, pageSize, page]);

  // Reset to first page whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [statuses, agentName, from, to, pageSize]);

  const { data, isLoading, refetch } = useListAgentRuns(params, {
    request: { headers: adminHeaders },
    query: {
      queryKey: getListAgentRunsQueryKey(params),
      refetchInterval: 5000,
    },
  });

  const cost = useGetAgentRunCostSummary(
    { range },
    { request: { headers: adminHeaders } },
  );

  const retryMut = useRetryAgentRun({
    request: { headers: adminHeaders },
  });

  const items = data?.items ?? [];
  const selected = items.find((r) => r.id === selectedId) ?? null;

  // Lazy-load the full input/output artifact bytes when a row is opened.
  const output = useGetAgentRunOutput(selectedId ?? "", {
    request: { headers: adminHeaders },
    query: {
      queryKey: getGetAgentRunOutputQueryKey(selectedId ?? ""),
      enabled: !!selectedId,
    },
  });

  const toggleStatus = (s: StatusFilter) => {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const onRetry = async (id: string) => {
    try {
      const r = await retryMut.mutateAsync({ id });
      toast({
        title: r.ok ? "Retry queued" : "Retry not available",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      });
      refetch();
    } catch (err) {
      toast({
        title: "Retry failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

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
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Cost rollup
              </span>
              <Select
                value={range}
                onValueChange={(v) => setRange(v as Range)}
              >
                <SelectTrigger
                  className="w-32 h-8"
                  data-testid="select-cost-range"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cost.isLoading && (
              <p className="text-xs text-muted-foreground">Loading…</p>
            )}
            {cost.data && (
              <div className="space-y-3">
                <div className="flex gap-6 text-sm flex-wrap">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Total runs
                    </div>
                    <div className="font-semibold">
                      {cost.data.totalRuns}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Total cost
                    </div>
                    <div className="font-semibold">
                      ${cost.data.totalCostUsd.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Input tokens
                    </div>
                    <div className="font-semibold">
                      {cost.data.totalInputTokens.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Output tokens
                    </div>
                    <div className="font-semibold">
                      {cost.data.totalOutputTokens.toLocaleString()}
                    </div>
                  </div>
                </div>
                {cost.data.byAgent.length > 0 && (
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left py-1">Agent</th>
                        <th className="text-right py-1">Runs</th>
                        <th className="text-right py-1">OK</th>
                        <th className="text-right py-1">Fail</th>
                        <th className="text-right py-1">Avg conf</th>
                        <th className="text-right py-1">Avg latency</th>
                        <th className="text-right py-1">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {cost.data.byAgent.map((a) => (
                        <tr key={a.agentName}>
                          <td className="py-1 font-mono">{a.agentName}</td>
                          <td className="text-right py-1">{a.runs}</td>
                          <td className="text-right py-1">{a.succeeded}</td>
                          <td
                            className={`text-right py-1 ${a.failed > 0 ? "text-destructive" : ""}`}
                          >
                            {a.failed}
                          </td>
                          <td className="text-right py-1">
                            {a.avgConfidence != null
                              ? `${(a.avgConfidence * 100).toFixed(0)}%`
                              : "—"}
                          </td>
                          <td className="text-right py-1">
                            {a.avgLatencyMs != null
                              ? `${(a.avgLatencyMs / 1000).toFixed(2)}s`
                              : "—"}
                          </td>
                          <td className="text-right py-1">
                            ${a.costUsd.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {STATUS_FILTERS.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statuses.has(s) ? "default" : "outline"}
                  onClick={() => toggleStatus(s)}
                  data-testid={`chip-status-${s}`}
                >
                  {s.replace("_", " ")}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setStatuses(new Set());
                  setAgentName("");
                  setFrom("");
                  setTo("");
                }}
                data-testid="button-clear-filters"
              >
                Clear
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input
                placeholder="agent name (e.g. intake_referral)"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                data-testid="input-filter-agent"
              />
              <Input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                data-testid="input-filter-from"
              />
              <Input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                data-testid="input-filter-to"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {data
                ? `${items.length} of ${data.total} runs`
                : "Recent runs"}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {isLoading && (
              <p className="text-sm text-muted-foreground py-4">Loading…</p>
            )}
            {!isLoading && items.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                No agent runs match the filters.
              </p>
            )}
            {!isLoading && items.length > 0 && data && (
              <div className="flex items-center justify-between py-2 text-xs text-muted-foreground">
                <div>
                  Showing {page * pageSize + 1}–
                  {page * pageSize + items.length} of {data.total}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => setPageSize(Number(v))}
                  >
                    <SelectTrigger
                      className="h-7 w-24"
                      data-testid="select-page-size"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25 / page</SelectItem>
                      <SelectItem value="50">50 / page</SelectItem>
                      <SelectItem value="100">100 / page</SelectItem>
                      <SelectItem value="200">200 / page</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    data-testid="button-prev-page"
                  >
                    Prev
                  </Button>
                  <span>
                    Page {page + 1} of{" "}
                    {Math.max(1, Math.ceil(data.total / pageSize))}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(page + 1) * pageSize >= data.total}
                    onClick={() => setPage((p) => p + 1)}
                    data-testid="button-next-page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
            {items.map((r) => (
              <div
                key={r.id}
                className="py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/40 -mx-3 px-3 rounded"
                data-testid={`row-agent-run-${r.id}`}
                onClick={() => setSelectedId(r.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
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
                        : r.status === "FAILED" || r.status === "TIMEOUT"
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

        <Sheet
          open={selected !== null}
          onOpenChange={(o) => !o && setSelectedId(null)}
        >
          <SheetContent className="overflow-y-auto sm:max-w-xl">
            {selected && (
              <>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5" /> {selected.agentName}
                  </SheetTitle>
                  <SheetDescription>
                    Run id <span className="font-mono">{selected.id}</span> ·{" "}
                    {format(new Date(selected.startedAt), "PPpp")}
                  </SheetDescription>
                </SheetHeader>
                <div className="space-y-4 mt-4 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Status">
                      <Badge
                        variant={
                          selected.status === "SUCCEEDED"
                            ? "default"
                            : selected.status === "FAILED" ||
                                selected.status === "TIMEOUT"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {selected.status}
                      </Badge>
                    </Field>
                    <Field label="Prompt version">
                      <code className="text-xs">{selected.promptVersion}</code>
                    </Field>
                    <Field label="Model">
                      <code className="text-xs">{selected.model}</code>
                    </Field>
                    <Field label="Latency">
                      {selected.latencyMs != null
                        ? `${(selected.latencyMs / 1000).toFixed(2)}s`
                        : "—"}
                    </Field>
                    <Field label="Confidence">
                      {selected.confidence != null
                        ? `${(selected.confidence * 100).toFixed(1)}%`
                        : "—"}
                    </Field>
                    <Field label="Cost">
                      {selected.costUsd != null
                        ? `$${selected.costUsd.toFixed(4)}`
                        : "—"}
                    </Field>
                    <Field label="Input tokens">
                      {selected.inputTokens ?? "—"}
                    </Field>
                    <Field label="Output tokens">
                      {selected.outputTokens ?? "—"}
                    </Field>
                    <Field label="Triggered by">
                      <code className="text-xs">
                        {selected.triggeredBy ?? "—"}
                      </code>
                    </Field>
                    <Field label="Trigger reason">
                      {selected.triggerReason ?? "—"}
                    </Field>
                  </div>
                  {selected.inputSummary && (
                    <Field label="Input summary" stacked>
                      <p className="whitespace-pre-wrap text-xs bg-muted p-2 rounded break-all">
                        {selected.inputSummary}
                      </p>
                    </Field>
                  )}
                  {selected.outputSummary && (
                    <Field label="Output summary" stacked>
                      <p className="whitespace-pre-wrap text-xs bg-muted p-2 rounded break-all">
                        {selected.outputSummary}
                      </p>
                    </Field>
                  )}
                  <Field label="Full model response" stacked>
                    {output.isLoading && (
                      <p className="text-xs text-muted-foreground">
                        Loading full content…
                      </p>
                    )}
                    {output.data?.outputContent ? (
                      <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded break-all max-h-96 overflow-auto">
                        {output.data.outputContent}
                        {output.data.truncated ? "\n…[truncated]" : ""}
                      </pre>
                    ) : output.data && !output.isLoading ? (
                      <p className="text-xs text-muted-foreground italic">
                        No stored output artifact for this run.
                      </p>
                    ) : null}
                  </Field>
                  {output.data?.inputContent && (
                    <Field label="Full input artifact" stacked>
                      <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded break-all max-h-64 overflow-auto">
                        {output.data.inputContent}
                      </pre>
                    </Field>
                  )}
                  {selected.error && (
                    <Field label="Error" stacked>
                      <p className="whitespace-pre-wrap text-xs bg-destructive/10 text-destructive p-2 rounded break-all">
                        {selected.error}
                      </p>
                    </Field>
                  )}
                  {(selected.inputRef || selected.outputRef) && (
                    <div className="text-xs text-muted-foreground space-y-1">
                      {selected.inputRef && (
                        <div>
                          input ref:{" "}
                          <code className="break-all">
                            {selected.inputRef}
                          </code>
                        </div>
                      )}
                      {selected.outputRef && (
                        <div>
                          output ref:{" "}
                          <code className="break-all">
                            {selected.outputRef}
                          </code>
                        </div>
                      )}
                    </div>
                  )}
                  {selected.status === "FAILED" ||
                  selected.status === "TIMEOUT" ? (
                    <Button
                      onClick={() => onRetry(selected.id)}
                      disabled={retryMut.isPending}
                      data-testid={`button-retry-run-${selected.id}`}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {retryMut.isPending ? "Retrying…" : "Retry agent"}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Retry is available only for failed or timed-out runs.
                    </p>
                  )}
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </Layout>
  );
}

function Field({
  label,
  children,
  stacked,
}: {
  label: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? "space-y-1" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
