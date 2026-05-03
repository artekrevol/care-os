import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { saveSession, type Session } from "@/lib/session";

type Step = "phone" | "otp" | "set-pin" | "pin-login";

type Props = { onAuthed: (s: Session) => void };

export default function Login({ onAuthed }: Props) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  function normalizePhone(p: string): string {
    return p.replace(/[^\d+]/g, "");
  }

  async function requestOtp(): Promise<void> {
    setBusy(true);
    try {
      const np = normalizePhone(phone);
      const r = await api<{ ok: boolean; devCode?: string; expiresInSeconds: number }>(
        "/m/auth/request-otp",
        { method: "POST", body: JSON.stringify({ phone: np }) },
      );
      setDevCode(r.devCode ?? null);
      setStep("otp");
      toast.success(r.devCode ? `Dev code: ${r.devCode}` : "Code sent via SMS");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to send code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(): Promise<void> {
    setBusy(true);
    try {
      const np = normalizePhone(phone);
      const r = await api<{
        sessionToken: string;
        expiresAt: string;
        caregiverId: string;
        hasPin: boolean;
      }>("/m/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({
          phone: np,
          code,
          deviceLabel: navigator.userAgent.slice(0, 60),
        }),
      });
      saveSession({
        sessionToken: r.sessionToken,
        expiresAt: r.expiresAt,
        caregiverId: r.caregiverId,
      });
      setHasPin(r.hasPin);
      if (!r.hasPin) {
        setStep("set-pin");
      } else {
        onAuthed({
          sessionToken: r.sessionToken,
          expiresAt: r.expiresAt,
          caregiverId: r.caregiverId,
        });
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function setPinFlow(): Promise<void> {
    if (pin.length < 4) {
      toast.error("PIN must be at least 4 digits");
      return;
    }
    if (pin !== pin2) {
      toast.error("PINs don't match");
      return;
    }
    setBusy(true);
    try {
      await api("/m/auth/set-pin", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      toast.success("PIN set. You're signed in.");
      const s: Session = JSON.parse(localStorage.getItem("careos.caregiver.session")!);
      onAuthed(s);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to set PIN");
    } finally {
      setBusy(false);
    }
  }

  async function pinLogin(): Promise<void> {
    setBusy(true);
    try {
      const np = normalizePhone(phone);
      const r = await api<{
        sessionToken: string;
        expiresAt: string;
        caregiverId: string;
      }>("/m/auth/login-pin", {
        method: "POST",
        body: JSON.stringify({
          phone: np,
          pin,
          deviceLabel: navigator.userAgent.slice(0, 60),
        }),
      });
      saveSession(r);
      onAuthed(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Invalid PIN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col safe-top safe-bottom px-6">
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[color:var(--color-accent)]/10 mb-4">
            <svg viewBox="0 0 192 192" className="w-10 h-10">
              <path d="M96 44c-22 0-40 18-40 40 0 30 40 64 40 64s40-34 40-64c0-22-18-40-40-40zm0 56a16 16 0 1 1 0-32 16 16 0 0 1 0 32z" fill="#22d3ee" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold">Chajinel Caregiver</h1>
          <p className="text-sm text-[color:var(--color-muted)] mt-1">
            Sign in to start your visit
          </p>
        </div>

        {step === "phone" && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Phone number</span>
              <input
                type="tel"
                inputMode="tel"
                placeholder="+1 555 555 0123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-2 w-full h-14 rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] px-4 text-lg outline-none focus:border-[color:var(--color-accent)]"
              />
            </label>
            <button
              onClick={requestOtp}
              disabled={busy || phone.length < 7}
              className="w-full h-14 rounded-xl bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] font-semibold disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send code"}
            </button>
            <button
              onClick={() => {
                if (normalizePhone(phone).length < 7) {
                  toast.error("Enter your phone first");
                  return;
                }
                setStep("pin-login");
              }}
              className="w-full text-sm text-[color:var(--color-muted)] underline"
            >
              I already have a PIN
            </button>
          </div>
        )}

        {step === "otp" && (
          <div className="space-y-4">
            <p className="text-sm text-[color:var(--color-muted)]">
              Enter the 6-digit code we sent to{" "}
              <span className="text-[color:var(--color-fg)]">{phone}</span>
              {devCode && (
                <span className="block mt-1 text-[color:var(--color-warning)] font-mono">
                  Dev: {devCode}
                </span>
              )}
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full h-16 rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] px-4 text-2xl tracking-[0.5em] text-center outline-none focus:border-[color:var(--color-accent)]"
            />
            <button
              onClick={verifyOtp}
              disabled={busy || code.length < 4}
              className="w-full h-14 rounded-xl bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] font-semibold disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              onClick={() => setStep("phone")}
              className="w-full text-sm text-[color:var(--color-muted)]"
            >
              Use a different number
            </button>
          </div>
        )}

        {step === "set-pin" && (
          <div className="space-y-4">
            <p className="text-sm text-[color:var(--color-muted)]">
              Set a 4-8 digit PIN to sign in faster next time.
            </p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="New PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="w-full h-14 rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] px-4 text-lg outline-none focus:border-[color:var(--color-accent)]"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="Confirm PIN"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
              className="w-full h-14 rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] px-4 text-lg outline-none focus:border-[color:var(--color-accent)]"
            />
            <button
              onClick={setPinFlow}
              disabled={busy}
              className="w-full h-14 rounded-xl bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] font-semibold disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save PIN & continue"}
            </button>
            <button
              onClick={() => {
                const s = localStorage.getItem("careos.caregiver.session");
                if (s) onAuthed(JSON.parse(s));
              }}
              className="w-full text-sm text-[color:var(--color-muted)]"
            >
              Skip for now
            </button>
          </div>
        )}

        {step === "pin-login" && (
          <div className="space-y-4">
            <p className="text-sm text-[color:var(--color-muted)]">
              Enter your PIN for{" "}
              <span className="text-[color:var(--color-fg)]">{phone}</span>
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={8}
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="w-full h-16 rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] px-4 text-2xl tracking-[0.5em] text-center outline-none focus:border-[color:var(--color-accent)]"
            />
            <button
              onClick={pinLogin}
              disabled={busy || pin.length < 4}
              className="w-full h-14 rounded-xl bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] font-semibold disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              onClick={() => {
                setPin("");
                setStep("phone");
              }}
              className="w-full text-sm text-[color:var(--color-muted)] underline"
            >
              Send code instead
            </button>
          </div>
        )}
        {hasPin}
      </div>
    </div>
  );
}
