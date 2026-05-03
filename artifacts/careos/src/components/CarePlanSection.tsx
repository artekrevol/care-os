import { useState } from "react";
import {
  useListClientCarePlans,
  useGetActiveCarePlan,
  useListTaskTemplates,
  useCreateCarePlan,
  useUpdateCarePlan,
  useSubmitCarePlan,
  useApproveCarePlan,
  useRejectCarePlan,
  useAcknowledgeCarePlan,
  useGenerateCarePlanFromAuthorization,
  getListClientCarePlansQueryKey,
  getGetActiveCarePlanQueryKey,
  CarePlanStatus,
  CarePlanTaskFrequency,
  type CarePlan,
  type CarePlanTask,
  type TaskTemplate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  ClipboardList,
  Sparkles,
  Plus,
  Send,
  Check,
  X,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { newId } from "@/lib/ids";

type Authorization = {
  id: string;
  authNumber: string;
  status: string;
};

interface Props {
  clientId: string;
  authorizations: Authorization[];
}

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "APPROVED") return "default";
  if (s === "REJECTED") return "destructive";
  if (s === "SUBMITTED") return "secondary";
  return "outline";
};

export function CarePlanSection({ clientId, authorizations }: Props) {
  const qc = useQueryClient();
  const { data: planList } = useListClientCarePlans(clientId, {
    query: { queryKey: getListClientCarePlansQueryKey(clientId) },
  });
  const { data: activePlan } = useGetActiveCarePlan(clientId, {
    query: { queryKey: getGetActiveCarePlanQueryKey(clientId) },
  });
  const { data: templatesData } = useListTaskTemplates();

  const create = useCreateCarePlan();
  const update = useUpdateCarePlan();
  const submit = useSubmitCarePlan();
  const approve = useApproveCarePlan();
  const reject = useRejectCarePlan();
  const acknowledge = useAcknowledgeCarePlan();
  const generate = useGenerateCarePlanFromAuthorization();

  const plans: CarePlan[] = planList ?? [];
  const templates: TaskTemplate[] = templatesData ?? [];

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingTasks, setEditingTasks] = useState<CarePlanTask[]>([]);
  const [editingRisks, setEditingRisks] = useState<string[]>([]);
  const [riskInput, setRiskInput] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [genAuthId, setGenAuthId] = useState<string>("");
  const [generateOpen, setGenerateOpen] = useState(false);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListClientCarePlansQueryKey(clientId) });
    qc.invalidateQueries({ queryKey: getGetActiveCarePlanQueryKey(clientId) });
  };

  const openEditor = (plan?: CarePlan) => {
    if (plan) {
      setSelectedPlanId(plan.id);
      setEditingTitle(plan.title);
      setEditingTasks(plan.tasks);
      setEditingRisks(plan.riskFactors);
    } else {
      setSelectedPlanId(null);
      setEditingTitle("New Care Plan");
      setEditingTasks([]);
      setEditingRisks([]);
    }
    setEditorOpen(true);
  };

  const addTemplate = (tpl: TaskTemplate) => {
    setEditingTasks((prev) => [
      ...prev,
      {
        id: newId("task"),
        templateId: tpl.id,
        category: tpl.category,
        title: tpl.title,
        instructions: tpl.description ?? "",
        frequency: tpl.defaultFrequency,
        ordering: prev.length,
        requiresPhoto: tpl.requiresPhoto,
      },
    ]);
  };

  const updateTask = (idx: number, patch: Partial<CarePlanTask>) => {
    setEditingTasks((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    );
  };
  const removeTask = (idx: number) => {
    setEditingTasks((prev) => prev.filter((_, i) => i !== idx));
  };

  const addRisk = () => {
    if (riskInput.trim()) {
      setEditingRisks((prev) => [...prev, riskInput.trim()]);
      setRiskInput("");
    }
  };

  const handleSave = () => {
    if (!editingTitle.trim()) {
      toast.error("Title required");
      return;
    }
    if (selectedPlanId) {
      update.mutate(
        {
          id: selectedPlanId,
          data: {
            title: editingTitle,
            tasks: editingTasks,
            riskFactors: editingRisks,
          },
        },
        {
          onSuccess: () => {
            toast.success("Care plan updated");
            setEditorOpen(false);
            invalidate();
          },
          onError: () => toast.error("Update failed (only DRAFT plans editable)"),
        },
      );
    } else {
      create.mutate(
        {
          data: {
            clientId,
            title: editingTitle,
            tasks: editingTasks,
            riskFactors: editingRisks,
          },
        },
        {
          onSuccess: () => {
            toast.success("Care plan created");
            setEditorOpen(false);
            invalidate();
          },
          onError: () => toast.error("Create failed"),
        },
      );
    }
  };

  const handleSubmit = (id: string) =>
    submit.mutate(
      { id, data: {} },
      {
        onSuccess: () => {
          toast.success("Submitted for approval");
          invalidate();
        },
        onError: () => toast.error("Submit failed"),
      },
    );

  const handleApprove = (id: string) =>
    approve.mutate(
      {
        id,
        data: { effectiveStart: new Date().toISOString().split("T")[0] },
      },
      {
        onSuccess: () => {
          toast.success("Approved & activated");
          invalidate();
        },
        onError: () => toast.error("Approve failed"),
      },
    );

  const handleReject = () => {
    if (!rejectingId || !rejectReason.trim()) return;
    reject.mutate(
      { id: rejectingId, data: { reason: rejectReason } },
      {
        onSuccess: () => {
          toast.success("Rejected");
          setRejectingId(null);
          setRejectReason("");
          invalidate();
        },
        onError: () => toast.error("Reject failed"),
      },
    );
  };

  const handleAck = (id: string) => {
    acknowledge.mutate(
      { id, data: { familyUserId: `fam_${clientId}` } },
      {
        onSuccess: () => {
          toast.success("Acknowledged");
          invalidate();
        },
        onError: () => toast.error("Acknowledge failed"),
      },
    );
  };

  const handleGenerate = () => {
    if (!genAuthId) return;
    generate.mutate(
      { id: clientId, data: { authorizationId: genAuthId } },
      {
        onSuccess: () => {
          toast.success("AI draft created");
          setGenerateOpen(false);
          setGenAuthId("");
          invalidate();
        },
        onError: () => toast.error("Generate failed"),
      },
    );
  };

  const categories = Array.from(new Set(templates.map((t) => t.category))).sort();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> Care Plans
          {activePlan && (
            <Badge variant="default" className="ml-2">
              Active v{activePlan.version}
            </Badge>
          )}
        </CardTitle>
        <div className="flex gap-2">
          <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={authorizations.length === 0}
              >
                <Sparkles className="h-4 w-4 mr-1" /> Generate from Auth
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>AI Care Plan Drafter</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Generate a draft from authorization scope.
                </p>
                <Select value={genAuthId} onValueChange={setGenAuthId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select authorization" />
                  </SelectTrigger>
                  <SelectContent>
                    {authorizations.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.authNumber} ({a.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleGenerate}
                  disabled={!genAuthId || generate.isPending}
                >
                  {generate.isPending ? "Generating..." : "Generate Draft"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="sm" onClick={() => openEditor()}>
            <Plus className="h-4 w-4 mr-1" /> New Plan
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No care plans yet.</p>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="border rounded-md p-3 space-y-2"
                data-testid={`care-plan-${plan.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {plan.title} <span className="text-muted-foreground">v{plan.version}</span>
                    </span>
                    <Badge variant={statusVariant(plan.status)}>{plan.status}</Badge>
                    {plan.isActive && <Badge>ACTIVE</Badge>}
                    {plan.sourceAgentRunId && (
                      <Badge variant="outline" className="gap-1">
                        <Sparkles className="h-3 w-3" /> AI
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {plan.status === CarePlanStatus.DRAFT && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditor(plan)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSubmit(plan.id)}
                          disabled={submit.isPending}
                        >
                          <Send className="h-3 w-3 mr-1" /> Submit
                        </Button>
                      </>
                    )}
                    {plan.status === CarePlanStatus.SUBMITTED && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleApprove(plan.id)}
                          disabled={approve.isPending}
                        >
                          <Check className="h-3 w-3 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRejectingId(plan.id)}
                        >
                          <X className="h-3 w-3 mr-1" /> Reject
                        </Button>
                      </>
                    )}
                    {plan.status === CarePlanStatus.APPROVED &&
                      plan.acknowledgments.length === 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAck(plan.id)}
                          disabled={acknowledge.isPending}
                        >
                          <ShieldCheck className="h-3 w-3 mr-1" /> Family Ack
                        </Button>
                      )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground flex gap-4 flex-wrap">
                  <span>{plan.tasks.length} tasks</span>
                  <span>{plan.riskFactors.length} risks</span>
                  <span>Created {format(new Date(plan.createdAt), "MMM d, yyyy")}</span>
                  {plan.acknowledgments.length > 0 && (
                    <span className="text-emerald-600">
                      Acknowledged by {plan.acknowledgments.map((a) => a.familyUserName).join(", ")}
                    </span>
                  )}
                  {plan.rejectionReason && (
                    <span className="text-destructive">Reason: {plan.rejectionReason}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Editor dialog */}
        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>
                {selectedPlanId ? "Edit Care Plan" : "New Care Plan"}
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1 pr-3">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Risk Factors</label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={riskInput}
                      onChange={(e) => setRiskInput(e.target.value)}
                      placeholder="e.g. Fall risk"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addRisk();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addRisk}>
                      Add
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {editingRisks.map((r, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() =>
                          setEditingRisks((prev) =>
                            prev.filter((_, idx) => idx !== i),
                          )
                        }
                      >
                        {r} ✕
                      </Badge>
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <label className="text-sm font-medium">
                    Tasks ({editingTasks.length})
                  </label>
                  <div className="space-y-2 mt-2">
                    {editingTasks.map((t, idx) => (
                      <div
                        key={t.id}
                        className="border rounded p-2 space-y-2"
                        data-testid={`task-row-${idx}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Input
                            value={t.title}
                            onChange={(e) => updateTask(idx, { title: e.target.value })}
                            className="font-medium"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeTask(idx)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Select
                            value={t.frequency}
                            onValueChange={(v) =>
                              updateTask(idx, { frequency: v as CarePlanTaskFrequency })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="DAILY">Daily</SelectItem>
                              <SelectItem value="WEEKLY">Weekly</SelectItem>
                              <SelectItem value="PER_VISIT">Per Visit</SelectItem>
                              <SelectItem value="PRN">As Needed (PRN)</SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-2 px-2">
                            <Checkbox
                              checked={t.requiresPhoto}
                              onCheckedChange={(c) =>
                                updateTask(idx, { requiresPhoto: !!c })
                              }
                            />
                            <span className="text-sm">Requires photo</span>
                          </div>
                        </div>
                        <Textarea
                          value={t.instructions ?? ""}
                          onChange={(e) =>
                            updateTask(idx, { instructions: e.target.value })
                          }
                          placeholder="Instructions"
                          rows={2}
                        />
                        <Badge variant="secondary" className="text-xs">
                          {t.category}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <label className="text-sm font-medium">
                    Add from Templates ({templates.length})
                  </label>
                  <Accordion type="multiple" className="mt-2">
                    {categories.map((cat) => (
                      <AccordionItem key={cat} value={cat}>
                        <AccordionTrigger className="text-sm">{cat}</AccordionTrigger>
                        <AccordionContent>
                          <div className="grid grid-cols-2 gap-2">
                            {templates
                              .filter((t) => t.category === cat)
                              .map((tpl) => (
                                <Button
                                  key={tpl.id}
                                  variant="outline"
                                  size="sm"
                                  className="justify-start h-auto py-2 text-left"
                                  onClick={() => addTemplate(tpl)}
                                  data-testid={`add-template-${tpl.id}`}
                                >
                                  <Plus className="h-3 w-3 mr-1 shrink-0" />
                                  <span className="truncate">{tpl.title}</span>
                                </Button>
                              ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={create.isPending || update.isPending}
                data-testid="save-care-plan"
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject dialog */}
        <Dialog
          open={!!rejectingId}
          onOpenChange={(o) => !o && setRejectingId(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Care Plan</DialogTitle>
            </DialogHeader>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection"
              rows={3}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectingId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={!rejectReason.trim() || reject.isPending}
              >
                Confirm Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
