import mongoose, { Schema, model, models } from "mongoose";

/** A vehicle (or scene) photo captured during a file session — evidence. */
export interface ISessionPhoto {
  _id: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** Compressed JPEG as a base64 data URL. */
  dataUrl: string;
  label?: string;
  createdAt: Date;
}

const SessionPhotoSchema = new Schema<ISessionPhoto>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "FileSession", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    dataUrl: { type: String, required: true },
    label: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const SessionPhoto =
  (models.SessionPhoto as mongoose.Model<ISessionPhoto>) ||
  model<ISessionPhoto>("SessionPhoto", SessionPhotoSchema);
