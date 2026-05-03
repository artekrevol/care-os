import { Router, type IRouter } from "express";
import { M } from "@workspace/api-zod";
import { requireCaregiverSession } from "./middleware";

const router: IRouter = Router();

export async function transcribeAudioBase64(
  base64: string,
  mime?: string,
): Promise<string | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;
  try {
    const buf = Buffer.from(base64, "base64");
    const ext = (mime ?? "audio/webm").split("/")[1] ?? "webm";
    const blob = new Blob([buf], { type: mime ?? "audio/webm" });
    const form = new FormData();
    form.append("file", blob, `clip.${ext}`);
    form.append("model", "whisper-1");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { text?: string };
    return data.text ?? null;
  } catch {
    return null;
  }
}

router.post(
  "/m/transcribe",
  requireCaregiverSession,
  async (req, res): Promise<void> => {
    const parsed = M.MTranscribeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const transcript = await transcribeAudioBase64(
      parsed.data.audioBase64,
      parsed.data.mime,
    );
    if (transcript == null) {
      res.json({
        transcript: "",
        provider: "stub",
      });
      return;
    }
    res.json({ transcript, provider: "openai-whisper" });
  },
);

export default router;
