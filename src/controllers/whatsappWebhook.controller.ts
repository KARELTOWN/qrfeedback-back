import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { processWhatsappWebhookPayload } from '../services/whatsappWebhook.service.js';

export async function verifyWebhook(req: Request, res: Response) {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');

  if (mode === 'subscribe' && token && token === env.whatsappCloud.webhookVerifyToken) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
}

export async function handleWebhook(req: Request, res: Response) {
  const result = await processWhatsappWebhookPayload(req.body);
  res.json({ ok: true, ...result });
}
