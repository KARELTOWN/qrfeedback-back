import type { Request, Response } from "express";
import {
  connectUserToTelegram,
  processTelegramUpdate,
} from "../services/telegramBot.service.js";
import type { Types } from "mongoose";

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number; type: string };
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    chat_instance: string;
    data: string;
    message?: {
      message_id: number;
      date: number;
      chat: { id: number };
    };
  };
};

export async function handleTelegramWebhook(req: Request, res: Response) {
  try {
    const update = req.body as TelegramUpdate;

    console.info("[telegram:webhook:received]", {
      updateId: update.update_id,
      hasMessage: Boolean(update.message),
      hasCallback: Boolean(update.callback_query),
    });

    processTelegramUpdate(update);

    res.json({ ok: true });
  } catch (error) {
    console.error("[telegram:webhook:error]", error);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

export async function connectTelegramAccount(req: Request, res: Response) {
  try {
    const { userId, chatId, username, firstName, lastName } = req.body as {
      userId: string;
      chatId: number;
      username?: string;
      firstName?: string;
      lastName?: string;
    };

    if (!userId || !chatId) {
      res.status(400).json({ error: "Missing userId or chatId" });
      return;
    }

    const user = await connectUserToTelegram(
      userId as unknown as Types.ObjectId,
      chatId,
      username,
      firstName,
      lastName,
    );

    res.json({
      ok: true,
      user: {
        id: user?._id,
        email: user?.email,
        telegramConnected: Boolean(user?.telegramProfile?.isActive),
      },
    });
  } catch (error) {
    console.error("[telegram:connect:error]", error);
    res
      .status(500)
      .json({ ok: false, error: "Failed to connect Telegram account" });
  }
}
