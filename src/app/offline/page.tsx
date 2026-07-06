"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getCachedSessions, type CachedSession } from "@/lib/sessionCache";
import { timeAgo } from "@/lib/time";
import { Card, Badge } from "@/components/ui";

export default function Offline() {
  const [sessions, setSessions] = useState<CachedSession[]>([]);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    getCachedSessions().then(({ sessions, expired }) => {
      setSessions(sessions);
      setExpired(expired);
    });
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <div className="mt-6 text-center">
        <div className="text-4xl">📡</div>
        <h1 className="mt-2 text-xl font-bold">You&apos;re offline</h1>
        <p className="text-sm text-muted">
          Searches need a secure connection, but your recent file sessions are
          cached for 48&nbsp;hours.
        </p>
      </div>

      {expired && (
        <Card>
          <p className="text-sm text-muted">
            Your cached sessions are older than 48 hours and were cleared. Reconnect to sync.
          </p>
        </Card>
      )}

      {sessions.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Cached file sessions
          </h2>
          {sessions.map((s) => (
            <Link key={s._id} href={`/session/${s._id}`}>
              <Card className="transition active:scale-[0.99]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-xs text-muted">
                      {s.caseRef || "No case ref"} · Created {timeAgo(s.createdAt)}
                    </p>
                  </div>
                  <Badge tone="ok">Audited</Badge>
                </div>
              </Card>
            </Link>
          ))}
          <p className="flex items-center justify-center gap-1.5 pt-0.5 text-center text-[11px] text-muted">
            <span>ℹ️</span> Sessions expire 48 hours after their last activity.
          </p>
        </div>
      ) : (
        !expired && (
          <Card>
            <p className="text-sm text-muted">No cached sessions available yet.</p>
          </Card>
        )
      )}

      <Link href="/dashboard" className="mt-2 text-center text-sm text-accent">
        Retry connection →
      </Link>
    </main>
  );
}
