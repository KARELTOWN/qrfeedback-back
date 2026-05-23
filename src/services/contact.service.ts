import type { HydratedDocument, Types } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Contact, type ContactSource, type IContact } from '../models/Contact.js';
import { ContactActivity, type ContactActivityType } from '../models/ContactActivity.js';
import { ContactList, type IContactList } from '../models/ContactList.js';
import { ContactListMembership } from '../models/ContactListMembership.js';
import { HttpError } from '../utils/httpError.js';
import { normalizeContactIdentity } from './contactNormalization.service.js';
import { ensureDefaultContactList, recalculateContactListCount } from './contactList.service.js';

type UpsertContactInput = {
  company: HydratedDocument<ICompany>;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  rating?: number;
  tags?: string[];
  customFields?: Record<string, unknown>;
  source?: ContactSource;
  lastFeedbackAt?: Date;
  createdBy?: Types.ObjectId | string;
};

type AddContactToListInput = {
  company: HydratedDocument<ICompany>;
  contact: HydratedDocument<IContact>;
  list?: HydratedDocument<IContactList>;
  listId?: Types.ObjectId | string;
  attributes?: Record<string, unknown>;
  addedBy?: Types.ObjectId | string;
  addedByAutomation?: Types.ObjectId | string;
};

function cleanText(value?: string) {
  const cleaned = String(value || '').trim();
  return cleaned || undefined;
}

function mergeTags(existing: string[] = [], incoming: string[] = []) {
  const tags = new Set(existing.map((tag) => tag.trim()).filter(Boolean));
  for (const tag of incoming) {
    const cleaned = tag.trim();
    if (cleaned) tags.add(cleaned);
  }
  return Array.from(tags);
}

function mergeMissingCustomFields(
  existing: Record<string, unknown> = {},
  incoming: Record<string, unknown> = {}
) {
  const next = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;
    if (next[key] === undefined || next[key] === null || next[key] === '') next[key] = value;
  }
  return next;
}

function fillMissingString(contact: HydratedDocument<IContact>, field: 'firstName' | 'lastName' | 'email' | 'phone' | 'whatsapp', value?: string) {
  const cleaned = cleanText(value);
  if (cleaned && !contact[field]) contact[field] = cleaned;
}

async function recordContactActivity(input: {
  companyId: Types.ObjectId | string;
  contactId: Types.ObjectId | string;
  type: ContactActivityType;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  await ContactActivity.create({
    company: input.companyId,
    contact: input.contactId,
    type: input.type,
    title: input.title,
    description: input.description,
    metadata: input.metadata || {},
    occurredAt: new Date()
  });
}

export async function findExistingContact(companyId: Types.ObjectId | string, payload: UpsertContactInput) {
  const normalized = normalizeContactIdentity(payload);

  if (normalized.whatsappNormalized) {
    const contact = await Contact.findOne({
      company: companyId,
      whatsappNormalized: normalized.whatsappNormalized,
      archivedAt: { $exists: false }
    });
    if (contact) return contact;
  }

  if (normalized.phoneNormalized) {
    const contact = await Contact.findOne({
      company: companyId,
      phoneNormalized: normalized.phoneNormalized,
      archivedAt: { $exists: false }
    });
    if (contact) return contact;
  }

  if (normalized.emailNormalized) {
    const contact = await Contact.findOne({
      company: companyId,
      emailNormalized: normalized.emailNormalized,
      archivedAt: { $exists: false }
    });
    if (contact) return contact;
  }

  return null;
}

export async function upsertContact(input: UpsertContactInput) {
  const normalized = normalizeContactIdentity(input);
  const existing = await findExistingContact(input.company._id, input);

  if (existing) {
    fillMissingString(existing, 'firstName', input.firstName);
    fillMissingString(existing, 'lastName', input.lastName);
    fillMissingString(existing, 'email', input.email);
    fillMissingString(existing, 'phone', input.phone);
    fillMissingString(existing, 'whatsapp', input.whatsapp);
    if (!existing.emailNormalized && normalized.emailNormalized) existing.emailNormalized = normalized.emailNormalized;
    if (!existing.phoneNormalized && normalized.phoneNormalized) existing.phoneNormalized = normalized.phoneNormalized;
    if (!existing.whatsappNormalized && normalized.whatsappNormalized) existing.whatsappNormalized = normalized.whatsappNormalized;
    if (typeof input.rating === 'number') existing.rating = input.rating;
    existing.tags = mergeTags(existing.tags, input.tags);
    existing.customFields = mergeMissingCustomFields(
      existing.customFields as Record<string, unknown>,
      input.customFields
    );
    existing.lastActivityAt = new Date();
    if (input.lastFeedbackAt) existing.lastFeedbackAt = input.lastFeedbackAt;
    await existing.save();
    await recordContactActivity({
      companyId: input.company._id,
      contactId: existing._id,
      type: 'contact_updated',
      title: 'Contact mis a jour',
      metadata: { source: input.source || 'manual' }
    });
    return { contact: existing, created: false };
  }

  const contact = await Contact.create({
    company: input.company._id,
    firstName: cleanText(input.firstName),
    lastName: cleanText(input.lastName),
    email: cleanText(input.email)?.toLowerCase(),
    emailNormalized: normalized.emailNormalized,
    phone: cleanText(input.phone),
    phoneNormalized: normalized.phoneNormalized,
    whatsapp: cleanText(input.whatsapp),
    whatsappNormalized: normalized.whatsappNormalized,
    rating: input.rating,
    tags: mergeTags([], input.tags),
    customFields: input.customFields || {},
    source: input.source || 'manual',
    lastActivityAt: new Date(),
    lastFeedbackAt: input.lastFeedbackAt,
    createdBy: input.createdBy
  });

  await recordContactActivity({
    companyId: input.company._id,
    contactId: contact._id,
    type: 'contact_created',
    title: 'Contact cree',
    metadata: { source: input.source || 'manual' }
  });

  return { contact, created: true };
}

export async function addContactToList({
  company,
  contact,
  list,
  listId,
  attributes = {},
  addedBy,
  addedByAutomation
}: AddContactToListInput) {
  const finalList = list || (listId ? await ContactList.findOne({
    _id: listId,
    company: company._id,
    archivedAt: { $exists: false }
  }) : await ensureDefaultContactList(company, addedBy));

  if (!finalList) throw new HttpError(404, 'Liste introuvable.');

  const existing = await ContactListMembership.findOne({
    company: company._id,
    list: finalList._id,
    contact: contact._id
  });

  if (existing) {
    const wasActive = existing.status === 'active';
    existing.status = 'active';
    existing.removedAt = undefined;
    existing.attributes = mergeMissingCustomFields(
      existing.attributes as Record<string, unknown>,
      attributes
    );
    await existing.save();
    if (!wasActive) await recalculateContactListCount(finalList);
    return { membership: existing, created: false, list: finalList };
  }

  const membership = await ContactListMembership.create({
    company: company._id,
    list: finalList._id,
    contact: contact._id,
    status: 'active',
    attributes,
    addedBy,
    addedByAutomation,
    addedAt: new Date()
  });

  finalList.contactCount += 1;
  finalList.lastCalculatedAt = new Date();
  await finalList.save();

  await recordContactActivity({
    companyId: company._id,
    contactId: contact._id,
    type: 'added_to_list',
    title: 'Contact ajoute a une liste',
    metadata: { listId: String(finalList._id), listName: finalList.name }
  });

  return { membership, created: true, list: finalList };
}
