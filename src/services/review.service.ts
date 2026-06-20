import type { HydratedDocument } from "mongoose";
import type { ICompany } from "../models/Company.js";
import type { ICompanyQrCode } from "../models/CompanyQrCode.js";
import { Company } from "../models/Company.js";
import { CompanyQrCode } from "../models/CompanyQrCode.js";
import { Review } from "../models/Review.js";
import { User } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { sendMail } from "./mail.service.js";
import {
  cleanAnswerValue,
  getCompanyFeedbackFormConfig,
  getEnabledField,
} from "./feedbackForm.service.js";
import { indexReviewQuietly } from "./typesense.service.js";
import { sendReviewNotification } from "./notification.service.js";
import { logger } from "../utils/logger.js";

type ReviewInput = {
  serviceFeedback?: string;
  customAnswers?: Array<{ questionId: string; value: unknown }>;
  rating: number;
};

function notificationsEnabled(
  company: HydratedDocument<ICompany>,
  qrCode: HydratedDocument<ICompanyQrCode> | undefined,
  channel: "email" | "telegram",
) {
  const key = channel === "telegram" ? "telegramEnabled" : "emailEnabled";
  if (qrCode?.notificationPreferences?.[key] !== undefined) {
    return qrCode.notificationPreferences[key] !== false;
  }

  return company.notificationPreferences?.[key] !== false;
}

function reviewEmailHtml(company: HydratedDocument<ICompany>, review: HydratedDocument<any>) {
  const rows = [
    `<p><strong>Note :</strong> ${review.rating}/5</p>`,
    review.serviceFeedback
      ? `<p><strong>Experience :</strong><br>${review.serviceFeedback}</p>`
      : "",
    ...(review.customAnswers || []).map((answer: any) => {
      if (!answer?.label || answer.value === undefined || answer.value === "") return "";
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
  review: HydratedDocument<any>,
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
    logger.info("notification:email:sent", {
      companyId: String(company._id),
      reviewId: String(review._id),
    });
  } catch (error) {
    review.emailNotificationStatus = "failed";
    review.emailNotificationError =
      error instanceof Error ? error.message : "Erreur inconnue";
    logger.warn("notification:email:failed", {
      companyId: String(company._id),
      reviewId: String(review._id),
      error: review.emailNotificationError,
    });
  }
}

async function notifyLinkedUsersByTelegram(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<any>,
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

  const handled = results
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof sendReviewNotification>>> => result.status === 'fulfilled')
    .map((result) => result.value);
  if (handled.some((result) => result.status === 'sent')) {
    review.notificationStatus = 'sent';
    review.notificationError = undefined;
  } else if (handled.some((result) => result.status === 'failed') || results.some((result) => result.status === 'rejected')) {
    review.notificationStatus = 'failed';
    review.notificationError = 'Echec de notification Telegram.';
  }

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn("notification:telegram:failed", {
        reviewId: String(review._id),
        userId: String(users[index]?._id),
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Erreur inconnue",
      });
    } else {
      logger.info("notification:telegram:handled", {
        reviewId: String(review._id),
        userId: String(users[index]?._id),
        status: result.value.status,
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
    notificationStatus: "skipped",
    notificationError: "Notifications email et Telegram uniquement.",
  });

  indexReviewQuietly(review, qrCode);
  await notifyByEmail(company, review, qrCode);
  await notifyLinkedUsersByTelegram(company, review, qrCode);
  await review.save();

  return review;
}

export async function createReviewForCompany(slug: string, payload: ReviewInput) {
  const company = await Company.findOne({ slug });
  if (company) return createReviewAndNotify(company, payload);

  const qrCode = await CompanyQrCode.findOne({ slug, isActive: { $ne: false } });
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
    if (!String(value || "").trim()) {
      throw new HttpError(400, `${field.label} est requis.`);
    }
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
