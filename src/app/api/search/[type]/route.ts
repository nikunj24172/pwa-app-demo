import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { FileSession } from "@/lib/models/FileSession";
import { requireSession, json, error } from "@/lib/api";
import { writeAudit, auditActor } from "@/lib/audit";
import { runSearch, summariseFields, isSearchType, SEARCH_PERMISSION } from "@/lib/search";

type Ctx = { params: Promise<{ type: string }> };

/**
 * Perform a Vehicle / Property / Company search from a structured, multi-field
 * form. Enforces RBAC, ties the search to a file session, records the search
 * purpose, and writes an audit-trail entry for every search.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { type } = await params;
  if (!isSearchType(type)) return error("Unknown search type.", 404);

  const guard = await requireSession(SEARCH_PERMISSION[type]);
  if ("response" in guard) return guard.response;

  const { fields, purpose, sessionId } = await req.json().catch(() => ({}));
  if (!fields || typeof fields !== "object") {
    return error("Enter at least one search field.");
  }
  if (!sessionId) return error("An active file session is required.");

  const summary = summariseFields(fields);
  if (!summary) return error("Enter at least 2 characters in one field.");

  await connectDB();

  const fileSession = await FileSession.findOne({
    _id: sessionId,
    userId: guard.session.sub,
  });
  if (!fileSession) return error("File session not found.", 404);

  const results = await runSearch(type, fields);
  if (results === null) return error("Enter at least 2 characters in one field.");

  fileSession.searchCount += 1;
  fileSession.lastActiveAt = new Date();
  await fileSession.save();

  await writeAudit(req, auditActor(guard.session), {
    action: "search",
    searchType: type,
    searchedValue: summary,
    purpose: purpose ? String(purpose) : "Mobile field query",
    sessionId: String(sessionId),
    resultCount: results.length,
    resultAccessed: false,
  });

  return json({ type, summary, count: results.length, results });
}
