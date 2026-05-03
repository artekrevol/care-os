import { describe, it, expect, beforeAll } from "vitest";
import { notifications } from "@workspace/services";

/**
 * IVR security integration tests.
 *
 * These tests hit the live api-server (NODE_ENV=development, no
 * TWILIO_AUTH_TOKEN configured -> signature check is bypassed for
 * unsigned requests). They cover the four documented brute-force
 * thresholds plus a unit-level signature check.
 *
 * State pollution: the route's lockout maps live in process memory.
 * We use unique fake CallSids / From numbers / cgids per test run so
 * one test cannot affect another, and we avoid locking real seeded
 * caregivers (cg_001..cg_006) so the live demo isn't impacted.
 */

const BASE = process.env["TEST_API_BASE"] ?? "http://localhost:80";

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function gather(
  step: "code" | "pin" | "menu",
  body: Record<string, string>,
  query: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const qs = new URLSearchParams({ step, ...query }).toString();
  const r = await fetch(`${BASE}/api/telephony/gather?${qs}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return { status: r.status, text: await r.text() };
}

beforeAll(async () => {
  // Smoke-check the live server is up before running any cases. If it
  // isn't, fail fast with a clear message rather than letting every
  // test time out.
  const r = await fetch(`${BASE}/api/telephony/voice`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "CallSid=warmup",
  });
  if (r.status !== 200) {
    throw new Error(
      `IVR integration tests require api-server on ${BASE} (got ${r.status})`,
    );
  }
});

describe("IVR security — brute-force thresholds", () => {
  it("spoofed caller-ID with valid caregiver code + PIN signs in", async () => {
    // cg_001 from the demo seed: phoneCode=100001, phonePin=1001.
    // From is a deliberately spoofed/random number — the route MUST NOT
    // accept caller-ID as a credential; only code + PIN authenticates.
    const callSid = `it_spoof_${rand()}`;
    const from = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;

    const code = await gather("code", {
      CallSid: callSid,
      Digits: "100001",
      From: from,
    });
    expect(code.status).toBe(200);
    expect(code.text).toMatch(/Hello Aisha/);

    const pin = await gather(
      "pin",
      { CallSid: callSid, Digits: "1001", From: from },
      { cgid: "cg_001" },
    );
    expect(pin.status).toBe(200);
    expect(pin.text).toMatch(/signed in|clock in|Press 1/i);
  });

  it("3 wrong PINs in the same call hang up with 'Too many incorrect attempts'", async () => {
    // Use a fictitious cgid so the caregiver-lockout map for real demo
    // caregivers is untouched. The route reaches recordPinFailure even
    // when the cgid is unknown.
    const callSid = `it_3wrong_${rand()}`;
    const from = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;
    const cgid = `cg_test_3wrong_${rand()}`;

    const r1 = await gather(
      "pin",
      { CallSid: callSid, Digits: "0000", From: from },
      { cgid },
    );
    expect(r1.text).toMatch(/incorrect/i);
    expect(r1.text).not.toMatch(/Too many/i);

    const r2 = await gather(
      "pin",
      { CallSid: callSid, Digits: "0000", From: from },
      { cgid },
    );
    expect(r2.text).toMatch(/incorrect/i);
    expect(r2.text).not.toMatch(/Too many/i);

    const r3 = await gather(
      "pin",
      { CallSid: callSid, Digits: "0000", From: from },
      { cgid },
    );
    expect(r3.text).toMatch(/Too many incorrect attempts/i);
    expect(r3.text).toMatch(/Hangup/i);
  });

  it("5 wrong PINs across calls lock the caregiver", async () => {
    // The caregiver-lockout pre-check only runs when loadCaregiver()
    // resolves, so this test must target a real seeded caregiver.
    // We use cg_006 (Priya Shah) — the last seeded caregiver, the
    // least likely to be in active demo flows. Side effect: cg_006
    // will be locked in api-server memory until the lockout window
    // expires or the server restarts. That's acceptable for the
    // test environment.
    const cgid = "cg_006";
    for (let i = 0; i < 5; i++) {
      const callSid = `it_5lock_${rand()}_${i}`;
      const from = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;
      await gather(
        "pin",
        { CallSid: callSid, Digits: "0000", From: from },
        { cgid },
      );
    }
    // 6th attempt: even with a fresh CallSid + From and a hypothetically
    // correct PIN, the caregiver-locked pre-check must short-circuit.
    const callSid = `it_5lock_${rand()}_final`;
    const from = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;
    const r = await gather(
      "pin",
      { CallSid: callSid, Digits: "1006", From: from },
      { cgid },
    );
    expect(r.text).toMatch(/temporarily locked/i);
  });

  it("8 wrong PINs from the same number lock the caller", async () => {
    const from = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;
    // Use 8 different fake cgids so we trip the caller threshold (8)
    // before the caregiver threshold (5).
    for (let i = 0; i < 8; i++) {
      const callSid = `it_8call_${rand()}_${i}`;
      const cgid = `cg_test_8call_${rand()}_${i}`;
      await gather(
        "pin",
        { CallSid: callSid, Digits: "0000", From: from },
        { cgid },
      );
    }
    // 9th attempt: any step should be short-circuited with the
    // caller-locked message.
    const callSid = `it_8call_${rand()}_final`;
    const r = await gather(
      "pin",
      { CallSid: callSid, Digits: "1001", From: from },
      { cgid: `cg_test_8call_final_${rand()}` },
    );
    expect(r.text).toMatch(/Too many recent failed attempts from this number/i);
  });

  it("malformed Twilio signature is detected as 'invalid' by the validator", () => {
    // We can't drive a 403 against the live server because it boots
    // without TWILIO_AUTH_TOKEN (development mode skips validation by
    // design — see twilioSignatureGuard). Instead we unit-test the
    // shared validator directly, which is exactly the verdict the
    // signature guard branches on for the 403 response.
    // Force the validator to attempt a real comparison by setting the
    // env token for the duration of this assertion (without one it
    // returns "unconfigured"). Restore the previous value afterwards
    // so other tests/processes aren't affected.
    const prev = process.env["TWILIO_AUTH_TOKEN"];
    process.env["TWILIO_AUTH_TOKEN"] = "test_token_for_signature_check";
    try {
      const verdict = notifications.validateTwilioSignature({
        signatureHeader: "deadbeef-not-a-real-signature",
        url: "https://example.test/api/telephony/voice",
        params: { CallSid: "CAxxx", From: "+15555550000" },
      });
      expect(verdict).toBe("invalid");

      // And missing signature header is also "invalid" once a token is set.
      const missing = notifications.validateTwilioSignature({
        signatureHeader: undefined,
        url: "https://example.test/api/telephony/voice",
        params: { CallSid: "CAxxx" },
      });
      expect(missing).toBe("invalid");
    } finally {
      if (prev === undefined) delete process.env["TWILIO_AUTH_TOKEN"];
      else process.env["TWILIO_AUTH_TOKEN"] = prev;
    }
  });
});
