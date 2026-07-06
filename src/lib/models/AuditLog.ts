import mongoose, { Schema, model, models } from "mongoose";

/**
 * Audit trail — one entry per meaningful action. Mirrors the desktop audit
 * schema so mobile activity synchronizes with existing history.
 * Records: user, time, device, search type, searched value, session id,
 * result access, ip/location, mobile source.
 */
export interface IAuditLog {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  username: string;
  action:
    | "login"
    | "logout"
    | "search"
    | "result_access"
    | "session_create"
    | "session_close"
    | "record_merge"
    | "photo_attach"
    | "photo_delete"
    | "mfa_enable"
    | "mfa_disable";
  searchType?: "vehicle" | "property" | "company";
  searchedValue?: string;
  purpose?: string;
  sessionId?: mongoose.Types.ObjectId;
  resultAccessed: boolean;
  resultCount?: number;
  device: string;
  userAgent: string;
  ip: string;
  location?: string;
  source: "mobile" | "desktop";
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    username: { type: String, required: true },
    action: { type: String, required: true, index: true },
    searchType: { type: String, enum: ["vehicle", "property", "company"] },
    searchedValue: String,
    purpose: String,
    sessionId: { type: Schema.Types.ObjectId, ref: "FileSession", index: true },
    resultAccessed: { type: Boolean, default: false },
    resultCount: Number,
    device: { type: String, default: "unknown" },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    location: String,
    source: { type: String, enum: ["mobile", "desktop"], default: "mobile" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog =
  (models.AuditLog as mongoose.Model<IAuditLog>) ||
  model<IAuditLog>("AuditLog", AuditLogSchema);
