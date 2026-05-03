import { eq } from "drizzle-orm";
import { db, referralDraftsTable } from "@workspace/db";
import { ai, ocr, storage } from "@workspace/services";
import { logger } from "../lib/logger";
import { recordAgentRun } from "../lib/agentRun";

const PROMPT_VERSION = "referral-parser-v1";

const SYSTEM_PROMPT = `You are an expert home-care intake specialist. Extract a structured client intake and authorization JSON from the OCR'd referral text.

Return ONLY valid JSON with this exact shape (use null when missing):
{
  "client": {
    "firstName": string,
    "lastName": string,
    "dob": "YYYY-MM-DD"|null,
    "phone": string|null,
    "email": string|null,
    "addressLine1": string|null,
    "city": string|null,
    "state": string|null,
    "postalCode": string|null,
    "primaryPayer": "PRIVATE_PAY"|"VA_CCN"|"MEDICAID_HCBS"|"COUNTY_IHSS"|"LTC_INSURANCE",
    "languages": string[],
    "allergies": string|null,
    "carePreferences": string|null,
    "emergencyContactName": string|null,
    "emergencyContactPhone": string|null
  },
  "authorization": {
    "payer": "PRIVATE_PAY"|"VA_CCN"|"MEDICAID_HCBS"|"COUNTY_IHSS"|"LTC_INSURANCE",
    "authNumber": string|null,
    "issuedDate": "YYYY-MM-DD"|null,
    "expirationDate": "YYYY-MM-DD"|null,
    "approvedHoursPerWeek": number|null,
    "approvedHoursTotal": number|null,
    "scopeOfCare": string[]
  } | null,
  "fieldConfidence": { [pathDot: string]: number },
  "overallConfidence": number,
  "summary": string
}`;

function tryParseJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const m = candidate.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function buildStub(filename: string): Record<string, unknown> {
  // Deterministic mock parsing for dev demo when AI/OCR not configured.
  const last =
    filename.replace(/\.[^.]+$/, "").split(/[\s_-]+/).pop() || "Demo";
  const today = new Date();
  const exp = new Date(today);
  exp.setDate(exp.getDate() + 180);
  return {
    client: {
      firstName: "Robert",
      lastName: last.charAt(0).toUpperCase() + last.slice(1),
      dob: "1948-04-12",
      phone: "(555) 010-2233",
      email: null,
      addressLine1: "1421 Magnolia Ave",
      city: "Sacramento",
      state: "CA",
      postalCode: "95816",
      primaryPayer: "VA_CCN",
      languages: ["English"],
      allergies: "Sulfa drugs",
      carePreferences: "Prefers female caregiver, mornings only.",
      emergencyContactName: "Linda " + last,
      emergencyContactPhone: "(555) 010-9988",
    },
    authorization: {
      payer: "VA_CCN",
      authNumber: "VA-" + Math.floor(100000 + Math.random() * 899999),
      issuedDate: today.toISOString().slice(0, 10),
      expirationDate: exp.toISOString().slice(0, 10),
      approvedHoursPerWeek: 20,
      approvedHoursTotal: 480,
      scopeOfCare: ["bathing", "meal-prep", "medication-reminders"],
    },
    fieldConfidence: {
      "client.firstName": 0.97,
      "client.lastName": 0.97,
      "client.dob": 0.91,
      "client.phone": 0.86,
      "client.addressLine1": 0.88,
      "client.primaryPayer": 0.95,
      "client.allergies": 0.72,
      "authorization.authNumber": 0.74,
      "authorization.expirationDate": 0.93,
      "authorization.approvedHoursPerWeek": 0.92,
    },
    overallConfidence: 0.86,
    summary:
      "[Dev stub] Generated mock referral fields. Configure ANTHROPIC_API_KEY + AWS_* for real OCR/extraction.",
    _stub: true,
  };
}

export async function processReferralParse(payload: {
  referralDraftId: string;
}): Promise<void> {
  const draftId = payload.referralDraftId;
  const [draft] = await db
    .select()
    .from(referralDraftsTable)
    .where(eq(referralDraftsTable.id, draftId));
  if (!draft) {
    logger.warn({ draftId }, "referral draft not found");
    return;
  }

  const objectKey = draft.rawAttachmentUrl ?? "";
  let pdfBytes: Buffer | null = null;
  if (objectKey) {
    try {
      pdfBytes = await storage.downloadBytes(objectKey);
    } catch (err) {
      logger.warn({ err, objectKey }, "failed to fetch referral pdf bytes");
    }
  }

  await db
    .update(referralDraftsTable)
    .set({ status: "REVIEW" })
    .where(eq(referralDraftsTable.id, draftId));

  try {
    const { value, runId } = await recordAgentRun(
      {
        agentName: "referral-parser",
        promptVersion: PROMPT_VERSION,
        triggeredBy: "system",
        triggerReason: `Parse referral draft ${draftId}`,
        inputSummary: `Referral PDF (${pdfBytes?.length ?? 0} bytes)`,
        // Stash the original queue payload so an operator can retry this run
        // from /admin/jobs/agent-runs without hunting down the source record.
        metadata: { inputPayload: { referralDraftId: draftId } },
      },
      async () => {
        // 1) OCR
        const ocrResult = pdfBytes
          ? await ocr.analyzeDocument(pdfBytes)
          : { text: "", blocks: [], isStub: true };
        const ocrText = ocrResult.text;

        // 2) Claude extraction
        const ai_client = ai.getAnthropicClient();
        if (!ai_client || ocrResult.isStub || !ocrText) {
          // dev stub mode
          const parsed = buildStub(draft.rawContent ?? draftId);
          return {
            value: parsed,
            outputSummary: "[stub] mock extraction",
            outputBytes: JSON.stringify(parsed, null, 2),
            confidence: 0.86,
            inputTokens: 0,
            outputTokens: 0,
          };
        }

        // Map-reduce chunking: split long OCR text into ~30k-char windows,
        // extract per-chunk partials, then reduce to a single JSON.
        const CHUNK = 30_000;
        const chunks: string[] = [];
        for (let i = 0; i < ocrText.length && chunks.length < 12; i += CHUNK) {
          chunks.push(ocrText.slice(i, i + CHUNK));
        }
        let totalIn = 0;
        let totalOut = 0;
        const partials: Record<string, unknown>[] = [];
        if (chunks.length <= 1) {
          const completion = await ai.complete({
            system: SYSTEM_PROMPT,
            prompt: `Referral OCR text follows. Extract intake fields as JSON only.\n\n---\n${chunks[0] ?? ""}\n---`,
            maxTokens: 4096,
            temperature: 0,
          });
          totalIn += completion.inputTokens ?? 0;
          totalOut += completion.outputTokens ?? 0;
          const p = tryParseJson(completion.text);
          if (!p) throw new Error("AI returned non-JSON output");
          return {
            value: p,
            outputSummary:
              (p["summary"] as string | undefined) ??
              "Extracted referral fields",
            outputBytes: completion.text,
            confidence:
              typeof p["overallConfidence"] === "number"
                ? (p["overallConfidence"] as number)
                : 0.7,
            inputTokens: totalIn,
            outputTokens: totalOut,
          };
        }
        // Multi-chunk path
        for (let i = 0; i < chunks.length; i++) {
          const c = await ai.complete({
            system: SYSTEM_PROMPT,
            prompt: `Referral OCR chunk ${i + 1}/${chunks.length}. Extract any intake fields visible in this portion as JSON only; use null for fields not present here.\n\n---\n${chunks[i]}\n---`,
            maxTokens: 2048,
            temperature: 0,
          });
          totalIn += c.inputTokens ?? 0;
          totalOut += c.outputTokens ?? 0;
          const p = tryParseJson(c.text);
          if (p) partials.push(p);
        }
        const reduce = await ai.complete({
          system: SYSTEM_PROMPT,
          prompt: `Reconcile these partial JSON extractions from a long referral document into one JSON in the schema above. Prefer non-null values; for conflicts, use the value from the chunk with the most context. Compute a single overallConfidence.\n\nPARTIALS:\n${JSON.stringify(partials).slice(0, 40_000)}\n\nReturn JSON only.`,
          maxTokens: 4096,
          temperature: 0,
        });
        totalIn += reduce.inputTokens ?? 0;
        totalOut += reduce.outputTokens ?? 0;
        const merged = tryParseJson(reduce.text);
        if (!merged) throw new Error("AI reduce step returned non-JSON");
        return {
          value: merged,
          outputSummary:
            (merged["summary"] as string | undefined) ??
            `Extracted referral fields (${chunks.length} chunks)`,
          outputBytes: reduce.text,
          confidence:
            typeof merged["overallConfidence"] === "number"
              ? (merged["overallConfidence"] as number)
              : 0.7,
          inputTokens: totalIn,
          outputTokens: totalOut,
        };
      },
    );

    const overall =
      typeof value["overallConfidence"] === "number"
        ? (value["overallConfidence"] as number)
        : null;

    await db
      .update(referralDraftsTable)
      .set({
        parsedFields: value,
        confidence: overall != null ? String(overall) : null,
        status: "REVIEW",
        agentRunId: runId,
      })
      .where(eq(referralDraftsTable.id, draftId));
    logger.info({ draftId, runId }, "referral parsed");
  } catch (err) {
    logger.error({ err, draftId }, "referral parse failed");
    // Mark the draft as PENDING_RETRY only when the failure is a known
    // *upstream AI/OCR module* availability problem — either a required
    // client (Anthropic) is not configured, or the error came from an
    // upstream Anthropic / AWS Textract primitive (SDK errors, throttles,
    // network/abort/timeout). Anything else (bad PDF, validation error,
    // DB error) falls back to DRAFT so it does not retry in a loop.
    const errName = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    const isAnthropicTransient =
      errName === "APIConnectionError" ||
      errName === "APIConnectionTimeoutError" ||
      errName === "RateLimitError" ||
      errName === "InternalServerError" ||
      errName === "AbortError" ||
      errName === "TimeoutError" ||
      message.includes("anthropic") ||
      message.includes("overloaded_error") ||
      (message.includes("rate limit") && message.includes("anthropic"));
    // AWS Textract transient/availability errors. Captures both the
    // explicit AWS SDK exception classes (ThrottlingException,
    // ProvisionedThroughputExceededException, ServiceUnavailable, etc.)
    // and generic message patterns we've seen when the OCR module is
    // unreachable or the AWS region is degraded.
    const isTextractTransient =
      errName === "ThrottlingException" ||
      errName === "ProvisionedThroughputExceededException" ||
      errName === "ServiceUnavailableException" ||
      errName === "InternalServerError" ||
      errName === "RequestTimeout" ||
      errName === "RequestTimeoutException" ||
      errName === "NetworkingError" ||
      message.includes("textract") ||
      message.includes("aws") ||
      message.includes("getaddrinfo") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("etimedout") ||
      message.includes("socket hang up");
    const transient =
      !ai.getAnthropicClient() || isAnthropicTransient || isTextractTransient;
    await db
      .update(referralDraftsTable)
      .set({ status: transient ? "PENDING_RETRY" : "DRAFT" })
      .where(eq(referralDraftsTable.id, draftId));
  }
}
