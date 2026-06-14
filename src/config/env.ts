import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  backendUrl: process.env.BACKEND_URL || "",
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/qr_feedback",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret",
  freeWhatsappMessages: Number(process.env.FREE_WHATSAPP_MESSAGES || 50),
  freeEmailNotifications: Number(process.env.FREE_EMAIL_NOTIFICATIONS || 300),
  otpRequestLimit: Number(process.env.OTP_REQUEST_LIMIT || 3),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || "QR Feedback <no-reply@example.com>",
  },
  whatsapp: {
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || "v25.0",
    reviewTemplateName:
      process.env.WHATSAPP_REVIEW_TEMPLATE_NAME || "nouvel_avis_client",
    reviewTemplateLanguage:
      process.env.WHATSAPP_REVIEW_TEMPLATE_LANGUAGE || "fr",
  },
  kkiapay: {
    apiUrl: process.env.KKIAPAY_API_URL || "https://api.kkiapay.me",
    publicKey: process.env.KKIAPAY_PUBLIC_KEY || "",
    privateKey: process.env.KKIAPAY_PRIVATE_KEY || "",
    secretKey: process.env.KKIAPAY_SECRET_KEY || "",
    sandbox: process.env.KKIAPAY_SANDBOX === "true",
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
    webAppUrl: process.env.TELEGRAM_WEBAPP_URL || "",
  },
  paymentConfirmSecret: process.env.PAYMENT_CONFIRM_SECRET || "",
  encryption: {
    masterKey: process.env.ENCRYPTION_MASTER_KEY || "",
  },
};
