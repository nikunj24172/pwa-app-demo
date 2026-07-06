/**
 * Purge file sessions past their 48h lifetime (from creation), INCLUDING their
 * data: photos and merged records. Audit logs are kept (compliance trail).
 * The app now does this lazily on each session-list request; this script is
 * for immediate/manual cleanup. Run: npx tsx scripts/purge-expired-sessions.ts
 */
import { existsSync } from "node:fs";
import mongoose from "mongoose";
import { FileSession, sessionExpiryCutoff } from "../src/lib/models/FileSession";
import { SessionPhoto } from "../src/lib/models/SessionPhoto";
import { SessionRecord } from "../src/lib/models/SessionRecord";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/infolog_pwa";

async function main() {
  await mongoose.connect(URI);
  const expired = await FileSession.find({ createdAt: { $lt: sessionExpiryCutoff() } })
    .select("_id title createdAt")
    .lean();
  if (!expired.length) {
    console.log("No expired sessions.");
  } else {
    const ids = expired.map((e) => e._id);
    const [photos, records, sessions] = await Promise.all([
      SessionPhoto.deleteMany({ sessionId: { $in: ids } }),
      SessionRecord.deleteMany({ sessionId: { $in: ids } }),
      FileSession.deleteMany({ _id: { $in: ids } }),
    ]);
    for (const e of expired) console.log(`✗ ${e.title} (created ${e.createdAt.toISOString()})`);
    console.log(
      `Purged ${sessions.deletedCount} session(s), ${photos.deletedCount} photo(s), ${records.deletedCount} record(s).`
    );
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
