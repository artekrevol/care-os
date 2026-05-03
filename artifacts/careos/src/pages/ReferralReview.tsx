import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useGetReferralDraft,
  useApproveReferralDraft,
  useRejectReferralDraft,
  getListReferralDraftsQueryKey,
  PayerType,
} from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FileText, Sparkles, Check, X } from "lucide-react";

type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "date" | "number";
  group: "client" | "authorization";
};

const CLIENT_FIELDS: FieldDef[] = [
  { key: "firstName", label: "First Name", group: "client" },
  { key: "lastName", label: "Last Name", group: "client" },
  { key: "dob", label: "Date of Birth", type: "date", group: "client" },
  { key: "phone", label: "Phone", group: "client" },
  { key: "email", label: "Email", group: "client" },
  { key: "addressLine1", label: "Address", group: "client" },
  { key: "city", label: "City", group: "client" },
  { key: "state", label: "State", group: "client" },
  { key: "postalCode", label: "ZIP", group: "client" },
  { key: "primaryPayer", label: "Payer", group: "client" },
  { key: "allergies", label: "Allergies", group: "client" },
  { key: "carePreferences", label: "Care Preferences", group: "client" },
  { key: "emergencyContactName", label: "Emergency Contact", group: "client" },
  { key: "emergencyContactPhone", label: "Emergency Phone", group: "client" },
];

const AUTH_FIELDS: FieldDef[] = [
  { key: "payer", label: "Payer", group: "authorization" },
  { key: "authNumber", label: "Auth #", group: "authorization" },
  { key: "issuedDate", label: "Issued", type: "date", group: "authorization" },
  {
    key: "expirationDate",
    label: "Expires",
    type: "date",
    group: "authorization",
  },
  {
    key: "approvedHoursPerWeek",
    label: "Hrs/Week",
    type: "number",
    group: "authorization",
  },
  {
    key: "approvedHoursTotal",
    label: "Total Hrs",
    type: "number",
    group: "authorization",
  },
];

function ConfBadge({ conf }: { conf: number | undefined }) {
  if (conf == null) return null;
  const v = Math.round(conf * 100);
  const variant =
    conf >= 0.85 ? "default" : conf >= 0.7 ? "secondary" : "destructive";
  return (
    <Badge variant={variant} className="text-[10px] h-4 px-1.5">
      {v}%
    </Badge>
  );
}

export default function ReferralReview() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: draft, refetch } = useGetReferralDraft(id!, {
    query: { enabled: !!id, refetchInterval: 2000 } as any,
  });
  const approve = useApproveReferralDraft();
  const reject = useRejectReferralDraft();

  const fields = (draft?.parsedFields as Record<string, unknown>) ?? {};
  const clientObj = (fields["client"] ?? {}) as Record<string, unknown>;
  const authObj = (fields["authorization"] ?? {}) as Record<string, unknown>;
  const fieldConfidence = (fields["fieldConfidence"] ?? {}) as Record<
    string,
    number
  >;
  const isStub = (fields["_stub"] as boolean | undefined) ?? false;

  const [client, setClient] = useState<Record<string, unknown>>({});
  const [auth, setAuth] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (Object.keys(clientObj).length > 0) setClient({ ...clientObj });
    if (Object.keys(authObj).length > 0) setAuth({ ...authObj });
  }, [draft?.id, draft?.confidence]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready =
    draft?.status === "REVIEW" || draft?.status === "ACCEPTED" || draft?.status === "REJECTED";

  const handleApprove = () => {
    if (!client["firstName"] || !client["lastName"] || !client["dob"]) {
      toast.error("Client first name, last name, and DOB are required");
      return;
    }
    const c: Record<string, unknown> = {
      firstName: client["firstName"],
      lastName: client["lastName"],
      dob: client["dob"],
      phone: client["phone"] ?? undefined,
      email: client["email"] ?? undefined,
      addressLine1: client["addressLine1"] ?? undefined,
      city: client["city"] ?? undefined,
      state: client["state"] ?? undefined,
      postalCode: client["postalCode"] ?? undefined,
      primaryPayer: client["primaryPayer"] ?? PayerType.PRIVATE_PAY,
      languages: (client["languages"] as string[]) ?? ["English"],
      allergies: client["allergies"] ?? undefined,
      carePreferences: client["carePreferences"] ?? undefined,
      emergencyContactName: client["emergencyContactName"] ?? undefined,
      emergencyContactPhone: client["emergencyContactPhone"] ?? undefined,
    };
    let a: Record<string, unknown> | undefined;
    if (auth["authNumber"] && auth["expirationDate"]) {
      a = {
        payer: auth["payer"] ?? c["primaryPayer"],
        authNumber: auth["authNumber"],
        issuedDate:
          auth["issuedDate"] ??
          new Date().toISOString().slice(0, 10),
        expirationDate: auth["expirationDate"],
        approvedHoursPerWeek: Number(auth["approvedHoursPerWeek"] ?? 0),
        approvedHoursTotal: Number(auth["approvedHoursTotal"] ?? 0),
        scopeOfCare: (auth["scopeOfCare"] as string[]) ?? [],
      };
    }
    approve.mutate(
      { id: id!, data: { client: c as never, authorization: a as never } },
      {
        onSuccess: (res) => {
          toast.success("Client created from referral");
          queryClient.invalidateQueries({
            queryKey: getListReferralDraftsQueryKey(),
          });
          setLocation(`/clients/${res.clientId}`);
        },
        onError: (e: unknown) => {
          const msg =
            e && typeof e === "object" && "message" in e
              ? String((e as { message: unknown }).message)
              : "Failed to approve";
          toast.error(msg);
        },
      },
    );
  };

  const handleReject = () => {
    reject.mutate(
      { id: id! },
      {
        onSuccess: () => {
          toast.success("Referral rejected");
          queryClient.invalidateQueries({
            queryKey: getListReferralDraftsQueryKey(),
          });
          void refetch();
        },
      },
    );
  };

  const renderField = (f: FieldDef) => {
    const obj = f.group === "client" ? client : auth;
    const setter = f.group === "client" ? setClient : setAuth;
    const path = `${f.group}.${f.key}`;
    const conf = fieldConfidence[path];
    const lowConf = conf != null && conf < 0.7;
    return (
      <div key={path} className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{f.label}</Label>
          <ConfBadge conf={conf} />
        </div>
        <Input
          type={f.type ?? "text"}
          value={(obj[f.key] as string | number | undefined) ?? ""}
          onChange={(e) =>
            setter((prev) => ({ ...prev, [f.key]: e.target.value }))
          }
          className={
            lowConf
              ? "border-orange-400 bg-orange-50 dark:bg-orange-950/20"
              : ""
          }
          data-testid={`input-${path}`}
        />
      </div>
    );
  };

  const summary = useMemo(() => {
    return (fields["summary"] as string | undefined) ?? null;
  }, [fields]);

  return (
    <Layout>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/intake")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Intake
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              Review Referral
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {draft?.status === "DRAFT"
                ? "Parsing in progress…"
                : "Edit any low-confidence fields, then approve to create the client."}
              {isStub && (
                <span className="ml-2 text-orange-600">
                  [DEV STUB — set ANTHROPIC_API_KEY for real extraction]
                </span>
              )}
            </p>
            {summary && (
              <p className="text-sm text-muted-foreground italic mt-2">
                {summary}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {draft?.confidence != null && (
              <Badge
                variant={
                  draft.confidence >= 0.85
                    ? "default"
                    : draft.confidence >= 0.7
                      ? "secondary"
                      : "destructive"
                }
              >
                Overall {(draft.confidence * 100).toFixed(0)}%
              </Badge>
            )}
            <Badge variant="outline">{draft?.status}</Badge>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="lg:order-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" /> Source Document
              </CardTitle>
            </CardHeader>
            <CardContent>
              {draft?.rawAttachmentUrl ? (
                <iframe
                  src={draft.rawAttachmentUrl}
                  className="w-full h-[600px] border rounded"
                  title="Referral PDF"
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  PDF preview unavailable.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6 lg:order-1">
            <Card>
              <CardHeader>
                <CardTitle>Client</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-3">
                {ready ? (
                  CLIENT_FIELDS.map(renderField)
                ) : (
                  <p className="text-muted-foreground text-sm col-span-2">
                    Waiting for AI extraction…
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Authorization</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-3">
                {ready && AUTH_FIELDS.map(renderField)}
              </CardContent>
            </Card>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={handleReject}
                disabled={
                  !ready ||
                  draft?.status === "ACCEPTED" ||
                  draft?.status === "REJECTED"
                }
                data-testid="button-reject"
              >
                <X className="h-4 w-4 mr-1" /> Reject
              </Button>
              <Button
                onClick={handleApprove}
                disabled={
                  !ready ||
                  approve.isPending ||
                  draft?.status === "ACCEPTED" ||
                  draft?.status === "REJECTED"
                }
                data-testid="button-approve"
              >
                <Check className="h-4 w-4 mr-1" />
                {approve.isPending ? "Approving…" : "Approve & Create Client"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
