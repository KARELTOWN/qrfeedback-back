import type { HydratedDocument } from "mongoose";
import type { IUser } from "../models/User.js";
import type { ICompany } from "../models/Company.js";
import type { ICompanyQrCode } from "../models/CompanyQrCode.js";
import type { IReview } from "../models/Review.js";
import { sendWhatsapp } from "./whatsapp.service.js";
import { sendMail } from "./mail.service.js";
import { sendTelegram } from "./telegram.service.js";

export type NotificationChannelType = "email" | "whatsapp" | "telegram";

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

/**
 * Récupère le canal de notification préféré de l'utilisateur
 */
export function getPreferredChannel(
  user: HydratedDocument<IUser>,
): NotificationChannelType {
  const prefs = user.notificationPreferences;

  if (prefs?.preferredChannel === "whatsapp") {
    return "email";
  }

  // Si un canal préféré est défini et activé, l'utiliser
  if (prefs?.preferredChannel && prefs.channels?.[prefs.preferredChannel]) {
    return prefs.preferredChannel;
  }

  // Sinon, chercher le premier canal activé
  const activeChannels = Object.entries(prefs?.channels || {})
    .filter(([channel]) => channel !== "whatsapp")
    .filter(([_, enabled]) => enabled)
    .map(([channel]) => channel as NotificationChannelType);

  return activeChannels[0] || "email";
}

/**
 * Envoie une notification d'avis sur le canal préféré
 */
export async function sendReviewNotification({
  user,
  company,
  review,
  qrCode,
  channel,
}: SendReviewNotificationInput): Promise<NotificationStatus> {
  const targetChannel = channel === "whatsapp" ? "email" : channel || getPreferredChannel(user);
  const isEnabled = user.notificationPreferences?.channels?.[targetChannel];

  if (!isEnabled) {
    return {
      channel: targetChannel,
      status: "skipped",
      error: `Canal ${targetChannel} désactivé`,
    };
  }

  try {
    switch (targetChannel) {
      case "email":
        return await sendEmailReviewNotification(user, company, review);
      case "whatsapp":
        return await sendWhatsappReviewNotification(user, company, review);
      case "telegram":
        return await sendTelegramReviewNotification(user, company, review, qrCode);
      default:
        return {
          channel: targetChannel,
          status: "skipped",
          error: `Canal ${targetChannel} non reconnu`,
        };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Erreur inconnue";
    return {
      channel: targetChannel,
      status: "failed",
      error: errorMessage,
    };
  }
}

/**
 * Envoie une notification sur tous les canaux activés
 */
export async function broadcastReviewNotification({
  user,
  company,
  review,
}: Omit<SendReviewNotificationInput, "channel">): Promise<
  NotificationStatus[]
> {
  const channels: NotificationChannelType[] = ["email", "telegram"];
  const results = await Promise.all(
    channels.map((channel) =>
      sendReviewNotification({ user, company, review, channel }).catch(
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
  const html = buildReviewEmailHtml(company, review);

  await sendMail({
    to: user.email,
    subject: `Nouvel avis pour ${company.name}`,
    html,
  });

  return {
    channel: "email",
    status: "sent",
  };
}

async function sendWhatsappReviewNotification(
  user: HydratedDocument<IUser>,
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
): Promise<NotificationStatus> {
  // Pour WhatsApp, on a besoin du numéro de téléphone
  // Cette partie dépend de votre implémentation existante
  // Vous devez avoir un champ phoneNumber ou similar dans User

  const phoneNumber = (user as any).phoneNumber;
  if (!phoneNumber) {
    return {
      channel: "whatsapp",
      status: "skipped",
      error: "Numéro de téléphone non configuré",
    };
  }

  const message = buildReviewMessage(company, review);
  const result = await sendWhatsapp({
    to: phoneNumber,
    body: message,
  });

  return {
    channel: "whatsapp",
    status: "sent",
    messageId: result.id,
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
      error: "Chat Telegram non configuré",
    };
  }

  const message = buildReviewTelegramMessage(company, review, qrCode);
  const result = await sendTelegram({
    chatId,
    message,
  });

  return {
    channel: "telegram",
    status: "sent",
    messageId: String(result.messageId),
  };
}

/**
 * Envoie une notification Telegram à un guest (utilisateur sans compte)
 */
export async function sendGuestReviewNotification(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
): Promise<NotificationStatus> {
  const chatId = company.telegramGuestChatId;

  if (!chatId) {
    return {
      channel: "telegram",
      status: "skipped",
      error: "Chat Telegram guest non configuré",
    };
  }

  const message = buildReviewTelegramMessage(company, review);
  const result = await sendTelegram({
    chatId,
    message,
  });

  return {
    channel: "telegram",
    status: "sent",
    messageId: String(result.messageId),
  };
}

function buildReviewMessage(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
): string {
  const lines = [
    `Nouvel avis pour ${company.name}`,
    `Note: ${review.rating}/5`,
  ];

  if (review.serviceFeedback) {
    lines.push(`Expérience: ${review.serviceFeedback}`);
  }

  if (Array.isArray(review.customAnswers)) {
    for (const answer of review.customAnswers) {
      if (answer?.label && answer.value !== undefined && answer.value !== "") {
        lines.push(`${answer.label}: ${answer.value}`);
      }
    }
  }

  return lines.join("\n");
}

function buildReviewTelegramMessage(
  company: HydratedDocument<ICompany>,
  review: HydratedDocument<IReview>,
  qrCode?: HydratedDocument<ICompanyQrCode>,
): string {
  const lines = [
    `<b>📝 Nouvel avis pour ${company.name}</b>`,
    ``,
    qrCode?.label ? `📍 <b>QR code:</b> ${qrCode.label}` : "",
    `⭐ <b>Note:</b> ${review.rating}/5`,
  ];

  if (review.serviceFeedback) {
    lines.push(`💬 <b>Expérience:</b> ${review.serviceFeedback}`);
  }

  if (Array.isArray(review.customAnswers)) {
    for (const answer of review.customAnswers) {
      if (answer?.label && answer.value !== undefined && answer.value !== "") {
        lines.push(`📌 <b>${answer.label}:</b> ${answer.value}`);
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
