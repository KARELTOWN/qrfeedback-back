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
import { CompanyQrCode } from "../models/CompanyQrCode.js";
import { TelegramLinkToken } from "../models/TelegramLinkToken.js";
import { Review } from "../models/Review.js";
import { generateQrDataUrl } from "./qr.service.js";
import { createSlug } from "../utils/slug.js";
import {
  sendTelegramKeyboard,
  editTelegramMessage,
  answerCallbackQuery,
} from "./telegram.service.js";
import { getCompanyStats } from "./dashboard.service.js";
import { getAiOverview } from "./reviewAnalytics.service.js";
import { searchReviewsSemantically } from "./typesense.service.js";
import type { Types } from "mongoose";

let bot: TelegramBotConstructor | null = null;

type UserContextState =
  | "creating_qr"
  | "search_reviews"
  | "guest_create_email"
  | "guest_create_label";

// Track user conversation context. Telegram callbacks and messages can be
// matched either by chat id or by Telegram user id.
const userContexts = new Map<
  string,
  { state: UserContextState; email?: string; qrName?: string }
>();

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
  payload: { email?: string; qrName?: string } = {},
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

const COMMANDS = {
  START: "/start",
  HELP: "/help",
  SETTINGS: "/settings",
  CREATE_QR: "/create_qr",
  MY_QR_CODES: "/my_qr_codes",
  REVIEWS: "/reviews",
  SEARCH: "/search",
  STATS: "/stats",
  AI: "/ai",
};

type TelegramInlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

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

function getReviewQrLabel(review: any) {
  return review.qrCode?.label || review.qrCode?.slug || "QR non precise";
}

function formatReviewExtraAnswers(review: any, limit = 2) {
  return (review.customAnswers || [])
    .filter((answer: any) => answer?.value !== undefined && answer?.value !== "")
    .slice(0, limit)
    .map((answer: any) => `${escapeHtml(answer.label)}: ${escapeHtml(answer.value)}`)
    .join("\n");
}

function formatReviewSummary(review: any, index: number) {
  const comment = review.serviceFeedback || "Sans commentaire";
  const answers = formatReviewExtraAnswers(review);
  return [
    `${index + 1}. <b>${review.rating}/5</b> - ${formatReviewDate(review.createdAt)}`,
    `QR: <b>${escapeHtml(getReviewQrLabel(review))}</b>`,
    `Experience: ${escapeHtml(comment).slice(0, 120)}`,
    answers,
  ]
    .filter(Boolean)
    .join("\n");
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
    freeMessagesLimit: 0,
    freeEmailNotificationsLimit: env.freeEmailNotifications,
    unlimitedAccess: true,
    unlimitedAccessActivatedAt: new Date(),
  });
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

  const qrImageBase64 = qrCodeDataUrl.split(",")[1] || qrCodeDataUrl;
  await bot.sendPhoto(chatId, Buffer.from(qrImageBase64, "base64"), {
    caption: `QR code cree: <b>${escapeHtml(qrName)}</b>\n\nLes avis seront envoyes par email a <b>${escapeHtml(company.email)}</b>.\n\nLien de feedback:\n<code>${qrCode.feedbackUrl}</code>`,
    parse_mode: "HTML",
  });
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

/**
 * Initialise le bot Telegram
 */
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

  // Enregistrer les commandes
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

/**
 * Enregistre les commandes du bot
 */
function registerCommands() {
  if (!bot) return;

  bot.onText(/\/start/, handleStart);
  bot.onText(/\/help/, handleHelp);
  bot.onText(/\/settings/, handleSettings);
  bot.onText(/\/create_qr/, handleCreateQr);
  bot.onText(/\/my_qr_codes/, handleMyQrCodes);
  bot.onText(/\/reviews/, handleReviews);
  bot.onText(/^\/search$/, handleSearchPrompt);
  bot.onText(/\/search (.+)/, handleSearch);
  bot.onText(/\/stats/, handleStats);
  bot.onText(/\/ai/, handleAiOverview);
  bot.onText(/\/qr (.+)/, handleQrCommand);

  // Message par défaut
  bot.on("message", handleDefaultMessage);
}

/**
 * Enregistre les callbacks pour les boutons
 */
function registerCallbacks() {
  if (!bot) return;

  bot.on("callback_query", handleCallbackQuery);
}

/**
 * Commande /start - Initialiser/connecter l'utilisateur
 */
async function handleStart(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const user = msg.from;
  const token = msg.text?.match(/^\/start\s+(.+)$/)?.[1];

  if (!user) return;

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
        await bot.sendMessage(chatId, "Lien Telegram invalide ou expiré.");
      }
    } catch (error) {
      console.error("[telegram:link:error]", error);
      await bot.sendMessage(
        chatId,
        "Lien Telegram invalide ou expiré. Veuillez relancer la connexion depuis vos paramètres QrFeedback.",
      );
    }
    return;
  }

  // Chercher un utilisateur connecté
  let dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    // Menu pour les utilisateurs non connectés (guests)
    const keyboard = [
      [{ text: "Creer un QR code", callback_data: "guest_create_qr" }],
      [
        {
          ...frontendButton("Se connecter à QrFeedback", "/login?redirect=/settings"),
        },
      ],
    ];

    await sendTelegramKeyboard(
      String(chatId),
      `👋 Bienvenue sur <b>QrFeedback</b>!\n\nPour recevoir vos avis sur Telegram, connectez votre compte QrFeedback puis liez Telegram depuis les paramètres.\n\nSans compte connecté, la création de QR code se fait depuis le site avec votre email et le nom de votre entreprise.`,
      keyboard,
    );
    return;
  }

  // Menu pour les utilisateurs connectés (avec accès complet)
  const companyName =
    typeof dbUser.company === "object"
      ? (dbUser.company as any)?.name
      : "QrFeedback";
  await sendTelegramKeyboard(
    String(chatId),
    `👋 Bienvenue <b>${companyName}</b>!\n\nQue souhaitez-vous faire ?`,
    [
      [{ text: "➕ Créer un QR code", callback_data: "create_qr" }],
      [{ text: "📋 Mes QR codes", callback_data: "my_qr_codes" }],
      [{ text: "⭐ Mes avis", callback_data: "my_reviews" }],
      [{ text: "📊 Statistiques", callback_data: "dashboard_stats" }],
      [{ text: "🤖 Analyse IA", callback_data: "ai_overview" }],
      [{ text: "🔍 Rechercher", callback_data: "search_reviews" }],
      [frontendButton("🌐 Ouvrir le dashboard", "/dashboard")],
      [frontendButton("⚙️ Réglages web", "/settings")],
      [{ text: "🔔 Notifications", callback_data: "settings" }],
    ],
  );
}

/**
 * Commande /help - Afficher l'aide
 */
async function handleHelp(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;

  const helpText = `<b>📖 Aide - Commandes disponibles:</b>

<b>Gestion des QR codes:</b>
/create_qr - Créer un nouveau QR code
/my_qr_codes - Voir mes QR codes

<b>Gestion des avis:</b>
/reviews - Voir mes avis récents
/search [texte] - Rechercher des avis similaires
/stats - Voir les statistiques
/ai - Voir l'analyse IA

<b>Autres:</b>
/settings - Gérer mes paramètres
/help - Afficher cette aide`;

  await bot.sendMessage(chatId, helpText, { parse_mode: "HTML" });
}

/**
 * Commande /settings - Gérer les paramètres
 */
async function handleSettings(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    await bot.sendMessage(
      chatId,
      "❌ Vous n'êtes pas connecté. Utilisez /start pour commencer.",
    );
    return;
  }

  const prefs = dbUser.notificationPreferences;
  const preferredChannel = prefs?.preferredChannel || "email";

  const text = `<b>⚙️ Vos paramètres</b>

<b>Canal de notification préféré:</b>
${preferredChannel === "telegram" ? "📱 Telegram" : "📧 Email"}

<b>Canaux activés:</b>
${prefs?.channels?.email ? "✅" : "❌"} Email
${prefs?.channels?.telegram ? "✅" : "❌"} Telegram`;

  await sendTelegramKeyboard(String(chatId), text, [
    [
      {
        text: "📧 Définir Email comme préféré",
        callback_data: "set_channel_email",
      },
    ],
    [
      {
        text: "📱 Définir Telegram comme préféré",
        callback_data: "set_channel_telegram",
      },
    ],
    [{ text: "🔙 Retour", callback_data: "main_menu" }],
  ]);
}

/**
 * Commande /create_qr - Créer un QR code
 */
async function handleCreateQr(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    setUserContext(chatId, msg.from?.id, "guest_create_email");
    await bot.sendMessage(
      chatId,
      "Pour creer votre QR code, tapez votre adresse email.",
    );
    return;
  }

  if (!dbUser) {
    await sendTelegramKeyboard(
      String(chatId),
      "Pour créer un QR code sans compte connecté, utilisez le site avec votre email et le nom de votre entreprise.",
      [[frontendButton("Créer mon QR code")]],
    );
    return;
  }

  setUserContext(chatId, msg.from?.id, "creating_qr");

  const text = `<b>➕ Créer un QR code</b>\n\nTapez simplement le libellé du QR code.\n\nPar exemple: <code>Table 1</code>, <code>Caisse</code> ou <code>Mon Restaurant</code>`;

  await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
}

/**
 * Commande /my_qr_codes - Lister les QR codes de l'utilisateur
 */
async function handleMyQrCodes(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    await bot.sendMessage(chatId, "❌ Vous n'êtes pas connecté.");
    return;
  }

  const qrCodes = await CompanyQrCode.find({ company: dbUser.company }).limit(
    10,
  );

  if (qrCodes.length === 0) {
    await bot.sendMessage(chatId, "📭 Vous n'avez pas encore de QR code.");
    return;
  }

  let text = "<b>📋 Mes QR codes</b>\n\n";
  text += qrCodes
    .map(
      (qr, i) =>
        `${i + 1}. <b>${qr.label || "QR Code"}</b>\nLien: ${qr.feedbackUrl || "N/A"}`,
    )
    .join("\n\n");

  const keyboard = qrCodes.map((qr) => [
    {
      text: qr.label || "QR Code",
      callback_data: `qr_detail_${qr._id}`,
    },
  ]);

  keyboard.push([{ text: "🔙 Retour", callback_data: "main_menu" }]);

  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

/**
 * Commande /reviews - Afficher les avis récents
 */
async function handleReviews(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    await bot.sendMessage(chatId, "❌ Vous n'êtes pas connecté.");
    return;
  }

  const reviews = await Review.find({ company: dbUser.company })
    .populate("qrCode", "label slug")
    .sort({ createdAt: -1 })
    .limit(5);

  if (reviews.length === 0) {
    await bot.sendMessage(chatId, "📭 Vous n'avez pas d'avis pour le moment.");
    return;
  }

  let text = "<b>⭐ Mes avis récents</b>\n\n";
  text += reviews.map((review, i) => formatReviewSummary(review, i)).join("\n\n");

  const keyboard = reviews.map((review) => [
    {
      text: `⭐ ${review.rating}/5`,
      callback_data: `review_detail_${review._id}`,
    },
  ]);

  keyboard.push([{ text: "🔙 Retour", callback_data: "main_menu" }]);

  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

async function findTelegramUserCompany(chatId: number) {
  const dbUser = await findUserByTelegram(chatId);
  if (!dbUser) return null;

  const company = await Company.findById(dbUser.company);
  if (!company) return null;

  return { dbUser, company };
}

async function handleStats(msg: TelegramMessage) {
  if (!bot) return;
  await sendStatsForChat(msg.chat.id);
}

async function sendStatsForChat(chatId: number, messageId?: number) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) {
    await bot.sendMessage(chatId, "❌ Vous n'êtes pas connecté.");
    return;
  }

  const stats = await getCompanyStats(context.company);
  const remainingEmailText = stats.unlimitedAccess
    ? "Illimite"
    : String(stats.remainingEmailNotifications);
  const text = `<b>📊 Statistiques - ${context.company.name}</b>

Avis collectés: <b>${stats.count}</b>
Note moyenne: <b>${stats.averageRating}/5</b>
Notifications email restantes: <b>${remainingEmailText}</b>`;

  const keyboard = [
    [frontendButton("Ouvrir le dashboard", "/dashboard")],
    [{ text: "🔙 Retour", callback_data: "main_menu" }],
  ];

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

async function sendAiOverviewForChat(chatId: number, messageId?: number) {
  if (!bot) return;

  const context = await findTelegramUserCompany(chatId);
  if (!context) {
    await bot.sendMessage(chatId, "❌ Vous n'êtes pas connecté.");
    return;
  }

  const overview = await getAiOverview(context.company);
  const topProblems = overview.problems
    .slice(0, 3)
    .map(
      (problem, index) =>
        `${index + 1}. ${problem.label} (${problem.count} avis, note ${problem.averageRating}/5)`,
    )
    .join("\n");

  const text = `<b>🤖 Analyse IA - ${context.company.name}</b>

Avis analysés: <b>${overview.totalReviews}</b>
Positif: <b>${overview.sentiment.positiveRate}%</b>
Négatif: <b>${overview.sentiment.negativeRate}%</b>

<b>Tendance</b>
${overview.trends.text}

<b>Sujets principaux</b>
${topProblems || "Aucun sujet récurrent détecté."}`;

  const keyboard = [
    [frontendButton("Ouvrir l'analyse IA", "/ai")],
    [{ text: "🔙 Retour", callback_data: "main_menu" }],
  ];

  if (messageId) {
    await editTelegramMessage(String(chatId), messageId, text, keyboard);
    return;
  }

  await sendTelegramKeyboard(String(chatId), text, keyboard);
}

/**
 * Commande /search - Rechercher des avis
 */
async function handleSearchPrompt(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    await bot.sendMessage(chatId, "❌ Vous n'êtes pas connecté.");
    return;
  }

  setUserContext(chatId, msg.from?.id, "search_reviews");
  await bot.sendMessage(
    chatId,
    'Tapez votre recherche (ex: "qualité du service").',
  );
}

async function handleSearch(
  msg: TelegramMessage,
  match: RegExpExecArray | null,
) {
  if (!bot || !match) return;

  const chatId = msg.chat.id;
  const query = match[1]?.trim();
  await searchReviewsForChat(chatId, query);
}

async function searchReviewsForChat(chatId: number, query: string) {
  if (!bot) return;

  const dbUser = await findUserByTelegram(chatId);

  if (!dbUser) {
    await bot.sendMessage(chatId, "❌ Vous n'êtes pas connecté.");
    return;
  }

  if (!query) {
    setUserContext(chatId, undefined, "search_reviews");
    await bot.sendMessage(
      chatId,
      'Tapez votre recherche (ex: "qualité du service").',
    );
    return;
  }

  try {
    const results = await searchReviewsSemantically(
      String(dbUser.company),
      query,
      1,
      5,
    );

    if (!results || results.documents.length === 0) {
      await bot?.sendMessage(chatId, `❌ Aucun avis trouvé pour "${query}".`);
      return;
    }

    let text = `<b>🔍 Résultats pour "${query}"</b>\n\n`;
    text += results.documents
      .map(
        (result: any, i: number) =>
          `${i + 1}. <b>${result.rating}/5</b>\n${(result.serviceFeedback || "Sans commentaire").slice(0, 100)}...`,
      )
      .join("\n\n");

    await bot?.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[telegram:search:error]", error);
    await bot?.sendMessage(
      chatId,
      "❌ Une erreur est survenue lors de la recherche.",
    );
  }
}

/**
 * Commande /qr - Créer un QR code avec un nom
 */
async function handleQrCommand(
  msg: TelegramMessage,
  match: RegExpExecArray | null,
) {
  if (!bot || !match) return;

  // handleCreateQrFromMessage s'attend à ce que msg.text soit "qr NOM" ou "/qr NOM"
  // On modifie msg.text temporairement pour qu'il corresponde au format attendu
  const originalText = msg.text;
  msg.text = `qr ${match[1]}`;

  await handleCreateQrFromMessage(msg);

  msg.text = originalText;
}

/**
 * Gestion des messages par défaut
 */
async function handleDefaultMessage(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const text = msg.text || "";

  // Ignore les commandes
  if (text.startsWith("/")) return;

  // Vérifier le contexte utilisateur
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
    await bot.sendMessage(
      chatId,
      "Merci. Tapez maintenant le libelle du QR code, par exemple: Mon restaurant.",
    );
    return;
  }

  if (userContext?.state === "guest_create_label") {
    const qrName = text.trim();
    if (qrName.length < 2) {
      await bot.sendMessage(chatId, "Tapez un libelle plus precis pour le QR code.");
      return;
    }

    clearUserContext(chatId, msg.from?.id);
    await createGuestQrCode(chatId, userContext.email || "", qrName);
    return;
  }

  // Si l'utilisateur est en train de créer un QR code, créer avec ce texte
  if (userContext?.state === "creating_qr") {
    clearUserContext(chatId, msg.from?.id); // Réinitialiser le contexte
    msg.text = `qr ${text}`; // Ajouter le préfixe pour la compatibilité
    await handleCreateQrFromMessage(msg);
    return;
  }

  if (userContext?.state === "search_reviews") {
    clearUserContext(chatId, msg.from?.id);
    await searchReviewsForChat(chatId, text.trim());
    return;
  }

  // Si c'est une tentative de créer un QR code via message
  if (text.startsWith("qr ") || text.startsWith("QR ")) {
    await handleCreateQrFromMessage(msg);
    return;
  }

  // Message générique
  await bot.sendMessage(
    chatId,
    "Je n'ai pas compris votre demande. Tapez /help pour voir les commandes disponibles.",
  );
}

/**
 * Gestion des callback queries (boutons)
 */
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
        `L'interface web est configurée en local (${env.frontendUrl}). Telegram n'autorise pas les boutons vers localhost. Ouvrez QrFeedback dans votre navigateur, ou configurez FRONTEND_URL avec une URL publique HTTPS.`,
      );
      await answerCallbackQuery(query.id);
      return;
    }

    // Les callbacks guest ne nécessitent pas de connexion
    if (data === "guest_create_qr") {
      setUserContext(chatId, query.from.id, "guest_create_email");
      await bot.sendMessage(
        chatId,
        "Pour creer votre QR code, tapez votre adresse email.",
      );
      await answerCallbackQuery(query.id);
      return;
    }

    // Pour les autres callbacks, vérifier la connexion
    const dbUser = await findUserByTelegram(chatId);

    if (!dbUser) {
      if (data === "create_qr") {
        setUserContext(chatId, query.from.id, "guest_create_email");
        await bot.sendMessage(
          chatId,
          "Pour creer votre QR code, tapez votre adresse email.",
        );
        await answerCallbackQuery(query.id);
        return;
      }

      if (
        data === "connect_telegram_" ||
        data.startsWith("connect_telegram_")
      ) {
        // Permettre le callback de connexion même sans compte
        await handleConnectTelegramCallback(chatId, messageId, data);
        await answerCallbackQuery(query.id);
        return;
      }

      await answerCallbackQuery(
        query.id,
        "Vous devez être connecté pour cette action",
        true,
      );
      return;
    }

    // Routing des callbacks pour utilisateurs connectés
    if (data === "main_menu") {
      await handleMainMenu(chatId, messageId, dbUser._id);
    } else if (data === "create_qr") {
      await handleCreateQrCallback(chatId, messageId, dbUser._id, query.from.id);
    } else if (data === "my_qr_codes") {
      await handleMyQrCodesCallback(chatId, messageId, dbUser._id);
    } else if (data === "my_reviews") {
      await handleReviewsCallback(chatId, messageId, dbUser._id);
    } else if (data === "dashboard_stats") {
      await sendStatsForChat(chatId, messageId);
    } else if (data === "ai_overview") {
      await sendAiOverviewForChat(chatId, messageId);
    } else if (data === "search_reviews") {
      await handleSearchCallback(chatId, messageId, query.from.id);
    } else if (data === "settings") {
      await handleSettingsCallback(chatId, messageId, dbUser._id);
    } else if (data.startsWith("set_channel_")) {
      await handleSetChannelCallback(chatId, messageId, dbUser._id, data);
    } else if (data.startsWith("qr_detail_")) {
      await handleQrDetailCallback(
        chatId,
        messageId,
        data.replace("qr_detail_", ""),
      );
    } else if (data.startsWith("copy_link_")) {
      await handleCopyLinkCallback(
        chatId,
        data.replace("copy_link_", ""),
      );
    } else if (data.startsWith("review_detail_")) {
      await handleReviewDetailCallback(
        chatId,
        messageId,
        data.replace("review_detail_", ""),
      );
    }

    await answerCallbackQuery(query.id);
  } catch (error) {
    console.error("[telegram:callback:error]", error);
    await answerCallbackQuery(query.id, "Une erreur est survenue", true);
  }
}

/**
 * Fonctions de callback
 */
async function handleMainMenu(
  chatId: number,
  messageId: number,
  userId: Types.ObjectId,
) {
  if (!bot) return;

  const keyboard = [
    [{ text: "➕ Créer un QR code", callback_data: "create_qr" }],
    [{ text: "📋 Mes QR codes", callback_data: "my_qr_codes" }],
    [{ text: "⭐ Mes avis", callback_data: "my_reviews" }],
    [{ text: "📊 Statistiques", callback_data: "dashboard_stats" }],
    [{ text: "🤖 Analyse IA", callback_data: "ai_overview" }],
    [{ text: "🔍 Rechercher", callback_data: "search_reviews" }],
    [frontendButton("🌐 Ouvrir le dashboard", "/dashboard")],
    [frontendButton("⚙️ Réglages web", "/settings")],
    [{ text: "🔔 Notifications", callback_data: "settings" }],
  ];

  await editTelegramMessage(
    String(chatId),
    messageId,
    "<b>📱 Menu principal</b>\n\nQue souhaitez-vous faire ?",
    keyboard,
  );
}

async function handleCreateQrCallback(
  chatId: number,
  messageId: number,
  userId: Types.ObjectId,
  telegramUserId?: number,
) {
  if (!bot) return;

  // Marquer que l'utilisateur est en mode création de QR code
  setUserContext(chatId, telegramUserId, "creating_qr");

  const text = `<b>➕ Créer un QR code</b>\n\nTapez le nom de votre service ou produit.\n\nPar exemple: <code>Mon Restaurant</code>`;

  await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
}

async function handleMyQrCodesCallback(
  chatId: number,
  messageId: number,
  userId: Types.ObjectId,
) {
  if (!bot) return;

  const dbUser = await User.findById(userId).populate("company");
  if (!dbUser) return;

  const qrCodes = await CompanyQrCode.find({ company: dbUser.company }).limit(
    10,
  );

  if (qrCodes.length === 0) {
    await bot.sendMessage(chatId, "📭 Vous n'avez pas encore de QR code.");
    return;
  }

  let text = "<b>📋 Mes QR codes</b>\n\n";
  text += qrCodes
    .map((qr, i) => `${i + 1}. <b>${qr.label || "QR Code"}</b>`)
    .join("\n");

  const keyboard = qrCodes.map((qr) => [
    {
      text: qr.label || "QR Code",
      callback_data: `qr_detail_${qr._id}`,
    },
  ]);

  await editTelegramMessage(String(chatId), messageId, text, keyboard);
}

async function handleReviewsCallback(
  chatId: number,
  messageId: number,
  userId: Types.ObjectId,
) {
  if (!bot) return;

  const dbUser = await User.findById(userId).populate("company");
  if (!dbUser) return;

  const reviews = await Review.find({ company: dbUser.company })
    .populate("qrCode", "label slug")
    .sort({ createdAt: -1 })
    .limit(10);

  if (reviews.length === 0) {
    await bot.sendMessage(chatId, "📭 Vous n'avez pas d'avis.");
    return;
  }

  let text = "<b>⭐ Mes avis</b>\n\n";
  text += reviews.map((review, i) => formatReviewSummary(review, i)).join("\n\n");

  await editTelegramMessage(String(chatId), messageId, text, [
    [{ text: "🔙 Retour", callback_data: "main_menu" }],
  ]);
}

async function handleSearchCallback(
  chatId: number,
  messageId: number,
  telegramUserId?: number,
) {
  if (!bot) return;

  setUserContext(chatId, telegramUserId, "search_reviews");
  await bot.sendMessage(
    chatId,
    'Tapez votre recherche (ex: "qualité du service").',
  );
}

async function handleSettingsCallback(
  chatId: number,
  messageId: number,
  userId: Types.ObjectId,
) {
  if (!bot) return;

  const dbUser = await User.findById(userId);
  if (!dbUser) return;

  const prefs = dbUser.notificationPreferences;
  const preferredChannel = prefs?.preferredChannel || "email";

  const text = `<b>⚙️ Vos paramètres</b>

<b>Canal de notification préféré:</b>
${preferredChannel === "email" ? "📧" : "  "} Email
${preferredChannel === "telegram" ? "📱" : "  "} Telegram`;

  const keyboard = [
    [{ text: "📧 Définir Email", callback_data: "set_channel_email" }],
    [{ text: "📱 Définir Telegram", callback_data: "set_channel_telegram" }],
    [{ text: "🔙 Retour", callback_data: "main_menu" }],
  ];

  await editTelegramMessage(String(chatId), messageId, text, keyboard);
}

async function handleSetChannelCallback(
  chatId: number,
  messageId: number,
  userId: Types.ObjectId,
  data: string,
) {
  if (!bot) return;

  const channel = data.replace("set_channel_", "") as
    | "email"
    | "whatsapp"
    | "telegram";

  await User.findByIdAndUpdate(userId, {
    "notificationPreferences.preferredChannel": channel,
  });

  await bot.sendMessage(
    chatId,
    `✅ Canal de notification changé en ${channel}`,
  );
  await handleSettingsCallback(chatId, messageId, userId);
}

/**
 * Callback pour les guests voulant créer un QR code
 */
async function handleGuestCreateQrCallback(
  chatId: number,
  messageId: number,
  telegramUserId?: number,
) {
  if (!bot) return;

  const text = `<b>➕ Créer un QR code</b>\n\nVeuillez créer votre QR code depuis le site avec votre email et le nom de votre entreprise.\n\nAprès connexion, vous pourrez lier Telegram dans les paramètres pour recevoir les notifications instantanées.`;

  await sendTelegramKeyboard(String(chatId), text, [
    [frontendButton("Créer mon QR code")],
    [frontendButton("Se connecter", "/login?redirect=/settings")],
  ]);
}

/**
 * Callback pour la connexion Telegram
 */
async function handleConnectTelegramCallback(
  chatId: number,
  messageId: number,
  data: string,
) {
  if (!bot) return;

  const text = `<b>🌐 Se connecter à QrFeedback</b>\n\nConnectez-vous puis ouvrez Paramètres → Notifications pour lier Telegram.`;

  await sendTelegramKeyboard(String(chatId), text, [
    [frontendButton("Se connecter", "/login?redirect=/settings")],
  ]);
}

async function handleQrDetailCallback(
  chatId: number,
  messageId: number,
  qrId: string,
) {
  if (!bot) return;

  const qr = await CompanyQrCode.findById(qrId);
  if (!qr) {
    await bot.sendMessage(chatId, "❌ QR code introuvable.");
    return;
  }

  const reviewCount = await Review.countDocuments({ qrCode: qr._id });

  const text = `<b>${qr.label || "QR Code"}</b>\n\nAvis: ${reviewCount}\nLien: <code>${qr.feedbackUrl}</code>`;

  await editTelegramMessage(String(chatId), messageId, text, [
    [{ text: "📋 Copier le lien", callback_data: `copy_link_${qrId}` }],
    [{ text: "🔙 Retour", callback_data: "my_qr_codes" }],
  ]);
}

async function handleCopyLinkCallback(chatId: number, qrId: string) {
  if (!bot) return;

  const qr = await CompanyQrCode.findById(qrId);
  if (!qr) {
    await bot.sendMessage(chatId, "❌ QR code introuvable.");
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

  const review = await Review.findById(reviewId).populate(
    "qrCode",
    "label slug feedbackUrl",
  );
  if (!review) {
    await bot.sendMessage(chatId, "❌ Avis introuvable.");
    return;
  }

  let text = `<b>Avis détaillé</b>\n\n`;
  text += `QR: <b>${escapeHtml(getReviewQrLabel(review))}</b>\n`;
  text += `Note: <b>${review.rating}/5</b>\n`;
  text += `Date: ${formatReviewDate(review.createdAt)}\n`;
  if (review.serviceFeedback) {
    text += `Commentaire: ${escapeHtml(review.serviceFeedback)}\n`;
  }

  const answers = formatReviewExtraAnswers(review, 10);
  if (answers) {
    text += `\n<b>Reponses:</b>\n${answers}`;
  }

  await editTelegramMessage(String(chatId), messageId, text, [
    [{ text: "🔙 Retour", callback_data: "my_reviews" }],
  ]);
}

async function handleCreateQrFromMessage(msg: TelegramMessage) {
  if (!bot) return;

  const chatId = msg.chat.id;
  const qrName =
    msg.text?.replace(/^(qr|\/qr)\s+/i, "").trim() || "Mon QR Code";

  try {
    // Chercher l'utilisateur (s'il est connecté)
    let dbUser = await findUserByTelegram(chatId);
    let company: any = null;

    if (!dbUser) {
      setUserContext(chatId, msg.from?.id, "guest_create_email", { qrName });
      await bot.sendMessage(
        chatId,
        `Pour creer le QR code "${qrName}", tapez votre adresse email.`,
      );
      return;
    }

    if (!dbUser) {
      await sendTelegramKeyboard(
        String(chatId),
        "Pour créer un QR code sans compte connecté, utilisez le site avec votre email et le nom de votre entreprise.",
        [[frontendButton("Créer mon QR code")]],
      );
      return;
    }

    if (dbUser && dbUser.company) {
      company = await Company.findById(dbUser.company);
    }

    if (!company) {
      await bot.sendMessage(
        chatId,
        "❌ Erreur: impossible de créer le QR code.",
      );
      return;
    }

    // Créer le QR code
    const slug = createSlug(`${company.name}-${qrName}-${chatId}`);
    const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
    const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);
    const qrCode = new CompanyQrCode({
      label: qrName,
      company: company._id,
      slug,
      feedbackUrl,
      qrCodeDataUrl,
    });

    await qrCode.save();

    const qrImageBase64 = qrCodeDataUrl.split(",")[1] || qrCodeDataUrl;

    await bot?.sendPhoto(chatId, Buffer.from(qrImageBase64, "base64"), {
      caption: `✅ QR code créé: <b>${qrName}</b>\n\n📱 Lien de feedback:\n<code>${qrCode.feedbackUrl}</code>`,
      parse_mode: "HTML",
    });
  } catch (error) {
    console.error("[telegram:create_qr:error]", error);
    await bot?.sendMessage(chatId, "❌ Erreur lors de la création du QR code.");
  }
}

/**
 * Utilitaire pour trouver un utilisateur par Telegram
 */
async function findUserByTelegram(chatId: number) {
  return User.findOne({ "telegramProfile.chatId": String(chatId) });
}

/**
 * Connecter un utilisateur existant avec Telegram
 */
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
    await bot.sendMessage(
      chatId,
      `✅ Connecté en tant que <b>${user?.email}</b>\n\nVotre compte est maintenant lié à Telegram!`,
      { parse_mode: "HTML" },
    );
  }

  return user;
}

export { bot };
