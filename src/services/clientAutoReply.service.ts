import { Company } from "../models/Company.js";
import { Review } from "../models/Review.js";
import { sendTemplateMail } from "./notificationTemplate.service.js";
import { sendSms } from "./sms.service.js";
import { logger } from "../utils/logger.js";

export async function deliverClientEmailReply(reviewId: string) {
  const review = await Review.findById(reviewId);
  if (!review || review.clientEmailStatus === "sent") return;
  if (!review.clientEmail) {
    review.clientEmailStatus = "skipped";
    await review.save();
    return;
  }

  const company = await Company.findById(review.company);
  if (!company) return;

  try {
    await sendTemplateMail({
      name: "review-client-email-reply",
      to: review.clientEmail,
      variables: { companyName: company.name },
    });
    review.clientEmailStatus = "sent";
    review.clientEmailError = undefined;
    logger.info("client-reply:email:sent", { reviewId, to: review.clientEmail });
  } catch (error) {
    review.clientEmailStatus = "failed";
    review.clientEmailError = error instanceof Error ? error.message : String(error);
    logger.warn("client-reply:email:failed", { reviewId, error: review.clientEmailError });
    throw error;
  } finally {
    await review.save();
  }
}

export async function deliverClientSmsReply(reviewId: string) {
  const review = await Review.findById(reviewId);
  if (!review || review.clientSmsStatus === "sent") return;
  if (!review.clientPhone) {
    review.clientSmsStatus = "skipped";
    await review.save();
    return;
  }

  const company = await Company.findById(review.company);
  if (!company) return;

  const message = `Merci pour votre avis sur ${company.name} ! Votre retour nous aide à améliorer notre service. À bientôt !`;

  const result = await sendSms(review.clientPhone, message);
  if (result.success) {
    review.clientSmsStatus = "sent";
    review.clientSmsError = undefined;
    logger.info("client-reply:sms:sent", { reviewId, to: review.clientPhone });
  } else {
    review.clientSmsStatus = "failed";
    review.clientSmsError = result.error;
    logger.warn("client-reply:sms:failed", { reviewId, error: result.error });
  }
  await review.save();

  if (!result.success) throw new Error(result.error);
}

export async function deliverManagerSmsAlert(reviewId: string) {
  const review = await Review.findById(reviewId);
  if (!review || review.managerSmsStatus === "sent") return;

  const company = await Company.findById(review.company);
  if (!company) return;

  const smsEnabled = company.notificationPreferences?.smsEnabled;
  const managerPhone = company.notificationPreferences?.managerPhone;
  const threshold = company.notificationPreferences?.badReviewThreshold ?? 2;

  if (!smsEnabled || !managerPhone || review.rating > threshold) {
    review.managerSmsStatus = "skipped";
    await review.save();
    return;
  }

  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const preview = review.serviceFeedback ? ` — "${review.serviceFeedback.slice(0, 80)}"` : "";
  const message = `⚠️ Mauvais avis ${company.name} : ${stars} (${review.rating}/5)${preview}. Connectez-vous pour répondre.`;

  const result = await sendSms(managerPhone, message);
  if (result.success) {
    review.managerSmsStatus = "sent";
    review.managerSmsError = undefined;
    logger.info("manager-alert:sms:sent", { reviewId, to: managerPhone });
  } else {
    review.managerSmsStatus = "failed";
    review.managerSmsError = result.error;
    logger.warn("manager-alert:sms:failed", { reviewId, error: result.error });
  }
  await review.save();

  if (!result.success) throw new Error(result.error);
}
