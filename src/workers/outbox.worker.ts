import type { Job } from "bullmq";
import { OutboxEvent } from "../models/OutboxEvent.js";
import { Review } from "../models/Review.js";
import { CompanyQrCode } from "../models/CompanyQrCode.js";
import { indexReview } from "../services/typesense.service.js";
import { processTelegramUpdate } from "../services/telegramBot.service.js";
import {
  deliverReviewEmailNotification,
  deliverReviewTelegramNotifications,
} from "../services/review.service.js";
import {
  deliverClientEmailReply,
  deliverClientSmsReply,
  deliverManagerSmsAlert,
} from "../services/clientAutoReply.service.js";

export async function processOutboxJob(job: Job<{ outboxEventId: string }>) {
  const event = await OutboxEvent.findById(job.data.outboxEventId);
  if (!event || event.status === "sent") return;

  event.status = "processing";
  event.attempts += 1;
  event.lastError = undefined;
  await event.save();

  try {
    const reviewId = String(event.payload?.reviewId || event.aggregateId);
    switch (event.type) {
      case "review.notify.email":
        await deliverReviewEmailNotification(reviewId);
        break;
      case "review.notify.telegram":
        await deliverReviewTelegramNotifications(reviewId);
        break;
      case "review.index": {
        const review = await Review.findById(reviewId);
        if (review) {
          const qrCode = review.qrCode ? await CompanyQrCode.findById(review.qrCode) : undefined;
          await indexReview(review, qrCode || undefined);
        }
        break;
      }
      case "review.notify.client.email":
        await deliverClientEmailReply(reviewId);
        break;
      case "review.notify.client.sms":
        await deliverClientSmsReply(reviewId);
        break;
      case "review.notify.manager.sms":
        await deliverManagerSmsAlert(reviewId);
        break;
      case "telegram.update":
        processTelegramUpdate(event.payload?.update);
        break;
      case "automation.trigger":
        // Reserved durable boundary for Telegram/WhatsApp automation execution.
        break;
      default:
        throw new Error(`Unsupported outbox event: ${event.type}`);
    }

    event.status = "sent";
    event.processedAt = new Date();
    await event.save();
  } catch (error) {
    event.status = "failed";
    event.lastError = error instanceof Error ? error.message : String(error);
    event.nextAttemptAt = new Date(Date.now() + Math.min(60_000 * event.attempts, 15 * 60_000));
    await event.save();
    throw error;
  }
}
