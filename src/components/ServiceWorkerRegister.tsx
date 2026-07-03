"use client";
import { useEffect } from "react";

/** Registers the PWA service worker after the page loads. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // Registered in all environments so the app is installable (Add to Home
    // Screen needs an active SW). The SW is network-first for navigation/RSC,
    // so it does NOT cause stale-routing (see public/sw.js).
    const onLoad = () => {
      // updateViaCache:"none" = always fetch sw.js fresh when checking for
      // updates, so a new deploy's worker rolls out on the next visit.
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((reg) => reg.update().catch(() => {}))
        .catch(() => {
          /* SW registration is best-effort */
        });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
