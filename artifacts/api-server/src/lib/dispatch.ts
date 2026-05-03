import { queue } from "@workspace/services";
import { logger } from "./logger";

const ENQUEUE_TIMEOUT_MS = 750;

/**
 * Enqueue a job. If the BullMQ queue isn't configured (dev) or doesn't
 * respond quickly, run the inline processor as fire-and-forget so the
 * demo still works end-to-end without Redis.
 */
export async function dispatch<N extends queue.QueueName>(
  name: N,
  data: queue.CareOSJobMap[N],
  inlineProcessor: (d: queue.CareOSJobMap[N]) => Promise<unknown>,
): Promise<{ mode: "queued" | "inline"; jobId?: string }> {
  try {
    const result = await Promise.race([
      queue.enqueue(name, data),
      new Promise<{ enqueued: false }>((resolve) =>
        setTimeout(() => resolve({ enqueued: false }), ENQUEUE_TIMEOUT_MS),
      ),
    ]);
    if (result.enqueued) {
      return { mode: "queued", jobId: result.jobId };
    }
  } catch (err) {
    logger.warn({ err, queue: name }, "enqueue failed — falling back to inline");
  }
  setImmediate(() => {
    inlineProcessor(data).catch((err) =>
      logger.error({ err, queue: name }, "inline processor failed"),
    );
  });
  return { mode: "inline" };
}
