import dotenv from 'dotenv';

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  backendUrl: process.env.BACKEND_URL || '',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/qr_feedback',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  freeWhatsappMessages: Number(process.env.FREE_WHATSAPP_MESSAGES || 20),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || 'QR Feedback <no-reply@example.com>'
  },
  whatsappCloud: {
    apiBaseUrl: process.env.WHATSAPP_CLOUD_API_BASE_URL || 'https://graph.facebook.com',
    graphApiVersion: process.env.WHATSAPP_CLOUD_API_VERSION || 'v23.0',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    reviewTemplateName: process.env.WHATSAPP_REVIEW_TEMPLATE_NAME || '',
    reviewTemplateLanguageCode: process.env.WHATSAPP_REVIEW_TEMPLATE_LANGUAGE_CODE || 'fr'
  },
  monero: {
    walletAddress: process.env.MONERO_WALLET_ADDRESS || '',
    network: process.env.MONERO_NETWORK || 'mainnet'
  },
  moneroo: {
    apiUrl: process.env.MONEROO_API_URL || 'https://api.moneroo.io',
    currency: process.env.MONEROO_CURRENCY || 'XOF',
    secretKey: process.env.MONEROO_SECRET_KEY || ''
  },
  turnstile: {
    secretKey: process.env.TURNSTILE_SECRET_KEY || ''
  },
  paymentConfirmSecret: process.env.PAYMENT_CONFIRM_SECRET || '',
  encryption: {
    masterKey: process.env.ENCRYPTION_MASTER_KEY || ''
  }
};
