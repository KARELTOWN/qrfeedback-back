import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { InboxConversation } from '../models/InboxConversation.js';
import { HttpError } from '../utils/httpError.js';
import { sendWhatsapp } from './whatsapp.service.js';

export async function listInboxConversations(company: HydratedDocument<ICompany>) {
  return InboxConversation.find({ company: company._id })
    .populate('contact', 'firstName lastName whatsapp whatsappNormalized phone email')
    .populate('assignee', 'email roleId')
    .sort({ lastMessageAt: -1, updatedAt: -1 });
}

export async function getInboxConversationMessages(company: HydratedDocument<ICompany>, conversationId: string) {
  const conversation = await InboxConversation.findOne({ _id: conversationId, company: company._id });
  if (!conversation) throw new HttpError(404, 'Conversation introuvable.');

  conversation.unreadCount = 0;
  await conversation.save();

  const messages = await ContactMessage.find({
    company: company._id,
    conversation: conversation._id
  }).sort({ createdAt: 1 });

  return { conversation, messages };
}

export async function sendInboxWhatsappMessage(input: {
  company: HydratedDocument<ICompany>;
  conversationId: string;
  body: string;
}) {
  const body = input.body.trim();
  if (!body) throw new HttpError(400, 'Message requis.');

  const conversation = await InboxConversation.findOne({ _id: input.conversationId, company: input.company._id })
    .populate('contact', 'whatsapp whatsappNormalized phone phoneNormalized');
  if (!conversation) throw new HttpError(404, 'Conversation introuvable.');

  const contact = conversation.contact as unknown as {
    _id?: unknown;
    whatsapp?: string;
    whatsappNormalized?: string;
    phone?: string;
    phoneNormalized?: string;
  } | undefined;
  const to = contact?.whatsappNormalized || contact?.whatsapp || contact?.phoneNormalized || contact?.phone;
  if (!to) throw new HttpError(400, 'Aucun numero WhatsApp disponible pour ce contact.');

  const sent = await sendWhatsapp({
    company: input.company,
    to,
    body,
    contactId: contact?._id ? String(contact._id) : undefined,
    conversationId: conversation._id
  });

  conversation.status = 'open';
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = body;
  await conversation.save();

  return { conversation, sent };
}
