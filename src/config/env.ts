import dotenv from "dotenv";

dotenv.config();

function splitCsv(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || "development";
const jwtSecret = process.env.JWT_SECRET || "dev-only-secret";

if (nodeEnv === "production" && jwtSecret === "dev-only-secret") {
  throw new Error("JWT_SECRET must be configured in production.");
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT || 4000),
  backendUrl: process.env.BACKEND_URL || "",
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/qr_feedback",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  corsOrigins: splitCsv(process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173"),
  jwtSecret,
  freeEmailNotifications: Number(process.env.FREE_EMAIL_NOTIFICATIONS || 300),
  otpRequestLimit: Number(process.env.OTP_REQUEST_LIMIT || 3),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  rateLimitTimeZone: process.env.RATE_LIMIT_TIME_ZONE || 'Africa/Lagos',
  weeklyRecommendationLimit: Number(process.env.WEEKLY_RECOMMENDATION_LIMIT || 7),
  openaiRecommendationsModel: process.env.OPENAI_RECOMMENDATIONS_MODEL || 'gpt-4.1-mini',
  openaiRecommendationsLanguage: process.env.OPENAI_RECOMMENDATIONS_LANGUAGE || 'français',
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || "QR Feedback <no-reply@example.com>",
  },
  turnstile: {
    secretKey: process.env.TURNSTILE_SECRET_KEY || "",
  },
  typesense: {
    host: process.env.TYPESENSE_HOST || "localhost",
    port: Number(process.env.TYPESENSE_PORT || 8108),
    protocol: process.env.TYPESENSE_PROTOCOL || "http",
    apiKey: process.env.TYPESENSE_API_KEY || "",
    embeddingModel:
      process.env.TYPESENSE_EMBEDDING_MODEL || "ts/all-MiniLM-L12-v2",
    vectorDistanceThreshold: Number(
      process.env.TYPESENSE_VECTOR_DISTANCE_THRESHOLD || 0.45,
    ),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    botUsername: process.env.TELEGRAM_BOT_USERNAME || "QrFeedback_Bot",
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    webAppUrl: process.env.TELEGRAM_WEBAPP_URL || "",
    authMaxAgeSeconds: Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || 3600),
  },
  encryption: {
    masterKey: process.env.ENCRYPTION_MASTER_KEY || "",
  },
  fasterMessage: {
    apiKey: process.env.FASTERMESSAGE_API_KEY || "",
    baseUrl: process.env.FASTERMESSAGE_BASE_URL || "https://api.fastermessage.com",
    senderId: process.env.FASTERMESSAGE_SENDER_ID || "QrFeedback",
  },
};
