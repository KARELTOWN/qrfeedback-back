import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { MessageTemplate } from '../models/MessageTemplate.js';
import { WhatsappCostEstimate } from '../models/WhatsappCostEstimate.js';
import { HttpError } from '../utils/httpError.js';
import { estimateWhatsappCreditCost } from './whatsappBilling.service.js';
import { getActiveWhatsappConfig } from './whatsappConfig.service.js';

type SaveTemplateInput = {
  company: HydratedDocument<ICompany>;
  name: string;
  languageCode?: string;
  category?: string;
  status?: string;
  components?: unknown;
  externalId?: string;
};

function clean(value: unknown) {
  const text = String(value || '').trim();
  return text || undefined;
}

function category(value: unknown) {
  const text = clean(value);
  return text === 'marketing' || text === 'utility' || text === 'authentication' || text === 'service'
    ? text
    : 'unknown';
}

function status(value: unknown) {
  const text = clean(value);
  return text === 'pending' || text === 'approved' || text === 'rejected' || text === 'paused' || text === 'disabled'
    ? text
    : 'draft';
}

function recipientCountryCode(recipient?: string) {
  const normalized = String(recipient || '').replace(/^whatsapp:/, '').replace(/\s+/g, '');
  const match = normalized.match(/^\+?(\d{1,4})/);
  return match ? `+${match[1]}` : undefined;
}

export async function listWhatsappTemplates(company: HydratedDocument<ICompany>) {
  return MessageTemplate.find({
    company: company._id,
    archivedAt: { $exists: false }
  }).sort({ updatedAt: -1 });
}

export async function saveWhatsappTemplate(input: SaveTemplateInput) {
  const name = clean(input.name);
  if (!name) throw new HttpError(400, 'Nom de template requis.');

  const config = await getActiveWhatsappConfig(String(input.company._id));
  const languageCode = clean(input.languageCode) || 'fr';
  return MessageTemplate.findOneAndUpdate(
    {
      company: input.company._id,
      name,
      languageCode
    },
    {
      company: input.company._id,
      whatsappConfig: config?._id,
      provider: 'whatsapp_cloud_api',
      name,
      languageCode,
      category: category(input.category),
      status: status(input.status),
      components: input.components || [],
      estimatedCreditCost: 1,
      externalId: clean(input.externalId),
      lastSyncedAt: new Date(),
      archivedAt: undefined
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export async function archiveWhatsappTemplate(company: HydratedDocument<ICompany>, templateId: string) {
  const template = await MessageTemplate.findOne({
    _id: templateId,
    company: company._id,
    archivedAt: { $exists: false }
  });
  if (!template) throw new HttpError(404, 'Template WhatsApp introuvable.');
  template.archivedAt = new Date();
  await template.save();
  return template;
}

export async function estimateWhatsappMessageCost(input: {
  company: HydratedDocument<ICompany>;
  messageType?: 'text' | 'template';
  templateId?: string;
  recipient?: string;
  metadata?: Record<string, unknown>;
}) {
  const config = await getActiveWhatsappConfig(String(input.company._id));
  const template = input.templateId
    ? await MessageTemplate.findOne({
      _id: input.templateId,
      company: input.company._id,
      archivedAt: { $exists: false }
    })
    : null;

  if (input.templateId && !template) throw new HttpError(404, 'Template WhatsApp introuvable.');

  const estimate = estimateWhatsappCreditCost();
  const row = await WhatsappCostEstimate.create({
    company: input.company._id,
    whatsappConfig: config?._id,
    template: template?._id,
    messageType: input.messageType || (template ? 'template' : 'text'),
    recipient: clean(input.recipient),
    recipientCountryCode: recipientCountryCode(input.recipient),
    estimatedCreditCost: estimate.estimatedCreditCost,
    pricingModel: estimate.pricingModel,
    reason: estimate.reason,
    metadata: input.metadata || {}
  });

  return {
    estimate: row,
    remainingCredits: input.company.paidMessagesBalance + Math.max(input.company.freeMessagesLimit - input.company.freeMessagesUsed, 0)
  };
}
