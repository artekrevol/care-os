import app from "./app";
import { logger } from "./lib/logger";
import { seed } from "./lib/seed";
import { startWorkers } from "./lib/workers";
import { logServiceStartupReport } from "@workspace/services";

// Defensive: BullMQ/ioredis can surface async errors (e.g. WRONGPASS) as
// unhandled rejections from internal connect handlers. Log and keep the
// server alive so background-job misconfiguration doesn't take down the API.
process.on("unhandledRejection", (reason) => {
  logger.warn({ reason }, "unhandledRejection (suppressed)");
});
process.on("uncaughtException", (err) => {
  logger.warn({ err }, "uncaughtException (suppressed)");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  logServiceStartupReport();
  try {
    await seed();
  } catch (err) {
    logger.error({ err }, "Seed failed");
  }
  try {
    await startWorkers();
  } catch (err) {
    logger.error({ err }, "Background workers failed to start");
  }
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

void main();
