import type { Types } from "mongoose";
import { TelegramAd } from "../models/TelegramAd.js";
import { User } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { buildPagination, normalizePagination, type PaginationInput } from "../utils/pagination.js";
import { sendTelegram, sendTelegramMedia, TelegramApiError } from "./telegram.service.js";

const BROADCAST_DELAY_MS = 50; // stays comfortably under Telegram's ~30 msg/sec global cap

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (error instanceof TelegramApiError && error.errorCode === 429 && error.retryAfterSeconds) {
      await sleep((error.retryAfterSeconds + 1) * 1000);
      return await send();
    }
    throw error;
  }
}

type TelegramAdMediaInput = {
  type: "image" | "video" | "audio";
  url: string;
  caption?: string;
};

type SaveTelegramAdInput = {
  title?: string;
  contentHtml?: string;
  media?: TelegramAdMediaInput[];
  isActive?: boolean;
  startsAt?: string | Date;
  endsAt?: string | Date;
  userId?: Types.ObjectId | string;
};

type ListTelegramAdsInput = PaginationInput & {
  status?: "all" | "draft" | "published" | "sent" | "active";
};

type BroadcastResult = {
  recipients: number;
  sent: number;
  failed: number;
};

const TELEGRAM_TEXT_LIMIT = 3900;

export async function listTelegramAds(input: ListTelegramAdsInput = {}) {
  const pagination = normalizePagination(input);
  const filter: Record<string, unknown> = {};

  if (input.status === "draft") filter.publishedAt = { $exists: false };
  if (input.status === "published") filter.publishedAt = { $exists: true };
  if (input.status === "sent") filter.sentAt = { $exists: true };
  if (input.status === "active") {
    const now = new Date();
    filter.isActive = true;
    filter.startsAt = { $lte: now };
    filter.endsAt = { $gte: now };
  }

  const [total, ads] = await Promise.all([
    TelegramAd.countDocuments(filter),
    TelegramAd.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ]);

  return {
    ads,
    pagination: buildPagination(total, pagination.page, pagination.limit),
  };
}

export async function getTelegramAd(adId: string) {
  const ad = await TelegramAd.findById(adId).lean();
  if (!ad) throw new HttpError(404, "Publicite introuvable.");
  return ad;
}

export async function createTelegramAd(input: SaveTelegramAdInput) {
  const dates = normalizeAdDates(input.startsAt, input.endsAt);
  const media = normalizeMedia(input.contentHtml || "", input.media || []);

  return TelegramAd.create({
    title: normalizeTitle(input.title),
    contentHtml: normalizeContentHtml(input.contentHtml),
    media,
    isActive: input.isActive !== false,
    startsAt: dates.startsAt,
    endsAt: dates.endsAt,
    createdBy: input.userId,
    updatedBy: input.userId,
  });
}

export async function updateTelegramAd(adId: string, input: SaveTelegramAdInput) {
  const ad = await TelegramAd.findById(adId);
  if (!ad) throw new HttpError(404, "Publicite introuvable.");
  if (ad.sentAt) throw new HttpError(409, "Une publicite deja envoyee ne peut plus etre modifiee.");

  if (input.title !== undefined) ad.title = normalizeTitle(input.title);
  if (input.contentHtml !== undefined) ad.contentHtml = normalizeContentHtml(input.contentHtml);
  if (input.media !== undefined || input.contentHtml !== undefined) {
    ad.set("media", normalizeMedia(ad.contentHtml, input.media || []));
  }
  if (input.isActive !== undefined) ad.isActive = Boolean(input.isActive);
  if (input.startsAt !== undefined || input.endsAt !== undefined) {
    const dates = normalizeAdDates(input.startsAt || ad.startsAt, input.endsAt || ad.endsAt);
    ad.startsAt = dates.startsAt;
    ad.endsAt = dates.endsAt;
  }
  ad.updatedBy = input.userId as Types.ObjectId | undefined;

  await ad.save();
  return ad;
}

export async function setTelegramAdActive(adId: string, isActive: boolean, userId?: Types.ObjectId | string) {
  const ad = await TelegramAd.findById(adId);
  if (!ad) throw new HttpError(404, "Publicite introuvable.");

  ad.isActive = isActive;
  ad.updatedBy = userId as Types.ObjectId | undefined;
  await ad.save();
  return ad;
}

export async function publishTelegramAd(adId: string, userId?: Types.ObjectId | string) {
  const ad = await TelegramAd.findById(adId);
  if (!ad) throw new HttpError(404, "Publicite introuvable.");

  validatePublicationWindow(ad.startsAt, ad.endsAt);
  ad.publishedAt = ad.publishedAt || new Date();
  ad.updatedBy = userId as Types.ObjectId | undefined;
  await ad.save();

  const now = new Date();
  if (ad.isActive && ad.startsAt <= now && ad.endsAt >= now && !ad.sentAt) {
    const broadcast = await broadcastTelegramAd(String(ad._id));
    return { ad, broadcast };
  }

  return { ad, broadcast: null };
}

export async function broadcastDueTelegramAds() {
  const now = new Date();
  const dueAds = await TelegramAd.find({
    isActive: true,
    publishedAt: { $exists: true },
    sentAt: { $exists: false },
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  }).sort({ startsAt: 1 });

  const results = [];
  for (const ad of dueAds) {
    results.push({
      adId: String(ad._id),
      ...(await broadcastTelegramAd(String(ad._id))),
    });
  }

  return results;
}

export async function broadcastTelegramAd(adId: string): Promise<BroadcastResult> {
  const ad = await TelegramAd.findById(adId);
  if (!ad) throw new HttpError(404, "Publicite introuvable.");
  if (!ad.isActive) throw new HttpError(409, "Publicite desactivee.");
  if (!ad.publishedAt) throw new HttpError(409, "Publicite non publiee.");
  if (ad.sentAt) {
    const sent = ad.deliveries.filter((delivery) => delivery.status === "sent").length;
    const failed = ad.deliveries.filter((delivery) => delivery.status === "failed").length;
    return { recipients: ad.deliveries.length, sent, failed };
  }

  validatePublicationWindow(ad.startsAt, ad.endsAt);
  const users = await User.find({
    isActive: { $ne: false },
    "telegramProfile.chatId": { $exists: true, $ne: "" },
    "telegramProfile.isActive": true,
    "notificationPreferences.channels.telegram": true,
  }).select("_id telegramProfile.chatId");

  const message = buildTelegramAdMessage(ad.title, ad.contentHtml);
  const deliveries = [];

  for (const user of users) {
    const chatId = user.telegramProfile?.chatId;
    if (!chatId) continue;

    try {
      const messageIds: string[] = [];
      const messageResult = await sendWithRetry(() =>
        sendTelegram({ chatId, message, disableWebPagePreview: false }),
      );
      messageIds.push(String(messageResult.messageId));

      for (const media of ad.media) {
        const result = await sendWithRetry(() =>
          sendTelegramMedia({
            chatId,
            type: media.type,
            url: media.url,
            caption: media.caption || undefined,
          }),
        );
        messageIds.push(String(result.messageId));
      }

      deliveries.push({
        user: user._id,
        chatId,
        status: "sent" as const,
        messageIds,
        sentAt: new Date(),
      });
    } catch (error) {
      deliveries.push({
        user: user._id,
        chatId,
        status: "failed" as const,
        error: error instanceof Error ? error.message : "Erreur inconnue",
        sentAt: new Date(),
      });
    }

    await sleep(BROADCAST_DELAY_MS);
  }

  ad.set("deliveries", deliveries);
  ad.sentAt = new Date();
  await ad.save();

  return {
    recipients: deliveries.length,
    sent: deliveries.filter((delivery) => delivery.status === "sent").length,
    failed: deliveries.filter((delivery) => delivery.status === "failed").length,
  };
}

function normalizeTitle(value: unknown) {
  const title = String(value || "").trim();
  if (title.length < 2) throw new HttpError(400, "Titre de publicite requis.");
  if (title.length > 120) throw new HttpError(400, "Titre trop long.");
  return title;
}

function normalizeContentHtml(value: unknown) {
  const contentHtml = String(value || "").trim();
  const plainText = contentHtml.replace(/<[^>]+>/g, "").trim();
  if (plainText.length < 2) throw new HttpError(400, "Contenu de publicite requis.");
  if (contentHtml.length > 12000) throw new HttpError(400, "Contenu trop long.");
  return contentHtml;
}

function normalizeAdDates(startsAtInput: unknown, endsAtInput: unknown) {
  const startsAt = parseDate(startsAtInput, "Date de debut invalide.");
  const endsAt = parseDate(endsAtInput, "Date de fin invalide.");
  if (startsAt >= endsAt) {
    throw new HttpError(400, "La date de fin doit etre apres la date de debut.");
  }

  return { startsAt, endsAt };
}

function parseDate(value: unknown, errorMessage: string) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, errorMessage);
  return date;
}

function validatePublicationWindow(startsAt: Date, endsAt: Date) {
  const now = new Date();
  if (endsAt < now) throw new HttpError(409, "La date de fin est deja passee.");
  if (startsAt >= endsAt) {
    throw new HttpError(400, "La date de fin doit etre apres la date de debut.");
  }
}

function normalizeMedia(contentHtml: string, media: TelegramAdMediaInput[]) {
  const combined = [...extractMediaFromHtml(contentHtml), ...media];
  const seen = new Set<string>();

  return combined
    .map((item) => ({
      type: item.type,
      url: String(item.url || "").trim(),
      caption: item.caption?.trim(),
    }))
    .filter((item) => {
      if (!["image", "video", "audio"].includes(item.type)) return false;
      if (!isPublicMediaUrl(item.url)) return false;
      const key = `${item.type}:${item.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function extractMediaFromHtml(contentHtml: string): TelegramAdMediaInput[] {
  const media: TelegramAdMediaInput[] = [];
  const patterns: Array<{ type: "image" | "video" | "audio"; regex: RegExp }> = [
    { type: "image", regex: /<img[^>]+src=["']([^"']+)["'][^>]*>/gi },
    { type: "video", regex: /<(?:video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi },
    { type: "audio", regex: /<(?:audio|source)[^>]+src=["']([^"']+)["'][^>]*>/gi },
  ];

  for (const pattern of patterns) {
    for (const match of contentHtml.matchAll(pattern.regex)) {
      const url = match[1]?.trim();
      if (url) media.push({ type: pattern.type, url });
    }
  }

  return media;
}

function isPublicMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function buildTelegramAdMessage(title: string, contentHtml: string) {
  const text = `<b>${escapeTelegramHtml(title)}</b>\n\n${htmlToTelegramHtml(contentHtml)}`;
  return text.slice(0, TELEGRAM_TEXT_LIMIT);
}

function htmlToTelegramHtml(value: string) {
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|section|article|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*li\s*>/gi, "")
    .replace(/<\s*(strong|b)[^>]*>/gi, "<b>")
    .replace(/<\/\s*(strong|b)\s*>/gi, "</b>")
    .replace(/<\s*(em|i)[^>]*>/gi, "<i>")
    .replace(/<\/\s*(em|i)\s*>/gi, "</i>")
    .replace(/<\s*u[^>]*>/gi, "<u>")
    .replace(/<\/\s*u\s*>/gi, "</u>")
    .replace(/<\s*s[^>]*>/gi, "<s>")
    .replace(/<\/\s*s\s*>/gi, "</s>")
    .replace(/<\s*a[^>]+href=["']([^"']+)["'][^>]*>/gi, (_match, href) =>
      isPublicMediaUrl(href) ? `<a href="${escapeTelegramHtml(href)}">` : "",
    )
    .replace(/<\/\s*a\s*>/gi, "</a>")
    .replace(/<\s*(img|video|audio|source)[^>]*>/gi, "")
    .replace(/<\/\s*(video|audio)\s*>/gi, "")
    .replace(/<(?!\/?(b|i|u|s|a|code|pre)\b)[^>]+>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeTelegramHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
