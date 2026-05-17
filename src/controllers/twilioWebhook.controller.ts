import type { Request, Response } from "express";
import { handleTwilioMessageStatus } from "../services/review.service.js";

export async function handleStatus(req: Request, res: Response) {
  try {
    const status = String(req.body.MessageStatus || req.body.SmsStatus || "");

    const result = await handleTwilioMessageStatus({
      messageSid: String(req.body.MessageSid),
      status,
      errorCode: req.body.ErrorCode ? String(req.body.ErrorCode) : undefined,
      errorMessage: req.body.ErrorMessage
        ? String(req.body.ErrorMessage)
        : undefined,
    });
    console.log("Status changed", result);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Handle twilio msg status", error);
  }
}
