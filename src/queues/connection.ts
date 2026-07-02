import { Redis } from "ioredis";
import { env } from "../config/env.js";

/** Shared Redis connection. BullMQ requires maxRetriesPerRequest to be disabled in workers. */
export const redisConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on("error", (error: Error) => {
  console.error("[redis:error]", error instanceof Error ? error.message : error);
});
