import type { Request, Response } from 'express';
import {
  getActiveWhatsappConfig,
  saveCompanyWhatsappConfig,
  serializeWhatsappConfig
} from '../services/whatsappConfig.service.js';
import {
  archiveWhatsappTemplate,
  estimateWhatsappMessageCost,
  listWhatsappTemplates,
  saveWhatsappTemplate
} from '../services/whatsappTemplate.service.js';
import { sendWhatsappTemplate } from '../services/whatsapp.service.js';

export async function getConfig(req: Request, res: Response) {
  const config = await getActiveWhatsappConfig(String(req.company._id));
  res.json({ config: config ? serializeWhatsappConfig(config) : null });
}

export async function upsertConfig(req: Request, res: Response) {
  const config = await saveCompanyWhatsappConfig({
    company: req.company,
    wabaId: req.body.wabaId,
    phoneNumberId: req.body.phoneNumberId,
    accessToken: req.body.accessToken,
    businessAccountId: req.body.businessAccountId,
    webhookVerifyToken: req.body.webhookVerifyToken,
    webhookSecret: req.body.webhookSecret,
    displayPhoneNumber: req.body.displayPhoneNumber,
    status: req.body.status
  });

  res.json({ config: serializeWhatsappConfig(config) });
}

export async function listTemplates(req: Request, res: Response) {
  const templates = await listWhatsappTemplates(req.company);
  res.json({ templates });
}

export async function upsertTemplate(req: Request, res: Response) {
  const template = await saveWhatsappTemplate({
    company: req.company,
    name: req.body.name,
    languageCode: req.body.languageCode,
    category: req.body.category,
    status: req.body.status,
    components: req.body.components,
    externalId: req.body.externalId
  });

  res.status(201).json({ template });
}

export async function deleteTemplate(req: Request, res: Response) {
  const template = await archiveWhatsappTemplate(req.company, String(req.params.id));
  res.json({ ok: true, template });
}

export async function estimateCost(req: Request, res: Response) {
  const result = await estimateWhatsappMessageCost({
    company: req.company,
    messageType: req.body.messageType,
    templateId: req.body.templateId,
    recipient: req.body.recipient,
    metadata: req.body.metadata
  });

  res.json(result);
}

export async function sendTestMessage(req: Request, res: Response) {
  const result = await sendWhatsappTemplate({
    company: req.company,
    to: req.body.to,
    templateName: req.body.templateName || 'hello_world',
    languageCode: req.body.languageCode || 'en_US'
  });

  res.json({ ok: true, result });
}
