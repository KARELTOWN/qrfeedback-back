import mongoose, { type InferSchemaType, type Types } from "mongoose";

const telegramLinkTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export type ITelegramLinkToken = InferSchemaType<
  typeof telegramLinkTokenSchema
> & {
  _id: Types.ObjectId;
};

export const TelegramLinkToken = mongoose.model<ITelegramLinkToken>(
  "TelegramLinkToken",
  telegramLinkTokenSchema,
);
