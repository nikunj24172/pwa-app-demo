import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { FileSession, sessionExpiryCutoff } from "@/lib/models/FileSession";
import { SessionPhoto } from "@/lib/models/SessionPhoto";
import { SessionRecord } from "@/lib/models/SessionRecord";
import { requireSession, json } from "@/lib/api";
import { writeAudit, auditActor } from "@/lib/audit";

/** Sessions live 48h from creation. Expired ones are PURGED — the session and
 *  its data (photos, merged records) are deleted. Audit log entries remain, as
 *  the compliance trail must outlive the working data. */
async function purgeExpired(userId: string) {
  const expired = await FileSession.find({
    userId,
    createdAt: { $lt: sessionExpiryCutoff() },
  })
    .select("_id")
    .lean();
  if (!expired.length) return;
  const ids = expired.map((e) => e._id);
  await Promise.all([
    SessionPhoto.deleteMany({ sessionId: { $in: ids } }),
    SessionRecord.deleteMany({ sessionId: { $in: ids } }),
    FileSession.deleteMany({ _id: { $in: ids } }),
  ]);
}

/** List the current user's file sessions (most recently active first). */
export async function GET() {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  await connectDB();
  await purgeExpired(guard.session.sub);
  const sessions = await FileSession.find({ userId: guard.session.sub })
    .sort({ lastActiveAt: -1 })
    .limit(50)
    .lean();

  return json({ sessions });
}

/** Create (start) a new file session. */
export async function POST(req: NextRequest) {
  const guard = await requireSession("session:create");
  if ("response" in guard) return guard.response;

  const { title, caseRef } = await req.json().catch(() => ({}));

  await connectDB();

  // If no title was entered, name it after the signed-in user + a running count
  // (e.g. "Jane Doe — Session 3") so an empty form still starts a valid session.
  let sessionTitle = typeof title === "string" ? title.trim() : "";
  if (!sessionTitle) {
    const count = await FileSession.countDocuments({ userId: guard.session.sub });
    sessionTitle = `${guard.session.name} — Session ${count + 1}`;
  }

  const doc = await FileSession.create({
    userId: guard.session.sub,
    title: sessionTitle,
    caseRef: caseRef ? String(caseRef).trim() : "",
    status: "open",
    source: "mobile",
    lastActiveAt: new Date(),
  });

  await writeAudit(req, auditActor(guard.session), {
    action: "session_create",
    sessionId: doc._id.toString(),
  });

  return json({ session: doc }, 201);
}
