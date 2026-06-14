import type { HydratedDocument } from "mongoose";
import { env } from "../config/env.js";
import type { ICompany } from "../models/Company.js";
import type { IReview } from "../models/Review.js";
import { Company } from "../models/Company.js";
import { CompanyQrCode, type ICompanyQrCode } from "../models/CompanyQrCode.js";
import { Review } from "../models/Review.js";
import { User } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { sendWhatsapp } from "./whatsapp.service.js";
import { sendMail } from "./mail.service.js";
import { buildReminderSchedule } from "./company.service.js";
import {
  cleanAnswerValue,
  getCompanyFeedbackFormConfig,
  getEnabledField,
} from "./feedbackForm.service.js";
import { indexReviewQuietly } from "./typesense.service.js";
import { sendReviewNotification } from "./notification.service.js";

type ReviewInput = {
  serviceFeedback?: string;
  customAnswers?: Array<{ questionId: string; value: unknown }>;
  rating: number;
};

type WhatsAppStatusInput = {
  messageId: string;
  status: string;
  errorCode?: string | number;
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

  if (review.serviceFeedback)
    lines.push(`Expérience: ${review.serviceFeedback}`);

  if (Array.isArray(review.customAnswers)) {
    for (const answer of review.customAnswers) {
      if (answer?.label && answer.value !== undefined && answer.value !== "") {
        lines.push(`${answer.label}: ${answer.value}`);
      }
    }
  }

  return lines.join("\n");
}

function reviewWhatsappTemplateDetails(review: HydratedDocument<IReview>) {
  const parts = [];
  if (review.serviceFeedback)
    parts.push(`Experience: ${review.serviceFeedback}`);

  if (Array.isArray(review.customAnswers)) {
    for (const answer of review.customAnswers) {
      if (answer?.label && answer.value !== undefined && answer.value !== "") {
        parts.push(`${answer.label}: ${answer.value}`);
      }
    }
  }

  const details = parts.join(" | ") || "Avis sans commentaire detaille.";
  return details.length > 900 ? `${details.slice(0, 897)}...` : details;
}

function notificationsEnabled(
  company: HydratedDocument<ICompany>,
  qrCode: HydratedDocument<ICompanyQrCode> | undefined,
  channel: "whatsapp" | "email" | "telegram",
) {
  const key =
    channel === "whatsapp"
      ? "whatsappEnabled"
      : channel === "telegram"
        ? "telegramEnabled"
        : "emailEnabled";
  return (
    company.notificationPreferences?.[key] !== false &&
    qrCode?.notificationPreferences?.[key] !== false
  );
}

function reviewEmailHtml(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
) {
  const rows = [
    `<p><strong>Note :</strong> ${review.rating}/5</p>`,
    review.serviceFeedback
      ? `<p><strong>Experience :</strong><br>${review.serviceFeedback}</p>`
      : "",
    ...(review.customAnswers || []).map((answer) => {
      if (!answer?.label || answer.value === undefined || answer.value === "")
        return "";
      return `<p><strong>${answer.label} :</strong><br>${answer.value}</p>`;
    }),
  ]
    .filter(Boolean)
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; color: #102a43; line-height: 1.6;">
      <h2>Nouvel avis pour ${company.name}</h2>
      ${rows}
      <p style="margin-top: 24px;">
        <a href="${company.feedbackUrl.replace("/avis/", "/dashboard/reviews")}" style="display: inline-block; background: #0f766e; color: #fff; padding: 12px 16px; border-radius: 10px; text-decoration: none; font-weight: 700;">Voir mes avis</a>
      </p>
    </div>
  `;
}

async function notifyByEmail(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
  qrCode?: HydratedDocument<ICompanyQrCode>,
) {
  if (!notificationsEnabled(company, qrCode, "email")) {
    review.emailNotificationStatus = "skipped";
    review.emailNotificationError = "Notification email desactivee.";
    return;
  }

  try {
    await sendMail({
      to: company.email,
      subject: `Nouvel avis client - ${company.name}`,
      html: reviewEmailHtml(company, review),
    });

    review.notificationEmail = company.email;
    review.emailNotificationStatus = "sent";
    review.emailNotificationChargedAt = undefined;
  } catch (error) {
    review.emailNotificationStatus = "failed";
    review.emailNotificationError =
      error instanceof Error ? error.message : "Erreur inconnue";
  }
}

async function notifyLinkedUsersByTelegram(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
  qrCode?: HydratedDocument<ICompanyQrCode>,
) {
  if (!notificationsEnabled(company, qrCode, "telegram")) return;

  const users = await User.find({
    company: company._id,
    isActive: { $ne: false },
    "telegramProfile.chatId": { $exists: true, $ne: "" },
    "telegramProfile.isActive": true,
    "notificationPreferences.channels.telegram": true,
  });

  const results = await Promise.allSettled(
    users.map((user) =>
      sendReviewNotification({
        user,
        company,
        review,
        qrCode,
        channel: "telegram",
      }),
    ),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[review:notify:telegram:user:error]", {
        reviewId: String(review._id),
        userId: String(users[index]?._id),
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Erreur inconnue",
      });
    }
  });
}

export async function createReviewAndNotify(
  company: HydratedDocument<ICompany>,
  payload: ReviewInput,
  qrCode?: HydratedDocument<ICompanyQrCode>,
) {
  const formConfig = getCompanyFeedbackFormConfig(company);
  const customAnswers = normalizeCustomAnswers(
    formConfig.customQuestions,
    payload.customAnswers || [],
  );
  validateRequiredAnswers(formConfig, payload, customAnswers);

  const review = await Review.create({
    company: company._id,
    qrCode: qrCode?._id,
    serviceFeedback: getEnabledField(formConfig, "serviceFeedback")
      ? payload.serviceFeedback
      : undefined,
    customAnswers,
    rating: payload.rating,
  });
  indexReviewQuietly(review, qrCode);
  await notifyByEmail(company, review, qrCode);
  await notifyLinkedUsersByTelegram(company, review, qrCode);
  review.notificationStatus = "skipped";
  review.notificationError = "Notification WhatsApp desactivee.";
  await review.save();
  return review;

  console.info("[review:notify:start]", {
    reviewId: String(review._id),
    companyId: String(company._id),
    companySlug: company.slug,
    qrCodeId: qrCode?._id ? String(qrCode?._id) : undefined,
    qrCodeSlug: qrCode?.slug,
    rating: review.rating,
  });

  if (!notificationsEnabled(company, qrCode, "whatsapp")) {
    review.notificationStatus = "skipped";
    review.notificationError = "Notification WhatsApp desactivee.";
    await review.save();
    return review;
  }

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

  console.info("[review:notify:credits]", {
    reviewId: String(review._id),
    freeMessagesUsed: company.freeMessagesUsed,
    freeMessagesLimit: company.freeMessagesLimit,
    paidMessagesBalance: company.paidMessagesBalance,
    reservedMessages,
    availableMessages,
  });

  if ((!hasFreeCredit && !hasPaidCredit) || availableMessages <= 0) {
    await markLimitReached(company);
    review.notificationStatus = "skipped";
    await review.save();
    console.warn("[review:notify:skipped]", {
      reviewId: String(review._id),
      reason: "no_credit",
      notificationStatus: review.notificationStatus,
    });
    return review;
  }

  const notificationNumber = (qrCode?.whatsappNumber || company.whatsappNumber || "").trim();
  const notificationSource = qrCode?.whatsappNumber ? "qr_code" : "company";

  console.info("[review:notify:recipient]", {
    reviewId: String(review._id),
    source: notificationSource,
    hasQrCodeNumber: Boolean(qrCode?.whatsappNumber),
    hasCompanyNumber: Boolean(company.whatsappNumber),
    notificationNumber,
  });

  if (!notificationNumber) {
    review.notificationStatus = "skipped";
    review.notificationError =
      "Aucun numéro WhatsApp configuré pour cette entreprise.";
    await review.save();
    console.warn("[review:notify:skipped]", {
      reviewId: String(review._id),
      reason: "missing_recipient",
      notificationStatus: review.notificationStatus,
    });
    return review;
  }

  review.notificationWhatsappNumber = notificationNumber;

  try {
    const messageSend = await sendWhatsapp({
      to: notificationNumber,
      body: reviewWhatsappBody(company, review),
      template: {
        name: env.whatsapp.reviewTemplateName,
        language: env.whatsapp.reviewTemplateLanguage,
        parameters: [
          company.name,
          String(review.rating),
          reviewWhatsappTemplateDetails(review),
        ],
      },
    });

    review.notificationStatus = "queued";
    review.whatsappMessageId = messageSend.id;
    console.info("[review:notify:queued]", {
      reviewId: String(review._id),
      whatsappMessageId: review.whatsappMessageId,
      providerStatus: messageSend.status,
    });
  } catch (error) {
    review.notificationStatus = "failed";
    const caughtError = error as { message?: unknown };
    const notificationError =
      typeof caughtError.message === "string" ? caughtError.message : "Erreur inconnue";
    review.notificationError = String(notificationError);
    console.error("[review:notify:failed]", {
      reviewId: String(review._id),
      notificationError: review.notificationError,
    });
  }

  await review.save();
  console.info("[review:notify:saved]", {
    reviewId: String(review._id),
    notificationStatus: review.notificationStatus,
    hasWhatsappMessageId: Boolean(review.whatsappMessageId),
    notificationError: review.notificationError,
  });
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
  const answerById = new Map(
    answers.map((answer) => [answer.questionId, answer.value]),
  );
  return questions
    .map((question) => {
      const rawValue = answerById.get(question.id);
      const hasRawValue =
        rawValue !== undefined &&
        rawValue !== null &&
        String(rawValue).trim() !== "";
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
    if (!String(value || "").trim())
      throw new HttpError(400, `${field.label} est requis.`);
  }

  const customAnswerIds = new Set(
    customAnswers.map((answer) => answer.questionId),
  );
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

export async function handleWhatsappMessageStatus({
  messageId,
  status,
  errorCode,
  errorMessage,
}: WhatsAppStatusInput) {
  console.info("[whatsapp:webhook:status]", {
    messageId,
    status,
    errorCode,
    hasErrorMessage: Boolean(errorMessage),
  });

  const review = await Review.findOne({ whatsappMessageId: messageId });
  if (!review) {
    console.warn("[whatsapp:webhook:unmatched]", { messageId, status });
    return { handled: false };
  }

  const normalizedStatus = status.toLowerCase();

  if (["sent", "delivered", "read"].includes(normalizedStatus)) {
    review.notificationStatus = ["delivered", "read"].includes(normalizedStatus)
      ? "delivered"
      : "sent";
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
            "Message envoye sans credit disponible au moment du callback WhatsApp.";
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
      errorMessage ||
      String(errorCode || "") ||
      `WhatsApp status: ${normalizedStatus}`;
  } else if (["queued", "sending", "accepted"].includes(normalizedStatus)) {
    review.notificationStatus = "queued";
  }

  await review.save();
  console.info("[whatsapp:webhook:saved]", {
    reviewId: String(review._id),
    messageId,
    notificationStatus: review.notificationStatus,
    notificationChargedAt: review.notificationChargedAt,
    notificationError: review.notificationError,
  });
  return { handled: true };
}
