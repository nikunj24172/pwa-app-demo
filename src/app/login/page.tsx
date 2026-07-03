"use client";
import { Suspense, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { post } from "@/lib/client";
import { Spinner } from "@/components/ui";

type Step = "credentials" | "mfaSetup" | "mfa" | "offer";

/** Best-effort geolocation for the audit trail ("Location captured"). */
function getLocation(): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`),
      () => resolve(undefined),
      { timeout: 5000, maximumAge: 60000 }
    );
  });
}

const glassInput =
  "w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/55 outline-none focus:border-white focus:bg-white/15";

/** The 4-square Microsoft logo. */
function MsLogo() {
  return (
    <span className="grid grid-cols-2 gap-[2px]" aria-hidden>
      <span className="h-2.5 w-2.5 bg-[#f25022]" />
      <span className="h-2.5 w-2.5 bg-[#7fba00]" />
      <span className="h-2.5 w-2.5 bg-[#00a4ef]" />
      <span className="h-2.5 w-2.5 bg-[#ffb900]" />
    </span>
  );
}

/** Six separate digit boxes with auto-advance, backspace and paste support. */
function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: () => void;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function setChars(next: string) {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.();
    return clean;
  }

  function handleChange(i: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) return;
    const arr = value.split("");
    arr[i] = digit;
    const clean = setChars(arr.join(""));
    if (i < length - 1 && clean.length > i) refs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const arr = value.split("");
      if (arr[i]) {
        arr[i] = "";
        onChange(arr.join("").replace(/\s/g, ""));
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
        const prev = value.split("");
        prev[i - 1] = "";
        onChange(prev.join(""));
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < length - 1) {
      refs.current[i + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const clean = setChars(e.clipboardData.getData("text"));
    refs.current[Math.min(clean.length, length - 1)]?.focus();
  }

  return (
    <div className="flex justify-center gap-1.5 sm:gap-2.5" onPaste={handlePaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          autoFocus={i === 0}
          aria-label={`Digit ${i + 1}`}
          // Fluid: boxes flex to share the row so 6 always fit, from a 320px
          // phone up to desktop. aspect-square keeps them tidy squares.
          className="aspect-square min-w-0 flex-1 basis-0 rounded-lg border border-slate-300 bg-white text-center text-xl font-semibold text-slate-900 caret-sky-500 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 sm:text-2xl"
        />
      ))}
    </div>
  );
}

/** Backdrop + centered white card shell for the Microsoft-styled screens. */
function MsCard({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden p-4 sm:p-6">
      <div className="absolute inset-0 bg-[#122a36]" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(120% 80% at 80% -10%, rgba(52,124,156,.5) 0%, transparent 55%), linear-gradient(165deg, rgba(40,105,135,.5) 0%, rgba(25,60,77,.85) 52%, rgba(12,25,33,.95) 100%)",
        }}
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl sm:max-w-md sm:p-8">
        {children}
      </div>
    </main>
  );
}

/** Microsoft brand row atop the card. */
function MsBrand() {
  return (
    <div className="flex items-center justify-center gap-2">
      <MsLogo />
      <span className="text-sm font-medium text-slate-600">Microsoft Authenticator</span>
    </div>
  );
}

function LoginInner() {
  const params = useSearchParams();
  const dest = params.get("from") || "/dashboard";
  // Full navigation (not router.replace) so we bypass any stale Router Cache
  // entry for the destination that middleware redirected while unauthenticated.
  const goDest = () => window.location.assign(dest);

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Set during the just-completed sign-in so post-2FA steps know where to go.
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const [mfaQr, setMfaQr] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");

  /** After auth completes, offer biometric (if not enrolled) or go on. */
  function proceed() {
    if (bioEnrolled) goDest();
    else setStep("offer");
  }

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) return setErr("Please accept the Terms & Conditions to continue.");
    setErr("");
    setBusy(true);
    try {
      const location = await getLocation();
      const r = await post<{ status?: string; biometricEnrolled?: boolean }>(
        "/api/auth/login",
        { email, password, location }
      );
      if (r.status === "mfa_required") {
        setCode("");
        setStep("mfa");
      } else {
        // Signed in without 2FA yet → prompt setup right here, after password.
        setBioEnrolled(!!r.biometricEnrolled);
        await beginMfaSetup(!!r.biometricEnrolled);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Fetch a QR/secret and show the in-login 2FA setup step. */
  async function beginMfaSetup(bio: boolean) {
    try {
      const r = await post<{ qr: string; secret: string }>("/api/auth/mfa/setup");
      setMfaQr(r.qr);
      setMfaSecret(r.secret);
      setCode("");
      setStep("mfaSetup");
    } catch {
      // Couldn't start setup — don't block sign-in.
      if (bio) goDest();
      else setStep("offer");
    }
  }

  async function submitEnable() {
    if (busy || code.length < 6) return;
    setErr("");
    setBusy(true);
    try {
      await post("/api/auth/mfa/enable", { token: code });
      proceed();
    } catch (e) {
      setErr((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  function enableMfa(e: React.FormEvent) {
    e.preventDefault();
    submitEnable();
  }

  async function submitMfa() {
    if (busy || code.length < 6) return;
    setErr("");
    setBusy(true);
    try {
      const location = await getLocation();
      const r = await post<{ biometricEnrolled: boolean }>("/api/auth/mfa/verify", {
        token: code,
        location,
      });
      if (r.biometricEnrolled) goDest();
      else setStep("offer");
    } catch (e) {
      setErr((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    submitMfa();
  }

  async function unlockWithBiometrics() {
    if (!email) return setErr("Enter your email, then unlock with biometrics.");
    setErr("");
    setBusy(true);
    try {
      const options = await post("/api/auth/biometric/login/options", { email });
      const assertion = await startAuthentication({ optionsJSON: options as never });
      const location = await getLocation();
      await post("/api/auth/biometric/login/verify", { response: assertion, location });
      goDest();
    } catch (e) {
      const msg = (e as Error).message || "";
      setErr(
        /NotAllowed|timed out|abort/i.test(msg)
          ? "Biometric unlock was cancelled. Sign in with your password instead."
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  async function enableBiometrics() {
    setErr("");
    setBusy(true);
    try {
      const options = await post("/api/auth/biometric/register/options");
      const attestation = await startRegistration({ optionsJSON: options as never });
      await post("/api/auth/biometric/register/verify", attestation);
      goDest();
    } catch (e) {
      const msg = (e as Error).message || "";
      setErr(
        /NotAllowed|timed out|abort/i.test(msg)
          ? "Couldn’t set up biometrics on this device. You can skip and do it later."
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  // In-login 2FA enrollment — shown right after email+password when the account
  // hasn't set up two-step yet. Scan the QR with Microsoft Authenticator.
  if (step === "mfaSetup") {
    return (
      <MsCard>
        <MsBrand />
        <h1 className="mt-4 text-center text-xl font-bold text-slate-900 sm:text-2xl">
          Set up two-step verification
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          Scan this QR code in the Microsoft Authenticator app, then enter the 6-digit code it
          shows.
        </p>

        {mfaQr && (
          <div className="mt-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mfaQr}
              alt="Authenticator QR code"
              width={176}
              height={176}
              className="rounded-xl border border-slate-200"
            />
          </div>
        )}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Or enter this key manually
          </p>
          <p className="mt-0.5 break-all font-mono text-xs text-slate-700">{mfaSecret}</p>
        </div>

        {err && <p className="mt-3 text-center text-sm text-red-600">{err}</p>}

        <form onSubmit={enableMfa} className="mt-4 flex flex-col gap-4">
          <OtpInput value={code} onChange={setCode} onComplete={submitEnable} />
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="rounded-md bg-[#7fb3c9] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#6aa5bb] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Verifying…" : "Verify & enable"}
          </button>
        </form>
        <p className="mt-3 text-center text-xs text-slate-400">
          Two-step verification is required to continue.
        </p>
      </MsCard>
    );
  }

  // Returning users: Microsoft-Authenticator-styled two-step screen (screenshot).
  // The 6-digit code is standard TOTP validated by our own backend.
  if (step === "mfa") {
    return (
      <MsCard>
        <MsBrand />
        <h1 className="mt-4 text-center text-xl font-bold text-slate-900 sm:text-2xl">
          Two-step verification
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          Enter the 6-digit code from your Microsoft Authenticator app to continue.
        </p>

        {err && <p className="mt-4 text-center text-sm text-red-600">{err}</p>}

        <form onSubmit={verifyMfa} className="mt-6 flex flex-col gap-5">
          <OtpInput value={code} onChange={setCode} onComplete={submitMfa} />
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="rounded-md bg-[#7fb3c9] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#6aa5bb] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-500">
          Didn&apos;t get a code? Open your Microsoft Authenticator app to view the current
          code.
        </p>
        <button
          onClick={() => {
            setStep("credentials");
            setErr("");
            setCode("");
          }}
          className="mt-2 w-full text-center text-xs font-medium text-sky-600 hover:underline"
        >
          Use a different account
        </button>
      </MsCard>
    );
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden p-6 text-white">
      {/* teal gradient backdrop */}
      <div className="absolute inset-0 bg-[#122a36]" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(120% 80% at 80% -10%, rgba(52,124,156,.5) 0%, transparent 55%), linear-gradient(165deg, rgba(40,105,135,.5) 0%, rgba(25,60,77,.85) 52%, rgba(12,25,33,.95) 100%)",
        }}
      />

      <div className="relative grid w-full max-w-5xl items-center gap-10 md:grid-cols-2">
        {/* hero / brand */}
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/20 bg-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" className="h-6 w-6" />
            </span>
            <span className="text-xl font-extrabold tracking-tight">
              info<span className="text-[#5bb7d4]">log</span>
            </span>
          </div>
          <p className="mt-8 text-[11px] font-bold uppercase tracking-[0.18em] text-[#9fd0e1]">
            Information Hub
          </p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            Run a search from <span className="text-[#5bb7d4]">the field.</span>
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
            Secure access to the InfoLog portal — motor vehicle, company and property
            searches, in your pocket.
          </p>
        </div>

        {/* auth card */}
        <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-5 backdrop-blur">
          {err && (
            <div className="mb-4 rounded-xl border border-red-300/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">
              {err}
            </div>
          )}

          {step === "credentials" ? (
            <>
              <h2 className="text-lg font-bold">Sign in to InfoLog</h2>
              <p className="mb-4 text-xs text-white/60">
                Verify your identity with your InfoLog account.
              </p>
              <form onSubmit={submitCredentials} className="flex flex-col gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/80">Email</label>
                  <input
                    type="email"
                    autoCapitalize="none"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="officer@infolog.local"
                    required
                    className={glassInput}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/80">Password</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className={glassInput}
                  />
                </div>

                <label className="my-1 flex items-start gap-2.5 text-[11px] leading-relaxed text-white/75">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#5bb7d4]"
                  />
                  <span>
                    I agree to the InfoLog mobile <u>Terms &amp; Conditions</u> and acknowledge
                    all searches are audited.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-sm font-extrabold text-[#163a4a] disabled:opacity-50"
                >
                  {busy && <Spinner />} Sign in
                </button>
              </form>

              <div className="my-3 flex items-center gap-3 text-[11px] text-white/50">
                <div className="h-px flex-1 bg-white/15" /> or <div className="h-px flex-1 bg-white/15" />
              </div>
              <button
                onClick={unlockWithBiometrics}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy && <Spinner />} 🔒 Unlock with biometrics
              </button>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-2xl">
                  🔒
                </span>
                <div>
                  <p className="font-bold">Enable biometric unlock?</p>
                  <p className="text-xs text-white/65">
                    Optional — sign in faster next time with your fingerprint or face.
                  </p>
                </div>
              </div>
              <button
                onClick={enableBiometrics}
                disabled={busy}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-sm font-extrabold text-[#163a4a] disabled:opacity-50"
              >
                {busy && <Spinner />} Enable biometric unlock
              </button>
              <button
                onClick={() => goDest()}
                className="mt-3 w-full text-center text-sm text-white/70"
              >
                Skip for now
              </button>
            </>
          )}
        </div>
      </div>

      <p className="absolute bottom-4 left-0 right-0 text-center text-[10px] text-white/40">
        Information Logistics Company Limited
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
