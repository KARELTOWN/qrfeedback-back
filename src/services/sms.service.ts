import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export type SmsResult =
  | { success: true; messageId?: string }
  | { success: false; error: string };

/**
 * Sends an SMS via the FasterMessage API.
 * The sender ID displayed to the recipient is configured per-client directly
 * on the FasterMessage platform — no parameter needed here.
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const { apiKey, baseUrl } = env.fasterMessage;

  if (!apiKey) {
    logger.warn("sms:skipped", { reason: "FASTERMESSAGE_API_KEY non configurée", to });
    return { success: false, error: "FASTERMESSAGE_API_KEY non configurée" };
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/sms/send`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ to, message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("sms:network-error", { to, error: msg });
    return { success: false, error: msg };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error("sms:http-error", { to, status: response.status, body: body.slice(0, 300) });
    return { success: false, error: `HTTP ${response.status}: ${body.slice(0, 120)}` };
  }

  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  const messageId = String(json.messageId ?? json.message_id ?? json.id ?? "");

  logger.info("sms:sent", { to, messageId });
  return { success: true, messageId: messageId || undefined };
}
