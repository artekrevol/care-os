import pino from "pino";

export const serviceLogger = pino({
  name: "services",
  level: process.env.LOG_LEVEL ?? "info",
});
