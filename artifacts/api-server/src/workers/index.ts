import { queue } from "@workspace/services";
import { logger } from "../lib/logger";
import { processReferralParse } from "./referralParser";
import { processDocumentClassify } from "./documentClassifier";

export function startWorkers(): void {
  const referralWorker = queue.registerWorker(
    "ai.intake-referral",
    async (job) => processReferralParse(job.data),
  );
  const docWorker = queue.registerWorker(
    "ocr.extract-document",
    async (job) => processDocumentClassify(job.data),
  );
  if (referralWorker || docWorker) {
    logger.info(
      {
        referral: !!referralWorker,
        documentClassifier: !!docWorker,
      },
      "background workers started",
    );
  } else {
    logger.warn(
      "queue not configured — workers will run inline via dispatch fallback",
    );
  }
}
