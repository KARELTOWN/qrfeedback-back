import type { HydratedDocument } from "mongoose";
import type { ICompany } from "../models/Company.js";
import type { IReview } from "../models/Review.js";
import { Company } from "../models/Company.js";
import { CompanyQrCode, type ICompanyQrCode } from "../models/CompanyQrCode.js";
import { Review } from "../models/Review.js";
import { HttpError } from "../utils/httpError.js";
import { sendWhatsapp } from "./whatsapp.service.js";
import { buildReminderSchedule } from "./company.service.js";

type ReviewInput = {
  customerName?: string;
  customerPhone?: string;
  serviceFeedback?: string;
  improvementSuggestion?: string;
  badExperience?: string;
  rating: number;
};

type TwilioStatusInput = {
  messageSid: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
};

function reviewWhatsappBody(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
) {
  const lines = [
    `Nouvel avis pour ${company.name}`,
    `Note: ${review.rating}/5`,
  ];

  if (review.customerName) lines.push(`Nom: ${review.customerName}`);
  if (review.customerPhone) lines.push(`Téléphone: ${review.customerPhone}`);
  if (review.serviceFeedback) lines.push(`Services: ${review.serviceFeedback}`);
  if (review.improvementSuggestion)
    lines.push(`À améliorer: ${review.improvementSuggestion}`);
  if (review.badExperience)
    lines.push(`Mauvaise expérience: ${review.badExperience}`);

  return lines.join("\n");
}

export async function createReviewAndNotify(
  company: HydratedDocument<ICompany>,
  payload: ReviewInput,
  qrCode?: HydratedDocument<ICompanyQrCode>,
) {
  const review = await Review.create({
    company: company._id,
    qrCode: qrCode?._id,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    serviceFeedback: payload.serviceFeedback,
    improvementSuggestion: payload.improvementSuggestion,
    badExperience: payload.badExperience,
    rating: payload.rating,
  });

  const hasFreeCredit = company.freeMessagesUsed < company.freeMessagesLimit;
  const hasPaidCredit = company.paidMessagesBalance > 0;
  const reservedMessages = await Review.countDocuments({
    company: company._id,
    _id: { $ne: review._id },
    notificationStatus: { $in: ["pending", "queued"] },
    notificationChargedAt: { $exists: false },
  });
  const availableMessages =
    company.freeMessagesLimit -
    company.freeMessagesUsed +
    company.paidMessagesBalance -
    reservedMessages;

  if ((!hasFreeCredit && !hasPaidCredit) || availableMessages <= 0) {
    await markLimitReached(company);
    review.notificationStatus = "skipped";
    await review.save();
    return review;
  }

  const notificationNumber = qrCode?.whatsappNumber || company.whatsappNumber;

  if (!notificationNumber) {
    review.notificationStatus = "skipped";
    review.notificationError =
      "Aucun numéro WhatsApp configuré pour cette entreprise.";
    await review.save();
    return review;
  }

  try {
    const messageSend = await sendWhatsapp({
      to: notificationNumber,
      body: reviewWhatsappBody(company, review),
    });

    review.notificationStatus = "queued";
    review.notificationWhatsappNumber = notificationNumber;
    review.twilioMessageSid = messageSend.sid;
  } catch (error) {
    review.notificationStatus = "failed";
    review.notificationError =
      error instanceof Error ? error.message : "Erreur inconnue";
  }

  await review.save();
  return review;
}

export async function createReviewForCompany(
  slug: string,
  payload: ReviewInput,
) {
  const company = await Company.findOne({ slug });
  if (company) return createReviewAndNotify(company, payload);

  const qrCode = await CompanyQrCode.findOne({ slug });
  if (!qrCode) throw new HttpError(404, "Entreprise introuvable.");

  const qrCompany = await Company.findById(qrCode.company);
  if (!qrCompany) throw new HttpError(404, "Entreprise introuvable.");

  return createReviewAndNotify(qrCompany, payload, qrCode);
}

async function markLimitReached(company: HydratedDocument<ICompany>) {
  if (!company.limitReachedAt) {
    company.limitReachedAt = new Date();
    company.set(
      "reminderSchedule",
      buildReminderSchedule(company.limitReachedAt),
    );
  }
  await company.save();
}

export async function handleTwilioMessageStatus({
  messageSid,
  status,
  errorCode,
  errorMessage,
}: TwilioStatusInput) {
  const review = await Review.findOne({ twilioMessageSid: messageSid });
  if (!review) return { handled: false };

  const normalizedStatus = status.toLowerCase();

  if (["sent", "delivered"].includes(normalizedStatus)) {
    review.notificationStatus =
      normalizedStatus === "delivered" ? "delivered" : "sent";
    review.notificationError = undefined;

    if (!review.notificationChargedAt) {
      const company = await Company.findById(review.company);
      if (company) {
        if (company.freeMessagesUsed < company.freeMessagesLimit) {
          company.freeMessagesUsed += 1;
        } else if (company.paidMessagesBalance > 0) {
          company.paidMessagesBalance -= 1;
        } else {
          await markLimitReached(company);
          review.notificationError =
            "Message envoyÃ© sans crÃ©dit disponible au moment du callback Twilio.";
        }

        if (!review.notificationError) {
          if (
            company.freeMessagesUsed >= company.freeMessagesLimit &&
            company.paidMessagesBalance <= 0
          ) {
            await markLimitReached(company);
          } else {
            await company.save();
          }
          review.notificationChargedAt = new Date();
        }
      }
    }

    review.notifiedAt = review.notifiedAt || new Date();
  } else if (["failed", "undelivered"].includes(normalizedStatus)) {
    review.notificationStatus = "failed";
    review.notificationError =
      errorMessage || errorCode || `Twilio status: ${normalizedStatus}`;
  } else if (["queued", "sending", "accepted"].includes(normalizedStatus)) {
    review.notificationStatus = "queued";
  }

  await review.save();
  return { handled: true };
}
