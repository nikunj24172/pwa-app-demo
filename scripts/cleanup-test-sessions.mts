import mongoose from "mongoose";
import { FileSession } from "../src/lib/models/FileSession";
import { SessionRecord } from "../src/lib/models/SessionRecord";
import { SessionPhoto } from "../src/lib/models/SessionPhoto";

process.loadEnvFile(".env.local");

await mongoose.connect(process.env.MONGODB_URI!);
const ids = (
  await FileSession.find({
    title: { $in: ["Nikunj Chudasama — Session 3", "photo-flow-verify"] },
  })
    .select("_id")
    .lean()
).map((s) => s._id);
const photos = await SessionPhoto.deleteMany({ sessionId: { $in: ids } });
const records = await SessionRecord.deleteMany({ sessionId: { $in: ids } });
const sessions = await FileSession.deleteMany({ _id: { $in: ids } });
console.log(
  `sessions=${sessions.deletedCount} photos=${photos.deletedCount} records=${records.deletedCount}`
);
await mongoose.disconnect();
