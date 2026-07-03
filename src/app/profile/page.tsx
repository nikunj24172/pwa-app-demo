"use client";
import AppShell, { type Me } from "@/components/AppShell";
import { Badge, SectionLabel, KV } from "@/components/ui";

export default function ProfilePage() {
  return (
    <AppShell title="Profile" eyebrow="Account" back="/dashboard">
      {(me) => <Profile me={me} />}
    </AppShell>
  );
}

function Profile({ me }: { me: Me }) {
  const initials = me.user.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const searchPerms = me.user.permissions
    .filter((p) => p.startsWith("search:"))
    .map((p) => p.split(":")[1]);

  return (
    <div className="flex flex-col gap-5">
      {/* identity */}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center">
        <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-teal to-teal-deep text-2xl font-extrabold text-white">
          {initials}
        </div>
        <div>
          <p className="text-lg font-bold">{me.user.name}</p>
          <p className="text-sm text-muted">{me.user.username}</p>
        </div>
        <Badge tone="accent">{me.user.role}</Badge>
      </div>

      {/* account details */}
      <div>
        <SectionLabel>Account details</SectionLabel>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <dl>
            <KV k="Name" v={me.user.name} />
            <KV k="Email" v={me.user.username} />
            <KV k="Role" v={me.user.role} />
          </dl>
        </div>
      </div>

      {/* search access */}
      <div>
        <SectionLabel>Search access</SectionLabel>
        <div className="rounded-2xl border border-border bg-surface p-4">
          {searchPerms.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {searchPerms.map((p) => (
                <Badge key={p} tone="ok">
                  {p}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No search permissions assigned.</p>
          )}
        </div>
      </div>

      {/* security status (manage in Settings) */}
      <div>
        <SectionLabel>Security</SectionLabel>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <dl>
            <KV k="Two-step verification" v={me.mfaEnabled ? "Enabled" : "Not set up"} />
            <KV k="Biometric unlock" v={me.biometricEnrolled ? "Enabled" : "Not set up"} />
          </dl>
          <p className="mt-2 text-xs text-muted">Manage these in Settings.</p>
        </div>
      </div>
    </div>
  );
}
