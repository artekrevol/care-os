import { and, eq, lte } from "drizzle-orm";
import { db, referralDraftsTable } from "@workspace/db";
import { ai } from "@workspace/services";
import { logger } from "./logger";
import { dispatch } from "./dispatch";
import { processReferralParse } from "../workers/referralParser";
import { AGENCY_ID } from "./agency";

const MAX_RESUME_PER_TICK = 10;

let interval: NodeJS.Timeout | null = null;
let inFlight = false;

/**
 * Periodic resume worker for referral drafts that the AI parser left in
 * `PENDING_RETRY` state because the AI module was unavailable. Each tick
 * we probe the AI module; if it comes back healthy we re-dispatch the
 * oldest N pending drafts. Successful re-parses transition the draft
 * back to `REVIEW`; further failures bounce it back to `PENDING_RETRY`
 * so the next tick can try again.
 */
export async function runReferralResumeTick(): Promise<{
  resumed: number;
  aiOk: boolean;
}> {
  if (inFlight) return { resumed: 0, aiOk: false };
  inFlight = true;
  try {
    const probe = await ai.probe();
    if (!probe.ok) {
      return { resumed: 0, aiOk: false };
    }

    const pending = await db
      .select()
      .from(referralDraftsTable)
      .where(
        and(
          eq(referralDraftsTable.agencyId, AGENCY_ID),
          eq(referralDraftsTable.status, "PENDING_RETRY"),
          lte(referralDraftsTable.updatedAt, new Date()),
        ),
      )
      .limit(MAX_RESUME_PER_TICK);

    let resumed = 0;
    for (const draft of pending) {
      // Flip back to DRAFT so the upload-style state machine takes over;
      // processReferralParse will set REVIEW on success or PENDING_RETRY
      // again on AI error.
      await db
        .update(referralDraftsTable)
        .set({ status: "DRAFT" })
        .where(eq(referralDraftsTable.id, draft.id));
      await dispatch(
        "ai.intake-referral",
        { referralDraftId: draft.id },
        processReferralParse,
      );
      resumed++;
    }
    if (resumed > 0) {
      logger.info({ resumed }, "referral resume worker dispatched retries");
    }
    return { resumed, aiOk: true };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "referral resume tick failed (suppressed)",
    );
    return { resumed: 0, aiOk: false };
  } finally {
    inFlight = false;
  }
}

export function startReferralResumeWorker(): void {
  if (interval) return;
  const FIVE_MIN = 5 * 60 * 1000;
  interval = setInterval(() => {
    runReferralResumeTick().catch((err) =>
      logger.warn({ err }, "referral resume tick crashed (suppressed)"),
    );
  }, FIVE_MIN);
  if (typeof interval.unref === "function") interval.unref();
  // Prime once shortly after boot so PENDING_RETRY drafts that were stuck
  // across a restart get a fast first attempt.
  setTimeout(() => {
    runReferralResumeTick().catch(() => undefined);
  }, 30_000);
}
