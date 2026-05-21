import type { HydratedDocument } from "mongoose";
import type { ICompany } from "../models/Company.js";
import type { IReview } from "../models/Review.js";
import { Company } from "../models/Company.js";
import { CompanyQrCode, type ICompanyQrCode } from "../models/CompanyQrCode.js";
import { Review } from "../models/Review.js";
import { HttpError } from "../utils/httpError.js";
import { sendWhatsapp } from "./whatsapp.service.js";
import { buildReminderSchedule } from "./company.service.js";
import { cleanAnswerValue, getCompanyFeedbackFormConfig, getEnabledField } from "./feedbackForm.service.js";

type ReviewInput = {
  serviceFeedback?: string;
  customAnswers?: Array<{ questionId: string; value: unknown }>;
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

  if (review.serviceFeedback) lines.push(`Expérience: ${review.serviceFeedback}`);

  if (Array.isArray(review.customAnswers)) {
    for (const answer of review.customAnswers) {
      if (answer?.label && answer.value !== undefined && answer.value !== "") {
        lines.push(`${answer.label}: ${answer.value}`);
      }
    }
  }

  return lines.join("\n");
}

export async function createReviewAndNotify(
  company: HydratedDocument<ICompany>,
  payload: ReviewInput,
  qrCode?: HydratedDocument<ICompanyQrCode>,
) {
  const formConfig = getCompanyFeedbackFormConfig(company);
  const customAnswers = normalizeCustomAnswers(formConfig.customQuestions, payload.customAnswers || []);
  validateRequiredAnswers(formConfig, payload, customAnswers);

  const review = await Review.create({
    company: company._id,
    qrCode: qrCode?._id,
    serviceFeedback: getEnabledField(formConfig, "serviceFeedback") ? payload.serviceFeedback : undefined,
    customAnswers,
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

function normalizeCustomAnswers(
  questions: ReturnType<typeof getCompanyFeedbackFormConfig>["customQuestions"],
  answers: Array<{ questionId: string; value: unknown }>,
) {
  const answerById = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  return questions
    .map((question) => {
      const rawValue = answerById.get(question.id);
      const hasRawValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "";
      const value = cleanAnswerValue(question.type, rawValue);
      if (hasRawValue && value === undefined) {
        throw new HttpError(400, `${question.label} est invalide.`);
      }
      return {
        questionId: question.id,
        label: question.label,
        type: question.type,
        value,
      };
    })
    .filter((answer) => answer.value !== undefined && answer.value !== "");
}

function validateRequiredAnswers(
  config: ReturnType<typeof getCompanyFeedbackFormConfig>,
  payload: ReviewInput,
  customAnswers: Array<{ questionId: string; value: unknown }>,
) {
  for (const field of config.fields) {
    if (!field.enabled || !field.required) continue;
    const value = payload[field.key as keyof ReviewInput];
    if (!String(value || "").trim()) throw new HttpError(400, `${field.label} est requis.`);
  }

  const customAnswerIds = new Set(customAnswers.map((answer) => answer.questionId));
  for (const question of config.customQuestions) {
    if (question.required && !customAnswerIds.has(question.id)) {
      throw new HttpError(400, `${question.label} est requis.`);
    }
  }
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
