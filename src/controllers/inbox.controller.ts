import type { Request, Response } from 'express';
import {
  getInboxConversationMessages,
  listInboxConversations,
  sendInboxWhatsappMessage
} from '../services/inbox.service.js';

export async function listConversations(req: Request, res: Response) {
  const conversations = await listInboxConversations(req.company);
  res.json({ conversations });
}

export async function getMessages(req: Request, res: Response) {
  const result = await getInboxConversationMessages(req.company, String(req.params.id));
  res.json(result);
}

export async function sendMessage(req: Request, res: Response) {
  const result = await sendInboxWhatsappMessage({
    company: req.company,
    conversationId: String(req.params.id),
    body: String(req.body.body || '')
  });

  res.status(201).json(result);
}
