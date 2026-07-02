import type { Request, Response, NextFunction } from "express";
import { User } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { createTelegramLinkUrl } from "../services/telegramBot.service.js";

type AuthenticatedRequest = Request & {
  user?: any;
};

type UpdatePreferencesInput = {
  channels?: {
    email?: boolean;
    telegram?: boolean;
  };
};

function defaultPreferences() {
  return {
    channels: {
      email: true,
      telegram: false,
    },
  };
}

export async function getNotificationPreferences(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?._id;
    if (!userId) throw new HttpError(401, "Unauthorized");

    const user = await User.findById(userId).select("notificationPreferences");

    res.json({
      ok: true,
      preferences: user?.notificationPreferences || defaultPreferences(),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to get preferences" });
  }
}

export async function updateNotificationPreferences(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?._id;
    if (!userId) throw new HttpError(401, "Unauthorized");

    const { channels } = req.body as UpdatePreferencesInput;
    const updateData: Record<string, unknown> = {};

    if (channels) {
      updateData["notificationPreferences"] = {
        channels: {
          email: channels.email ?? true,
          telegram: channels.telegram ?? false,
        },
      };
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { ...updateData },
      { new: true },
    ).select("notificationPreferences");

    res.json({
      ok: true,
      preferences: user?.notificationPreferences,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to update preferences" });
  }
}

export async function getTelegramProfile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?._id;
    if (!userId) throw new HttpError(401, "Unauthorized");

    const user = await User.findById(userId).select("telegramProfile");

    res.json({
      ok: true,
      telegramProfile: user?.telegramProfile || null,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to get Telegram profile" });
  }
}

export async function getTelegramLink(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?._id;
    if (!userId) throw new HttpError(401, "Unauthorized");

    res.json({
      ok: true,
      url: await createTelegramLinkUrl(userId),
      expiresInSeconds: 600,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to create Telegram link" });
  }
}

export async function disconnectTelegram(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?._id;
    if (!userId) throw new HttpError(401, "Unauthorized");

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          "telegramProfile.isActive": false,
          "notificationPreferences.channels.telegram": false,
        },
      },
      { new: true },
    );

    res.json({
      ok: true,
      message: "Telegram disconnected",
      telegramProfile: user?.telegramProfile,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to disconnect Telegram" });
  }
}
