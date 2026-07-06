import mongoose, { Schema, model, models } from "mongoose";

/** A field-work "File Session" — the unit that groups searches and syncs to desktop. */
export interface IFileSession {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  caseRef: string;
  status: "open" | "closed";
  /** where the session was last touched — used for continue-later + audit sync */
  lastActiveAt: Date;
  source: "mobile" | "desktop";
  searchCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * File sessions are 48-hour field artifacts: they disappear from the app 48h
 * after their LAST activity (a search / photo / merge extends the window).
 * Expired sessions are hidden, not deleted — the audit trail must survive.
 */
export const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
export const sessionActiveCutoff = () => new Date(Date.now() - SESSION_TTL_MS);

const FileSessionSchema = new Schema<IFileSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    caseRef: { type: String, default: "" },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    lastActiveAt: { type: Date, default: Date.now },
    source: { type: String, enum: ["mobile", "desktop"], default: "mobile" },
    searchCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const FileSession =
  (models.FileSession as mongoose.Model<IFileSession>) ||
  model<IFileSession>("FileSession", FileSessionSchema);
