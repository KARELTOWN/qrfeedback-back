import express from "express";
import {
  handleTelegramWebhook,
  connectTelegramAccount,
} from "../controllers/telegramWebhook.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Webhook pour recevoir les mises à jour Telegram
router.post("/webhook", handleTelegramWebhook);

// Connecter un compte utilisateur à Telegram (protégé)
router.post("/connect", requireAuth, connectTelegramAccount);

export default router;
