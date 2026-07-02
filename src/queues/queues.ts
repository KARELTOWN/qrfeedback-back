import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

export const QUEUE_NAMES = {
  outbox: "outbox-events",
  scheduled: "scheduled-work",
} as const;

export const outboxQueue = new Queue<{ outboxEventId: string }>(QUEUE_NAMES.outbox, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
});

export const scheduledQueue = new Queue(QUEUE_NAMES.scheduled, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
});
