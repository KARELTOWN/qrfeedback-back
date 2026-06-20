import mongoose, { type InferSchemaType, type Types } from "mongoose";

const telegramAdMediaSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "audio"],
      required: true,
    },
    url: { type: String, required: true, trim: true },
    caption: { type: String, trim: true },
  },
  { _id: false },
);

const telegramAdDeliverySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    chatId: { type: String, required: true },
    status: {
      type: String,
      enum: ["sent", "failed"],
      required: true,
    },
    messageIds: [{ type: String }],
    error: { type: String },
    sentAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const telegramAdSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    contentHtml: { type: String, required: true, trim: true },
    media: { type: [telegramAdMediaSchema], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },
    publishedAt: { type: Date, index: true },
    sentAt: { type: Date, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deliveries: { type: [telegramAdDeliverySchema], default: [] },
  },
  { timestamps: true },
);

telegramAdSchema.index({ isActive: 1, publishedAt: 1, sentAt: 1, startsAt: 1, endsAt: 1 });

export type ITelegramAd = InferSchemaType<typeof telegramAdSchema> & {
  _id: Types.ObjectId;
};

export const TelegramAd = mongoose.model<ITelegramAd>("TelegramAd", telegramAdSchema);
