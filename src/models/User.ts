import mongoose, { type InferSchemaType, type Types } from "mongoose";

const userSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
    passwordHash: { type: String, required: true },
    roleId: {
      type: String,
      enum: ["utilisateur", "superadministrateur"],
      default: "utilisateur",
      index: true,
    },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    tokenVersion: { type: Number, default: 0 },
    resetTokenHash: { type: String },
    resetTokenExpiresAt: { type: Date },
    otpHash: { type: String },
    otpPurpose: { type: String, enum: ["signup", "login", "reset-password"] },
    otpExpiresAt: { type: Date },
    emailVerified: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: true },
    // Préférences de notification
    notificationPreferences: {
      channels: {
        email: { type: Boolean, default: true },
        telegram: { type: Boolean, default: false },
      },
    },
    // Profil Telegram
    telegramProfile: {
      chatId: { type: String },
      username: { type: String },
      firstName: { type: String },
      lastName: { type: String },
      connectedAt: { type: Date },
      isActive: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

export type IUser = InferSchemaType<typeof userSchema> & {
  _id: Types.ObjectId;
};

export const User = mongoose.model<IUser>("User", userSchema);
