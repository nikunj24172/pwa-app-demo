import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { FileSession } from "@/lib/models/FileSession";
import { SessionPhoto } from "@/lib/models/SessionPhoto";
import { requireSession, json, error } from "@/lib/api";
import { writeAudit, auditActor } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

// Compressed client-side to ~1024px JPEG; cap the payload defensively.
const MAX_DATAURL_LEN = 3_000_000; // ~3MB

/** List the photos attached to a file session. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;
  const { id } = await params;

  await connectDB();
  const owns = await FileSession.exists({ _id: id, userId: guard.session.sub });
  if (!owns) return error("Session not found.", 404);

  const photos = await SessionPhoto.find({ sessionId: id, userId: guard.session.sub })
    .sort({ createdAt: -1 })
    .lean();
  return json({ photos });
}

/** Attach a captured vehicle photo (base64 JPEG) to the session. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const { dataUrl, label, resultKey } = await req.json().catch(() => ({}));
  if (typeof dataUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) {
    return error("A valid image is required.");
  }
  if (dataUrl.length > MAX_DATAURL_LEN) {
    return error("Image is too large. Please retake the photo.", 413);
  }

  await connectDB();
  const session = await FileSession.findOne({ _id: id, userId: guard.session.sub });
  if (!session) return error("Session not found.", 404);

  const photo = await SessionPhoto.create({
    sessionId: id,
    userId: guard.session.sub,
    resultKey: typeof resultKey === "string" ? resultKey.slice(0, 200) : undefined,
    dataUrl,
    label: typeof label === "string" ? label.trim().slice(0, 120) || undefined : undefined,
  });

  session.lastActiveAt = new Date();
  await session.save();

  // Audit the attach so it shows (with time) in the session's audit trail.
  // searchedValue uses the parseable "field=value" form so tapping the entry
  // can re-open the result the photo belongs to.
  const [rkType, ...rkRest] = (photo.resultKey ?? "").split(":");
  const isSearchType = rkType === "vehicle" || rkType === "company" || rkType === "property";
  await writeAudit(req, auditActor(guard.session), {
    action: "photo_attach",
    searchType: isSearchType ? rkType : undefined,
    searchedValue: isSearchType
      ? `${rkType === "vehicle" ? "registration" : rkType === "company" ? "name" : "address"}=${rkRest.join(":")}`
      : photo.label,
    sessionId: id,
    resultAccessed: true,
  });

  return json(
    {
      photo: {
        _id: photo._id.toString(),
        resultKey: photo.resultKey,
        dataUrl: photo.dataUrl,
        label: photo.label,
        createdAt: photo.createdAt,
      },
    },
    201
  );
}
