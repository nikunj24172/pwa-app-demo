import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { FileSession } from "@/lib/models/FileSession";
import { SessionRecord } from "@/lib/models/SessionRecord";
import { requireSession, json, error } from "@/lib/api";
import { writeAudit, auditActor } from "@/lib/audit";
import { isSearchType } from "@/lib/search";

type Ctx = { params: Promise<{ id: string }> };

/** List the records merged into this file session. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;
  const { id } = await params;

  await connectDB();
  const owns = await FileSession.exists({ _id: id, userId: guard.session.sub });
  if (!owns) return error("Session not found.", 404);

  const records = await SessionRecord.find({ sessionId: id, userId: guard.session.sub })
    .sort({ createdAt: -1 })
    .lean();
  return json({ records });
}

/** Merge a search result (snapshot) into the file session. Idempotent. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const { resultKey, searchType, title, data } = await req.json().catch(() => ({}));
  if (typeof resultKey !== "string" || !resultKey.trim()) {
    return error("A result key is required.");
  }
  if (typeof searchType !== "string" || !isSearchType(searchType)) {
    return error("Unknown search type.");
  }
  if (typeof title !== "string" || !title.trim()) return error("A title is required.");
  if (!data || typeof data !== "object") return error("Record data is required.");

  await connectDB();
  const session = await FileSession.findOne({ _id: id, userId: guard.session.sub });
  if (!session) return error("Session not found.", 404);
  if (session.status !== "open") {
    return error("This file session is closed.", 409);
  }

  // Upsert: one record per result, but re-merging UPDATES the snapshot (so a
  // merge after new photos/details refreshes what's in the file).
  const record = await SessionRecord.findOneAndUpdate(
    { sessionId: id, resultKey: resultKey.slice(0, 200) },
    {
      $set: {
        userId: guard.session.sub,
        searchType,
        title: title.trim().slice(0, 160),
        data,
      },
      $setOnInsert: {
        sessionId: id,
        resultKey: resultKey.slice(0, 200),
      },
    },
    { new: true, upsert: true, rawResult: false }
  );

  session.lastActiveAt = new Date();
  await session.save();

  await writeAudit(req, auditActor(guard.session), {
    action: "record_merge",
    searchType,
    searchedValue: title.trim().slice(0, 160),
    sessionId: id,
    resultAccessed: true,
  });

  return json({ record }, 201);
}
