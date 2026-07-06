"use client";
import { useEffect, useState } from "react";

/**
 * Map for a record's address, matching the InfoLog report layout.
 * Uses Google's keyless embed (no API key needed); Directions / View open the
 * full Google Maps app.
 *
 * OFFLINE: map tiles are third-party content that cannot be pre-cached, so
 * without a connection we show the address card instead — and swap the live
 * map back in automatically when connectivity returns.
 */
export default function OwnerMap({ address, label }: { address: string; label?: string }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const q = encodeURIComponent(address);
  const embed = `https://maps.google.com/maps?q=${q}&z=15&output=embed`;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  const view = `https://www.google.com/maps/search/?api=1&query=${q}`;

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-border">
        {label && (
          <span className="absolute left-2 top-2 z-10 rounded-lg bg-background/90 px-2 py-1 text-xs font-medium shadow">
            📍 {label}
          </span>
        )}
        {online ? (
          <iframe
            title={`Map of ${address}`}
            src={embed}
            className="h-44 w-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <div className="grid h-44 w-full place-items-center bg-surface-2 p-4 text-center">
            <div>
              <div className="text-2xl">🗺️</div>
              <p className="mt-1 text-sm font-semibold">{address}</p>
              <p className="mt-1 text-xs text-muted">
                You&apos;re offline — the map will load when you reconnect.
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-strong px-4 py-3 text-sm font-semibold text-slate-950 active:scale-[0.98]"
        >
          🧭 Directions
        </a>
        <a
          href={view}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-semibold active:scale-[0.98]"
        >
          🗺 View
        </a>
      </div>
    </div>
  );
}
