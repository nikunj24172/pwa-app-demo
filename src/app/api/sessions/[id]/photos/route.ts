import type { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { FileSession } from "@/lib/models/FileSession";
import { SessionPhoto } from "@/lib/models/SessionPhoto";
import { requireSession, json, error } from "@/lib/api";
import { writeAudit, auditActor } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

// Compressed client-side to ~1024px JPEG; cap the payload defensively.
const MAX_DATAURL_LEN = 3_000_000; // ~3MB

/** Audit fields for a photo: parseable "field=value" searchedValue so tapping
 *  the trail entry can re-open the result the photo belongs to. */
function photoAuditFields(resultKey: string | undefined, label: string | undefined) {
  const [rkType, ...rkRest] = (resultKey ?? "").split(":");
  const isSearchType = rkType === "vehicle" || rkType === "company" || rkType === "property";
  return {
    searchType: isSearchType ? (rkType as "vehicle" | "company" | "property") : undefined,
    searchedValue: isSearchType
      ? `${rkType === "vehicle" ? "registration" : rkType === "company" ? "name" : "address"}=${rkRest.join(":")}`
      : label,
  };
}

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
  await writeAudit(req, auditActor(guard.session), {
    action: "photo_attach",
    ...photoAuditFields(photo.resultKey, photo.label),
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

/** Delete a photo (works before or after its result was merged to file). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;
  const { id } = await params;

  const photoId = req.nextUrl.searchParams.get("photoId");
  if (!photoId || !mongoose.isValidObjectId(photoId)) {
    return error("A valid photo id is required.");
  }

  await connectDB();
  const session = await FileSession.findOne({ _id: id, userId: guard.session.sub });
  if (!session) return error("Session not found.", 404);

  const photo = await SessionPhoto.findOneAndDelete({
    _id: photoId,
    sessionId: id,
    userId: guard.session.sub,
  });
  if (!photo) return error("Photo not found.", 404);

  session.lastActiveAt = new Date();
  await session.save();

  await writeAudit(req, auditActor(guard.session), {
    action: "photo_delete",
    ...photoAuditFields(photo.resultKey, photo.label),
    sessionId: id,
  });

  return json({ ok: true });
}
