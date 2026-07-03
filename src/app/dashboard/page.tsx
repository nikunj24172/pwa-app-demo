"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, post } from "@/lib/client";
import { cacheSessions, getCachedSessions, type CachedSession } from "@/lib/sessionCache";
import AppShell from "@/components/AppShell";
import { Badge, Alert, Spinner, SectionLabel } from "@/components/ui";

export default function DashboardPage() {
  return (
    <AppShell title="InfoLog Mobile" eyebrow="Field search">
      {(me) => (
        <Dashboard
          name={me.user.name}
          canCreate={
            me.user.permissions.includes("session:create") || me.user.role === "admin"
          }
        />
      )}
    </AppShell>
  );
}

function Dashboard({ name, canCreate }: { name: string; canCreate: boolean }) {
  const router = useRouter();
  const [sessions, setSessions] = useState<CachedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [caseRef, setCaseRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ sessions: CachedSession[] }>("/api/sessions");
      setSessions(r.sessions);
      await cacheSessions(r.sessions);
    } catch {
      // Offline / server unreachable: fall back to the 48h metadata cache.
      const { sessions: cached, expired } = await getCachedSessions();
      if (cached.length) {
        setSessions(cached);
        setErr("Offline — showing file sessions cached within the last 48 hours.");
      } else {
        setErr(
          expired
            ? "Your offline cache is older than 48 hours. Reconnect to sync."
            : "You're offline and no sessions are cached yet."
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await post<{ session: CachedSession }>("/api/sessions", { title, caseRef });
      router.push(`/session/${r.session._id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-semibold text-muted">Kia ora,</p>
        <h2 className="text-2xl font-extrabold tracking-tight">
          {name.split(" ")[0] || name} <span className="text-accent">👋</span>
        </h2>
      </div>

      {canCreate && (
        <div className="rounded-2xl bg-gradient-to-br from-teal to-teal-deep p-5 text-white shadow-lg shadow-teal-deep/30">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-lg">🗂️</span>
            <p className="font-bold">Start a file session</p>
          </div>
          <p className="mb-4 text-xs text-white/70">
            Group your searches under a case. Continue later on desktop.
          </p>
          {err && (
            <div className="mb-3">
              <Alert>{err}</Alert>
            </div>
          )}
          <form onSubmit={create} className="flex flex-col gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Session title (optional — defaults to your name)"
              className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60 outline-none focus:border-white"
            />
            <input
              value={caseRef}
              onChange={(e) => setCaseRef(e.target.value)}
              placeholder="Case reference (optional)"
              className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60 outline-none focus:border-white"
            />
            <button
              type="submit"
              disabled={busy}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-teal disabled:opacity-50"
            >
              {busy ? <Spinner /> : "＋"} Start session
            </button>
          </form>
        </div>
      )}

      <div>
        <SectionLabel count={sessions.length || undefined}>Your file sessions</SectionLabel>
        {loading ? (
          <div className="flex justify-center py-8 text-muted">
            <Spinner />
          </div>
        ) : sessions.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-5 text-center text-sm text-muted">
            No sessions yet. Start one above to begin searching.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((s) => (
              <Link key={s._id} href={`/session/${s._id}`}>
                <div className="rounded-2xl border border-border bg-surface p-4 transition hover:border-accent active:scale-[0.99]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2 font-semibold text-accent">
                      <span className="text-muted">🗂️</span>
                      <span className="truncate">{s.title}</span>
                    </p>
                    <Badge tone={s.status === "open" ? "ok" : "muted"}>{s.status}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                    <Meta label="Case ref" value={s.caseRef || "—"} />
                    <Meta label="Searches" value={String(s.searchCount)} />
                    <Meta
                      label="Last active"
                      value={new Date(s.lastActiveAt).toLocaleDateString()}
                    />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted/70">
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
