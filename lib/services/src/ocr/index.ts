import {
  TextractClient,
  AnalyzeDocumentCommand,
  type Block,
} from "@aws-sdk/client-textract";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";
import { recordSuccess, recordError } from "../health/index";

let client: TextractClient | null = null;

export function getTextractClient(): TextractClient | null {
  if (!isModuleConfigured("ocr")) return null;
  if (!client) {
    client = new TextractClient({
      region: process.env["AWS_REGION"]!,
      credentials: {
        accessKeyId: process.env["AWS_ACCESS_KEY_ID"]!,
        secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"]!,
      },
    });
  }
  return client;
}

export type OCRResult = {
  text: string;
  blocks: Block[];
  isStub: boolean;
};

export async function analyzeDocument(bytes: Uint8Array): Promise<OCRResult> {
  const c = getTextractClient();
  if (!c) {
    serviceLogger.warn(
      { module: "ocr" },
      "Textract not configured — returning stub OCR result",
    );
    return {
      text: "[OCR disabled in dev — set AWS_* keys to enable Textract]",
      blocks: [],
      isStub: true,
    };
  }
  const cmd = new AnalyzeDocumentCommand({
    Document: { Bytes: bytes },
    FeatureTypes: ["FORMS", "TABLES"],
  });
  try {
    const resp = await c.send(cmd);
    const blocks = resp.Blocks ?? [];
    const text = blocks
      .filter((b) => b.BlockType === "LINE")
      .map((b) => b.Text ?? "")
      .join("\n");
    recordSuccess("ocr");
    return { text, blocks, isStub: false };
  } catch (err) {
    recordError("ocr", err);
    throw err;
  }
}

/**
 * Cheap probe: send a 1-pixel PNG to AnalyzeDocument. Failure usually means
 * credentials/region are wrong; the actual response is irrelevant.
 */
export async function probe(): Promise<{ ok: boolean; message: string }> {
  const c = getTextractClient();
  if (!c) return { ok: false, message: "not configured" };
  const tinyPng = Buffer.from(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082",
    "hex",
  );
  try {
    await c.send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: tinyPng },
        FeatureTypes: ["FORMS"],
      }),
    );
    recordSuccess("ocr");
    return { ok: true, message: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // InvalidParameterException etc. on a 1-px image still confirms creds work.
    if (/InvalidParameter|UnsupportedDocument/i.test(msg)) {
      recordSuccess("ocr");
      return { ok: true, message: "credentials accepted (probe payload rejected, expected)" };
    }
    recordError("ocr", err);
    return { ok: false, message: msg };
  }
}
