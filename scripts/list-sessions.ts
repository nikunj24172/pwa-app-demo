/** List all file sessions with ages. Run: npx tsx scripts/list-sessions.ts */
import { existsSync } from "node:fs";
import mongoose from "mongoose";
import { FileSession } from "../src/lib/models/FileSession";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/infolog_pwa");
  const all = await FileSession.find({}).select("title createdAt lastActiveAt").lean();
  for (const s of all) {
    const h = ((Date.now() - s.createdAt.getTime()) / 3.6e6).toFixed(1);
    console.log(`${s.title} — created ${s.createdAt.toISOString()} (${h}h ago)`);
  }
  console.log(`Total: ${all.length}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
