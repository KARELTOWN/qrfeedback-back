import { env } from "../config/env.js";
import { readFileSecret } from "./fileSecret.service.js";

type SendTelegramInput = {
  chatId: string;
  message: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  disableWebPagePreview?: boolean;
  keyboard?: Array<
    Array<{ text: string; callback_data?: string; url?: string; web_app?: { url: string } }>
  >;
};

type TelegramResponse = {
  ok: boolean;
  result?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    date: number;
  };
  error_code?: number;
  description?: string;
};

type SendTelegramMediaInput = {
  chatId: string;
  type: "image" | "video" | "audio";
  url: string;
  caption?: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
};

async function getBotToken() {
  const token = env.telegram.botToken;
  if (token) return token;
  return await readFileSecret("telegramBotToken");
}

export async function sendTelegram({
  chatId,
  message,
  parseMode = "HTML",
  disableWebPagePreview = true,
  keyboard,
}: SendTelegramInput) {
  const botToken = await getBotToken();

  const logContext = {
    provider: "telegram_bot_api",
    chatId: chatId.slice(-4),
    messageLength: message.length,
    hasBotToken: Boolean(botToken),
  };

  if (!botToken) {
    console.warn("[telegram:send:mock]", logContext);
    return { messageId: "mock", ok: true };
  }

  console.info("[telegram:send:start]", logContext);

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: message,
    parse_mode: parseMode,
    disable_web_page_preview: disableWebPagePreview,
  };

  if (keyboard) {
    payload.reply_markup = {
      inline_keyboard: keyboard,
    };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const data = (await response.json()) as TelegramResponse;

  if (!data.ok) {
    console.error("[telegram:send:error]", {
      ...logContext,
      errorCode: data.error_code,
      errorMessage: data.description,
    });
    throw new Error(`Telegram error: ${data.description}`);
  }

  console.info("[telegram:send:success]", {
    ...logContext,
    messageId: data.result?.message_id,
  });

  return {
    messageId: data.result?.message_id || "unknown",
    ok: true,
  };
}

export async function sendTelegramKeyboard(
  chatId: string,
  message: string,
  keyboard: Array<
    Array<{ text: string; callback_data?: string; url?: string; web_app?: { url: string } }>
  >,
  parseMode: "HTML" | "Markdown" = "HTML",
) {
  const botToken = await getBotToken();

  if (!botToken) {
    console.warn("[telegram:send-keyboard:mock]", { chatId });
    return { messageId: "mock", ok: true };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode,
        reply_markup: {
          inline_keyboard: keyboard,
        },
      }),
    },
  );

  const data = (await response.json()) as TelegramResponse;
  if (!data.ok) {
    throw new Error(`Telegram error: ${data.description}`);
  }

  return {
    messageId: data.result?.message_id,
    ok: true,
  };
}

export async function sendTelegramMedia({
  chatId,
  type,
  url,
  caption,
  parseMode = "HTML",
}: SendTelegramMediaInput) {
  const botToken = await getBotToken();

  const methodByType = {
    image: "sendPhoto",
    video: "sendVideo",
    audio: "sendAudio",
  } as const;
  const fieldByType = {
    image: "photo",
    video: "video",
    audio: "audio",
  } as const;

  if (!botToken) {
    console.warn("[telegram:send-media:mock]", {
      chatId: chatId.slice(-4),
      type,
      hasUrl: Boolean(url),
    });
    return { messageId: "mock", ok: true };
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    [fieldByType[type]]: url,
    parse_mode: parseMode,
  };

  if (caption) {
    payload.caption = caption.slice(0, 1024);
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${methodByType[type]}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const data = (await response.json()) as TelegramResponse;
  if (!data.ok) {
    throw new Error(`Telegram error: ${data.description}`);
  }

  return {
    messageId: data.result?.message_id || "unknown",
    ok: true,
  };
}

export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  message: string,
  keyboard?: Array<
    Array<{ text: string; callback_data?: string; url?: string }>
  >,
) {
  const botToken = await getBotToken();

  if (!botToken) {
    return { ok: true };
  }

  const payload: any = {
    chat_id: chatId,
    message_id: messageId,
    text: message,
    parse_mode: "HTML",
  };

  if (keyboard) {
    payload.reply_markup = {
      inline_keyboard: keyboard,
    };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/editMessageText`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const data = (await response.json()) as TelegramResponse;
  if (!data.ok) {
    console.warn("[telegram:edit-message:error]", data.description);
  }

  return { ok: data.ok };
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
) {
  const botToken = await getBotToken();

  if (!botToken) return { ok: true };

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    },
  );

  const data = (await response.json()) as TelegramResponse;
  return { ok: data.ok };
}

export async function deleteTelegramMessage(chatId: string, messageId: number) {
  const botToken = await getBotToken();

  if (!botToken) return { ok: true };

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/deleteMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
      }),
    },
  );

  const data = (await response.json()) as TelegramResponse;
  return { ok: data.ok };
}
