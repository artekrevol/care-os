import { eq } from "drizzle-orm";
import {
  db,
  caregiverDocumentsTable,
  clientDocumentsTable,
} from "@workspace/db";
import { ai, ocr, storage } from "@workspace/services";
import { logger } from "../lib/logger";
import { recordAgentRun } from "../lib/agentRun";

const PROMPT_VERSION = "doc-classifier-v1";
const CONFIDENCE_THRESHOLD = 0.7;

const TYPES = [
  "BACKGROUND_CHECK",
  "TB_TEST",
  "CPR",
  "TRAINING",
  "LICENSE",
  "I9",
  "W4",
  "DIRECT_DEPOSIT",
  "CARE_AGREEMENT",
  "INCIDENT_REPORT",
  "AUTHORIZATION",
  "MEDICAL_RECORD",
  "OTHER",
] as const;

const SYSTEM_PROMPT = `You are a home-care document classifier. Read OCR'd document text and return JSON only with this shape:
{
  "documentType": one of ${TYPES.join("|")},
  "expirationDate": "YYYY-MM-DD"|null,
  "issuedDate": "YYYY-MM-DD"|null,
  "confidence": number 0..1,
  "rationale": short string
}
Tips: BACKGROUND_CHECK contains LiveScan/DOJ/FBI text. TB_TEST contains "tuberculosis"/"PPD"/"QuantiFERON". CPR cards mention American Heart Association/American Red Cross. I9 is the federal Form I-9. W4 is Form W-4. LICENSE may be CNA/HHA/RN. AUTHORIZATION mentions insurance auth numbers. CARE_AGREEMENT or MEDICAL_RECORD typically belong on a client.`;

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

const HEURISTICS: { kw: RegExp; type: string; defaultExpiryYears?: number }[] =
  [
    { kw: /background\s*check|live\s*scan|doj|fbi/i, type: "BACKGROUND_CHECK", defaultExpiryYears: 1 },
    { kw: /tuberculosis|tb\s*test|ppd|quantiferon|t-spot/i, type: "TB_TEST", defaultExpiryYears: 1 },
    { kw: /cardiopulmonary|cpr|aha|red\s*cross|bls/i, type: "CPR", defaultExpiryYears: 2 },
    { kw: /\bform\s*i-?9\b|employment eligibility/i, type: "I9" },
    { kw: /\bform\s*w-?4\b|withholding allowance/i, type: "W4" },
    { kw: /direct deposit|routing number|aba/i, type: "DIRECT_DEPOSIT" },
    { kw: /(license|certificat).{0,40}(rn|cna|hha|lvn)|board of nursing/i, type: "LICENSE", defaultExpiryYears: 2 },
    { kw: /care agreement|service agreement|client agreement/i, type: "CARE_AGREEMENT" },
    { kw: /incident report/i, type: "INCIDENT_REPORT" },
    { kw: /authorization\s*(no|number|#)|medicaid auth|prior auth/i, type: "AUTHORIZATION" },
    { kw: /medical (record|history)|h&p|hospital discharge/i, type: "MEDICAL_RECORD" },
    { kw: /\btraining\b|in-service|module|completion/i, type: "TRAINING", defaultExpiryYears: 1 },
  ];

function classifyByText(text: string): {
  documentType: string;
  expirationDate: string | null;
  issuedDate: string | null;
  confidence: number;
  rationale: string;
} {
  for (const h of HEURISTICS) {
    if (h.kw.test(text)) {
      const issued = new Date();
      const exp = h.defaultExpiryYears
        ? new Date(
            issued.getFullYear() + h.defaultExpiryYears,
            issued.getMonth(),
            issued.getDate(),
          )
        : null;
      return {
        documentType: h.type,
        issuedDate: issued.toISOString().slice(0, 10),
        expirationDate: exp ? exp.toISOString().slice(0, 10) : null,
        confidence: 0.78,
        rationale: `[stub] keyword match for ${h.type}`,
      };
    }
  }
  return {
    documentType: "OTHER",
    issuedDate: null,
    expirationDate: null,
    confidence: 0.4,
    rationale: "[stub] no keyword match — defaulting to OTHER",
  };
}

async function runClassifier(
  filename: string,
  bytes: Buffer | null,
  triggerReason: string,
  inputPayload?: { documentId: string; objectKey: string },
): Promise<{
  runId: string;
  documentType: string;
  expirationDate: string | null;
  issuedDate: string | null;
  confidence: number;
}> {
  const { value, runId } = await recordAgentRun(
    {
      agentName: "document-classifier",
      promptVersion: PROMPT_VERSION,
      triggeredBy: "system",
      triggerReason,
      inputSummary: filename,
      ...(inputPayload ? { metadata: { inputPayload } } : {}),
    },
    async () => {
      const ocrResult = bytes
        ? await ocr.analyzeDocument(bytes)
        : { text: "", blocks: [], isStub: true };

      const aiClient = ai.getAnthropicClient();
      if (!aiClient || ocrResult.isStub || !ocrResult.text) {
        const stub = classifyByText(
          (ocrResult.text || "") + "\n" + filename,
        );
        return {
          value: stub,
          outputSummary: `[stub] classified as ${stub.documentType}`,
          outputBytes: JSON.stringify(stub),
          confidence: stub.confidence,
          inputTokens: 0,
          outputTokens: 0,
        };
      }

      const completion = await ai.complete({
        system: SYSTEM_PROMPT,
        prompt: `OCR text:\n${ocrResult.text.slice(0, 12_000)}\n\nReturn classification JSON only.`,
        maxTokens: 512,
        temperature: 0,
      });
      const parsed = tryParseJson(completion.text);
      if (!parsed || typeof parsed["documentType"] !== "string") {
        throw new Error("AI returned non-JSON or missing documentType");
      }
      const t = parsed["documentType"] as string;
      if (!TYPES.includes(t as (typeof TYPES)[number])) {
        parsed["documentType"] = "OTHER";
      }
      const conf =
        typeof parsed["confidence"] === "number"
          ? (parsed["confidence"] as number)
          : 0.6;
      return {
        value: parsed,
        outputSummary: `Classified as ${parsed["documentType"]} (${(conf * 100).toFixed(0)}%)`,
        outputBytes: completion.text,
        confidence: conf,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      };
    },
  );

  return {
    runId,
    documentType: (value["documentType"] as string) ?? "OTHER",
    expirationDate: (value["expirationDate"] as string | null) ?? null,
    issuedDate: (value["issuedDate"] as string | null) ?? null,
    confidence:
      typeof value["confidence"] === "number"
        ? (value["confidence"] as number)
        : 0.6,
  };
}

async function downloadBytes(objectKey: string): Promise<Buffer | null> {
  if (!objectKey) return null;
  try {
    return await storage.downloadBytes(objectKey);
  } catch (err) {
    logger.warn({ err }, "failed to download doc bytes");
    return null;
  }
}

export async function processDocumentClassify(payload: {
  documentId: string;
  objectKey: string;
}): Promise<void> {
  const docId = payload.documentId;

  // Try caregiver first, then client.
  const [cgDoc] = await db
    .select()
    .from(caregiverDocumentsTable)
    .where(eq(caregiverDocumentsTable.id, docId));
  if (cgDoc) {
    await db
      .update(caregiverDocumentsTable)
      .set({ classificationStatus: "RUNNING" })
      .where(eq(caregiverDocumentsTable.id, docId));
    const bytes = await downloadBytes(payload.objectKey);
    try {
      const r = await runClassifier(
        cgDoc.originalFilename ?? "document upload",
        bytes,
        `Classify caregiver document ${docId}`,
        { documentId: docId, objectKey: payload.objectKey },
      );
      const needsReview = r.confidence < CONFIDENCE_THRESHOLD;
      await db
        .update(caregiverDocumentsTable)
        .set({
          classifiedType: r.documentType,
          documentType: r.documentType,
          classificationConfidence: String(r.confidence),
          classificationStatus: "DONE",
          needsReview,
          agentRunId: r.runId,
          ...(r.expirationDate ? { expirationDate: r.expirationDate } : {}),
          ...(r.issuedDate ? { issuedDate: r.issuedDate } : {}),
        })
        .where(eq(caregiverDocumentsTable.id, docId));
      logger.info({ docId, ...r }, "caregiver document classified");
    } catch (err) {
      logger.error({ err, docId }, "caregiver document classify failed");
      await db
        .update(caregiverDocumentsTable)
        .set({ classificationStatus: "FAILED", needsReview: true })
        .where(eq(caregiverDocumentsTable.id, docId));
    }
    return;
  }

  const [clDoc] = await db
    .select()
    .from(clientDocumentsTable)
    .where(eq(clientDocumentsTable.id, docId));
  if (!clDoc) {
    logger.warn({ docId }, "document not found in caregiver or client tables");
    return;
  }
  await db
    .update(clientDocumentsTable)
    .set({ classificationStatus: "RUNNING" })
    .where(eq(clientDocumentsTable.id, docId));
  const bytes = await downloadBytes(payload.objectKey);
  try {
    const r = await runClassifier(
      clDoc.originalFilename ?? "document upload",
      bytes,
      `Classify client document ${docId}`,
      { documentId: docId, objectKey: payload.objectKey },
    );
    const needsReview = r.confidence < CONFIDENCE_THRESHOLD;
    await db
      .update(clientDocumentsTable)
      .set({
        classifiedType: r.documentType,
        documentType: r.documentType,
        classificationConfidence: String(r.confidence),
        classificationStatus: "DONE",
        needsReview,
        agentRunId: r.runId,
        ...(r.expirationDate ? { expirationDate: r.expirationDate } : {}),
        ...(r.issuedDate ? { issuedDate: r.issuedDate } : {}),
      })
      .where(eq(clientDocumentsTable.id, docId));
    logger.info({ docId, ...r }, "client document classified");
  } catch (err) {
    logger.error({ err, docId }, "client document classify failed");
    await db
      .update(clientDocumentsTable)
      .set({ classificationStatus: "FAILED", needsReview: true })
      .where(eq(clientDocumentsTable.id, docId));
  }
}
