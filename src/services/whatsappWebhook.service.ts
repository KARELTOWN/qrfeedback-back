import type { HydratedDocument } from 'mongoose';
import { Company } from '../models/Company.js';
import { CompanyWhatsappConfig, type ICompanyWhatsappConfig } from '../models/CompanyWhatsappConfig.js';
import { ContactActivity } from '../models/ContactActivity.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { InboundMessage } from '../models/InboundMessage.js';
import { InboxConversation } from '../models/InboxConversation.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { WhatsappMessageLog } from '../models/WhatsappMessageLog.js';
import { upsertContact } from './contact.service.js';
import { handleWhatsappCloudMessageStatus } from './review.service.js';
import { appLogger } from '../utils/appLogger.js';

type WhatsappWebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
};

type WhatsappWebhookContact = {
  profile?: { name?: string };
  wa_id?: string;
};

type WhatsappWebhookMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  document?: { caption?: string; filename?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string; id?: string };
    list_reply?: { title?: string; id?: string };
  };
};

type WhatsappWebhookChangeValue = {
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: WhatsappWebhookContact[];
  statuses?: WhatsappWebhookStatus[];
  messages?: WhatsappWebhookMessage[];
};

type WhatsappWebhookPayload = {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: WhatsappWebhookChangeValue;
    }>;
  }>;
};

function dateFromWhatsappTimestamp(timestamp?: string) {
  if (!timestamp) return new Date();
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return new Date();
  return new Date(numericTimestamp * 1000);
}

function firstStatusError(status: WhatsappWebhookStatus) {
  const error = status.errors?.[0];
  return {
    errorCode: error?.code ? String(error.code) : undefined,
    errorMessage: error?.message || error?.title || error?.error_data?.details
  };
}

function normalizeWhatsappStatus(status: string) {
  return status === 'failed' ? 'failed' : status;
}

function whatsappNumber(value?: string) {
  if (!value) return undefined;
  return value.startsWith('+') ? value : `+${value}`;
}

function inboundBody(message: WhatsappWebhookMessage) {
  if (message.text?.body) return message.text.body;
  if (message.image?.caption) return message.image.caption;
  if (message.document?.caption) return message.document.caption;
  if (message.document?.filename) return message.document.filename;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  return message.type ? `[${message.type}]` : '';
}

function contactName(contact?: WhatsappWebhookContact) {
  const name = contact?.profile?.name?.trim();
  if (!name) return {};
  const [firstName, ...rest] = name.split(/\s+/);
  return { firstName, lastName: rest.join(' ') || undefined };
}

async function startWebhookEvent(input: {
  company?: unknown;
  whatsappConfig?: unknown;
  phoneNumberId?: string;
  eventType: 'message' | 'status' | 'unknown';
  externalEventId?: string;
  payload: unknown;
}) {
  if (!input.externalEventId) {
    return WebhookEvent.create({
      company: input.company,
      whatsappConfig: input.whatsappConfig,
      eventType: input.eventType,
      phoneNumberId: input.phoneNumberId,
      payload: input.payload,
      processingStatus: 'processing'
    });
  }

  const existing = await WebhookEvent.findOne({
    provider: 'whatsapp_cloud_api',
    externalEventId: input.externalEventId
  });
  if (existing) return existing;

  return WebhookEvent.create({
    company: input.company,
    whatsappConfig: input.whatsappConfig,
    eventType: input.eventType,
    externalEventId: input.externalEventId,
    phoneNumberId: input.phoneNumberId,
    payload: input.payload,
    processingStatus: 'processing'
  });
}

async function markWebhookProcessed(eventId: unknown) {
  await WebhookEvent.updateOne(
    { _id: eventId },
    { $set: { processingStatus: 'processed', processedAt: new Date() } }
  );
}

async function markWebhookFailed(eventId: unknown, error: unknown) {
  await WebhookEvent.updateOne(
    { _id: eventId },
    {
      $set: {
        processingStatus: 'failed',
        error: { message: error instanceof Error ? error.message : String(error) },
        processedAt: new Date()
      }
    }
  );
}

async function updateOutboundStatus({
  config,
  phoneNumberId,
  displayPhoneNumber,
  status
}: {
  config: HydratedDocument<ICompanyWhatsappConfig> | null;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  status: WhatsappWebhookStatus;
}) {
  if (!config || !status.id || !status.status) return false;

  const occurredAt = dateFromWhatsappTimestamp(status.timestamp);
  const normalizedStatus = normalizeWhatsappStatus(status.status);
  const { errorCode, errorMessage } = firstStatusError(status);
  const externalEventId = `${status.id}:${normalizedStatus}:${status.timestamp || ''}`;
  const event = await startWebhookEvent({
    company: config.company,
    whatsappConfig: config._id,
    phoneNumberId,
    eventType: 'status',
    externalEventId,
    payload: status
  });
  if (event.processingStatus === 'processed') return false;

  try {
    const statusLog = await WhatsappMessageLog.create({
      company: config.company,
      whatsappConfig: config._id,
      direction: 'outbound',
      type: 'status',
      status: normalizedStatus,
      providerMessageId: status.id,
      to: status.recipient_id,
      from: displayPhoneNumber || phoneNumberId,
      webhookPayload: status,
      errorCode,
      errorMessage,
      occurredAt
    });

    const contactMessageUpdate: Record<string, unknown> = {
      status: normalizedStatus,
      providerPayload: status
    };
    if (normalizedStatus === 'sent') contactMessageUpdate.sentAt = occurredAt;
    if (normalizedStatus === 'delivered') contactMessageUpdate.deliveredAt = occurredAt;
    if (normalizedStatus === 'read') contactMessageUpdate.readAt = occurredAt;
    if (normalizedStatus === 'failed') {
      contactMessageUpdate.failedAt = occurredAt;
      contactMessageUpdate.error = { code: errorCode, message: errorMessage };
    }

    const contactMessage = await ContactMessage.findOneAndUpdate(
      { providerMessageId: status.id },
      { $set: contactMessageUpdate },
      { new: true }
    );
    if (contactMessage) statusLog.contactMessage = contactMessage._id;
    if (contactMessage?.contact) statusLog.contact = contactMessage.contact;
    await statusLog.save();

    await WhatsappMessageLog.updateMany(
      { providerMessageId: status.id, direction: 'outbound', type: { $ne: 'status' } },
      {
        $set: {
          contactMessage: contactMessage?._id,
          contact: contactMessage?.contact,
          status: normalizedStatus,
          errorCode,
          errorMessage
        }
      }
    );

    if (contactMessage?.contact && ['delivered', 'read', 'failed'].includes(normalizedStatus)) {
      await ContactActivity.create({
        company: config.company,
        contact: contactMessage.contact,
        type: normalizedStatus === 'failed' ? 'message_failed' : normalizedStatus === 'read' ? 'message_read' : 'message_delivered',
        channel: 'whatsapp',
        direction: 'outbound',
        provider: 'whatsapp_cloud_api',
        providerMessageId: status.id,
        title: `Message WhatsApp ${normalizedStatus}`,
        metadata: { status: normalizedStatus },
        occurredAt
      });
    }

    await handleWhatsappCloudMessageStatus({
      messageId: status.id,
      status: status.status,
      errorCode,
      errorMessage
    });

    await markWebhookProcessed(event._id);
    return true;
  } catch (error) {
    await markWebhookFailed(event._id, error);
    throw error;
  }
}

async function processInboundMessage({
  config,
  phoneNumberId,
  displayPhoneNumber,
  message,
  contactProfile
}: {
  config: HydratedDocument<ICompanyWhatsappConfig> | null;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  message: WhatsappWebhookMessage;
  contactProfile?: WhatsappWebhookContact;
}) {
  if (!config || !message.id) return false;

  const event = await startWebhookEvent({
    company: config.company,
    whatsappConfig: config._id,
    phoneNumberId,
    eventType: 'message',
    externalEventId: message.id,
    payload: message
  });
  if (event.processingStatus === 'processed') return false;

  try {
    const company = await Company.findById(config.company);
    if (!company) return false;

    const receivedAt = dateFromWhatsappTimestamp(message.timestamp);
    const from = message.from || contactProfile?.wa_id || '';
    const body = inboundBody(message);
    const { firstName, lastName } = contactName(contactProfile);
    const { contact } = await upsertContact({
      company,
      firstName,
      lastName,
      whatsapp: whatsappNumber(from),
      phone: whatsappNumber(from),
      source: 'api'
    });

    const conversation = await InboxConversation.findOneAndUpdate(
      {
        company: config.company,
        contact: contact._id,
        channel: 'whatsapp',
        status: { $ne: 'closed' }
      },
      {
        $set: {
          status: 'open',
          lastMessageAt: receivedAt,
          lastMessagePreview: body,
          metadata: {
            phoneNumberId,
            displayPhoneNumber
          }
        },
        $inc: { unreadCount: 1 }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const contactMessage = await ContactMessage.findOneAndUpdate(
      { providerMessageId: message.id },
      {
        $set: {
          company: config.company,
          contact: contact._id,
          conversation: conversation._id,
          channel: 'whatsapp',
          direction: 'inbound',
          status: 'received',
          to: displayPhoneNumber || phoneNumberId,
          from,
          body,
          providerPayload: message
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await InboundMessage.findOneAndUpdate(
      { providerMessageId: message.id },
      {
        $set: {
          company: config.company,
          whatsappConfig: config._id,
          contact: contact._id,
          contactMessage: contactMessage._id,
          from,
          toPhoneNumberId: phoneNumberId,
          profileName: contactProfile?.profile?.name,
          messageType: message.type || 'text',
          text: body,
          payload: message,
          receivedAt,
          processedAt: new Date()
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await WhatsappMessageLog.create({
      company: config.company,
      whatsappConfig: config._id,
      contact: contact._id,
      contactMessage: contactMessage._id,
      direction: 'inbound',
      type: message.type || 'text',
      status: 'received',
      providerMessageId: message.id,
      to: displayPhoneNumber || phoneNumberId,
      from,
      webhookPayload: message,
      occurredAt: receivedAt
    });

    contact.lastActivityAt = receivedAt;
    await contact.save();

    await markWebhookProcessed(event._id);
    return true;
  } catch (error) {
    await markWebhookFailed(event._id, error);
    throw error;
  }
}

export async function processWhatsappWebhookPayload(payload: WhatsappWebhookPayload) {
  let processedStatuses = 0;
  let processedMessages = 0;
  appLogger.info('whatsapp:webhook', 'received', { entries: payload.entry?.length || 0 });

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;

      const config = await CompanyWhatsappConfig.findOne({ phoneNumberId });
      if (!config) {
        appLogger.warn('whatsapp:webhook', 'unknown phone number id', { phoneNumberId });
        await startWebhookEvent({
          phoneNumberId,
          eventType: 'unknown',
          externalEventId: `${phoneNumberId}:${Date.now()}`,
          payload: change
        });
        continue;
      }

      for (const status of value.statuses || []) {
        const processed = await updateOutboundStatus({
          config,
          phoneNumberId,
          displayPhoneNumber: value.metadata?.display_phone_number,
          status
        });
        if (processed) processedStatuses += 1;
      }

      for (const message of value.messages || []) {
        const profile = value.contacts?.find((contact) => contact.wa_id === message.from) || value.contacts?.[0];
        const processed = await processInboundMessage({
          config,
          phoneNumberId,
          displayPhoneNumber: value.metadata?.display_phone_number,
          message,
          contactProfile: profile
        });
        if (processed) processedMessages += 1;
      }
    }
  }

  appLogger.info('whatsapp:webhook', 'processed', { processedStatuses, processedMessages });
  return { processedStatuses, processedMessages };
}
