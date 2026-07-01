import type { Job } from "bullmq";
import { broadcastDueTelegramAds } from "../services/telegramAd.service.js";
import { sendWeeklyReports } from "../jobs/weeklyReportScheduler.js";
import { enqueuePendingOutboxEvents } from "../services/outbox.service.js";

export type ScheduledJobName = "telegram-campaigns.scan" | "weekly-reports.send" | "outbox.recover";

export async function processScheduledJob(job: Job<Record<string, never>, unknown, ScheduledJobName>) {
  switch (job.name) {
    case "telegram-campaigns.scan":
      await broadcastDueTelegramAds();
      return;
    case "weekly-reports.send":
      await sendWeeklyReports();
      return;
    case "outbox.recover":
      await enqueuePendingOutboxEvents();
      return;
  }
}
