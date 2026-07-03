"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "infolog.a2hs.dismissed";
type Platform = "ios" | "android" | "desktop";

/**
 * "Add to Home Screen" prompt.
 * - Chrome/Edge fire `beforeinstallprompt` → we show a native "Install" button.
 * - iOS Safari never fires it (no auto dialog exists on iOS) → manual steps.
 * - As a fallback (any browser that doesn't fire the event), we still show
 *   platform-specific manual instructions so there's always an install path.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const platformRef = useRef<Platform>("desktop");

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari-only property
      window.navigator.standalone === true;
    if (standalone) return; // already installed

    const ua = window.navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) || (/mac/i.test(ua) && "ontouchend" in document);
    const android = /android/i.test(ua);
    platformRef.current = ios ? "ios" : android ? "android" : "desktop";

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", dismiss);

    // Fallback: if the native event never fires, still surface manual steps.
    const t = setTimeout(() => setShow(true), ios ? 300 : 2500);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", dismiss);
      clearTimeout(t);
    };
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  }

  if (!show) return null;

  const steps =
    platformRef.current === "ios"
      ? "Tap the Share icon, then “Add to Home Screen.”"
      : platformRef.current === "android"
        ? "Open the ⋮ menu, then “Add to Home screen” / “Install app.”"
        : "Click the install icon in the address bar, or ⋮ menu → “Install InfoLog.”";

  return (
    <div className="rounded-2xl border border-accent/40 bg-accent/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">Add InfoLog to your home screen</p>
          <p className="mt-1 text-sm text-muted">
            {deferred
              ? "Install the app for faster, full-screen access in the field."
              : steps}
          </p>
          {deferred && (
            <Button onClick={install} className="mt-3">
              📲 Install app
            </Button>
          )}
        </div>
        <button onClick={dismiss} className="shrink-0 text-muted" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
