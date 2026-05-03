import type { Request, Response, NextFunction, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, webhookEventsTable } from "@workspace/db";
import { logger } from "./logger";
import { newId } from "./ids";
import { AGENCY_ID } from "./agency";

/**
 * Inbound webhook logger. Persists a `webhook_events` row BEFORE the
 * handler (and before any signature guard) runs, so rejected requests
 * are still forensically traceable. After the response is sent, the
 * row is updated with the response status, signature verdict, and any
 * error captured by handlers.
 *
 * Handlers (or signature guards) can override the recorded event type /
 * external id / signature verdict by setting `res.locals.webhookEventType`,
 * `res.locals.webhookExternalId`, and `res.locals.signatureValid`.
 */
export function webhookLogMiddleware(provider: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = newId("whk");
    const route = req.originalUrl.split("?")[0] ?? req.originalUrl;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const headers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (lk === "authorization" || lk === "cookie") {
        headers[k] = "[redacted]";
      } else {
        headers[k] = Array.isArray(v) ? v.join(",") : (v ?? null);
      }
    }

    const externalId =
      typeof body["CallSid"] === "string"
        ? (body["CallSid"] as string)
        : typeof body["MessageSid"] === "string"
          ? (body["MessageSid"] as string)
          : typeof body["RecordingSid"] === "string"
            ? (body["RecordingSid"] as string)
            : null;

    const eventType =
      typeof body["CallStatus"] === "string"
        ? `call.${body["CallStatus"]}`
        : typeof body["MessageStatus"] === "string"
          ? `sms.${body["MessageStatus"]}`
          : typeof body["RecordingStatus"] === "string"
            ? `recording.${body["RecordingStatus"]}`
            : null;

    res.locals["webhookEventId"] = id;

    // Redact PHI/PII fields commonly present in Twilio webhook bodies before
    // we persist them. Forensic value lives in the SIDs and status fields;
    // the raw caller / callee numbers and digits are sensitive and not
    // required for the webhook audit trail.
    const REDACT_BODY_FIELDS = new Set([
      "From",
      "To",
      "Caller",
      "Called",
      "ForwardedFrom",
      "FromCity",
      "FromState",
      "FromZip",
      "FromCountry",
      "ToCity",
      "ToState",
      "ToZip",
      "ToCountry",
      "CalledCity",
      "CalledState",
      "CalledZip",
      "CalledCountry",
      "CallerCity",
      "CallerState",
      "CallerZip",
      "CallerCountry",
      "Digits",
      "SpeechResult",
    ]);
    const sanitizedBody: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      sanitizedBody[k] = REDACT_BODY_FIELDS.has(k) ? "[redacted]" : v;
    }

    // Track the insert as a promise on res.locals so the finish handler
    // can await it before issuing the update — otherwise we race and
    // can lose the response_status / signature_valid columns under load.
    const insertPromise = db
      .insert(webhookEventsTable)
      .values({
        id,
        agencyId: AGENCY_ID,
        provider,
        route,
        eventType,
        externalId,
        requestHeaders: headers,
        requestBody: sanitizedBody,
      })
      .then(() => true as const)
      .catch((err) => {
        logger.warn(
          { err: (err as Error).message, route },
          "webhook_events insert failed",
        );
        return false as const;
      });
    res.locals["webhookInsertPromise"] = insertPromise;

    res.on("finish", () => {
      const finalEventType =
        (res.locals["webhookEventType"] as string | undefined) ??
        eventType ??
        null;
      const finalExternalId =
        (res.locals["webhookExternalId"] as string | undefined) ??
        externalId ??
        null;
      const signatureValid =
        typeof res.locals["signatureValid"] === "boolean"
          ? (res.locals["signatureValid"] as boolean)
          : null;
      const errorMessage =
        (res.locals["webhookErrorMessage"] as string | undefined) ?? null;
      // Wait for the insert to land (or fail) before issuing the update —
      // skipping the update entirely if the insert never persisted.
      void insertPromise.then((inserted) => {
        if (!inserted) return;
        db.update(webhookEventsTable)
          .set({
            responseStatus: res.statusCode,
            signatureValid,
            eventType: finalEventType,
            externalId: finalExternalId,
            errorMessage,
            completedAt: new Date(),
          })
          .where(eq(webhookEventsTable.id, id))
          .catch((err: unknown) => {
            logger.warn(
              { err: (err as Error).message, route },
              "webhook_events update failed",
            );
          });
      });
    });

    next();
  };
}
