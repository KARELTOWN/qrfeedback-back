import express from "express";
import { handleTelegramWebhook } from "../controllers/telegramWebhook.controller.js";

const router = express.Router();

// Webhook pour recevoir les mises à jour Telegram (authentifié via secret_token, voir le controller)
router.post("/webhook", handleTelegramWebhook);

export default router;
