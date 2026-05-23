import type { HydratedDocument, Types } from 'mongoose';
import { env } from '../config/env.js';
import type { ICompany } from '../models/Company.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { WhatsappMessageLog } from '../models/WhatsappMessageLog.js';
import { HttpError } from '../utils/httpError.js';
import {
  chargeWhatsappCredit,
  estimateWhatsappCreditCost,
  refundWhatsappCredit,
  type WhatsappCreditCharge
} from './whatsappBilling.service.js';
import { getActiveWhatsappConfig, getWhatsappAccessToken } from './whatsappConfig.service.js';
import { appLogger } from '../utils/appLogger.js';

type SendWhatsappTextInput = {
  company: HydratedDocument<ICompany>;
  to: string;
  body: string;
  contactId?: Types.ObjectId | string;
  conversationId?: Types.ObjectId | string;
  automationExecutionId?: Types.ObjectId | string;
  automationStepKey?: string;
};

type SendWhatsappTemplateInput = {
  company: HydratedDocument<ICompany>;
  to: string;
  templateName: string;
  languageCode: string;
  components?: unknown[];
  contactId?: Types.ObjectId | string;
  conversationId?: Types.ObjectId | string;
  automationExecutionId?: Types.ObjectId | string;
  automationStepKey?: string;
};

type MetaMessageResponse = {
  messaging_product?: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string; message_status?: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

function normalizeWhatsappRecipient(number: string) {
  return number.replace(/^whatsapp:/, '').replace(/\s+/g, '');
}

function messagesUrl(phoneNumberId: string) {
  const baseUrl = env.whatsappCloud.apiBaseUrl.replace(/\/$/, '');
  return `${baseUrl}/${env.whatsappCloud.graphApiVersion}/${phoneNumberId}/messages`;
}

async function postWhatsappMessage({
  company,
  to,
  payload,
  type,
  body,
  contactId,
  conversationId,
  automationExecutionId,
  automationStepKey
}: {
  company: HydratedDocument<ICompany>;
  to: string;
  payload: Record<string, unknown>;
  type: 'text' | 'template';
  body?: string;
  contactId?: Types.ObjectId | string;
  conversationId?: Types.ObjectId | string;
  automationExecutionId?: Types.ObjectId | string;
  automationStepKey?: string;
}) {
  const config = await getActiveWhatsappConfig(String(company._id));
  if (!config) {
    appLogger.error('whatsapp:send', 'missing active config', { companyId: String(company._id), to, type });
    throw new HttpError(400, 'Aucune configuration WhatsApp Cloud API active pour cette entreprise.');
  }
  const estimate = estimateWhatsappCreditCost();
  let charge: WhatsappCreditCharge | undefined;

  const requestPayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeWhatsappRecipient(to),
    ...payload
  };

  const contactMessage = await ContactMessage.create({
    company: company._id,
    contact: contactId,
    conversation: conversationId,
    automationExecution: automationExecutionId,
    automationStepKey,
    channel: 'whatsapp',
    direction: 'outbound',
    status: 'pending',
    to: requestPayload.to,
    from: config.displayPhoneNumber || config.phoneNumberId,
    body,
    templatePayload: type === 'template' ? payload.template : undefined,
    providerPayload: requestPayload
  });

  const log = await WhatsappMessageLog.create({
    company: company._id,
    whatsappConfig: config._id,
    contactMessage: contactMessage._id,
    contact: contactId,
    direction: 'outbound',
    type,
    status: 'pending',
    to: requestPayload.to,
    from: config.displayPhoneNumber || config.phoneNumberId,
    requestPayload,
    estimatedCreditCost: estimate.estimatedCreditCost,
    occurredAt: new Date()
  });

  try {
    charge = await chargeWhatsappCredit(company, estimate.estimatedCreditCost);
    appLogger.info('whatsapp:billing', 'credit charged', {
      companyId: String(company._id),
      source: charge.source,
      cost: charge.cost,
      to: requestPayload.to
    });
    log.creditChargedAt = charge.chargedAt;
    log.creditChargeSource = charge.source;
    await log.save();
  } catch (error) {
    log.status = 'failed';
    log.errorMessage = error instanceof Error ? error.message : 'Credit WhatsApp insuffisant.';
    await log.save();
    appLogger.error('whatsapp:billing', 'credit charge failed', { companyId: String(company._id), message: log.errorMessage });
    throw error;
  }

  appLogger.info('whatsapp:send', 'request', {
    companyId: String(company._id),
    phoneNumberId: config.phoneNumberId,
    type,
    to: requestPayload.to,
    logId: String(log._id)
  });
  const response = await fetch(messagesUrl(config.phoneNumberId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getWhatsappAccessToken(config)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestPayload)
  });

  const responsePayload = await response.json().catch(() => ({})) as MetaMessageResponse;
  const providerMessageId = responsePayload.messages?.[0]?.id;
  const providerStatus = responsePayload.messages?.[0]?.message_status || (response.ok ? 'accepted' : 'failed');

  log.responsePayload = responsePayload;
  log.providerMessageId = providerMessageId;
  log.status = response.ok ? 'accepted' : 'failed';
  log.errorCode = responsePayload.error?.code ? String(responsePayload.error.code) : undefined;
  log.errorMessage = responsePayload.error?.message;
  await log.save();
  contactMessage.providerMessageId = providerMessageId;
  contactMessage.status = response.ok ? 'accepted' : 'failed';
  contactMessage.providerPayload = responsePayload;
  if (!response.ok) {
    contactMessage.failedAt = new Date();
    contactMessage.error = {
      code: responsePayload.error?.code ? String(responsePayload.error.code) : undefined,
      message: responsePayload.error?.message
    };
  }
  await contactMessage.save();
  appLogger.info('whatsapp:send', 'response', {
    ok: response.ok,
    status: response.status,
    providerMessageId,
    providerStatus,
    errorCode: log.errorCode,
    errorMessage: log.errorMessage
  });

  if (!response.ok) {
    await refundWhatsappCredit(company._id, charge);
    log.creditRefundedAt = new Date();
    await log.save();
    appLogger.warn('whatsapp:billing', 'credit refunded after provider failure', { companyId: String(company._id), source: charge.source });
    throw new HttpError(
      502,
      responsePayload.error?.message || 'Erreur lors de l’envoi WhatsApp Cloud API.'
    );
  }

  return {
    id: providerMessageId || String(log._id),
    sid: providerMessageId || String(log._id),
    status: providerStatus,
    logId: log._id,
    estimatedCreditCost: estimate.estimatedCreditCost,
    creditChargedAt: charge.chargedAt,
    creditChargeSource: charge.source
  };
}

export function sendWhatsapp({
  company,
  to,
  body,
  contactId,
  conversationId,
  automationExecutionId,
  automationStepKey
}: SendWhatsappTextInput) {
  return postWhatsappMessage({
    company,
    to,
    type: 'text',
    body,
    contactId,
    conversationId,
    automationExecutionId,
    automationStepKey,
    payload: {
      type: 'text',
      text: {
        preview_url: false,
        body
      }
    }
  });
}

export function sendWhatsappTemplate({
  company,
  to,
  templateName,
  languageCode,
  components = [],
  contactId,
  conversationId,
  automationExecutionId,
  automationStepKey
}: SendWhatsappTemplateInput) {
  return postWhatsappMessage({
    company,
    to,
    type: 'template',
    contactId,
    conversationId,
    automationExecutionId,
    automationStepKey,
    payload: {
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length ? { components } : {})
      }
    }
  });
}
