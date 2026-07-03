"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { post } from "@/lib/client";
import { clearCachedSessions } from "@/lib/sessionCache";
import { clearOfflineCache } from "@/lib/offlineStore";
import AppShell, { type Me } from "@/components/AppShell";
import { Button, Badge, SectionLabel, KV } from "@/components/ui";

export default function SettingsPage() {
  return (
    <AppShell title="Settings" eyebrow="Account" back="/dashboard">
      {(me) => <Settings me={me} />}
    </AppShell>
  );
}

function Settings({ me }: { me: Me }) {
  const router = useRouter();
  const [bioErr, setBioErr] = useState("");
  const [bioDone, setBioDone] = useState(me.biometricEnrolled);
  const [bioBusy, setBioBusy] = useState(false);
  const [outBusy, setOutBusy] = useState(false);

  // Two-factor (TOTP) enrollment state.
  const [mfaOn, setMfaOn] = useState(me.mfaEnabled);
  const [mfaQr, setMfaQr] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaErr, setMfaErr] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  async function startMfa() {
    setMfaErr("");
    setMfaBusy(true);
    try {
      const r = await post<{ qr: string; secret: string }>("/api/auth/mfa/setup");
      setMfaQr(r.qr);
      setMfaSecret(r.secret);
      setMfaCode("");
    } catch (e) {
      setMfaErr((e as Error).message);
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmMfa(e: React.FormEvent) {
    e.preventDefault();
    setMfaErr("");
    setMfaBusy(true);
    try {
      await post("/api/auth/mfa/enable", { token: mfaCode });
      setMfaOn(true);
      setMfaQr("");
      setMfaSecret("");
      setMfaCode("");
    } catch (e) {
      setMfaErr((e as Error).message);
    } finally {
      setMfaBusy(false);
    }
  }

  async function enableBiometrics() {
    setBioErr("");
    setBioBusy(true);
    try {
      const options = await post("/api/auth/biometric/register/options");
      const attestation = await startRegistration({ optionsJSON: options as never });
      await post("/api/auth/biometric/register/verify", attestation);
      setBioDone(true);
    } catch (e) {
      const msg = (e as Error).message || "";
      setBioErr(
        /NotAllowed|timed out|abort/i.test(msg)
          ? "Couldn’t set up biometrics on this device."
          : msg
      );
    } finally {
      setBioBusy(false);
    }
  }

  async function signOut() {
    setOutBusy(true);
    await post("/api/auth/logout").catch(() => {});
    await clearCachedSessions(); // also drops the legacy localStorage entry
    await clearOfflineCache(); // wipe encrypted PII cache + its key on sign-out
    router.replace("/login");
  }

  return (
    <div className="flex flex-col gap-5">
      {/* account */}
      <div>
        <SectionLabel>Account</SectionLabel>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold">{me.user.name}</p>
            <Badge tone="accent">{me.user.role}</Badge>
          </div>
          <dl>
            <KV k="Email" v={me.user.username} />
            <KV k="Biometric unlock" v={bioDone ? "Enabled" : "Not set up"} />
          </dl>
        </div>
      </div>

      {/* biometric */}
      <div>
        <SectionLabel>Biometric unlock &amp; offline access</SectionLabel>
        <div className="rounded-2xl border border-border bg-surface p-4">
          {bioDone ? (
            <p className="text-sm text-muted">
              <span className="font-semibold text-ok">Enabled.</span> You can sign in with
              your fingerprint or face, and unlock file sessions &amp; results cached on this
              device for up to 48 hours while offline.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                Sign in faster with your fingerprint or face — and{" "}
                <span className="font-semibold text-foreground">
                  required to open cached data offline
                </span>
                . Without it, the app needs a connection every time.
              </p>
              {bioErr && <p className="mt-2 text-sm text-danger">{bioErr}</p>}
              <Button
                variant="surface"
                onClick={enableBiometrics}
                loading={bioBusy}
                className="mt-3"  
              >
                🔒 Enable biometric unlock
              </Button>
            </>
          )}
        </div>
      </div>

      {/* two-factor authentication */}
      <div>
        <SectionLabel>Two-step verification</SectionLabel>
        <div className="rounded-2xl border border-border bg-surface p-4">
          {mfaOn ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ok/15 text-xs text-ok">
                ✓
              </span>
              <span>
                <span className="font-semibold text-ok">Two-step verification enabled.</span>{" "}
                You&apos;ll enter a 6-digit code from your authenticator app after your
                password.
              </span>
            </p>
          ) : mfaQr ? (
            <form onSubmit={confirmMfa} className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                Scan this with Microsoft Authenticator (or Google Authenticator / Authy),
                then enter the 6-digit code it shows.
              </p>
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mfaQr}
                  alt="Authenticator QR code"
                  className="rounded-xl border border-border bg-white p-2"
                  width={200}
                  height={200}
                />
              </div>
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Or enter this key manually
                </p>
                <p className="mt-1 break-all font-mono text-xs">{mfaSecret}</p>
              </div>
              <input
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6-digit code"
                autoFocus
                className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-center text-lg font-bold tracking-[0.4em] outline-none focus:border-accent"
              />
              {mfaErr && <p className="text-sm text-danger">{mfaErr}</p>}
              <Button type="submit" loading={mfaBusy} disabled={mfaCode.length < 6}>
                Verify &amp; enable
              </Button>
            </form>
          ) : (
            <>
              <p className="text-sm text-muted">
                Add a second factor — a rolling code from Microsoft Authenticator — required
                after your password each time you sign in.
              </p>
              {mfaErr && <p className="mt-2 text-sm text-danger">{mfaErr}</p>}
              <Button variant="surface" onClick={startMfa} loading={mfaBusy} className="mt-3">
                🔐 Set up two-step verification
              </Button>
            </>
          )}
        </div>
      </div>

      <Button variant="danger" onClick={signOut} loading={outBusy}>
        Sign out
      </Button>
    </div>
  );
}
