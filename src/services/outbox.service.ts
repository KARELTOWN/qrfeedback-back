import type { Types } from "mongoose";
import { OutboxEvent, type OutboxEventType } from "../models/OutboxEvent.js";
import { outboxQueue } from "../queues/queues.js";

type PublishOutboxEventInput = {
  type: OutboxEventType;
  aggregateId: string;
  companyId?: string | Types.ObjectId;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
};

/**
 * Persists the intent before attempting Redis. A later dispatcher can recover any
 * pending event if Redis or the API process disappears at the wrong moment.
 */
export async function publishOutboxEvent(input: PublishOutboxEventInput) {
  const event = await OutboxEvent.findOneAndUpdate(
    { idempotencyKey: input.idempotencyKey },
    {
      $setOnInsert: {
        type: input.type,
        company: input.companyId,
        aggregateId: input.aggregateId,
        payload: input.payload || {},
        idempotencyKey: input.idempotencyKey,
        status: "pending",
      },
    },
    { new: true, upsert: true },
  );

  if (event.status === "pending" || event.status === "failed") {
    try {
      await enqueueOutboxEvent(String(event._id));
      event.status = "queued";
      await event.save();
    } catch (error) {
      // Mongo is the source of truth. The worker's periodic recovery will enqueue it later.
      console.error("[outbox:enqueue:deferred]", {
        eventId: String(event._id),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return event;
}

export async function enqueueOutboxEvent(outboxEventId: string) {
  await outboxQueue.add(
    "dispatch",
    { outboxEventId },
    { jobId: `outbox:${outboxEventId}` },
  );
}

export async function enqueuePendingOutboxEvents(limit = 100) {
  const events = await OutboxEvent.find({
    status: { $in: ["pending", "queued", "failed"] },
    nextAttemptAt: { $lte: new Date() },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select("_id");

  await Promise.all(events.map((event) => enqueueOutboxEvent(String(event._id))));
  return events.length;
}
