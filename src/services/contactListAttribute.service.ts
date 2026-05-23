import type { HydratedDocument, Types } from 'mongoose';
import {
  ContactListAttribute,
  type ContactListAttributeType,
  type IContactListAttribute
} from '../models/ContactListAttribute.js';
import type { IContactList } from '../models/ContactList.js';
import { HttpError } from '../utils/httpError.js';

export const systemContactListAttributes = [
  { key: 'first_name', label: 'Prenom', type: 'text' },
  { key: 'last_name', label: 'Nom', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Telephone', type: 'phone' },
  { key: 'whatsapp', label: 'WhatsApp', type: 'whatsapp' },
  { key: 'rating', label: 'Note', type: 'rating' },
  { key: 'tags', label: 'Tags', type: 'tag' },
  { key: 'created_at', label: 'Date de creation', type: 'date' },
  { key: 'updated_at', label: 'Derniere modification', type: 'date' }
] satisfies Array<{ key: string; label: string; type: ContactListAttributeType }>;

type CreateContactListAttributeInput = {
  companyId: Types.ObjectId | string;
  listId: Types.ObjectId | string;
  key: string;
  label: string;
  type: ContactListAttributeType;
  isSystem?: boolean;
  isRequired?: boolean;
  isUnique?: boolean;
  options?: string[];
  defaultValue?: unknown;
  position?: number;
};

function normalizeAttributeKey(key: string) {
  return key.trim().toLowerCase();
}

export async function createContactListAttribute(input: CreateContactListAttributeInput) {
  const key = normalizeAttributeKey(input.key);
  const existing = await ContactListAttribute.findOne({ list: input.listId, key });
  if (existing) throw new HttpError(409, 'Cet attribut existe deja dans la liste.');

  return ContactListAttribute.create({
    company: input.companyId,
    list: input.listId,
    key,
    label: input.label,
    type: input.type,
    isSystem: input.isSystem || false,
    isRequired: input.isRequired || false,
    isUnique: input.isUnique || false,
    options: input.options || [],
    defaultValue: input.defaultValue,
    position: input.position || 0
  });
}

export async function ensureSystemContactListAttributes(list: HydratedDocument<IContactList>) {
  const existingAttributes = await ContactListAttribute.find({ list: list._id }).select('key').lean();
  const existingKeys = new Set(existingAttributes.map((attribute) => attribute.key));
  const created: HydratedDocument<IContactListAttribute>[] = [];

  for (const [index, attribute] of systemContactListAttributes.entries()) {
    if (existingKeys.has(attribute.key)) continue;
    created.push(await ContactListAttribute.create({
      company: list.company,
      list: list._id,
      ...attribute,
      isSystem: true,
      position: index
    }));
  }

  return created;
}
