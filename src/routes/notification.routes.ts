import express from "express";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  getTelegramProfile,
  getTelegramLink,
  disconnectTelegram,
} from "../controllers/notification.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// Obtenir les préférences de notification
router.get("/preferences", getNotificationPreferences);

// Mettre à jour les préférences de notification
router.put("/preferences", updateNotificationPreferences);

// Obtenir le profil Telegram
router.get("/telegram-profile", getTelegramProfile);
router.get("/telegram-link", getTelegramLink);

// Déconnecter Telegram
router.post("/telegram-disconnect", disconnectTelegram);

export default router;
