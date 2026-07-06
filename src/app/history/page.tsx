"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import AppShell from "@/components/AppShell";
import { Card, Badge, Spinner, SectionLabel } from "@/components/ui";

interface AuditEntry {
  _id: string;
  username: string;
  action: string;
  searchType?: string;
  searchedValue?: string;
  purpose?: string;
  device: string;
  ip: string;
  source: string;
  location?: string;
  resultAccessed: boolean;
  resultCount?: number;
  createdAt: string;
}

export default function HistoryPage() {
  return (
    <AppShell title="Audit trail" eyebrow="Activity" back="/dashboard">
      {() => <AuditView />}
    </AppShell>
  );
}

function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [scope, setScope] = useState("self");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ scope: string; entries: AuditEntry[] }>("/api/audit")
      .then((r) => {
        setEntries(r.entries);
        setScope(r.scope);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex justify-center py-8 text-muted">
        <Spinner />
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel count={entries.length || undefined}>
        {scope === "all" ? "All users" : "Your"} activity · synced with desktop
      </SectionLabel>
      {entries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No audit activity yet.</p>
        </Card>
      ) : (
        entries.map((e) => (
          <Card key={e._id} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium capitalize">{e.action.replace("_", " ")}</span>
              <div className="flex items-center gap-2">
                {e.searchType && <Badge tone="accent">{e.searchType}</Badge>}
                <Badge>{e.source}</Badge>
              </div>
            </div>
            {e.searchedValue && (
              <p className="mt-1 text-sm">
                “{e.searchedValue}”
                {typeof e.resultCount === "number" && (
                  <span className="text-muted"> · {e.resultCount} results</span>
                )}
                {e.resultAccessed && <span className="text-accent"> · opened</span>}
              </p>
            )}
            {e.purpose && (
              <p className="mt-1 text-xs text-muted">Purpose: {e.purpose}</p>
            )}
            <p className="mt-1 text-xs text-muted">
              {scope === "all" && <span>{e.username} · </span>}
              {new Date(e.createdAt).toLocaleString()} · {e.device} · {e.ip}
            </p>
            {e.location && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block text-xs text-accent"
              >
                📍 {e.location}
              </a>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
