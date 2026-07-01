import { Worker } from "bullmq";
import { connectDatabase } from "./config/database.js";
import { initializeTelegramBot } from "./services/telegramBot.service.js";
import { redisConnection } from "./queues/connection.js";
import { QUEUE_NAMES, scheduledQueue } from "./queues/queues.js";
import { processOutboxJob } from "./workers/outbox.worker.js";
import { processScheduledJob } from "./workers/scheduled.worker.js";

await connectDatabase();
// The API owns polling when webhook mode is disabled. Production workers should use webhooks.
await initializeTelegramBot({ polling: false });

const outboxWorker = new Worker(QUEUE_NAMES.outbox, processOutboxJob, {
  connection: redisConnection,
  concurrency: 10,
});
const scheduledWorker = new Worker(QUEUE_NAMES.scheduled, processScheduledJob, {
  connection: redisConnection,
  concurrency: 1,
});

for (const worker of [outboxWorker, scheduledWorker]) {
  worker.on("failed", (job, error) => console.error("[worker:job:failed]", { jobId: job?.id, name: job?.name, error: error.message }));
  worker.on("error", (error) => console.error("[worker:error]", error));
}

await Promise.all([
  scheduledQueue.add("outbox.recover", {}, { repeat: { pattern: "*/1 * * * *" }, jobId: "outbox-recover" }),
  scheduledQueue.add("telegram-campaigns.scan", {}, { repeat: { pattern: "* * * * *" }, jobId: "telegram-campaign-scan" }),
  scheduledQueue.add("weekly-reports.send", {}, { repeat: { pattern: "0 8 * * *" }, jobId: "weekly-reports-send" }),
]);

console.info("[worker:started]");

async function shutdown(signal: string) {
  console.info("[worker:shutdown]", { signal });
  await Promise.all([outboxWorker.close(), scheduledWorker.close(), redisConnection.quit()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
