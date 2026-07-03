/**
 * One-off cleanup: the app no longer has a "close session" concept, so flip
 * every legacy status:"closed" file session back to "open".
 * Run: npx tsx scripts/reopen-sessions.ts
 */
import { existsSync } from "node:fs";
import mongoose from "mongoose";
import { FileSession } from "../src/lib/models/FileSession";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/infolog_pwa";

async function main() {
  await mongoose.connect(URI);
  const res = await FileSession.updateMany(
    { status: "closed" },
    { $set: { status: "open" } }
  );
  console.log(`Reopened ${res.modifiedCount} closed session(s).`);
  const left = await FileSession.countDocuments({ status: "closed" });
  console.log(`Sessions still closed: ${left}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
