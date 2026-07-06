import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { FileSession, sessionExpiryCutoff } from "@/lib/models/FileSession";
import { requireSession, json, error } from "@/lib/api";
import { writeAudit, auditActor } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** Open / continue a specific file session. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;
  const { id } = await params;

  await connectDB();
  const session = await FileSession.findOne({
    _id: id,
    userId: guard.session.sub,
  }).lean();
  if (!session) return error("Session not found.", 404);
  if (session.createdAt < sessionExpiryCutoff()) {
    return error("This file session expired after 48 hours.", 404);
  }

  return json({ session });
}

/** Update a session — continue (touch) or close it. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;
  const { id } = await params;
  const { status } = await req.json().catch(() => ({}));

  await connectDB();
  const session = await FileSession.findOne({
    _id: id,
    userId: guard.session.sub,
  });
  if (!session) return error("Session not found.", 404);

  session.lastActiveAt = new Date();
  if (status === "closed" || status === "open") {
    const was = session.status;
    session.status = status;
    await session.save();
    if (status === "closed" && was !== "closed") {
      await writeAudit(req, auditActor(guard.session), {
        action: "session_close",
        sessionId: session._id.toString(),
      });
    }
  } else {
    await session.save();
  }

  return json({ session });
}
