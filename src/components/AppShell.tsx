"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import {
  cacheGet,
  cacheSet,
  sweepExpired,
  requestPersistentStorage,
} from "@/lib/offlineStore";
import { unlockWithBiometric } from "@/lib/biometricUnlock";
import { Spinner, Button } from "@/components/ui";


/** Idle timeout before the app locks and demands a biometric re-check. */
const IDLE_MS = 2 * 60 * 1000; // 2 minutes

export interface Me {
  user: {
    id: string;
    username: string;
    name: string;
    role: string;
    permissions: string[];
    amr: string[];
  };
  biometricEnrolled: boolean;
  biometricCredentialIds: string[];
  mfaEnabled: boolean;
  sessionExpiresAt: number | null;
}

/** Authenticated chrome: top app bar, bottom tab bar, session-timeout guard.
 *  Mobile-first, centered + width-capped on tablet/laptop/desktop. */
export default function AppShell({
  children,
  title,
  eyebrow,
  sub,
  back,
}: {
  children: (me: Me) => React.ReactNode;
  title: string;
  eyebrow?: string;
  sub?: string;
  back?: string;
}) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState(false);
  // Offline-only gate: "locked" until the officer passes a biometric unlock;
  // "unavailable" when offline but no biometric is enrolled (can't unlock).
  const [gate, setGate] = useState<"open" | "locked" | "unavailable">("open");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErr, setUnlockErr] = useState("");
  // Idle auto-lock: after IDLE_MS of no activity, require a biometric unlock.
  const [idleLocked, setIdleLocked] = useState(false);
  const lastActive = useRef(0);

  // Prepare offline storage once: drop stale (>48h) records and ask the browser
  // not to evict our cache under disk pressure.
  useEffect(() => {
    sweepExpired();
    requestPersistentStorage();
  }, []);

  // Idle auto-lock: once the officer is viewing content, watch for activity and
  // lock after IDLE_MS. Biometric-enrolled users re-unlock with fingerprint/face;
  // otherwise fall back to a full re-login.
  useEffect(() => {
    if (!me || idleLocked || (offline && gate !== "open")) return;
    const mark = () => {
      lastActive.current = Date.now();
    };
    const events = ["mousedown", "keydown", "touchstart", "pointerdown", "scroll"];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    mark();
    const iv = setInterval(() => {
      if (Date.now() - lastActive.current < IDLE_MS) return;
      if (me.biometricEnrolled) {
        setUnlockErr("");
        setIdleLocked(true);
      } else {
        router.replace("/login"); // no biometric to unlock with → re-authenticate
      }
    }, 5000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      clearInterval(iv);
    };
  }, [me, idleLocked, offline, gate, router]);

  useEffect(() => {
    let cancelled = false;
    api<Me>("/api/auth/me")
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        setOffline(false);
        setGate("open");
        cacheSet("me", m); // refresh the offline identity snapshot (48h TTL)
      })
      .catch(async () => {
        // Offline (or server unreachable): fall back to the cached identity so
        // the officer can still read data captured within the last 48h — but
        // only behind a biometric unlock. No biometric enrolled ⇒ no offline
        // access (they must reconnect and enable it in Settings).
        const cached = await cacheGet<Me>("me");
        if (cancelled) return;
        if (cached) {
          setMe(cached.value);
          setOffline(true);
          setGate(cached.value.biometricEnrolled ? "locked" : "unavailable");
        } else {
          setError(true);
          router.replace("/login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Security: auto sign-out when the session token expires — but ONLY while
  // online. The 15-min token guards *server* access; offline read-only viewing
  // is governed instead by the biometric unlock + the 48h encrypted-cache TTL.
  useEffect(() => {
    if (offline || !me?.sessionExpiresAt) return;
    const ms = me.sessionExpiresAt - Date.now();
    if (ms <= 0) return void router.replace("/login");
    const t = setTimeout(() => router.replace("/login"), ms);
    return () => clearTimeout(t);
  }, [me, offline, router]);

  async function unlock() {
    if (!me) return;
    setUnlockErr("");
    setUnlocking(true);
    const ok = await unlockWithBiometric(me.biometricCredentialIds);
    setUnlocking(false);
    if (ok) setGate("open");
    else setUnlockErr("Unlock failed. Try again with your fingerprint or face.");
  }

  async function unlockIdle() {
    if (!me) return;
    setUnlockErr("");
    setUnlocking(true);
    const ok = await unlockWithBiometric(me.biometricCredentialIds);
    setUnlocking(false);
    if (ok) {
      lastActive.current = Date.now();
      setIdleLocked(false);
    } else {
      setUnlockErr("Unlock failed. Try again with your fingerprint or face.");
    }
  }

  if (error) return null;
  if (!me)
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner />
      </div>
    );

  // Offline lock screen: cached data stays encrypted until biometric unlock.
  if (offline && gate !== "open")
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="text-5xl">{gate === "locked" ? "🔒" : "📡"}</div>
        {gate === "locked" ? (
          <>
            <div>
              <h1 className="text-xl font-bold">Unlock offline access</h1>
              <p className="mt-1 text-sm text-muted">
                You&apos;re offline. Verify your identity to open the file sessions and
                results cached on this device.
              </p>
            </div>
            {unlockErr && <p className="text-sm text-danger">{unlockErr}</p>}
            <Button onClick={unlock} loading={unlocking} className="w-full">
              🔓 Unlock with biometric
            </Button>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-bold">Offline access needs biometric</h1>
              <p className="mt-1 text-sm text-muted">
                To open cached data without a connection, enable biometric unlock in
                Settings while you&apos;re online. Reconnect to continue.
              </p>
            </div>
            <Button variant="surface" onClick={() => router.refresh()} className="w-full">
              Retry connection
            </Button>
          </>
        )}
      </div>
    );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur">
        {back ? (
          <Link
            href={back}
            aria-label="Back"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="h-7 w-7" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
              {eyebrow}
            </p>
          )}
          <h1 className="truncate text-base font-bold leading-tight">{title}</h1>
          {sub && <p className="truncate text-xs text-muted">{sub}</p>}
        </div>
        <span className="hidden text-xs text-muted sm:block">{me.user.name}</span>
      </header>

      {offline && (
        <div className="flex items-center justify-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-[11px] font-semibold text-warn">
          <span>📡</span> Offline — showing data cached within the last 48 hours.
        </div>
      )}

      <main className="flex-1 p-4 sm:p-5">{children(me)}</main>

      <BottomTabs />

      {/* Idle auto-lock overlay — covers content until a biometric re-check. */}
      {idleLocked && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/95 p-6 text-center backdrop-blur">
          <div className="flex max-w-xs flex-col items-center gap-5">
            <div className="text-5xl">🔒</div>
            <div>
              <h2 className="text-xl font-bold">Session locked</h2>
              <p className="mt-1 text-sm text-muted">
                Locked after 2 minutes of inactivity. Verify it&apos;s you to continue.
              </p>
            </div>
            {unlockErr && <p className="text-sm text-danger">{unlockErr}</p>}
            <Button onClick={unlockIdle} loading={unlocking} className="w-full">
              🔓 Unlock with fingerprint / face
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabIcon({ name }: { name: "home" | "history" | "settings" }) {
  const paths: Record<string, React.ReactNode> = {
    home: <path d="M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5" />,
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 4v4h4M12 8v4l3 2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function BottomTabs() {
  const pathname = usePathname();
  const isHome = pathname.startsWith("/dashboard") || pathname.startsWith("/session");
  const isHistory = pathname.startsWith("/history");
  const isSettings = pathname.startsWith("/settings");

  const base = "flex flex-1 flex-col items-center gap-1 py-1.5 text-[10px] font-semibold transition";
  return (
    <nav className="sticky bottom-0 z-20 flex border-t border-border bg-background/90 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur">
      <Link href="/dashboard" className={`${base} ${isHome ? "text-accent" : "text-muted"}`}>
        <TabIcon name="home" />
        Home
      </Link>
      <Link href="/history" className={`${base} ${isHistory ? "text-accent" : "text-muted"}`}>
        <TabIcon name="history" />
        Audit
      </Link>
      <Link href="/settings" className={`${base} ${isSettings ? "text-accent" : "text-muted"}`}>
        <TabIcon name="settings" />
        Settings
      </Link>
    </nav>
  );
}
