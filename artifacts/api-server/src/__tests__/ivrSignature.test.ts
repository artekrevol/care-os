import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * Twilio signature 403 path — hermetic.
 *
 * The live api-server in this workspace boots without TWILIO_AUTH_TOKEN
 * and with NODE_ENV=development, so its signature guard intentionally
 * lets unsigned requests through. To assert the *production* 403 path
 * we mount the telephony router into a fresh Express instance with
 * NODE_ENV forced to "production" and a known token, and exercise the
 * guard via supertest.
 *
 * Why this matters: the signature guard is the only thing standing
 * between an attacker who can reach our public Twilio webhook URL and
 * a fully-authenticated caregiver IVR session. A regression here is a
 * direct fraud-control hole.
 */

let app: Express;
let prevNodeEnv: string | undefined;
let prevToken: string | undefined;
let telephonyRouter: import("express").Router;

beforeAll(async () => {
  prevNodeEnv = process.env["NODE_ENV"];
  prevToken = process.env["TWILIO_AUTH_TOKEN"];
  // The router reads NODE_ENV / TWILIO_AUTH_TOKEN at request time
  // (not at import time), so flipping them here is sufficient.
  process.env["NODE_ENV"] = "production";
  process.env["TWILIO_AUTH_TOKEN"] = "test_token_for_signature_check";
  // Import after env is set so any module-level reads pick up our
  // values too.
  telephonyRouter = (await import("../routes/telephony")).default;

  app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", telephonyRouter);
});

afterAll(() => {
  if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = prevNodeEnv;
  if (prevToken === undefined) delete process.env["TWILIO_AUTH_TOKEN"];
  else process.env["TWILIO_AUTH_TOKEN"] = prevToken;
});

describe("IVR Twilio signature guard (production posture)", () => {
  it("returns 403 when X-Twilio-Signature is missing", async () => {
    const r = await request(app)
      .post("/api/telephony/voice")
      .set("content-type", "application/x-www-form-urlencoded")
      .send("CallSid=CAtest&From=%2B15555550000");
    expect(r.status).toBe(403);
    expect(r.text).toMatch(/invalid Twilio signature/i);
  });

  it("returns 403 when X-Twilio-Signature is malformed/forged", async () => {
    const r = await request(app)
      .post("/api/telephony/voice")
      .set("content-type", "application/x-www-form-urlencoded")
      .set("x-twilio-signature", "deadbeef-not-a-real-signature")
      .send("CallSid=CAtest&From=%2B15555550000");
    expect(r.status).toBe(403);
    expect(r.text).toMatch(/invalid Twilio signature/i);
  });

  it("returns 503 in production when TWILIO_AUTH_TOKEN is unset (no implicit allow)", async () => {
    // Prove the unconfigured-in-prod branch: drop the token and
    // confirm the guard refuses rather than silently letting the
    // request through. We restore it before the next test.
    const prev = process.env["TWILIO_AUTH_TOKEN"];
    delete process.env["TWILIO_AUTH_TOKEN"];
    try {
      const r = await request(app)
        .post("/api/telephony/voice")
        .set("content-type", "application/x-www-form-urlencoded")
        .send("CallSid=CAtest");
      expect(r.status).toBe(503);
      expect(r.text).toMatch(/telephony not configured/i);
    } finally {
      process.env["TWILIO_AUTH_TOKEN"] = prev;
    }
  });
});
