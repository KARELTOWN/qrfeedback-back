import type { FilterQuery, HydratedDocument, Types } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Contact, type IContact } from '../models/Contact.js';
import { ContactActivity } from '../models/ContactActivity.js';
import { ContactListMembership } from '../models/ContactListMembership.js';
import { Review } from '../models/Review.js';
import {
  Segment,
  type ISegment,
  type segmentOperators
} from '../models/Segment.js';
import { SegmentMembership } from '../models/SegmentMembership.js';
import { HttpError } from '../utils/httpError.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';

type SegmentOperator = typeof segmentOperators[number];

export type SegmentConditionInput = {
  field: string;
  operator: SegmentOperator;
  value?: unknown;
  windowDays?: number;
};

type SaveSegmentInput = {
  company: HydratedDocument<ICompany>;
  name: string;
  description?: string;
  type?: 'dynamic' | 'static';
  matchType?: 'all' | 'any';
  conditions?: SegmentConditionInput[];
  contactIds?: Array<Types.ObjectId | string>;
  createdBy?: Types.ObjectId | string;
};

export type ContactFilterInput = {
  search?: string;
  conditions?: SegmentConditionInput[];
  matchType?: 'all' | 'any';
} & PaginationInput;

function cleanCondition(condition: SegmentConditionInput) {
  return {
    field: condition.field.trim(),
    operator: condition.operator,
    value: condition.value,
    windowDays: condition.windowDays
  };
}

function dateDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function contactFieldPath(field: string) {
  const aliases: Record<string, string> = {
    'contact.created_at': 'createdAt',
    'contact.updated_at': 'updatedAt',
    'contact.last_activity_at': 'lastActivityAt',
    'contact.last_feedback_at': 'lastFeedbackAt',
    'contact.rating': 'rating',
    'contact.whatsapp': 'whatsapp',
    'contact.whatsapp_normalized': 'whatsappNormalized',
    'contact.phone': 'phone',
    'contact.phone_normalized': 'phoneNormalized',
    'contact.email': 'email',
    'contact.email_normalized': 'emailNormalized',
    'contact.tags': 'tags'
  };

  if (aliases[field]) return aliases[field];
  if (field.startsWith('custom_fields.')) return `customFields.${field.slice('custom_fields.'.length)}`;
  if (field.startsWith('contact.custom_fields.')) return `customFields.${field.slice('contact.custom_fields.'.length)}`;
  return undefined;
}

function mongoCondition(path: string, operator: SegmentOperator, value: unknown, windowDays?: number) {
  if (operator === 'exists') return { [path]: { $exists: true, $nin: [null, ''] } };
  if (operator === 'not_exists') return { $or: [{ [path]: { $exists: false } }, { [path]: null }, { [path]: '' }] };
  if (operator === 'equals') return { [path]: value };
  if (operator === 'not_equals') return { [path]: { $ne: value } };
  if (operator === 'contains') return { [path]: { $regex: String(value || ''), $options: 'i' } };
  if (operator === 'not_contains') return { [path]: { $not: { $regex: String(value || ''), $options: 'i' } } };
  if (operator === 'starts_with') return { [path]: { $regex: `^${String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' } };
  if (operator === 'in') return { [path]: { $in: Array.isArray(value) ? value : [value] } };
  if (operator === 'not_in') return { [path]: { $nin: Array.isArray(value) ? value : [value] } };
  if (operator === '<') return { [path]: { $lt: value } };
  if (operator === '<=') return { [path]: { $lte: value } };
  if (operator === '>') return { [path]: { $gt: value } };
  if (operator === '>=') return { [path]: { $gte: value } };
  if (operator === 'within_last_days') return { [path]: { $gte: dateDaysAgo(Number(value || windowDays || 1)) } };
  if (operator === 'older_than_days') return { [path]: { $lt: dateDaysAgo(Number(value || windowDays || 1)) } };
  return {};
}

async function contactIdsForListCondition(companyId: Types.ObjectId | string, condition: SegmentConditionInput) {
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  const memberships = await ContactListMembership.find({
    company: companyId,
    list: { $in: values },
    status: 'active'
  }).select('contact').lean();
  return new Set(memberships.map((membership) => String(membership.contact)));
}

async function contactIdsForFeedbackCount(companyId: Types.ObjectId | string, condition: SegmentConditionInput) {
  const threshold = Number(condition.value || 1);
  const match: Record<string, unknown> = { company: companyId };
  if (condition.windowDays) match.createdAt = { $gte: dateDaysAgo(condition.windowDays) };
  const countMatch = mongoCondition('count', condition.operator, threshold) as Record<string, unknown>;

  const rows = await Review.aggregate([
    { $match: match },
    { $group: { _id: '$contact', count: { $sum: 1 } } },
    { $match: { _id: { $ne: null }, ...countMatch } }
  ]);

  return new Set(rows.map((row) => String(row._id)));
}

async function contactCountsForWhatsappMessages(companyId: Types.ObjectId | string, windowDays?: number) {
  const match: Record<string, unknown> = {
    company: companyId,
    type: 'message_sent',
    channel: 'whatsapp'
  };
  if (windowDays) match.occurredAt = { $gte: dateDaysAgo(windowDays) };

  const rows = await ContactActivity.aggregate([
    { $match: match },
    { $group: { _id: '$contact', count: { $sum: 1 } } }
  ]);

  return new Map(rows.map((row) => [String(row._id), Number(row.count || 0)]));
}

function contactValue(contact: Record<string, unknown>, field: string) {
  const path = contactFieldPath(field);
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, contact);
}

function compareValue(value: unknown, condition: SegmentConditionInput) {
  const expected = condition.value;
  if (condition.operator === 'exists') return value !== undefined && value !== null && value !== '';
  if (condition.operator === 'not_exists') return value === undefined || value === null || value === '';
  if (condition.operator === 'equals') return value === expected;
  if (condition.operator === 'not_equals') return value !== expected;
  if (condition.operator === 'contains') return String(value || '').toLowerCase().includes(String(expected || '').toLowerCase());
  if (condition.operator === 'not_contains') return !String(value || '').toLowerCase().includes(String(expected || '').toLowerCase());
  if (condition.operator === 'starts_with') return String(value || '').toLowerCase().startsWith(String(expected || '').toLowerCase());
  if (condition.operator === 'in') return (Array.isArray(expected) ? expected : [expected]).includes(value);
  if (condition.operator === 'not_in') return !(Array.isArray(expected) ? expected : [expected]).includes(value);

  const actualNumber = value instanceof Date ? value.getTime() : Number(value);
  const expectedValue = condition.operator === 'within_last_days' || condition.operator === 'older_than_days'
    ? dateDaysAgo(Number(expected || condition.windowDays || 1)).getTime()
    : Number(expected);

  if (condition.operator === '<') return actualNumber < expectedValue;
  if (condition.operator === '<=') return actualNumber <= expectedValue;
  if (condition.operator === '>') return actualNumber > expectedValue;
  if (condition.operator === '>=') return actualNumber >= expectedValue;
  if (condition.operator === 'within_last_days') return actualNumber >= expectedValue;
  if (condition.operator === 'older_than_days') return actualNumber < expectedValue;
  return false;
}

type SpecialConditionData =
  | { kind: 'set'; ids: Set<string> }
  | { kind: 'count'; counts: Map<string, number> };

async function buildSpecialConditionData(companyId: Types.ObjectId | string, conditions: SegmentConditionInput[]) {
  const data = new Map<number, SpecialConditionData>();
  for (const [index, condition] of conditions.entries()) {
    if (condition.field === 'contact.list_id' || condition.field === 'contact.list') {
      data.set(index, { kind: 'set', ids: await contactIdsForListCondition(companyId, condition) });
    } else if (condition.field === 'feedback.count') {
      data.set(index, { kind: 'set', ids: await contactIdsForFeedbackCount(companyId, condition) });
    } else if (condition.field === 'whatsapp.sent_count') {
      data.set(index, { kind: 'count', counts: await contactCountsForWhatsappMessages(companyId, condition.windowDays) });
    }
  }
  return data;
}

function evaluateSegmentCondition(
  contact: Record<string, unknown>,
  contactId: string,
  condition: SegmentConditionInput,
  conditionIndex: number,
  specialData: Map<number, SpecialConditionData>
) {
  const special = specialData.get(conditionIndex);
  if (special?.kind === 'set') {
    const included = special.ids.has(contactId);
    return condition.operator === 'not_in' || condition.operator === 'not_equals' ? !included : included;
  }
  if (special?.kind === 'count') {
    return compareValue(special.counts.get(contactId) || 0, condition);
  }
  return compareValue(contactValue(contact, condition.field), condition);
}

export const segmentTemplates = [
  {
    key: 'new_contacts',
    name: 'Nouveaux contacts',
    description: 'Contacts crees durant les 7 derniers jours.',
    matchType: 'all',
    conditions: [{ field: 'contact.created_at', operator: 'within_last_days', value: 7 }]
  },
  {
    key: 'low_rating',
    name: 'Contacts ayant laisse un avis < 3',
    description: 'Contacts dont la derniere note connue est inferieure a 3.',
    matchType: 'all',
    conditions: [{ field: 'contact.rating', operator: '<', value: 3 }]
  },
  {
    key: 'very_low_rating',
    name: 'Avis tres negatifs',
    description: 'Contacts dont la derniere note connue est inferieure ou egale a 2.',
    matchType: 'all',
    conditions: [{ field: 'contact.rating', operator: '<=', value: 2 }]
  },
  {
    key: 'satisfied_customers',
    name: 'Clients satisfaits',
    description: 'Contacts dont la derniere note connue est superieure ou egale a 4.',
    matchType: 'all',
    conditions: [{ field: 'contact.rating', operator: '>=', value: 4 }]
  },
  {
    key: 'frequent_feedback',
    name: 'Contacts laissant frequemment des avis',
    description: 'Contacts ayant laisse au moins 3 avis sur 30 jours.',
    matchType: 'all',
    conditions: [{ field: 'feedback.count', operator: '>=', value: 3, windowDays: 30 }]
  },
  {
    key: 'inactive_contacts',
    name: 'Contacts inactifs',
    description: 'Contacts sans activite depuis plus de 90 jours.',
    matchType: 'all',
    conditions: [{ field: 'contact.last_activity_at', operator: 'older_than_days', value: 90 }]
  },
  {
    key: 'recent_not_relaunched',
    name: 'Contacts tres recents mais non relances',
    description: 'Contacts crees dans les 7 derniers jours et sans message WhatsApp envoye.',
    matchType: 'all',
    conditions: [
      { field: 'contact.created_at', operator: 'within_last_days', value: 7 },
      { field: 'whatsapp.sent_count', operator: 'equals', value: 0 }
    ]
  },
  {
    key: 'country_dial_code',
    name: 'Contacts WhatsApp par indicatif pays',
    description: 'Contacts dont le WhatsApp normalise commence par un indicatif choisi par l’utilisateur.',
    matchType: 'all',
    conditions: [{ field: 'contact.whatsapp_normalized', operator: 'starts_with', value: '+229' }]
  },
  {
    key: 'without_usable_whatsapp',
    name: 'Contacts sans WhatsApp exploitable',
    description: 'Contacts sans numero WhatsApp normalise.',
    matchType: 'all',
    conditions: [{ field: 'contact.whatsapp_normalized', operator: 'not_exists' }]
  }
] as const;

export async function listSegments(company: HydratedDocument<ICompany>, input: PaginationInput = {}) {
  const pagination = normalizePagination(input);
  const filter = { company: company._id, archivedAt: { $exists: false } };
  const [total, segments] = await Promise.all([
    Segment.countDocuments(filter),
    Segment.find(filter).sort({ updatedAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean()
  ]);

  return {
    segments,
    pagination: buildPagination(total, pagination.page, pagination.limit)
  };
}

function searchContactQuery(search?: string): FilterQuery<IContact> | undefined {
  const cleaned = String(search || '').trim();
  if (!cleaned) return undefined;

  return {
    $or: [
      { firstName: { $regex: cleaned, $options: 'i' } },
      { lastName: { $regex: cleaned, $options: 'i' } },
      { email: { $regex: cleaned, $options: 'i' } },
      { phone: { $regex: cleaned, $options: 'i' } },
      { whatsapp: { $regex: cleaned, $options: 'i' } },
      { whatsappNormalized: { $regex: cleaned.replace(/\s+/g, ''), $options: 'i' } }
    ]
  };
}

async function matchingContactIds(
  company: HydratedDocument<ICompany>,
  conditions: SegmentConditionInput[] = [],
  matchType: 'all' | 'any' = 'all',
  search?: string
) {
  const baseQuery: FilterQuery<IContact> = {
    company: company._id,
    archivedAt: { $exists: false }
  };
  const searchQuery = searchContactQuery(search);
  const candidates = await Contact.find(searchQuery ? { ...baseQuery, ...searchQuery } : baseQuery).lean();
  const specialData = await buildSpecialConditionData(company._id, conditions);
  const matchedContactIds: string[] = [];

  for (const candidate of candidates) {
    const contactId = String(candidate._id);
    const results = conditions.map((condition, index) => evaluateSegmentCondition(
      candidate as Record<string, unknown>,
      contactId,
      condition,
      index,
      specialData
    ));
    const matches = conditions.length === 0 || (matchType === 'any' ? results.some(Boolean) : results.every(Boolean));
    if (matches) matchedContactIds.push(contactId);
  }

  return matchedContactIds;
}

export async function filterContactsForSegment(company: HydratedDocument<ICompany>, input: ContactFilterInput = {}) {
  const pagination = normalizePagination(input);
  const ids = await matchingContactIds(company, input.conditions || [], input.matchType || 'all', input.search);
  const pageIds = ids.slice(pagination.skip, pagination.skip + pagination.limit);
  const contacts = pageIds.length
    ? await Contact.find({ _id: { $in: pageIds }, company: company._id }).lean()
    : [];
  const contactById = new Map(contacts.map((contact) => [String(contact._id), contact]));

  return {
    contacts: pageIds.map((id) => contactById.get(id)).filter(Boolean),
    pagination: buildPagination(ids.length, pagination.page, pagination.limit)
  };
}

export async function previewSegment(company: HydratedDocument<ICompany>, input: ContactFilterInput = {}) {
  const ids = await matchingContactIds(company, input.conditions || [], input.matchType || 'all', input.search);
  return {
    count: ids.length,
    contactIds: ids.slice(0, 100)
  };
}

export async function getSegment(company: HydratedDocument<ICompany>, segmentId: string) {
  const segment = await Segment.findOne({ _id: segmentId, company: company._id, archivedAt: { $exists: false } });
  if (!segment) throw new HttpError(404, 'Segment introuvable.');
  return segment;
}

export async function createSegment(input: SaveSegmentInput) {
  const existing = await Segment.findOne({
    company: input.company._id,
    name: input.name.trim(),
    archivedAt: { $exists: false }
  });
  if (existing) throw new HttpError(409, 'Un segment porte deja ce nom.');

  const segment = await Segment.create({
    company: input.company._id,
    name: input.name.trim(),
    description: input.description,
    type: input.type || 'dynamic',
    matchType: input.matchType || 'all',
    conditions: (input.conditions || []).map(cleanCondition),
    createdBy: input.createdBy
  });

  if (segment.type === 'static' && input.contactIds?.length) {
    await replaceStaticSegmentMembers(input.company, segment, input.contactIds);
  }

  return segment;
}

export async function updateSegment(company: HydratedDocument<ICompany>, segmentId: string, input: Partial<SaveSegmentInput>) {
  const segment = await getSegment(company, segmentId);
  if (input.name) segment.name = input.name.trim();
  if (input.description !== undefined) segment.description = input.description;
  if (input.type) segment.type = input.type;
  if (input.matchType) segment.matchType = input.matchType;
  if (input.conditions) segment.set('conditions', input.conditions.map(cleanCondition));
  await segment.save();
  if (segment.type === 'static' && input.contactIds) {
    await replaceStaticSegmentMembers(company, segment, input.contactIds);
  }
  return segment;
}

async function replaceStaticSegmentMembers(
  company: HydratedDocument<ICompany>,
  segment: HydratedDocument<ISegment>,
  contactIds: Array<Types.ObjectId | string>
) {
  const uniqueIds = Array.from(new Set(contactIds.map(String)));
  const validContacts = await Contact.find({
    _id: { $in: uniqueIds },
    company: company._id,
    archivedAt: { $exists: false }
  }).select('_id').lean();
  const validIds = validContacts.map((contact) => String(contact._id));

  await SegmentMembership.deleteMany({ company: company._id, segment: segment._id });
  if (validIds.length) {
    await SegmentMembership.insertMany(validIds.map((contactId) => ({
      company: company._id,
      segment: segment._id,
      contact: contactId,
      matchedAt: new Date(),
      lastEvaluatedAt: new Date()
    })), { ordered: false });
  }

  segment.contactCount = validIds.length;
  segment.lastCalculatedAt = new Date();
  await segment.save();
}

export async function archiveSegment(company: HydratedDocument<ICompany>, segmentId: string) {
  const segment = await getSegment(company, segmentId);
  segment.archivedAt = new Date();
  await segment.save();
  await SegmentMembership.deleteMany({ company: company._id, segment: segment._id });
  return segment;
}

export async function recalculateSegment(company: HydratedDocument<ICompany>, segmentId: string) {
  const segment = await getSegment(company, segmentId);
  if (segment.type === 'static') return segment;
  const conditions = (segment.conditions || []) as SegmentConditionInput[];
  const matchType = (segment.matchType || 'all') as 'all' | 'any';
  const matchedContactIds = await matchingContactIds(company, conditions, matchType);

  await SegmentMembership.deleteMany({ company: company._id, segment: segment._id });
  if (matchedContactIds.length) {
    await SegmentMembership.insertMany(matchedContactIds.map((contactId) => ({
      company: company._id,
      segment: segment._id,
      contact: contactId,
      matchedAt: new Date(),
      lastEvaluatedAt: new Date()
    })), { ordered: false });
  }

  segment.contactCount = matchedContactIds.length;
  segment.lastCalculatedAt = new Date();
  await segment.save();
  return segment;
}

export async function listSegmentMembers(company: HydratedDocument<ICompany>, segmentId: string, input: PaginationInput = {}) {
  await getSegment(company, segmentId);
  const pagination = normalizePagination(input);
  const filter = { company: company._id, segment: segmentId };
  const [total, memberships] = await Promise.all([
    SegmentMembership.countDocuments(filter),
    SegmentMembership.find(filter)
      .populate('contact')
      .sort({ matchedAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
  ]);

  return {
    members: memberships,
    pagination: buildPagination(total, pagination.page, pagination.limit)
  };
}
