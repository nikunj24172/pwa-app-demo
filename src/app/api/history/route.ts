import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { AuditLog } from "@/lib/models/AuditLog";
import { requireSession, json } from "@/lib/api";

/**
 * Search history within a file session. Derived from the audit trail so history
 * and audit never diverge. `?sessionId=` scopes to one session (default: all
 * of the user's recent searches).
 */
export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const sessionId = req.nextUrl.searchParams.get("sessionId");

  await connectDB();
  const filter: Record<string, unknown> = {
    userId: guard.session.sub,
    // Searches plus per-result activity (photo attach, merge/update) so the
    // trail shows WHEN each record was touched, not just queries.
    action: { $in: ["search", "photo_attach", "record_merge"] },
  };
  if (sessionId) filter.sessionId = sessionId;

  const history = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .select("action searchType searchedValue resultCount sessionId createdAt")
    .lean();

  return json({ history });
}
