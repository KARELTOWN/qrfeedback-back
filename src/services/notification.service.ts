import type { HydratedDocument } from "mongoose";
import type { IUser } from "../models/User.js";
import type { ICompany } from "../models/Company.js";
import type { ICompanyQrCode } from "../models/CompanyQrCode.js";
import type { IReview } from "../models/Review.js";
import { sendTemplateMail } from "./notificationTemplate.service.js";
import { sendTelegram } from "./telegram.service.js";
import { env } from "../config/env.js";

export type NotificationChannelType = "email" | "telegram";

type SendReviewNotificationInput = {
  user: HydratedDocument<IUser>;
  company: HydratedDocument<ICompany>;
  review: HydratedDocument<IReview>;
  qrCode?: HydratedDocument<ICompanyQrCode>;
  channel?: NotificationChannelType;
};

type NotificationStatus = {
  channel: NotificationChannelType;
  status: "sent" | "failed" | "skipped";
  error?: string;
  messageId?: string;
};

export async function sendReviewNotification({
  user,
  company,
  review,
  qrCode,
  channel,
}: SendReviewNotificationInput): Promise<NotificationStatus> {
  const targetChannel = channel || "email";
  const isEnabled = user.notificationPreferences?.channels?.[targetChannel];

  if (!isEnabled) {
    return {
      channel: targetChannel,
      status: "skipped",
      error: `Canal ${targetChannel} desactive`,
    };
  }

  try {
    if (targetChannel === "telegram") {
      return await sendTelegramReviewNotification(user, company, review, qrCode);
    }

    return await sendEmailReviewNotification(user, company, review);
  } catch (error) {
    return {
      channel: targetChannel,
      status: "failed",
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
}

export async function broadcastReviewNotification({
  user,
  company,
  review,
  qrCode,
}: Omit<SendReviewNotificationInput, "channel">): Promise<NotificationStatus[]> {
  const channels: NotificationChannelType[] = ["email", "telegram"];
  const results = await Promise.all(
    channels.map((channel) =>
      sendReviewNotification({ user, company, review, qrCode, channel }).catch(
        (error) => ({
          channel,
          status: "failed" as const,
          error: error instanceof Error ? error.message : "Erreur inconnue",
        }),
      ),
    ),
  );
  return results;
}

async function sendEmailReviewNotification(
  user: HydratedDocument<IUser>,
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
): Promise<NotificationStatus> {
  await sendTemplateMail({
    name: "review-new-user",
    to: user.email,
    variables: {
      companyName: company.name,
      rating: review.rating,
      serviceFeedback: review.serviceFeedback || "Sans commentaire",
    },
  });

  return {
    channel: "email",
    status: "sent",
  };
}

async function sendTelegramReviewNotification(
  user: HydratedDocument<IUser>,
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
  qrCode?: HydratedDocument<ICompanyQrCode>,
): Promise<NotificationStatus> {
  const chatId = user.telegramProfile?.chatId;

  if (!chatId) {
    return {
      channel: "telegram",
      status: "skipped",
      error: "Chat Telegram non configure",
    };
  }

  const result = await sendTelegram({
    chatId,
    message: buildReviewTelegramMessage(company, review, qrCode),
    keyboard: buildReviewTelegramKeyboard(review),
  });

  return {
    channel: "telegram",
    status: "sent",
    messageId: String(result.messageId),
  };
}

export async function sendGuestReviewNotification(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
): Promise<NotificationStatus> {
  const chatId = company.telegramGuestChatId;

  if (!chatId) {
    return {
      channel: "telegram",
      status: "skipped",
      error: "Chat Telegram guest non configure",
    };
  }

  const result = await sendTelegram({
    chatId,
    message: buildReviewTelegramMessage(company, review),
    keyboard: buildReviewTelegramKeyboard(review),
  });

  return {
    channel: "telegram",
    status: "sent",
    messageId: String(result.messageId),
  };
}

function buildReviewTelegramKeyboard(
  review: HydratedDocument<IReview>,
): Array<Array<{ text: string; callback_data?: string; url?: string }>> {
  const reviewId = String(review._id);
  const dashboardUrl = `${env.frontendUrl.replace(/\/$/, "")}/reviews`;
  const keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [
    [
      { text: "Voir details", callback_data: `review_detail_${reviewId}` },
      { text: "Archiver", callback_data: `review_archive_${reviewId}` },
    ],
    [
      { text: "Ajouter une note", callback_data: `review_reply_${reviewId}` },
      { text: "Ajouter un tag", callback_data: `review_tag_${reviewId}` },
    ],
    [{ text: "Retour", callback_data: "my_reviews" }],
    [{ text: "Menu principal", callback_data: "main_menu" }],
  ];

  try {
    const parsedUrl = new URL(dashboardUrl);
    if (
      ["http:", "https:"].includes(parsedUrl.protocol) &&
      !["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)
    ) {
      keyboard.push([{ text: "Ouvrir le dashboard", url: dashboardUrl }]);
    }
  } catch {
    // Ignore invalid dashboard URLs; callback actions remain available.
  }

  return keyboard;
}

function buildReviewTelegramMessage(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
  qrCode?: HydratedDocument<ICompanyQrCode>,
): string {
  const lines = [
    `<b>Nouvel avis pour ${company.name}</b>`,
    "",
    qrCode?.label ? `<b>QR code:</b> ${qrCode.label}` : "",
    `<b>Score:</b> ${review.rating}/5`,
  ];

  if (review.serviceFeedback) {
    lines.push(`<b>Experience:</b> ${review.serviceFeedback}`);
  }

  if (Array.isArray(review.customAnswers)) {
    for (const answer of review.customAnswers) {
      if (answer?.label && answer.value !== undefined && answer.value !== "") {
        lines.push(`<b>${answer.label}:</b> ${answer.value}`);
      }
    }
  }

  return lines.filter(Boolean).join("\n");
}

function buildReviewEmailHtml(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
): string {
  const rows = [
    `<p><strong>Note :</strong> ${review.rating}/5</p>`,
    review.serviceFeedback
      ? `<p><strong>Experience :</strong><br>${review.serviceFeedback}</p>`
      : "",
    ...(review.customAnswers || []).map((answer) => {
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
    </div>
  `;
}
