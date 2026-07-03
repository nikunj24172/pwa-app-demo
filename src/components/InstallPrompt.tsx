"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Dismiss = SNOOZE: hidden for a few minutes, then offered again on the next
// page. Only actually installing the app stops it permanently.
const DISMISS_KEY = "infolog.a2hs.dismissedAt";
const INSTALLED_KEY = "infolog.a2hs.installed";
const SNOOZE_MS = 5 * 60 * 1000; // ~5 minutes

// Public routes where the install banner should NOT show (pre-login).
const PUBLIC_PATHS = ["/", "/login", "/offline"];

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "desktop";
  const ua = window.navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (/mac/i.test(ua) && "ontouchend" in document)) return "ios";
  return /android/i.test(ua) ? "android" : "desktop";
}

/**
 * "Add to Home Screen" prompt.
 * - Chrome/Edge fire `beforeinstallprompt` → native one-tap Install button.
 * - iOS Safari never fires it (no auto dialog exists on iOS) → manual steps.
 * - Dismissing snoozes for SNOOZE_MS; it re-appears on a later page visit.
 */
export default function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [platform] = useState<Platform>(detectPlatform);
  const skipRef = useRef(false); // standalone or already installed → never show

  // Mount once: platform + standalone detection, capture the install event.
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari-only property
      window.navigator.standalone === true;
    if (standalone || localStorage.getItem(INSTALLED_KEY)) {
      skipRef.current = true;
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault(); // suppress Chrome's own banner; we render ours
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      skipRef.current = true;
      try {
        localStorage.setItem(INSTALLED_KEY, "1");
      } catch {}
      setShow(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // On every navigation (and periodically), re-offer once the snooze expired.
  useEffect(() => {
    if (skipRef.current) return;
    const evaluate = () => {
      if (skipRef.current) return;
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (Date.now() - dismissedAt >= SNOOZE_MS) setShow(true);
    };
    const t = setTimeout(evaluate, 400); // let the page settle first
    const iv = setInterval(evaluate, 30_000); // re-check while user stays put
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [pathname]);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now())); // snooze, not forever
    } catch {}
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      skipRef.current = true;
      try {
        localStorage.setItem(INSTALLED_KEY, "1");
      } catch {}
      setShow(false);
    } else {
      dismiss();
    }
  }

  // Banner renders on signed-in routes only (capture still happens app-wide).
  if (!show || PUBLIC_PATHS.includes(pathname)) return null;

  const steps =
    platform === "ios"
      ? "Tap the Share icon, then “Add to Home Screen.”"
      : platform === "android"
        ? "Open the ⋮ menu, then “Add to Home screen” / “Install app.”"
        : "Click the install icon in the address bar, or ⋮ menu → “Install InfoLog.”";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface/95 p-4 shadow-2xl backdrop-blur">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">Install InfoLog</p>
          <p className="mt-0.5 text-sm text-muted">
            {deferred ? "Add to your home screen for offline field use." : steps}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {deferred && (
            <Button onClick={install} className="px-3 py-2 text-xs">
              Install
            </Button>
          )}
          <button
            onClick={dismiss}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
