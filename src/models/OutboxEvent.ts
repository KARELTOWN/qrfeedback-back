import mongoose, { type InferSchemaType, type Types } from "mongoose";

export const OUTBOX_EVENT_TYPES = [
  "review.notify.email",
  "review.notify.telegram",
  "review.notify.client.email",
  "review.notify.client.sms",
  "review.notify.manager.sms",
  "review.index",
  "telegram.update",
  "telegram.ad.broadcast",
  "weekly-report.send",
  "automation.trigger",
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

const outboxEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: OUTBOX_EVENT_TYPES, required: true, index: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    aggregateId: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "queued", "processing", "sent", "failed"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lastError: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

outboxEventSchema.index({ status: 1, nextAttemptAt: 1 });
outboxEventSchema.index({ company: 1, createdAt: -1 });

export type IOutboxEvent = InferSchemaType<typeof outboxEventSchema> & { _id: Types.ObjectId };
export const OutboxEvent = mongoose.model<IOutboxEvent>("OutboxEvent", outboxEventSchema);
