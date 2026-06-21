import TelegramBotConstructor from "node-telegram-bot-api";
import crypto from "crypto";
import type {
  Message as TelegramMessage,
  CallbackQuery as TelegramCallbackQuery,
} from "node-telegram-bot-api";
import { env } from "../config/env.js";
import { readFileSecret } from "./fileSecret.service.js";
import { User } from "../models/User.js";
import { Company } from "../models/Company.js";
import { CompanyQrCode, type ICompanyQrCode } from "../models/CompanyQrCode.js";
import { TelegramLinkToken } from "../models/TelegramLinkToken.js";
import { Review, type IReview } from "../models/Review.js";
import { generateQrDataUrl } from "./qr.service.js";
import { buildQrPdfBuffer } from "./pdf.service.js";
import { createSlug } from "../utils/slug.js";
import {
  sendTelegramKeyboard,
  editTelegramMessage,
  answerCallbackQuery,
} from "./telegram.service.js";
import { getCompanyStats } from "./dashboard.service.js";
import { buildCompanyReviewsExcel } from './dashboard.service.js';
import { getAiOverview } from "./reviewAnalytics.service.js";
import { searchReviewsSemantically } from "./typesense.service.js";
import type { Types } from "mongoose";

let bot: TelegramBotConstructor | null = null;

// Shape of a Review document after `.populate("qrCode", "label slug feedbackUrl")` —
// Mongoose's static types don't reflect populate(), so this fills the gap instead of `any`.
type ReviewWithQr = IReview & {
  qrCode?: { label?: string; slug?: string; feedbackUrl?: string } | null;
};

type UserContextState =
  | "creating_qr_name"
  | "search_reviews"
  | "guest_create_email"
  | "guest_create_label"
  | "review_add_tag"
  | "review_reply"
  | "review_search_tag";

type UserContext = {
  state: UserContextState;
  email?: string;
  qrName?: string;
  emailEnabled?: boolean;
  telegramEnabled?: boolean;
  reviewId?: string;
};

type TelegramInlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

type ReviewFilter = {
  rating?: 1 | 2 | 3 | 4 | 5;
  sentiment?: "positive" | "neutral" | "negative";
  moderationStatus?: "published" | "archived";
  qrCodeId?: string;
  qrCodeLabel?: string;
  tag?: string;
  page?: number;
};

const REVIEWS_PER_TELEGRAM_PAGE = 10;
const QR_CODES_PER_TELEGRAM_PAGE = 10;

// Bounded, TTL-evicting cache for the bot's ephemeral state (conversation context, callback
// tokens). Plain Maps here would grow forever — every keyboard render used to mint a fresh
// random token that was never removed, leaking memory for the life of the process.
class BoundedCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private maxEntries: number, private ttlMs: number) {}

  set(key: string, value: T) {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string) {
    this.store.delete(key);
  }
}

const USER_CONTEXT_TTL_MS = 30 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;

const userContexts = new BoundedCache<UserContext>(MAX_CACHE_ENTRIES, USER_CONTEXT_TTL_MS);
const reviewTagTokens = new BoundedCache<string>(MAX_CACHE_ENTRIES, TOKEN_TTL_MS);
const reviewFilterTokens = new BoundedCache<ReviewFilter>(MAX_CACHE_ENTRIES, TOKEN_TTL_MS);
const qrActionTokens = new BoundedCache<{ qrCodeId: string; qrCodeLabel: string }>(MAX_CACHE_ENTRIES, TOKEN_TTL_MS);

function formatPercent(value: unknown) {
  return `${Number(value || 0).toFixed(Number(value || 0) % 1 === 0 ? 0 : 2)}%`;
}

function getContextKeys(chatId: number, telegramUserId?: number) {
  return [
    `chat:${chatId}`,
    ...(telegramUserId ? [`user:${telegramUserId}`] : []),
  ];
}

function setUserContext(
  chatId: number,
  telegramUserId: number | undefined,
  state: UserContextState,
  payload: Omit<UserContext, "state"> = {},
) {
  for (const key of getContextKeys(chatId, telegramUserId)) {
    userContexts.set(key, { state, ...payload });
  }
}

function getUserContext(chatId: number, telegramUserId?: number) {
  for (const key of getContextKeys(chatId, telegramUserId)) {
    const context = userContexts.get(key);
    if (context) return context;
  }

  return null;
}

function clearUserContext(chatId: number, telegramUserId?: number) {
  for (const key of getContextKeys(chatId, telegramUserId)) {
    userContexts.delete(key);
  }
}

function isTelegramAllowedUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return (
      ["http:", "https:"].includes(parsedUrl.protocol) &&
      !["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)
    );
  } catch {
    return false;
  }
}

function frontendUrl(path = "") {
  return `${env.frontendUrl.replace(/\/$/, "")}${path}`;
}

function frontendButton(text: string, path = ""): TelegramInlineButton {
  const url = frontendUrl(path);
  if (isTelegramAllowedUrl(url)) {
    return { text, url };
  }

  return { text, callback_data: "frontend_url_unavailable" };
}


function mainMenuKeyboard(): TelegramInlineButton[][] {
  return [
    [{ text: "Mes avis", callback_data: "my_reviews" }],
    [{ text: "Mes QR codes", callback_data: "my_qr_codes" }],
    [{ text: "Creer un QR", callback_data: "create_qr" }],
    [{ text: "Statistiques", callback_data: "dashboard_stats" }],
    [{ text: "Analyse IA", callback_data: "ai_overview" }],
    [{ text: "Parametres", callback_data: "settings" }],
    [{ text: "Aide", callback_data: "help" }],
    [frontendButton("Ouvrir le dashboard", "/dashboard")],
  ];
}

function navigationKeyboard(
  backCallback?: string,
  extra: TelegramInlineButton[][] = [],
): TelegramInlineButton[][] {
  const rows = [...extra];
  rows.push([{ text: "Retour", callback_data: backCallback || "main_menu" }]);
  rows.push([{ text: "Menu principal", callback_data: "main_menu" }]);
  return rows;
}

function reviewActionKeyboard(reviewId: string): TelegramInlineButton[][] {
  return [
    [
      { text: "Voir details", callback_data: `review_detail_${reviewId}` },
      { text: "Archiver", callback_data: `review_archive_${reviewId}` },
    ],
    [
      { text: "Ajouter une note", callback_data: `review_reply_${reviewId}` },
      { text: "Ajouter un tag", callback_data: `review_tag_${reviewId}` },
    ],
    [frontendButton("Ouvrir le dashboard", "/dashboard/reviews")],
    [{ text: "Retour", callback_data: "my_reviews" }],
    [{ text: "Menu principal", callback_data: "main_menu" }],
  ];
}

function reviewListKeyboard(filter: ReviewFilter = {}, hasNextPage = false): TelegramInlineButton[][] {
  const token = createReviewFilterToken(filter);
  const page = Math.max(1, Number(filter.page || 1));
  const previousFilter = { ...filter, page: Math.max(1, page - 1) };
  const nextFilter = { ...filter, page: page + 1 };
  const paginationRows: TelegramInlineButton[][] = [];

  if (page > 1 || hasNextPage) {
    const row: TelegramInlineButton[] = [];
    if (page > 1) row.push({ text: "Precedent", callback_data: `reviews_page_${createReviewFilterToken(previousFilter)}` });
    if (hasNextPage) row.push({ text: "Suivant", callback_data: `reviews_page_${createReviewFilterToken(nextFilter)}` });
    paginationRows.push(row);
  }

  return [
    ...paginationRows,
    [{ text: "Filtrer", callback_data: `reviews_filters_${token}` }],
    [{ text: "Recherche", callback_data: `search_reviews_${token}` }],
    [{ text: "Tous les avis", callback_data: "my_reviews" }],
    [{ text: "Retour", callback_data: "main_menu" }],
    [{ text: "Menu principal", callback_data: "main_menu" }],
  ];
}

function reviewFiltersKeyboard(filter: ReviewFilter = {}): TelegramInlineButton[][] {
  const token = createReviewFilterToken(filter);
  const rows: TelegramInlineButton[][] = [
    [{ text: "Exporter Excel", callback_data: `reviews_export_${token}` }],
    [{ text: "Par tag", callback_data: `reviews_by_tag_${token}` }],
    [{ text: "Par statut", callback_data: `reviews_status_${token}` }],
    [{ text: "Par score", callback_data: `reviews_rating_${token}` }],
    [{ text: "Par sentiment", callback_data: `reviews_sentiment_${token}` }],
    [{ text: "Recherche", callback_data: `search_reviews_${token}` }],
    [{ text: "Retour", callback_data: "my_reviews" }],
    [{ text: "Menu principal", callback_data: "main_menu" }],
  ];

  if (!filter.qrCodeId) {
    rows.unshift([{ text: "Par QR code", callback_data: `reviews_by_qr_${token}` }]);
  }

  return rows;
}

function reviewRatingKeyboard(filter: ReviewFilter = {}): TelegramInlineButton[][] {
  const token = createReviewFilterToken(filter);
  return [
    [
      { text: "1", callback_data: `reviews_rating_1_${token}` },
      { text: "2", callback_data: `reviews_rating_2_${token}` },
      { text: "3", callback_data: `reviews_rating_3_${token}` },
    ],
    [
      { text: "4", callback_data: `reviews_rating_4_${token}` },
      { text: "5", callback_data: `reviews_rating_5_${token}` },
    ],
    [{ text: "Retour", callback_data: `reviews_filters_${token}` }],
    [{ text: "Menu principal", callback_data: "main_menu" }],
  ];
}

function reviewSentimentKeyboard(filter: ReviewFilter = {}): TelegramInlineButton[][] {
  const token = createReviewFilterToken(filter);
  return [
    [
      { text: "Content", callback_data: `reviews_sentiment_positive_${token}` },
      { text: "Neutre", callback_data: `reviews_sentiment_neutral_${token}` },
      { text: "Mecontent", callback_data: `reviews_sentiment_negative_${token}` },
    ],
    [{ text: "Retour", callback_data: `reviews_filters_${token}` }],
    [{ text: "Menu principal", callback_data: "main_menu" }],
  ];
}

function reviewStatusKeyboard(filter: ReviewFilter = {}): TelegramInlineButton[][] {
  const token = createReviewFilterToken(filter);
  return [
    [
      { text: "Publies", callback_data: `reviews_status_published_${token}` },
      { text: "Archives", callback_data: `reviews_status_archived_${token}` },
    ],
    [{ text: "Retour", callback_data: `reviews_filters_${token}` }],
    [{ text: "Menu principal", callback_data: "main_menu" }],
  ];
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatReviewDate(value: unknown) {
  if (!value) return "Date inconnue";
  return new Date(String(value)).toLocaleDateString("fr-FR");
}

function getReviewQrLabel(review: ReviewWithQr) {
  return review.qrCode?.label || review.qrCode?.slug || "QR non precise";
}

function formatModerationStatus(value: unknown) {
  return String(value) === "archived" ? "Archive" : "Publie";
}

function formatReviewExtraAnswers(review: ReviewWithQr, limit = 2) {
  return (review.customAnswers || [])
    .filter((answer) => answer?.value !== undefined && answer?.value !== "")
    .slice(0, limit)
    .map((answer) => `${escapeHtml(answer.label)}: ${escapeHtml(answer.value)}`)
    .join("\n");
}

function formatShortReviewSummary(review: ReviewWithQr, index: number) {
  const sentiment =
    review.rating >= 4 ? "Client content" : review.rating <= 2 ? "Client mecontent" : "Avis moyen";
  const comment = String(review.serviceFeedback || "Sans commentaire").replace(/\s+/g, " ").trim();
  const snippet = comment.length > 70 ? `${comment.slice(0, 67)}...` : comment;

  return [
    `<b>${index + 1}. ${sentiment}</b> - ${review.rating}/5`,
    `QR: ${escapeHtml(getReviewQrLabel(review))}`,
    `"${escapeHtml(snippet)}"`,
    formatReviewDate(review.createdAt),
  ].join("\n");
}

function buildReviewListTitle(filter: ReviewFilter) {
  const parts = ["Mes avis"];
  if (filter.qrCodeId) parts.push(`QR ${escapeHtml(filter.qrCodeLabel || "choisi")}`);
  if (filter.tag) parts.push(`tag "${escapeHtml(filter.tag)}"`);
  if (filter.rating) parts.push(`score ${filter.rating}/5`);
  if (filter.sentiment === "positive") parts.push("clients contents");
  if (filter.sentiment === "neutral") parts.push("avis neutres");
  if (filter.sentiment === "negative") parts.push("clients mecontents");
  if (filter.moderationStatus) parts.push(formatModerationStatus(filter.moderationStatus));
  return parts.join(" - ");
}

function createReviewTagToken(companyId: unknown, tag: string) {
  const token = crypto
    .createHash("sha1")
    .update(`${String(companyId)}:${tag}`)
    .digest("hex")
    .slice(0, 20);
  reviewTagTokens.set(token, tag);
  return token;
}

function createReviewFilterToken(filter: ReviewFilter = {}) {
  // Deterministic (content-only) hash: re-rendering the same filter reuses the same cache
  // entry instead of minting a fresh one every time a keyboard is built.
  const token = crypto
    .createHash("sha1")
    .update(JSON.stringify(filter))
    .digest("hex")
    .slice(0, 20);
  reviewFilterTokens.set(token, filter);
  return token;
}

function createQrActionToken(qrCodeId: unknown, qrCodeLabel: unknown) {
  const token = crypto
    .createHash("sha1")
    .update(`${String(qrCodeId)}:${String(qrCodeLabel || "")}`)
    .digest("hex")
    .slice(0, 20);
  qrActionTokens.set(token, {
    qrCodeId: String(qrCodeId),
    qrCodeLabel: String(qrCodeLabel || "QR Code"),
  });
  return token;
}

function getQrActionToken(tokenOrId: string) {
  return qrActionTokens.get(tokenOrId) || { qrCodeId: tokenOrId, qrCodeLabel: "" };
}

function getReviewFilterToken(token: string) {
  return reviewFilterTokens.get(token) || {};
}

function resetReviewFilterPage(filter: ReviewFilter): ReviewFilter {
  const { page, ...rest } = filter;
  return rest;
}

function buildReviewFiltersText(filter: ReviewFilter) {
  const qrLine = filter.qrCodeId
    ? `\nQR actif: <b>${escapeHtml(filter.qrCodeLabel || "QR choisi")}</b>\n`
    : "";

  return `<b>Filtrer les avis</b>${qrLine}\nChoisissez une option simple.`;
}

async function hydrateReviewFilter(filter: ReviewFilter, companyId: unknown): Promise<ReviewFilter> {
  if (!filter.qrCodeId || filter.qrCodeLabel) return filter;

  const qr = await CompanyQrCode.findOne({ _id: filter.qrCodeId, company: companyId }).select("label slug");
  if (!qr) return filter;

  return {
    ...filter,
    qrCodeLabel: qr.label || qr.slug || "QR choisi",
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());
}

function companyNameFromEmail(email: string) {
  const localPart = email.split("@")[0] || "Entreprise";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function createUniqueSlug(base: string) {
  const root = createSlug(base) || `qr-${Date.now()}`;
  let slug = root;
  let index = 1;

  while (
    (await Company.exists({ slug })) ||
    (await CompanyQrCode.exists({ slug }))
  ) {
    slug = `${root}-${index}`;
    index += 1;
  }

  return slug;
}

async function findOrCreateGuestCompany(email: string, qrName: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existingCompany = await Company.findOne({ email: normalizedEmail });
  if (existingCompany) return existingCompany;

  const companyName = qrName || companyNameFromEmail(normalizedEmail);
  const slug = await createUniqueSlug(companyName);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  return Company.create({
    name: companyName,
    email: normalizedEmail,
    slug,
    feedbackUrl,
    qrCodeDataUrl,
    freeEmailNotificationsLimit: env.freeEmailNotifications,
    unlimitedAccess: true,
    unlimitedAccessActivatedAt: new Date(),
  });
}

async function sendQrAssets(
  chatId: number,
  companyName: string,
  qrCode: ICompanyQrCode,
  caption?: string,
) {
  if (!bot) return;

  const qrImageBase64 = String(qrCode.qrCodeDataUrl).split(",")[1] || qrCode.qrCodeDataUrl;
  const image = Buffer.from(qrImageBase64, "base64");
  await bot.sendPhoto(chatId, image, {
    caption:
      caption ||
      `QR code: <b>${escapeHtml(qrCode.label || "QR Code")}</b>\n\nLien:\n<code>${qrCode.feedbackUrl}</code>`,
    parse_mode: "HTML",
  });

  const pdf = await buildQrPdfBuffer({
    companyName,
    feedbackUrl: qrCode.feedbackUrl,
    qrCodeDataUrl: qrCode.qrCodeDataUrl,
  });
  await bot.sendDocument(
    chatId,
    pdf,
    {
      caption: "PDF imprimable",
    },
    {
      filename: `${createSlug(qrCode.label || "qr-code") || "qr-code"}.pdf`,
      contentType: "application/pdf",
    },
  );
}

async function createGuestQrCode(chatId: number, email: string, qrName: string) {
  if (!bot) return;

  const company = await findOrCreateGuestCompany(email, qrName);
  const slug = await createUniqueSlug(`${company.name}-${qrName}-${chatId}`);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  const qrCode = await CompanyQrCode.create({
    label: qrName,
    company: company._id,
    slug,
    feedbackUrl,
    qrCodeDataUrl,
  });

  await sendQrAssets(
    chatId,
    company.name,
    qrCode,
    `QR code cree: <b>${escapeHtml(qrName)}</b>\n\nLes avis seront envoyes par email a <b>${escapeHtml(company.email)}</b>.\n\nLien:\n<code>${qrCode.feedbackUrl}</code>`,
  );
  await sendTelegramKeyboard(
    String(chatId),
    "Que voulez-vous faire ensuite ?",
    navigationKeyboard(undefined, [[{ text: "Creer un autre QR", callback_data: "guest_create_qr" }]]),
  );
}

function hashTelegramLinkToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createTelegramLinkUrl(userId: Types.ObjectId | string) {
  const token = crypto.randomBytes(24).toString("base64url");
  await TelegramLinkToken.create({
    tokenHash: hashTelegramLinkToken(token),
    user: userId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  return `https://t.me/${env.telegram.botUsername}?start=${encodeURIComponent(token)}`;
}

async function verifyTelegramLinkToken(token: string) {
  const linkToken = await TelegramLinkToken.findOneAndDelete({
    tokenHash: hashTelegramLinkToken(token),
    expiresAt: { $gt: new Date() },
  });

  if (!linkToken) {
    throw new Error("Invalid Telegram link token");
  }

  return String(linkToken.user);
}

export async function initializeTelegramBot() {
  const token =
    env.telegram.botToken || (await readFileSecret("telegramBotToken"));

  if (!token) {
    console.warn("[telegram:bot:init:skip] No bot token provided");
    return null;
  }

  bot = new TelegramBotConstructor(
    token,
    env.telegram.webhookUrl ? { polling: false } : { polling: true },
  );

  bot.on("polling_error", (error) => console.error("[telegram:polling:error]", error));
  bot.on("webhook_error", (error) => console.error("[telegram:webhook:error]", error));

  registerCommands();
  registerCallbacks();

  console.info("[telegram:bot:initialized]");
  return bot;
}

export function processTelegramUpdate(update: unknown) {
  if (!bot) {
    console.warn("[telegram:bot:update:skip] Bot not initialized");
    return;
  }

  bot.processUpdate(update as Parameters<TelegramBotConstructor["processUpdate"]>[0]);
}

// Command handlers run inside node-telegram-bot-api's internal EventEmitter dispatch — an
// unhandled rejection there fails silently (no reply, no structured log). Every entry point
// goes through this wrapper so a DB hiccup still gets logged and the user gets a reply.
function withErrorHandling<A extends [TelegramMessage, ...unknown[]]>(
  handler: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    const msg = args[0];
    try {
      await handler(...args);
    } catch (error) {
      console.error("[telegram:handler:error]", {
        chatId: msg.chat?.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (bot && msg.chat?.id) {
        await bot
          .sendMessage(msg.chat.id, "Une erreur est survenue. Reessayez ou tapez /start.")
          .catch(() => {});
      }
    }
  };
}

const KNOWN_COMMAND_PATTERNS = [
  /^\/start\b/, /^\/help\b/, /^\/settings\b/, /^\/create_qr\b/, /^\/my_qr_codes\b/,
  /^\/reviews\b/, /^\/avis\b/, /^\/search\b/, /^\/ai\b/, /^\/qr\b/,
];

function registerCommands() {
  if (!bot) return;

  bot.onText(/\/start/, withErrorHandling(handleStart));
  bot.onText(/\/help/, withErrorHandling(handleHelp));
  bot.onText(/\/settings/, withErrorHandling(handleSettings));
  bot.onText(/\/create_qr/, withErrorHandling(handleCreateQr));
  bot.onText(/\/my_qr_codes/, withErrorHandling(handleMyQrCodes));
  bot.onText(/\/reviews/, withErrorHandling(handleReviews));
  bot.onText(/\/avis/, withErrorHandling(handleReviews));
  bot.onText(/^\/search$/, withErrorHandling(handleSearchPrompt));
  bot.onText(/\/search (.+)/, withErrorHandling(handleSearch));
  bot.onText(/\/ai/, withErrorHandling(handleAiOverview));
  bot.onText(/\/qr (.+)/, withErrorHandling(handleQrCommand));
  bot.on("message", withErrorHandling(handleDefaultMessage));
}

function registerCallbacks() {
  if (!bot) return;
  bot.on("callback_query", handleCallbackQuery);
}

async function handleStart(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const user = msg.from;
  const token = msg.text?.match(/^\/start\s+(.+)$/)?.[1];

  if (!user) return;

  // Le lien public du front utilise ?start=auth. Telegram envoie alors ce
  // message au bot, qui ouvre une vraie Web App et fournit initData signe.

  if (token) {
    try {
      const userId = await verifyTelegramLinkToken(token);
      const linkedUser = await connectUserToTelegram(
        userId as unknown as Types.ObjectId,
        chatId,
        user.username,
        user.first_name,
        user.last_name,
      );

      if (!linkedUser) {
        await bot.sendMessage(chatId, "Lien Telegram invalide ou expire.");
      }
    } catch (error) {
      console.error("[telegram:link:error]", error);
      await bot.sendMessage(
        chatId,
        "Lien Telegram invalide ou expire. Relancez la connexion depuis QrFeedback.",
      );
    }
    return;
  }

  const dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    await sendTelegramKeyboard(
      String(chatId),
      "<b>Bienvenue sur QrFeedback</b>\n\nCreez un QR rapidement ou connectez votre compte pour gerer avis, QR codes et notifications depuis Telegram.",
      [
        [{ text: "Creer un QR", callback_data: "guest_create_qr" }],
        [frontendButton("Se connecter a QrFeedback", "/login?redirect=/settings")],
      ],
    );
    return;
  }

  await sendMainMenu(chatId);
}

async function sendMainMenu(chatId: number, messageId?: number) {
  const dbUser = await findUserByTelegram(chatId);
  const company = dbUser?.company ? await Company.findById(dbUser.company) : null;
  const companyName = company?.name || "QrFeedback";
  const text = `<b>Menu principal</b>\n\n${escapeHtml(companyName)}, que souhaitez-vous faire ?`;

  if (messageId) {
    await editTelegramMessage(String(chatId), messageId, text, mainMenuKeyboard());
    return;
  }

  await sendTelegramKeyboard(String(chatId), text, mainMenuKeyboard());
}

async function handleHelp(msg: TelegramMessage) {
  if (!bot) return;
  await sendHelp(msg.chat.id);
}

async function sendHelp(chatId: number, messageId?: number) {
  const text = `<b>Aide QrFeedback</b>

Commandes utiles:
/avis - avis recents et filtres
/create_qr - creation guidee de QR code
/my_qr_codes - liste des QR codes
/ai - analyse IA
/settings - preferences de notification`;

  const keyboard = navigationKeyboard(undefined);
  if (messageId) {
    await editTelegramMessage(String(chatId), messageId, text, keyboard);
    return;
  }
  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

async function handleSettings(msg: TelegramMessage) {
  if (!bot) return;
  await sendSettings(msg.chat.id);
}

async function sendSettings(chatId: number, messageId?: number) {
  if (!bot) return;

  const dbUser = await findUserByTelegram(chatId);
  if (!dbUser) {
    await bot.sendMessage(chatId, "Vous n'etes pas connecte. Utilisez /start pour commencer.");
    return;
  }

  const company = dbUser.company ? await Company.findById(dbUser.company) : null;
  if (!company) {
    await bot.sendMessage(chatId, "Entreprise introuvable.");
    return;
  }

  const prefs = company.notificationPreferences;
  const text = `<b>Parametres</b>

Notifications globales:
Email: <b>${prefs?.emailEnabled !== false ? "actif" : "desactive"}</b>
Telegram: <b>${prefs?.telegramEnabled !== false ? "actif" : "desactive"}</b>

Chaque QR code peut avoir son propre reglage. Le reglage du QR passe avant ce reglage global.`;

  const keyboard = navigationKeyboard(undefined, [
    [{ text: `${prefs?.emailEnabled !== false ? "Desactiver" : "Activer"} Email`, callback_data: "toggle_company_email" }],
    [{ text: `${prefs?.telegramEnabled !== false ? "Desactiver" : "Activer"} Telegram`, callback_data: "toggle_company_telegram" }],
  ]);

  if (messageId) {
    await editTelegramMessage(String(chatId), messageId, text, keyboard);
    return;
  }
  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

async function handleCreateQr(msg: TelegramMessage) {
  if (!bot) return;
  await startQrCreation(msg.chat.id, msg.from?.id);
}

async function startQrCreation(chatId: number, telegramUserId?: number) {
  if (!bot) return;

  const dbUser = await findUserByTelegram(chatId);
  if (!dbUser) {
    setUserContext(chatId, telegramUserId, "guest_create_email");
    await sendTelegramKeyboard(
      String(chatId),
      "<b>Creer un QR</b>\n\nTapez votre adresse email.",
      navigationKeyboard(undefined),
    );
    return;
  }

  setUserContext(chatId, telegramUserId, "creating_qr_name");
  await sendTelegramKeyboard(
    String(chatId),
    "<b>Creer un QR</b>\n\n1/3 - Tapez le nom du QR code.\n\nExemples: Table 1, Caisse, Chambre 204.",
    navigationKeyboard(undefined),
  );
}

async function handleMyQrCodes(msg: TelegramMessage) {
  if (!bot) return;
  await sendQrCodes(msg.chat.id);
}

async function sendQrCodes(chatId: number, messageId?: number, page = 1) {
  if (!bot) return;

  const dbUser = await findUserByTelegram(chatId);
  if (!dbUser) {
    await bot.sendMessage(chatId, "Vous n'etes pas connecte.");
    return;
  }

  const safePage = Math.max(1, Number(page || 1));
  const qrCodes = await CompanyQrCode.find({ company: dbUser.company })
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * QR_CODES_PER_TELEGRAM_PAGE)
    .limit(QR_CODES_PER_TELEGRAM_PAGE + 1);
  const hasNextPage = qrCodes.length > QR_CODES_PER_TELEGRAM_PAGE;
  const pageQrCodes = qrCodes.slice(0, QR_CODES_PER_TELEGRAM_PAGE);

  if (pageQrCodes.length === 0) {
    const emptyKeyboardExtra: TelegramInlineButton[][] = [
      ...(safePage > 1 ? [[{ text: "Precedent", callback_data: `my_qr_codes_page_${safePage - 1}` }]] : []),
      [{ text: "Creer un QR", callback_data: "create_qr" }],
    ];
    await sendTelegramKeyboard(
      String(chatId),
      `<b>Mes QR codes</b>\nPage ${safePage}\n\nAucun QR code pour le moment.`,
      navigationKeyboard(undefined, emptyKeyboardExtra),
    );
    return;
  }

  const text = `<b>Mes QR codes</b>\nPage ${safePage}\n\nTapez sur un bouton <b>Voir QR</b> pour ouvrir un QR code.\n\n${pageQrCodes
    .map(
      (qr, i) =>
        `${i + 1}. <b>${escapeHtml(qr.label || "QR Code")}</b> - ${qr.isActive ? "actif" : "inactif"}`,
    )
    .join("\n")}`;

  const keyboard: TelegramInlineButton[][] = [];
  for (let i = 0; i < pageQrCodes.length; i += 2) {
    const row: TelegramInlineButton[] = [
      { text: `Voir QR ${i + 1}`, callback_data: `qr_detail_${pageQrCodes[i]._id}` },
    ];
    if (pageQrCodes[i + 1]) {
      row.push({ text: `Voir QR ${i + 2}`, callback_data: `qr_detail_${pageQrCodes[i + 1]._id}` });
    }
    keyboard.push(row);
  }
  if (safePage > 1 || hasNextPage) {
    const row: TelegramInlineButton[] = [];
    if (safePage > 1) row.push({ text: "Precedent", callback_data: `my_qr_codes_page_${safePage - 1}` });
    if (hasNextPage) row.push({ text: "Suivant", callback_data: `my_qr_codes_page_${safePage + 1}` });
    keyboard.push(row);
  }
  keyboard.push([{ text: "Creer un QR", callback_data: "create_qr" }]);
  keyboard.push([{ text: "Retour", callback_data: "main_menu" }]);
  keyboard.push([{ text: "Menu principal", callback_data: "main_menu" }]);

  if (messageId) {
    await editTelegramMessage(String(chatId), messageId, text, keyboard);
    return;
  }
  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

async function handleReviews(msg: TelegramMessage) {
  if (!bot) return;
  await sendReviews(msg.chat.id);
}

async function sendReviews(chatId: number, messageId?: number, filter: ReviewFilter = {}) {
  if (!bot) return;

  const dbUser = await findUserByTelegram(chatId);
  if (!dbUser) {
    await bot.sendMessage(chatId, "Vous n'etes pas connecte.");
    return;
  }

  const activeFilter = await hydrateReviewFilter(filter, dbUser.company);
  const query: Record<string, unknown> = { company: dbUser.company };
  if (activeFilter.rating) query.rating = activeFilter.rating;
  if (activeFilter.sentiment === "positive") query.rating = { $in: [4, 5] };
  if (activeFilter.sentiment === "neutral") query.rating = 3;
  if (activeFilter.sentiment === "negative") query.rating = { $in: [1, 2] };
  if (activeFilter.moderationStatus === "archived") {
    query.moderationStatus = "archived";
  } else {
    query.moderationStatus = { $ne: "archived" };
  }
  if (activeFilter.qrCodeId) query.qrCode = activeFilter.qrCodeId;
  if (activeFilter.tag) query.tags = { $regex: `^${escapeRegExp(activeFilter.tag)}$`, $options: "i" };
  const page = Math.max(1, Number(activeFilter.page || 1));

  const reviews = await Review.find(query)
    .populate("qrCode", "label slug feedbackUrl")
    .sort({ createdAt: -1 })
    .skip((page - 1) * REVIEWS_PER_TELEGRAM_PAGE)
    .limit(REVIEWS_PER_TELEGRAM_PAGE + 1);
  const hasNextPage = reviews.length > REVIEWS_PER_TELEGRAM_PAGE;
  const pageReviews = reviews.slice(0, REVIEWS_PER_TELEGRAM_PAGE);

  const title = buildReviewListTitle(activeFilter);
  if (pageReviews.length === 0) {
    const text = `<b>${title}</b>\nPage ${page}\n\nAucun avis ne correspond a ce filtre.`;
    if (messageId) {
      await editTelegramMessage(String(chatId), messageId, text, reviewListKeyboard({ ...activeFilter, page }, false));
      return;
    }
    await sendTelegramKeyboard(String(chatId), text, reviewListKeyboard({ ...activeFilter, page }, false));
    return;
  }

  const text = `<b>${title}</b>\nPage ${page}\n\n${pageReviews
    .map((review, i) => formatShortReviewSummary(review, i))
    .join("\n\n")}`;

  const keyboard: TelegramInlineButton[][] = [];
  for (let i = 0; i < pageReviews.length; i += 2) {
    const row: TelegramInlineButton[] = [];
    row.push({ text: `Voir avis ${i + 1}`, callback_data: `review_detail_${pageReviews[i]._id}` });
    if (pageReviews[i + 1]) {
      row.push({ text: `Voir avis ${i + 2}`, callback_data: `review_detail_${pageReviews[i + 1]._id}` });
    }
    keyboard.push(row);
  }
  keyboard.push(...reviewListKeyboard({ ...activeFilter, page }, hasNextPage));

  if (messageId) {
    await editTelegramMessage(String(chatId), messageId, text, keyboard);
    return;
  }
  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

async function exportReviewsForChat(chatId: number, filter: ReviewFilter = {}) {
  if (!bot) return;
  const user = await findUserByTelegram(chatId);
  if (!user) return;
  const active = await hydrateReviewFilter(filter, user.company);
  const query: Record<string, unknown> = {};
  if (active.rating) query.rating = active.rating;
  if (active.sentiment === 'positive') query.rating = { $in: [4, 5] };
  if (active.sentiment === 'neutral') query.rating = 3;
  if (active.sentiment === 'negative') query.rating = { $in: [1, 2] };
  query.moderationStatus = active.moderationStatus === 'archived' ? 'archived' : { $ne: 'archived' };
  if (active.qrCodeId) query.qrCode = active.qrCodeId;
  if (active.tag) query.tags = { $regex: `^${escapeRegExp(active.tag)}$`, $options: 'i' };
  const company = await Company.findById(user.company);
  if (!company) return;
  const buffer = await buildCompanyReviewsExcel(company as any, query);
  await bot.sendDocument(chatId, Buffer.from(buffer), { caption: 'Export Excel des avis' }, { filename: 'avis.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function sendReviewQrFilter(chatId: number, messageId: number, filter: ReviewFilter = {}) {
  const dbUser = await findUserByTelegram(chatId);
  if (!dbUser) return;

  const qrCodes = await CompanyQrCode.find({ company: dbUser.company })
    .sort({ createdAt: -1 })
    .limit(20);

  const keyboard = qrCodes.map((qr) => [
    {
      text: qr.label || "QR Code",
      callback_data: `reviews_qr_${createReviewFilterToken({
        ...resetReviewFilterPage(filter),
        qrCodeId: String(qr._id),
        qrCodeLabel: qr.label || qr.slug || "QR Code",
      })}`,
    },
  ]);
  const token = createReviewFilterToken(filter);
  keyboard.push([{ text: "Retour", callback_data: `reviews_filters_${token}` }]);
  keyboard.push([{ text: "Menu principal", callback_data: "main_menu" }]);

  await editTelegramMessage(
    String(chatId),
    messageId,
    "<b>Filtrer par QR code</b>\n\nChoisissez un QR code.",
    keyboard,
  );
}

async function sendReviewTagFilter(chatId: number, messageId: number, filter: ReviewFilter = {}) {
  const dbUser = await findUserByTelegram(chatId);
  if (!dbUser) return;

  const activeFilter = await hydrateReviewFilter(filter, dbUser.company);
  const distinctQuery: Record<string, unknown> = {
    company: dbUser.company,
    tags: { $exists: true, $ne: "" },
  };
  if (activeFilter.qrCodeId) distinctQuery.qrCode = activeFilter.qrCodeId;

  const tags = (
    await Review.distinct("tags", distinctQuery)
  )
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "fr"));

  const filterToken = createReviewFilterToken(activeFilter);
  const tagButtons = tags.slice(0, 20).map((tag) => [
    {
      text: tag,
      callback_data: `reviews_tag_${createReviewTagToken(dbUser.company, tag)}_${filterToken}`,
    },
  ]);

  const keyboard: TelegramInlineButton[][] = [
    [{ text: "Rechercher un tag", callback_data: `reviews_search_tag_${filterToken}` }],
    ...tagButtons,
    [{ text: "Retour", callback_data: `reviews_filters_${filterToken}` }],
    [{ text: "Menu principal", callback_data: "main_menu" }],
  ];

  const qrLine = activeFilter.qrCodeId
    ? `\nQR actif: <b>${escapeHtml(activeFilter.qrCodeLabel || "QR choisi")}</b>\n`
    : "";
  const text = tags.length
    ? `<b>Filtrer par tag</b>${qrLine}\nChoisissez un tag existant ou recherchez un tag precis.`
    : `<b>Filtrer par tag</b>${qrLine}\nAucun tag existant pour le moment. Vous pouvez quand meme rechercher un tag.`;

  await editTelegramMessage(String(chatId), messageId, text, keyboard);
}

async function askReviewTagSearch(chatId: number, telegramUserId: number | undefined, filter: ReviewFilter = {}) {
  setUserContext(chatId, telegramUserId, "review_search_tag", { qrName: createReviewFilterToken(filter) });
  await sendTelegramKeyboard(
    String(chatId),
    "Tapez le tag a rechercher.",
    navigationKeyboard(`reviews_filters_${createReviewFilterToken(filter)}`),
  );
}

async function searchReviewsByTag(chatId: number, telegramUserId: number | undefined, tag: string) {
  const cleanTag = tag.trim();
  if (!cleanTag) {
    await bot?.sendMessage(chatId, "Tapez un tag valide.");
    return;
  }

  const context = getUserContext(chatId, telegramUserId);
  const filter = context?.qrName ? getReviewFilterToken(context.qrName) : {};
  clearUserContext(chatId, telegramUserId);
  await sendReviews(chatId, undefined, { ...resetReviewFilterPage(filter), tag: cleanTag });
}

async function findTelegramUserCompany(chatId: number) {
  const dbUser = await findUserByTelegram(chatId);
  if (!dbUser) return null;

  const company = await Company.findById(dbUser.company);
  if (!company) return null;

  return { dbUser, company };
}

async function sendStatsForChat(chatId: number, messageId?: number) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) {
    await bot.sendMessage(chatId, "Vous n'etes pas connecte.");
    return;
  }

  const stats = await getCompanyStats(context.company);
  const text = `<b>Statistiques - ${escapeHtml(context.company.name)}</b>

Avis collectes: <b>${stats.count}</b>
Scans: <b>${stats.scanCount}</b>
Conversion scan vers avis: <b>${formatPercent(stats.conversionRate)}</b>
Repere: <b>10% a 30%</b> est generalement sain.
Note moyenne: <b>${stats.averageRating}/5</b>
Application: <b>gratuite</b>`;

  const keyboard = navigationKeyboard(undefined, [[frontendButton("Ouvrir le dashboard", "/dashboard")]]);

  if (messageId) {
    await editTelegramMessage(String(chatId), messageId, text, keyboard);
    return;
  }
  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

async function handleAiOverview(msg: TelegramMessage) {
  if (!bot) return;
  await sendAiOverviewForChat(msg.chat.id);
}

async function sendAiOverviewForChat(chatId: number, messageId?: number, qrCodeId?: string, qrCodeLabel?: string) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) {
    await bot.sendMessage(chatId, "Vous n'etes pas connecte.");
    return;
  }

  const qr = qrCodeId ? await CompanyQrCode.findOne({ _id: qrCodeId, company: context.company._id }) : null;
  const overview = await getAiOverview(context.company, { qrCodeId });
  const title = qrCodeId
    ? qrCodeLabel || qr?.label || qr?.slug || "QR choisi"
    : context.company.name;
  const topProblems = overview.problems
    .slice(0, 3)
    .map(
      (problem, index) =>
        `${index + 1}. ${escapeHtml(problem.label)} (${problem.count} avis, note ${problem.averageRating}/5)`,
    )
    .join("\n");

  const text = `<b>Analyse IA - ${escapeHtml(title)}</b>

Avis analyses: <b>${overview.totalReviews}</b>
Positif: <b>${overview.sentiment.positiveRate}%</b>
Negatif: <b>${overview.sentiment.negativeRate}%</b>

<b>Tendance</b>
${escapeHtml(overview.trends.text)}

<b>Sujets principaux</b>
${topProblems || "Aucun sujet recurrent detecte."}`;

  const keyboard = navigationKeyboard(undefined, [[frontendButton("Ouvrir l'analyse IA", "/ai")]]);

  if (messageId) {
    await editTelegramMessage(String(chatId), messageId, text, keyboard);
    return;
  }
  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

async function handleSearchPrompt(msg: TelegramMessage) {
  if (!bot) return;

  const dbUser = await findUserByTelegram(msg.chat.id);
  if (!dbUser) {
    await bot.sendMessage(msg.chat.id, "Vous n'etes pas connecte.");
    return;
  }

  setUserContext(msg.chat.id, msg.from?.id, "search_reviews");
  await sendTelegramKeyboard(
    String(msg.chat.id),
    'Tapez votre recherche, par exemple "qualite du service".',
    navigationKeyboard("my_reviews"),
  );
}

async function handleSearch(
  msg: TelegramMessage,
  match: RegExpExecArray | null,
) {
  if (!bot || !match) return;

  await searchReviewsForChat(msg.chat.id, match[1]?.trim());
}

async function searchReviewsForChat(chatId: number, query: string, filter: ReviewFilter = {}) {
  if (!bot) return;

  const dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    await bot.sendMessage(chatId, "Vous n'etes pas connecte.");
    return;
  }

  if (!query) {
    setUserContext(chatId, undefined, "search_reviews");
    await sendTelegramKeyboard(
      String(chatId),
      'Tapez votre recherche, par exemple "qualite du service".',
      navigationKeyboard("my_reviews"),
    );
    return;
  }

  try {
    const results = await searchReviewsSemantically(
      String(dbUser.company),
      query,
      1,
      5,
      { qrCodeId: filter.qrCodeId },
    );

    if (!results || results.documents.length === 0) {
      await sendTelegramKeyboard(
        String(chatId),
        `Aucun avis trouve pour "${escapeHtml(query)}".`,
        navigationKeyboard("my_reviews"),
      );
      return;
    }

    const text = `<b>Resultats pour "${escapeHtml(query)}"</b>\n\n${results.documents
      .map(
        (result, i) =>
          `${i + 1}. <b>${result.rating}/5</b>\n${escapeHtml(result.serviceFeedback || "Sans commentaire").slice(0, 120)}`,
      )
      .join("\n\n")}`;

    await sendTelegramKeyboard(String(chatId), text, navigationKeyboard("my_reviews"));
  } catch (error) {
    console.error("[telegram:search:error]", error);
    await bot.sendMessage(chatId, "Une erreur est survenue lors de la recherche.");
  }
}

async function handleQrCommand(
  msg: TelegramMessage,
  match: RegExpExecArray | null,
) {
  if (!bot || !match) return;
  await createConnectedQr(msg.chat.id, match[1].trim(), true, true);
}

async function handleDefaultMessage(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (text.startsWith("/")) {
    if (!KNOWN_COMMAND_PATTERNS.some((pattern) => pattern.test(text))) {
      await bot.sendMessage(chatId, "Commande inconnue. Tapez /help pour la liste des commandes.");
    }
    return;
  }

  const userContext = getUserContext(chatId, msg.from?.id);

  if (userContext?.state === "guest_create_email") {
    const email = text.trim().toLowerCase();
    if (!isValidEmail(email)) {
      await bot.sendMessage(chatId, "Adresse email invalide. Tapez une adresse email valide.");
      return;
    }

    if (userContext.qrName) {
      clearUserContext(chatId, msg.from?.id);
      await createGuestQrCode(chatId, email, userContext.qrName);
      return;
    }

    setUserContext(chatId, msg.from?.id, "guest_create_label", { email });
    await bot.sendMessage(chatId, "Merci. Tapez maintenant le nom du QR code.");
    return;
  }

  if (userContext?.state === "guest_create_label") {
    const qrName = text.trim();
    if (qrName.length < 2) {
      await bot.sendMessage(chatId, "Tapez un nom plus precis pour le QR code.");
      return;
    }

    clearUserContext(chatId, msg.from?.id);
    await createGuestQrCode(chatId, userContext.email || "", qrName);
    return;
  }

  if (userContext?.state === "creating_qr_name") {
    const qrName = text.trim();
    if (qrName.length < 2) {
      await bot.sendMessage(chatId, "Tapez un nom plus precis pour le QR code.");
      return;
    }

    setUserContext(chatId, msg.from?.id, "creating_qr_name", { qrName });
    await sendTelegramKeyboard(
      String(chatId),
      `<b>Creer un QR</b>\n\n2/3 - Activer les notifications email pour <b>${escapeHtml(qrName)}</b> ?`,
      [
        [
          { text: "Oui", callback_data: "qr_email_yes" },
          { text: "Non", callback_data: "qr_email_no" },
        ],
        [{ text: "Retour", callback_data: "create_qr" }],
        [{ text: "Menu principal", callback_data: "main_menu" }],
      ],
    );
    return;
  }

  if (userContext?.state === "review_add_tag") {
    await addReviewTags(chatId, msg.from?.id, userContext.reviewId, text);
    return;
  }

  if (userContext?.state === "review_reply") {
    await replyToReview(chatId, msg.from?.id, userContext.reviewId, text);
    return;
  }

  if (userContext?.state === "review_search_tag") {
    await searchReviewsByTag(chatId, msg.from?.id, text);
    return;
  }

  if (userContext?.state === "search_reviews") {
    const filter = userContext.qrName ? getReviewFilterToken(userContext.qrName) : {};
    clearUserContext(chatId, msg.from?.id);
    await searchReviewsForChat(chatId, text.trim(), filter);
    return;
  }

  if (text.startsWith("qr ") || text.startsWith("QR ")) {
    await createConnectedQr(chatId, text.replace(/^qr\s+/i, "").trim(), true, true);
    return;
  }

  await sendTelegramKeyboard(
    String(chatId),
    "Je n'ai pas compris votre demande. Utilisez le menu ci-dessous.",
    mainMenuKeyboard(),
  );
}

async function handleCallbackQuery(query: TelegramCallbackQuery) {
  if (!bot) return;

  const chatId = query.message?.chat.id;
  const data = query.data;
  const messageId = query.message?.message_id;

  if (!chatId || !messageId || !data) return;

  try {
    if (data === "frontend_url_unavailable") {
      await bot.sendMessage(
        chatId,
        `L'interface web est configuree en local (${env.frontendUrl}). Configurez FRONTEND_URL avec une URL publique HTTPS pour ouvrir ce bouton depuis Telegram.`,
      );
      await answerCallbackQuery(query.id);
      return;
    }

    if (data === "guest_create_qr") {
      setUserContext(chatId, query.from.id, "guest_create_email");
      await bot.sendMessage(chatId, "Pour creer votre QR code, tapez votre adresse email.");
      await answerCallbackQuery(query.id);
      return;
    }

    const dbUser = await findUserByTelegram(chatId);

    if (!dbUser) {
      if (data === "create_qr") {
        setUserContext(chatId, query.from.id, "guest_create_email");
        await bot.sendMessage(chatId, "Pour creer votre QR code, tapez votre adresse email.");
        await answerCallbackQuery(query.id);
        return;
      }

      if (data.startsWith("connect_telegram_")) {
        await handleConnectTelegramCallback(chatId);
        await answerCallbackQuery(query.id);
        return;
      }

      await answerCallbackQuery(query.id, "Vous devez etre connecte pour cette action", true);
      return;
    }

    await routeConnectedCallback(chatId, messageId, data, dbUser._id, query.from.id);
    await answerCallbackQuery(query.id);
  } catch (error) {
    console.error("[telegram:callback:error]", error);
    await answerCallbackQuery(query.id, "Une erreur est survenue", true);
  }
}

async function routeConnectedCallback(
  chatId: number,
  messageId: number,
  data: string,
  userId: Types.ObjectId,
  telegramUserId?: number,
) {
  if (data === "main_menu") return sendMainMenu(chatId, messageId);
  if (data === "help") return sendHelp(chatId, messageId);
  if (data === "create_qr") return startQrCreation(chatId, telegramUserId);
  if (data === "my_qr_codes") return sendQrCodes(chatId, messageId);
  if (data.startsWith("my_qr_codes_page_")) return sendQrCodes(chatId, messageId, Number(data.replace("my_qr_codes_page_", "")));
  if (data === "my_reviews") return sendReviews(chatId, messageId);
  if (data === "dashboard_stats") return sendStatsForChat(chatId, messageId);
  if (data === "ai_overview") return sendAiOverviewForChat(chatId, messageId);
  if (data === "search_reviews") return handleSearchCallback(chatId, telegramUserId);
  if (data.startsWith("search_reviews_")) return handleSearchCallback(chatId, telegramUserId, getReviewFilterToken(data.replace("search_reviews_", "")));
  if (data === "settings") return sendSettings(chatId, messageId);
  if (data === "toggle_company_email") return toggleCompanyNotification(chatId, messageId, "email");
  if (data === "toggle_company_telegram") return toggleCompanyNotification(chatId, messageId, "telegram");

  if (data === "qr_email_yes" || data === "qr_email_no") {
    return handleQrEmailChoice(chatId, telegramUserId, data === "qr_email_yes");
  }
  if (data === "qr_telegram_yes" || data === "qr_telegram_no") {
    return handleQrTelegramChoice(chatId, telegramUserId, data === "qr_telegram_yes");
  }

  if (data.startsWith("reviews_filters_")) {
    const baseFilter = getReviewFilterToken(data.replace("reviews_filters_", ""));
    const dbUser = await findUserByTelegram(chatId);
    const filter = dbUser ? await hydrateReviewFilter(baseFilter, dbUser.company) : baseFilter;
    await editTelegramMessage(
      String(chatId),
      messageId,
      buildReviewFiltersText(filter),
      reviewFiltersKeyboard(filter),
    );
    return;
  }
  if (data.startsWith("reviews_page_")) {
    return sendReviews(chatId, messageId, getReviewFilterToken(data.replace("reviews_page_", "")));
  }
  if (data.startsWith('reviews_export_')) return exportReviewsForChat(chatId, getReviewFilterToken(data.replace('reviews_export_', '')));
  const ratingMatch = data.match(/^reviews_rating_([1-5])_(.+)$/);
  if (ratingMatch) {
    const filter = resetReviewFilterPage(getReviewFilterToken(ratingMatch[2] || ""));
    return sendReviews(chatId, messageId, { ...filter, rating: Number(ratingMatch[1]) as 1 | 2 | 3 | 4 | 5 });
  }
  if (data.startsWith("reviews_rating_")) {
    const filter = getReviewFilterToken(data.replace("reviews_rating_", ""));
    await editTelegramMessage(String(chatId), messageId, "<b>Score</b>\n\nChoisissez une note.", reviewRatingKeyboard(filter));
    return;
  }
  const sentimentMatch = data.match(/^reviews_sentiment_(positive|neutral|negative)_(.+)$/);
  if (sentimentMatch) {
    const filter = resetReviewFilterPage(getReviewFilterToken(sentimentMatch[2] || ""));
    return sendReviews(chatId, messageId, { ...filter, sentiment: sentimentMatch[1] as ReviewFilter["sentiment"] });
  }
  if (data.startsWith("reviews_sentiment_")) {
    const filter = getReviewFilterToken(data.replace("reviews_sentiment_", ""));
    await editTelegramMessage(String(chatId), messageId, "<b>Sentiment</b>\n\nChoisissez le ressenti client.", reviewSentimentKeyboard(filter));
    return;
  }
  const statusMatch = data.match(/^reviews_status_(published|archived)_(.+)$/);
  if (statusMatch) {
    const filter = resetReviewFilterPage(getReviewFilterToken(statusMatch[2] || ""));
    return sendReviews(chatId, messageId, { ...filter, moderationStatus: statusMatch[1] as ReviewFilter["moderationStatus"] });
  }
  if (data.startsWith("reviews_status_")) {
    const filter = getReviewFilterToken(data.replace("reviews_status_", ""));
    await editTelegramMessage(String(chatId), messageId, "<b>Statut</b>\n\nChoisissez le statut.", reviewStatusKeyboard(filter));
    return;
  }
  if (data.startsWith("reviews_by_qr_")) return sendReviewQrFilter(chatId, messageId, getReviewFilterToken(data.replace("reviews_by_qr_", "")));
  if (data.startsWith("reviews_by_tag_")) return sendReviewTagFilter(chatId, messageId, getReviewFilterToken(data.replace("reviews_by_tag_", "")));
  if (data.startsWith("reviews_search_tag_")) return askReviewTagSearch(chatId, telegramUserId, getReviewFilterToken(data.replace("reviews_search_tag_", "")));
  if (data.startsWith("reviews_tag_")) {
    const [, tagToken, filterToken] = data.match(/^reviews_tag_([^_]+)_(.+)$/) || [];
    const tag = reviewTagTokens.get(tagToken || "");
    if (!tag) {
      await sendReviewTagFilter(chatId, messageId, getReviewFilterToken(filterToken || ""));
      return;
    }
    return sendReviews(chatId, messageId, { ...resetReviewFilterPage(getReviewFilterToken(filterToken || "")), tag });
  }
  if (data.startsWith("reviews_qr_")) {
    return sendReviews(chatId, messageId, getReviewFilterToken(data.replace("reviews_qr_", "")));
  }

  if (data.startsWith("qr_detail_")) return handleQrDetailCallback(chatId, messageId, data.replace("qr_detail_", ""));
  if (data.startsWith("qr_download_png_")) return handleQrDownload(chatId, data.replace("qr_download_png_", ""), "png");
  if (data.startsWith("qr_download_pdf_")) return handleQrDownload(chatId, data.replace("qr_download_pdf_", ""), "pdf");
  if (data.startsWith("qr_toggle_email_")) return toggleQrNotification(chatId, messageId, data.replace("qr_toggle_email_", ""), "email");
  if (data.startsWith("qr_toggle_telegram_")) return toggleQrNotification(chatId, messageId, data.replace("qr_toggle_telegram_", ""), "telegram");
  if (data.startsWith("qr_reviews_")) return sendReviews(chatId, messageId, { qrCodeId: data.replace("qr_reviews_", "") });
  if (data.startsWith("qr_ai_")) {
    const qrAction = getQrActionToken(data.replace("qr_ai_", ""));
    return sendAiOverviewForChat(chatId, messageId, qrAction.qrCodeId, qrAction.qrCodeLabel);
  }
  if (data.startsWith("copy_link_")) return handleCopyLinkCallback(chatId, data.replace("copy_link_", ""));

  if (data.startsWith("review_detail_")) return handleReviewDetailCallback(chatId, messageId, data.replace("review_detail_", ""));
  if (data.startsWith("review_archive_")) return updateReviewModeration(chatId, messageId, data.replace("review_archive_", ""), "archived");
  if (data.startsWith("review_tag_")) return askReviewTag(chatId, telegramUserId, data.replace("review_tag_", ""));
  if (data.startsWith("review_reply_")) return askReviewReply(chatId, telegramUserId, data.replace("review_reply_", ""));
}

async function handleQrEmailChoice(chatId: number, telegramUserId: number | undefined, enabled: boolean) {
  const context = getUserContext(chatId, telegramUserId);
  if (!context?.qrName) {
    await startQrCreation(chatId, telegramUserId);
    return;
  }

  setUserContext(chatId, telegramUserId, "creating_qr_name", {
    qrName: context.qrName,
    emailEnabled: enabled,
  });
  await sendTelegramKeyboard(
    String(chatId),
    `<b>Creer un QR</b>\n\n3/3 - Activer Telegram pour <b>${escapeHtml(context.qrName)}</b> ?`,
    [
      [
        { text: "Oui", callback_data: "qr_telegram_yes" },
        { text: "Non", callback_data: "qr_telegram_no" },
      ],
      [{ text: "Retour", callback_data: "create_qr" }],
      [{ text: "Menu principal", callback_data: "main_menu" }],
    ],
  );
}

async function handleQrTelegramChoice(
  chatId: number,
  telegramUserId: number | undefined,
  enabled: boolean,
) {
  const context = getUserContext(chatId, telegramUserId);
  if (!context?.qrName) {
    await startQrCreation(chatId, telegramUserId);
    return;
  }

  clearUserContext(chatId, telegramUserId);
  await createConnectedQr(chatId, context.qrName, context.emailEnabled !== false, enabled);
}

async function handleSearchCallback(chatId: number, telegramUserId?: number, filter: ReviewFilter = {}) {
  const token = createReviewFilterToken(filter);
  setUserContext(chatId, telegramUserId, "search_reviews", { qrName: token });
  await sendTelegramKeyboard(
    String(chatId),
    'Tapez votre recherche, par exemple "qualite du service".',
    navigationKeyboard(`reviews_filters_${token}`),
  );
}

async function toggleCompanyNotification(
  chatId: number,
  messageId: number,
  channel: "email" | "telegram",
) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  const key = channel === "telegram" ? "telegramEnabled" : "emailEnabled";
  const current = context.company.notificationPreferences?.[key] !== false;
  context.company.set(`notificationPreferences.${key}`, !current);
  await context.company.save();

  await bot.sendMessage(chatId, `${channel === "telegram" ? "Telegram" : "Email"} ${!current ? "active" : "desactive"}.`);
  await sendSettings(chatId, messageId);
}

async function handleConnectTelegramCallback(chatId: number) {
  await sendTelegramKeyboard(
    String(chatId),
    "<b>Se connecter a QrFeedback</b>\n\nConnectez-vous puis ouvrez Parametres > Notifications pour lier Telegram.",
    [[frontendButton("Se connecter", "/login?redirect=/settings")]],
  );
}

async function handleQrDetailCallback(
  chatId: number,
  messageId: number,
  qrId: string,
) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  const qr = await CompanyQrCode.findOne({ _id: qrId, company: context.company._id });
  if (!qr) {
    await bot.sendMessage(chatId, "QR code introuvable.");
    return;
  }

  const reviewCount = await Review.countDocuments({ qrCode: qr._id, moderationStatus: { $ne: "archived" } });
  const scanCount = qr.scanCount || 0;
  const conversion = scanCount ? (Math.min(reviewCount, scanCount) / scanCount) * 100 : 0;
  const prefs = qr.notificationPreferences;
  const qrAiToken = createQrActionToken(qr._id, qr.label || qr.slug || "QR Code");
  const text = `<b>${escapeHtml(qr.label || "QR Code")}</b>

Statut: <b>${qr.isActive ? "Actif" : "Inactif"}</b>
Avis: <b>${reviewCount}</b>
Scans: <b>${scanCount}</b>
Conversion scan vers avis: <b>${formatPercent(conversion)}</b>
Repere: <b>10% a 30%</b> est generalement sain.
Email: <b>${prefs?.emailEnabled !== false ? "active" : "desactive"}</b>
Telegram: <b>${prefs?.telegramEnabled !== false ? "active" : "desactive"}</b>

Lien:
<code>${qr.feedbackUrl}</code>`;

  await editTelegramMessage(String(chatId), messageId, text, [
    [
      { text: "PNG", callback_data: `qr_download_png_${qrId}` },
      { text: "PDF", callback_data: `qr_download_pdf_${qrId}` },
    ],
    [
      { text: `${prefs?.emailEnabled !== false ? "Desactiver" : "Activer"} Email`, callback_data: `qr_toggle_email_${qrId}` },
      { text: `${prefs?.telegramEnabled !== false ? "Desactiver" : "Activer"} Telegram`, callback_data: `qr_toggle_telegram_${qrId}` },
    ],
    [{ text: "Mes avis", callback_data: `qr_reviews_${qrId}` }],
    [{ text: "Analyse IA", callback_data: `qr_ai_${qrAiToken}` }],
    [{ text: "Copier le lien", callback_data: `copy_link_${qrId}` }],
    ...navigationKeyboard("my_qr_codes"),
  ]);
}

async function handleQrDownload(chatId: number, qrId: string, format: "png" | "pdf") {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  const qr = await CompanyQrCode.findOne({ _id: qrId, company: context.company._id });
  if (!qr) {
    await bot.sendMessage(chatId, "QR code introuvable.");
    return;
  }

  if (format === "png") {
    const qrImageBase64 = qr.qrCodeDataUrl.split(",")[1] || qr.qrCodeDataUrl;
    await bot.sendPhoto(chatId, Buffer.from(qrImageBase64, "base64"), {
      caption: `<b>${escapeHtml(qr.label || "QR Code")}</b>\n<code>${qr.feedbackUrl}</code>`,
      parse_mode: "HTML",
    });
    await sendQrFollowUpKeyboard(chatId, qrId, qr.label || qr.slug || "QR Code");
    return;
  }

  const pdf = await buildQrPdfBuffer({
    companyName: context.company.name,
    feedbackUrl: qr.feedbackUrl,
    qrCodeDataUrl: qr.qrCodeDataUrl,
  });
  await bot.sendDocument(
    chatId,
    pdf,
    { caption: "PDF imprimable" },
    {
      filename: `${createSlug(qr.label || "qr-code") || "qr-code"}.pdf`,
      contentType: "application/pdf",
    },
  );
  await sendQrFollowUpKeyboard(chatId, qrId, qr.label || qr.slug || "QR Code");
}

async function sendQrFollowUpKeyboard(chatId: number, qrId: string, qrLabel = "QR Code") {
  const qrAiToken = createQrActionToken(qrId, qrLabel);
  await sendTelegramKeyboard(
    String(chatId),
    "Que voulez-vous voir pour ce QR ?",
    navigationKeyboard(`qr_detail_${qrId}`, [
      [{ text: "Mes avis", callback_data: `qr_reviews_${qrId}` }],
      [{ text: "Analyse IA", callback_data: `qr_ai_${qrAiToken}` }],
    ]),
  );
}

async function toggleQrNotification(
  chatId: number,
  messageId: number,
  qrId: string,
  channel: "email" | "telegram",
) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  const qr = await CompanyQrCode.findOne({ _id: qrId, company: context.company._id });
  if (!qr) {
    await bot.sendMessage(chatId, "QR code introuvable.");
    return;
  }

  const key = channel === "telegram" ? "telegramEnabled" : "emailEnabled";
  const current = qr.notificationPreferences?.[key] !== false;
  qr.set(`notificationPreferences.${key}`, !current);
  await qr.save();

  await bot.sendMessage(chatId, `${channel === "telegram" ? "Telegram" : "Email"} ${!current ? "active" : "desactive"} pour ce QR.`);
  await handleQrDetailCallback(chatId, messageId, qrId);
}

async function handleCopyLinkCallback(chatId: number, qrId: string) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  const qr = await CompanyQrCode.findOne({ _id: qrId, company: context.company._id });
  if (!qr) {
    await bot.sendMessage(chatId, "QR code introuvable.");
    return;
  }

  await bot.sendMessage(chatId, `<code>${qr.feedbackUrl}</code>`, {
    parse_mode: "HTML",
  });
}

async function handleReviewDetailCallback(
  chatId: number,
  messageId: number,
  reviewId: string,
) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  const review = await Review.findOne({ _id: reviewId, company: context.company._id }).populate(
    "qrCode",
    "label slug feedbackUrl",
  );
  if (!review) {
    await bot.sendMessage(chatId, "Avis introuvable.");
    return;
  }

  let text = `<b>Avis detaille</b>\n\n`;
  text += `QR: <b>${escapeHtml(getReviewQrLabel(review))}</b>\n`;
  text += `Score: <b>${review.rating}/5</b>\n`;
  text += `Statut: <b>${formatModerationStatus(review.moderationStatus)}</b>\n`;
  text += `Date: ${formatReviewDate(review.createdAt)}\n`;
  if (review.tags?.length) text += `Tags: ${review.tags.map(escapeHtml).join(", ")}\n`;
  if (review.serviceFeedback) text += `Commentaire: ${escapeHtml(review.serviceFeedback)}\n`;
  if (review.internalNote) text += `Note interne: ${escapeHtml(review.internalNote)}\n`;
  if (review.responseText) text += `Ancienne note: ${escapeHtml(review.responseText)}\n`;

  const answers = formatReviewExtraAnswers(review, 10);
  if (answers) text += `\n<b>Reponses du formulaire:</b>\n${answers}`;

  await editTelegramMessage(String(chatId), messageId, text, reviewActionKeyboard(reviewId));
}

async function updateReviewModeration(
  chatId: number,
  messageId: number,
  reviewId: string,
  status: "archived",
) {
  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  await Review.findOneAndUpdate({ _id: reviewId, company: context.company._id }, { moderationStatus: status });
  await handleReviewDetailCallback(chatId, messageId, reviewId);
}

async function askReviewTag(chatId: number, telegramUserId: number | undefined, reviewId: string) {
  setUserContext(chatId, telegramUserId, "review_add_tag", { reviewId });
  await sendTelegramKeyboard(
    String(chatId),
    "Tapez un ou plusieurs tags separes par des virgules.",
    navigationKeyboard(`review_detail_${reviewId}`),
  );
}

async function addReviewTags(
  chatId: number,
  telegramUserId: number | undefined,
  reviewId: string | undefined,
  text: string,
) {
  if (!bot || !reviewId) return;
  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  const tags = text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (!tags.length) {
    await bot.sendMessage(chatId, "Aucun tag valide.");
    return;
  }

  await Review.findOneAndUpdate(
    { _id: reviewId, company: context.company._id },
    { $addToSet: { tags: { $each: tags } } },
  );
  clearUserContext(chatId, telegramUserId);
  await bot.sendMessage(chatId, "Tags ajoutes.");
  await sendReviews(chatId);
}

async function askReviewReply(chatId: number, telegramUserId: number | undefined, reviewId: string) {
  setUserContext(chatId, telegramUserId, "review_reply", { reviewId });
  await sendTelegramKeyboard(
    String(chatId),
    "Tapez la note interne a enregistrer pour cet avis.",
    navigationKeyboard(`review_detail_${reviewId}`),
  );
}

async function replyToReview(
  chatId: number,
  telegramUserId: number | undefined,
  reviewId: string | undefined,
  text: string,
) {
  if (!bot || !reviewId) return;
  const context = await findTelegramUserCompany(chatId);
  if (!context) return;

  const internalNote = text.trim();
  if (internalNote.length < 2) {
    await bot.sendMessage(chatId, "Tapez une note plus complete.");
    return;
  }

  await Review.findOneAndUpdate(
    { _id: reviewId, company: context.company._id },
    { internalNote },
  );
  clearUserContext(chatId, telegramUserId);
  await bot.sendMessage(chatId, "Note interne enregistree.");
  await sendReviews(chatId);
}

async function createConnectedQr(
  chatId: number,
  qrName: string,
  emailEnabled: boolean,
  telegramEnabled: boolean,
) {
  if (!bot) return;

  try {
    const context = await findTelegramUserCompany(chatId);
    if (!context) {
      setUserContext(chatId, undefined, "guest_create_email", { qrName });
      await bot.sendMessage(chatId, `Pour creer le QR code "${escapeHtml(qrName)}", tapez votre adresse email.`);
      return;
    }

    const slug = await createUniqueSlug(`${context.company.name}-${qrName}-${chatId}`);
    const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
    const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);
    const qrCode = await CompanyQrCode.create({
      label: qrName,
      company: context.company._id,
      slug,
      feedbackUrl,
      qrCodeDataUrl,
      notificationPreferences: {
        emailEnabled,
        telegramEnabled,
      },
    });

    await sendQrAssets(
      chatId,
      context.company.name,
      qrCode,
      `QR code cree: <b>${escapeHtml(qrName)}</b>

Email: <b>${emailEnabled ? "active" : "desactive"}</b>
Telegram: <b>${telegramEnabled ? "active" : "desactive"}</b>

Lien:
<code>${qrCode.feedbackUrl}</code>`,
    );

    await sendTelegramKeyboard(
      String(chatId),
      "QR pret. Vous pouvez aussi le retrouver dans Mes QR codes.",
      navigationKeyboard("my_qr_codes", [
        [{ text: "Mes avis", callback_data: `qr_reviews_${qrCode._id}` }],
        [{ text: "Analyse IA", callback_data: `qr_ai_${createQrActionToken(qrCode._id, qrCode.label || qrCode.slug || "QR Code")}` }],
        [{ text: "Creer un autre QR", callback_data: "create_qr" }],
        [frontendButton("Ouvrir le dashboard", "/dashboard/qr-codes")],
      ]),
    );
  } catch (error) {
    console.error("[telegram:create_qr:error]", error);
    await bot.sendMessage(chatId, "Erreur lors de la creation du QR code.");
  }
}

async function findUserByTelegram(chatId: number) {
  return User.findOne({ "telegramProfile.chatId": String(chatId) });
}

export async function connectUserToTelegram(
  userId: Types.ObjectId,
  chatId: number,
  username?: string,
  firstName?: string,
  lastName?: string,
) {
  const user = await User.findByIdAndUpdate(
    userId,
    {
      "telegramProfile.chatId": String(chatId),
      "telegramProfile.username": username,
      "telegramProfile.firstName": firstName,
      "telegramProfile.lastName": lastName,
      "telegramProfile.connectedAt": new Date(),
      "telegramProfile.isActive": true,
      "notificationPreferences.channels.telegram": true,
    },
    { new: true },
  );

  if (bot) {
    await sendTelegramKeyboard(
      String(chatId),
      `Connecte en tant que <b>${escapeHtml(user?.email)}</b>\n\nVotre compte est maintenant lie a Telegram.`,
      mainMenuKeyboard(),
    );
  }

  return user;
}

export { bot };
