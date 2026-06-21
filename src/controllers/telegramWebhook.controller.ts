import type { Request, Response } from "express";
import { processTelegramUpdate } from "../services/telegramBot.service.js";
import { env } from "../config/env.js";
import { readFileSecret } from "../services/fileSecret.service.js";

let warnedMissingSecret = false;
let warnedInvalidSecret = false;
const TELEGRAM_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

async function getWebhookSecret() {
  const secret = env.telegram.webhookSecret || (await readFileSecret("telegramWebhookSecret"));
  if (secret && !TELEGRAM_SECRET_PATTERN.test(secret) && !warnedInvalidSecret) {
    warnedInvalidSecret = true;
    console.warn(
      "[telegram:webhook:invalid-secret] The stored secret contains characters Telegram's secret_token rejects (only A-Z, a-z, 0-9, _, - are allowed) — setWebhook would never have accepted it, so no real Telegram request can match. Regenerate it (npm run telegram:setup).",
    );
  }
  return secret;
}

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
    const expectedSecret = await getWebhookSecret();

    if (expectedSecret) {
      const providedSecret = req.headers["x-telegram-bot-api-secret-token"];
      if (providedSecret !== expectedSecret) {
        console.warn("[telegram:webhook:rejected]", { reason: "secret_token_mismatch" });
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
    } else if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn(
        "[telegram:webhook:unprotected] No TELEGRAM_WEBHOOK_SECRET configured — anyone can forge updates to this endpoint. Set TELEGRAM_WEBHOOK_SECRET and re-run the telegram:setup script.",
      );
    }

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
