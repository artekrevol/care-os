import {
  TextractClient,
  AnalyzeDocumentCommand,
  type Block,
} from "@aws-sdk/client-textract";
import { serviceLogger } from "../logger";
import { isModuleConfigured } from "../env";

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
  const resp = await c.send(cmd);
  const blocks = resp.Blocks ?? [];
  const text = blocks
    .filter((b) => b.BlockType === "LINE")
    .map((b) => b.Text ?? "")
    .join("\n");
  return { text, blocks, isStub: false };
}
