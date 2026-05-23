import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import type { IAutomationExecution } from '../models/AutomationExecution.js';
import type { IAutomationStep } from '../models/AutomationStep.js';
import { Company } from '../models/Company.js';
import { Contact } from '../models/Contact.js';
import { ContactActivity } from '../models/ContactActivity.js';
import { ContactList } from '../models/ContactList.js';
import { ContactListMembership } from '../models/ContactListMembership.js';
import { ContactTag } from '../models/ContactTag.js';
import { InboxConversation } from '../models/InboxConversation.js';
import { InternalAlert } from '../models/InternalAlert.js';
import { Ticket } from '../models/Ticket.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { addContactToList } from './contact.service.js';
import { recalculateContactListCount } from './contactList.service.js';
import { sendMail } from './mail.service.js';
import { sendWhatsapp, sendWhatsappTemplate } from './whatsapp.service.js';
import { appLogger } from '../utils/appLogger.js';

type ActionResult = {
  actionType?: string;
  skipped?: boolean;
  reason?: string;
  [key: string]: unknown;
};

type ActionContext = {
  execution: HydratedDocument<IAutomationExecution>;
  step: HydratedDocument<IAutomationStep>;
  config: Record<string, unknown>;
};

function objectId(value: unknown) {
  if (!value || !mongoose.isValidObjectId(value)) return undefined;
  return new mongoose.Types.ObjectId(String(value));
}

function stringValue(value: unknown) {
  const text = String(value || '').trim();
  return text || undefined;
}

function conversationStatus(value: unknown) {
  const status = stringValue(value);
  return status === 'pending' || status === 'closed' ? status : 'open';
}

function stringList(...values: unknown[]) {
  const items: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const cleaned = stringValue(item);
        if (cleaned) items.push(cleaned);
      }
    } else {
      const cleaned = stringValue(value);
      if (cleaned) items.push(...cleaned.split(',').map((item) => item.trim()).filter(Boolean));
    }
  }
  return Array.from(new Set(items));
}

function contextValue(context: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (context[key] !== undefined && context[key] !== null && context[key] !== '') return context[key];
  }
  return undefined;
}

function interpolate(template: unknown, context: Record<string, unknown>) {
  const text = stringValue(template);
  if (!text) return undefined;

  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = path.split('.').reduce<unknown>((current, key) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, context);
    return value === undefined || value === null ? '' : String(value);
  });
}

function interpolateDeep(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') return interpolate(value, context) || '';
  if (Array.isArray(value)) return value.map((item) => interpolateDeep(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolateDeep(item, context)])
    );
  }
  return value;
}

async function resolveContact(execution: HydratedDocument<IAutomationExecution>, config: Record<string, unknown>) {
  const context = execution.context as Record<string, unknown>;
  const contactId = objectId(
    config.contactId ||
    config.contact ||
    contextValue(context, 'contact_id', 'contactId') ||
    (context.contact && typeof context.contact === 'object'
      ? (context.contact as Record<string, unknown>).id
      : undefined)
  );

  if (!contactId) return null;
  return Contact.findOne({
    _id: contactId,
    company: execution.company,
    archivedAt: { $exists: false }
  });
}

async function resolveUser(companyId: Types.ObjectId | string, config: Record<string, unknown>) {
  const targetUserId = objectId(config.targetUserId || config.managerUserId || config.assignee || config.assigneeId);
  if (targetUserId) {
    const target = await User.findOne({ _id: targetUserId, company: companyId, isActive: true });
    if (target) return target;
  }

  const targetEmail = stringValue(config.email || config.managerEmail || config.targetEmail)?.toLowerCase();
  if (targetEmail) {
    const target = await User.findOne({ company: companyId, email: targetEmail, isActive: true });
    if (target) return target;
  }

  return User.findOne({ company: companyId, isActive: true }).sort({ createdAt: 1 });
}

async function addTags({ execution, step, config }: ActionContext): Promise<ActionResult> {
  const contact = await resolveContact(execution, config);
  if (!contact) return { skipped: true, reason: 'contact_not_found' };

  const tags = stringList(config.tags, config.tag, config.name);
  if (!tags.length) return { skipped: true, reason: 'tag_missing' };

  const existingTags = new Set((contact.tags || []).map((tag) => tag.trim()).filter(Boolean));
  for (const tag of tags) {
    existingTags.add(tag);
    await ContactTag.updateOne(
      { company: execution.company, name: tag },
      {
        $setOnInsert: {
          company: execution.company,
          name: tag
        },
        $unset: { archivedAt: 1 }
      },
      { upsert: true }
    );
  }

  contact.tags = Array.from(existingTags);
  contact.lastActivityAt = new Date();
  await contact.save();
  await ContactActivity.create({
    company: execution.company,
    contact: contact._id,
    type: 'tag_added',
    title: 'Tag ajoute par automation',
    metadata: { tags, automation: String(execution.automation), stepKey: step.key },
    occurredAt: new Date()
  });

  return { contactId: String(contact._id), tags };
}

async function removeTags({ execution, step, config }: ActionContext): Promise<ActionResult> {
  const contact = await resolveContact(execution, config);
  if (!contact) return { skipped: true, reason: 'contact_not_found' };

  const tags = stringList(config.tags, config.tag, config.name);
  if (!tags.length) return { skipped: true, reason: 'tag_missing' };

  const removed = new Set(tags.map((tag) => tag.toLowerCase()));
  contact.tags = (contact.tags || []).filter((tag) => !removed.has(tag.toLowerCase()));
  contact.lastActivityAt = new Date();
  await contact.save();
  await ContactActivity.create({
    company: execution.company,
    contact: contact._id,
    type: 'tag_removed',
    title: 'Tag retire par automation',
    metadata: { tags, automation: String(execution.automation), stepKey: step.key },
    occurredAt: new Date()
  });

  return { contactId: String(contact._id), tags };
}

async function addToList({ execution, step, config }: ActionContext): Promise<ActionResult> {
  const [company, contact] = await Promise.all([
    Company.findById(execution.company),
    resolveContact(execution, config)
  ]);
  if (!company) throw new HttpError(404, 'Entreprise introuvable.');
  if (!contact) return { skipped: true, reason: 'contact_not_found' };

  const listId = objectId(config.listId || config.list);
  const listName = stringValue(config.listName || config.name);
  const list = listId
    ? await ContactList.findOne({ _id: listId, company: execution.company, archivedAt: { $exists: false } })
    : listName
      ? await ContactList.findOne({ company: execution.company, name: listName, archivedAt: { $exists: false } })
      : null;

  const result = await addContactToList({
    company,
    contact,
    list: list || undefined,
    listId: list ? undefined : listId,
    attributes: (config.attributes || {}) as Record<string, unknown>,
    addedByAutomation: execution.automation
  });

  await ContactActivity.create({
    company: execution.company,
    contact: contact._id,
    type: 'added_to_list',
    title: 'Contact ajoute a une liste par automation',
    metadata: { listId: String(result.list._id), listName: result.list.name, stepKey: step.key },
    occurredAt: new Date()
  });

  return { contactId: String(contact._id), listId: String(result.list._id), created: result.created };
}

async function removeFromList({ execution, step, config }: ActionContext): Promise<ActionResult> {
  const contact = await resolveContact(execution, config);
  if (!contact) return { skipped: true, reason: 'contact_not_found' };

  const listId = objectId(config.listId || config.list);
  const listName = stringValue(config.listName || config.name);
  const list = listId
    ? await ContactList.findOne({ _id: listId, company: execution.company, archivedAt: { $exists: false } })
    : listName
      ? await ContactList.findOne({ company: execution.company, name: listName, archivedAt: { $exists: false } })
      : null;
  if (!list) return { skipped: true, reason: 'list_not_found' };

  const membership = await ContactListMembership.findOne({
    company: execution.company,
    list: list._id,
    contact: contact._id
  });
  if (!membership || membership.status === 'removed') {
    return { skipped: true, reason: 'membership_not_active', contactId: String(contact._id), listId: String(list._id) };
  }

  membership.status = 'removed';
  membership.removedAt = new Date();
  await membership.save();
  await recalculateContactListCount(list);
  await ContactActivity.create({
    company: execution.company,
    contact: contact._id,
    type: 'removed_from_list',
    title: 'Contact retire d une liste par automation',
    metadata: { listId: String(list._id), listName: list.name, stepKey: step.key },
    occurredAt: new Date()
  });

  return { contactId: String(contact._id), listId: String(list._id) };
}

async function createAlert({ execution, step, config }: ActionContext): Promise<ActionResult> {
  const [contact, targetUser] = await Promise.all([
    resolveContact(execution, config),
    resolveUser(execution.company, config)
  ]);
  const context = execution.context as Record<string, unknown>;
  const alert = await InternalAlert.create({
    company: execution.company,
    type: stringValue(config.type) || 'automation',
    title: interpolate(config.title, context) || 'Alerte automation',
    message: interpolate(config.message || config.description, context),
    severity: stringValue(config.severity) || 'info',
    targetUser: targetUser?._id,
    contact: contact?._id,
    automation: execution.automation,
    automationExecution: execution._id,
    automationStepKey: step.key,
    metadata: {
      ...(config.metadata && typeof config.metadata === 'object' ? config.metadata as Record<string, unknown> : {}),
      actionType: step.actionType
    }
  });

  return { alertId: String(alert._id), targetUserId: targetUser ? String(targetUser._id) : undefined };
}

async function notifyManager(input: ActionContext): Promise<ActionResult> {
  const targetUser = await resolveUser(input.execution.company, input.config);
  if (!targetUser) return { skipped: true, reason: 'manager_not_found' };

  const context = input.execution.context as Record<string, unknown>;
  const subject = interpolate(input.config.subject || input.config.title, context) || 'Notification automation';
  const message = interpolate(input.config.message || input.config.body || input.config.description, context) ||
    'Une automation demande votre attention.';

  await sendMail({
    to: targetUser.email,
    subject,
    html: `<p>${message.replace(/\n/g, '<br>')}</p>`
  });

  const alert = await InternalAlert.create({
    company: input.execution.company,
    type: 'automation',
    title: subject,
    message,
    severity: stringValue(input.config.severity) || 'info',
    targetUser: targetUser._id,
    automation: input.execution.automation,
    automationExecution: input.execution._id,
    automationStepKey: input.step.key,
    metadata: { actionType: input.step.actionType, notifiedByEmail: true }
  });

  return { targetUserId: String(targetUser._id), email: targetUser.email, alertId: String(alert._id) };
}

async function createConversation({ execution, step, config }: ActionContext): Promise<ActionResult> {
  const [contact, assignee] = await Promise.all([
    resolveContact(execution, config),
    resolveUser(execution.company, config)
  ]);
  const channel = stringValue(config.channel) || 'whatsapp';
  const preview = interpolate(config.lastMessagePreview || config.preview || config.message, execution.context as Record<string, unknown>);

  const existing = contact ? await InboxConversation.findOne({
    company: execution.company,
    contact: contact._id,
    channel,
    status: { $ne: 'closed' }
  }).sort({ updatedAt: -1 }) : null;

  const conversation = existing || await InboxConversation.create({
    company: execution.company,
    contact: contact?._id,
    channel,
    status: conversationStatus(config.status),
    assignee: assignee?._id,
    lastMessageAt: new Date(),
    lastMessagePreview: preview,
    unreadCount: 0,
    metadata: {
      automation: String(execution.automation),
      automationExecution: String(execution._id),
      automationStepKey: step.key
    }
  });

  if (existing) {
    existing.status = conversationStatus(config.status);
    if (assignee?._id) existing.assignee = assignee._id;
    existing.lastMessageAt = new Date();
    if (preview) existing.lastMessagePreview = preview;
    await existing.save();
  }

  return {
    conversationId: String(conversation._id),
    contactId: contact ? String(contact._id) : undefined,
    reused: Boolean(existing)
  };
}

async function createTicket(input: ActionContext): Promise<ActionResult> {
  const conversationResult = await createConversation(input);
  const conversationId = objectId(conversationResult.conversationId);
  const [contact, assignee] = await Promise.all([
    resolveContact(input.execution, input.config),
    resolveUser(input.execution.company, input.config)
  ]);
  const context = input.execution.context as Record<string, unknown>;
  const ticket = await Ticket.create({
    company: input.execution.company,
    conversation: conversationId,
    contact: contact?._id,
    source: 'automation',
    status: stringValue(input.config.status) || 'open',
    priority: stringValue(input.config.priority) || 'normal',
    subject: interpolate(input.config.subject || input.config.title, context) || 'Ticket automation',
    description: interpolate(input.config.description || input.config.message, context),
    assignee: assignee?._id,
    automation: input.execution.automation,
    automationExecution: input.execution._id,
    automationStepKey: input.step.key,
    metadata: input.config.metadata && typeof input.config.metadata === 'object'
      ? input.config.metadata as Record<string, unknown>
      : {}
  });

  return {
    ...conversationResult,
    ticketId: String(ticket._id),
    assigneeId: assignee ? String(assignee._id) : undefined
  };
}

async function sendWhatsappMessage({ execution, step, config }: ActionContext): Promise<ActionResult> {
  const [company, contact] = await Promise.all([
    Company.findById(execution.company),
    resolveContact(execution, config)
  ]);
  if (!company) throw new HttpError(404, 'Entreprise introuvable.');

  const context = execution.context as Record<string, unknown>;
  const enrichedContext = {
    ...context,
    contact: {
      ...(context.contact && typeof context.contact === 'object' ? context.contact as Record<string, unknown> : {}),
      id: contact ? String(contact._id) : contextValue(context, 'contact_id', 'contactId'),
      whatsapp: contact?.whatsappNormalized || contact?.whatsapp,
      phone: contact?.phoneNormalized || contact?.phone,
      email: contact?.email,
      firstName: contact?.firstName,
      lastName: contact?.lastName
    }
  };

  const to = interpolate(config.to, enrichedContext) ||
    contact?.whatsappNormalized ||
    contact?.whatsapp ||
    contact?.phoneNormalized ||
    contact?.phone;
  if (!to) return { skipped: true, reason: 'recipient_missing' };

  const mode = stringValue(config.mode) || (config.templateName ? 'template' : 'text');
  if (mode === 'template') {
    const templateName = stringValue(config.templateName || config.name);
    if (!templateName) return { skipped: true, reason: 'template_missing' };
    const languageCode = stringValue(config.languageCode) || 'fr';

    const sent = await sendWhatsappTemplate({
      company,
      to,
      templateName,
      languageCode,
      components: Array.isArray(config.components)
        ? interpolateDeep(config.components, enrichedContext) as unknown[]
        : [],
      contactId: contact?._id,
      automationExecutionId: execution._id,
      automationStepKey: step.key
    });

    return { providerMessageId: sent.id, status: sent.status, to, templateName, languageCode };
  }

  const body = interpolate(config.body || config.message, enrichedContext);
  if (!body) return { skipped: true, reason: 'body_missing' };

  const sent = await sendWhatsapp({
    company,
    to,
    body,
    contactId: contact?._id,
    automationExecutionId: execution._id,
    automationStepKey: step.key
  });

  return { providerMessageId: sent.id, status: sent.status, to };
}

export async function executeAutomationAction(
  execution: HydratedDocument<IAutomationExecution>,
  step: HydratedDocument<IAutomationStep>
): Promise<ActionResult> {
  const config = (step.config || {}) as Record<string, unknown>;
  const input = { execution, step, config };
  appLogger.info('automation:action', 'execute', {
    executionId: String(execution._id),
    stepKey: step.key,
    actionType: step.actionType,
    config
  });

  if (step.actionType === 'add_tag') return { actionType: step.actionType, ...await addTags(input) };
  if (step.actionType === 'remove_tag') return { actionType: step.actionType, ...await removeTags(input) };
  if (step.actionType === 'add_to_list') return { actionType: step.actionType, ...await addToList(input) };
  if (step.actionType === 'remove_from_list') return { actionType: step.actionType, ...await removeFromList(input) };
  if (step.actionType === 'notify_manager') return { actionType: step.actionType, ...await notifyManager(input) };
  if (step.actionType === 'send_whatsapp_message') return { actionType: step.actionType, ...await sendWhatsappMessage(input) };
  if (step.actionType === 'create_internal_alert') return { actionType: step.actionType, ...await createAlert(input) };
  if (step.actionType === 'create_inbox_conversation') return { actionType: step.actionType, ...await createConversation(input) };
  if (step.actionType === 'create_ticket') return { actionType: step.actionType, ...await createTicket(input) };

  const result = { actionType: stringValue(step.actionType), skipped: true, reason: 'unsupported_action' };
  appLogger.warn('automation:action', 'unsupported', result);
  return result;
}
