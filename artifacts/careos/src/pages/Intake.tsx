import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileUp,
  Sparkles,
  Upload,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import {
  useListReferralDrafts,
  useUploadReferralDraft,
  getListReferralDraftsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { toast } from "sonner";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Intake() {
  const { data: drafts, refetch } = useListReferralDrafts({
    query: { refetchInterval: 3000 } as any,
  });
  const upload = useUploadReferralDraft();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleUpload = async (file: File) => {
    const contentBase64 = await fileToBase64(file);
    upload.mutate(
      {
        data: {
          filename: file.name,
          contentType: file.type || "application/pdf",
          contentBase64,
        },
      },
      {
        onSuccess: () => {
          toast.success("Referral uploaded — extracting fields…");
          queryClient.invalidateQueries({
            queryKey: getListReferralDraftsQueryKey(),
          });
        },
        onError: () => toast.error("Upload failed"),
      },
    );
  };

  useEffect(() => {
    const t = setInterval(() => refetch(), 3000);
    return () => clearInterval(t);
  }, [refetch]);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-8 w-8 text-primary" /> AI Document Intake
            </h1>
            <p className="text-muted-foreground mt-1">
              Drop a referral PDF — Claude extracts client + authorization
              fields with confidence scores.
            </p>
          </div>
        </div>

        <Card
          className={`border-2 border-dashed transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleUpload(f);
          }}
        >
          <CardContent className="p-10 text-center flex flex-col items-center gap-4">
            <FileUp className="h-12 w-12 text-muted-foreground" />
            <div>
              <p className="font-medium text-lg">
                Drop a referral PDF here or click to upload
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Files run through OCR + Claude. Most extracts complete in under
                a minute. If the AI parser is temporarily down, your upload is
                saved and queued — we will resume parsing automatically as soon
                as it comes back.
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              data-testid="input-referral-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              data-testid="button-upload-referral"
            >
              <Upload className="h-4 w-4 mr-2" />
              {upload.isPending ? "Uploading…" : "Choose PDF"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drafts</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {drafts?.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                No referral drafts yet. Upload a PDF to begin.
              </p>
            )}
            {drafts?.map((d) => {
              const fields =
                (d.parsedFields as Record<string, unknown>) ?? {};
              const clientFields = (fields["client"] ?? {}) as Record<
                string,
                unknown
              >;
              const name =
                clientFields["firstName"] && clientFields["lastName"]
                  ? `${clientFields["firstName"]} ${clientFields["lastName"]}`
                  : ((fields["_filename"] as string) ?? d.id);
              const conf = d.confidence ?? null;
              return (
                <Link
                  key={d.id}
                  href={`/intake/${d.id}`}
                  data-testid={`row-referral-${d.id}`}
                >
                  <div className="flex items-center justify-between py-3 cursor-pointer hover:bg-muted/40 px-2 rounded">
                    <div>
                      <p className="font-medium">{String(name)}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(d.createdAt), "MMM d, h:mm a")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {conf != null && (
                        <Badge
                          variant={
                            conf >= 0.85
                              ? "default"
                              : conf >= 0.7
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {(conf * 100).toFixed(0)}% conf
                        </Badge>
                      )}
                      {d.status === "PENDING_RETRY" ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 bg-amber-100 text-amber-900 border-amber-300"
                          title="The AI parser is temporarily unavailable. We'll retry automatically when it recovers."
                        >
                          <RefreshCw className="h-3 w-3" />
                          Waiting to retry
                        </Badge>
                      ) : (
                        <Badge variant="outline">{d.status}</Badge>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
