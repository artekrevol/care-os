import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useGetSystemHealth,
  useProbeSystemHealthModule,
  useRetryAllFailedJobs,
  useDiscardAllFailedJobs,
} from "@workspace/api-client-react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Trash2,
  Play,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";

export default function SystemHealth() {
  const { toast } = useToast();
  const [adminToken, setAdminToken] = useState<string>(() => {
    return localStorage.getItem("careos.adminToken") ?? "";
  });

  const headers: Record<string, string> = adminToken
    ? { Authorization: `Bearer ${adminToken}` }
    : { "x-careos-role": "OWNER" };

  const { data, isLoading, refetch } = useGetSystemHealth({
    request: { headers } as any,
    query: { refetchInterval: 15000 } as any,
  } as any);

  const probeMut = useProbeSystemHealthModule({
    request: { headers } as any,
  } as any);
  const retryAllMut = useRetryAllFailedJobs({
    request: { headers } as any,
  } as any);
  const discardAllMut = useDiscardAllFailedJobs({
    request: { headers } as any,
  } as any);

  const [confirm, setConfirm] = useState<{
    queue: string;
    action: "retry" | "discard";
  } | null>(null);

  const onSaveToken = () => {
    localStorage.setItem("careos.adminToken", adminToken);
    toast({ title: "Token saved", description: "Admin token stored locally." });
    refetch();
  };

  const onProbe = async (module: string) => {
    try {
      const r = await probeMut.mutateAsync({ module });
      toast({
        title: r.ok ? `Probe OK: ${module}` : `Probe failed: ${module}`,
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      });
      refetch();
    } catch (err) {
      toast({
        title: "Probe error",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const onConfirmBulk = async () => {
    if (!confirm) return;
    const { queue, action } = confirm;
    setConfirm(null);
    try {
      const r =
        action === "retry"
          ? await retryAllMut.mutateAsync({ name: queue })
          : await discardAllMut.mutateAsync({ name: queue });
      toast({
        title: `${action === "retry" ? "Retried" : "Discarded"} ${r.affected}/${r.scanned} jobs`,
        description: r.errors.length > 0 ? `${r.errors.length} errors` : queue,
      });
      refetch();
    } catch (err) {
      toast({
        title: "Bulk action failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Activity className="h-8 w-8 text-primary" /> System Health
            </h1>
            <p className="text-muted-foreground mt-1">
              Per-service status, recent errors, and queue depths. Owner-only.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-refresh-health"
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Admin token</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 items-center">
            <Input
              type="password"
              placeholder="Bearer ADMIN_BEARER_TOKEN (or leave blank in dev)"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              data-testid="input-admin-token"
            />
            <Button
              variant="secondary"
              onClick={onSaveToken}
              data-testid="button-save-token"
            >
              Save
            </Button>
          </CardContent>
        </Card>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {data && (
          <>
            <div>
              <h2 className="text-lg font-semibold mb-3">Services</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.modules.map((m) => {
                  const healthy =
                    m.configured && m.errorCount24h === 0 && m.lastSuccessAt;
                  const warn =
                    m.configured && m.errorCount24h > 0 && m.errorCount24h < 5;
                  return (
                    <Card key={m.module} data-testid={`card-module-${m.module}`}>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center justify-between gap-2 text-base">
                          <span className="font-mono">{m.module}</span>
                          {!m.configured ? (
                            <Badge variant="secondary">not configured</Badge>
                          ) : healthy ? (
                            <Badge className="bg-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> healthy
                            </Badge>
                          ) : warn ? (
                            <Badge variant="secondary">
                              <AlertCircle className="h-3 w-3 mr-1" /> warning
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <XCircle className="h-3 w-3 mr-1" /> degraded
                            </Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-xs space-y-2">
                        <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                          <span>Errors (24h)</span>
                          <span className="text-foreground font-medium">
                            {m.errorCount24h}
                          </span>
                          <span>Last success</span>
                          <span className="text-foreground">
                            {m.lastSuccessAt
                              ? formatDistanceToNow(new Date(m.lastSuccessAt), {
                                  addSuffix: true,
                                })
                              : "never"}
                          </span>
                          {m.lastProbeAt && (
                            <>
                              <span>Last probe</span>
                              <span
                                className={
                                  m.lastProbeOk
                                    ? "text-foreground"
                                    : "text-destructive"
                                }
                              >
                                {format(new Date(m.lastProbeAt), "HH:mm:ss")}{" "}
                                {m.lastProbeOk ? "ok" : "fail"}
                              </span>
                            </>
                          )}
                        </div>
                        {m.lastProbeMessage && (
                          <p className="text-[11px] text-muted-foreground italic break-all">
                            {m.lastProbeMessage}
                          </p>
                        )}
                        {m.recentErrors.length > 0 && (
                          <details className="text-[11px]">
                            <summary className="cursor-pointer text-destructive">
                              {m.recentErrors.length} recent error
                              {m.recentErrors.length === 1 ? "" : "s"}
                            </summary>
                            <ul className="mt-1 space-y-1">
                              {m.recentErrors.slice(0, 5).map((e, i) => (
                                <li key={i} className="break-all">
                                  <span className="text-muted-foreground">
                                    {format(new Date(e.at), "HH:mm:ss")}
                                  </span>{" "}
                                  {e.message}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onProbe(m.module)}
                          disabled={probeMut.isPending}
                          data-testid={`button-probe-${m.module}`}
                        >
                          <Play className="h-3 w-3 mr-1" /> Test connection
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold mb-3">Background queues</h2>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs">
                      <tr>
                        <th className="text-left px-3 py-2">Queue</th>
                        <th className="text-right px-3 py-2">Waiting</th>
                        <th className="text-right px-3 py-2">Active</th>
                        <th className="text-right px-3 py-2">Delayed</th>
                        <th className="text-right px-3 py-2">Failed</th>
                        <th className="text-right px-3 py-2">Completed</th>
                        <th className="text-right px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.queues.map((q) => (
                        <tr key={q.name} data-testid={`row-queue-${q.name}`}>
                          <td className="px-3 py-2 font-mono text-xs">
                            {q.name}
                          </td>
                          <td className="text-right px-3 py-2">{q.waiting}</td>
                          <td className="text-right px-3 py-2">{q.active}</td>
                          <td className="text-right px-3 py-2">{q.delayed}</td>
                          <td
                            className={`text-right px-3 py-2 ${q.failed > 0 ? "text-destructive font-semibold" : ""}`}
                          >
                            {q.failed}
                          </td>
                          <td className="text-right px-3 py-2 text-muted-foreground">
                            {q.completed}
                          </td>
                          <td className="text-right px-3 py-2">
                            <div className="inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={q.failed === 0}
                                onClick={() =>
                                  setConfirm({
                                    queue: q.name,
                                    action: "retry",
                                  })
                                }
                                data-testid={`button-retry-${q.name}`}
                              >
                                <RefreshCw className="h-3 w-3 mr-1" /> Retry
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={q.failed === 0}
                                onClick={() =>
                                  setConfirm({
                                    queue: q.name,
                                    action: "discard",
                                  })
                                }
                                data-testid={`button-discard-${q.name}`}
                              >
                                <Trash2 className="h-3 w-3 mr-1" /> Discard
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        <AlertDialog
          open={confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm?.action === "retry"
                  ? "Retry all failed jobs?"
                  : "Discard all failed jobs?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Queue: <span className="font-mono">{confirm?.queue}</span>.
                {confirm?.action === "discard"
                  ? " Discarded jobs cannot be recovered."
                  : " Each job will be returned to the waiting state."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirmBulk}
                data-testid="button-confirm-bulk"
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}
