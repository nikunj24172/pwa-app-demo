import mongoose, { Schema, model, models } from "mongoose";

/**
 * A search result "merged to file" — a snapshot of the record the officer
 * committed into the file session. Photos stay in SessionPhoto and relate to
 * the record via the same resultKey.
 */
export interface ISessionRecord {
  _id: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** Stable key of the result (e.g. "vehicle:RCF722"). One merge per record. */
  resultKey: string;
  searchType: "vehicle" | "property" | "company";
  title: string;
  /** Full raw result row at merge time, so the report re-renders as-was. */
  data: Record<string, unknown>;
  createdAt: Date;
}

const SessionRecordSchema = new Schema<ISessionRecord>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "FileSession", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    resultKey: { type: String, required: true },
    searchType: { type: String, enum: ["vehicle", "property", "company"], required: true },
    title: { type: String, required: true },
    data: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A record can be merged into a given file only once.
SessionRecordSchema.index({ sessionId: 1, resultKey: 1 }, { unique: true });

export const SessionRecord =
  (models.SessionRecord as mongoose.Model<ISessionRecord>) ||
  model<ISessionRecord>("SessionRecord", SessionRecordSchema);
