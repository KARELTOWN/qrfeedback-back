import type { Request, Response } from 'express';
import { handleWhatsappMessageStatus } from '../services/review.service.js';
import { readFileSecret } from '../services/fileSecret.service.js';

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<{
          id?: string;
          status?: string;
          errors?: Array<{
            code?: number;
            title?: string;
            message?: string;
            error_data?: { details?: string };
          }>;
        }>;
      };
    }>;
  }>;
};

export async function verifyWebhook(req: Request, res: Response) {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const verifyToken = await readFileSecret('whatsappWebhookVerifyToken');

  if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
    console.info('[whatsapp:webhook:verify:success]', { mode });
    res.status(200).send(challenge);
    return;
  }

  console.warn('[whatsapp:webhook:verify:failed]', {
    mode,
    hasToken: Boolean(token),
    hasVerifyToken: Boolean(verifyToken),
  });
  res.sendStatus(403);
}

export async function handleStatus(req: Request, res: Response) {
  const payload = req.body as WhatsAppWebhookPayload;
  const statuses = payload.entry
    ?.flatMap((entry) => entry.changes || [])
    .flatMap((change) => change.value?.statuses || []) || [];

  console.info('[whatsapp:webhook:received]', {
    entries: payload.entry?.length || 0,
    statuses: statuses.length,
  });

  const results = await Promise.all(
    statuses
      .filter((status) => status.id && status.status)
      .map((status) => {
        const firstError = status.errors?.[0];
        return handleWhatsappMessageStatus({
          messageId: String(status.id),
          status: String(status.status),
          errorCode: firstError?.code,
          errorMessage: firstError?.message || firstError?.error_data?.details || firstError?.title,
        });
      }),
  );

  res.json({
    ok: true,
    handled: results.filter((result) => result.handled).length,
  });
}
