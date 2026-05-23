import type { HydratedDocument, Types } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { CompanyQrCode, type ICompanyQrCode } from '../models/CompanyQrCode.js';
import { ContactList } from '../models/ContactList.js';
import { ContactListAttribute } from '../models/ContactListAttribute.js';
import {
  QrFormListMapping,
  type IQrFormListMapping
} from '../models/QrFormListMapping.js';
import { HttpError } from '../utils/httpError.js';
import { createContactListAttribute } from './contactListAttribute.service.js';
import { ensureDefaultContactList } from './contactList.service.js';
import type { CustomQuestionType } from './feedbackForm.service.js';

type FieldMappingInput = {
  formFieldKey: string;
  formFieldLabel?: string;
  listAttributeKey: string;
  createIfMissing?: boolean;
};

export type ResolvedQrFormListMapping = {
  company: Types.ObjectId;
  qrCode?: Types.ObjectId;
  list: Types.ObjectId;
  fieldMappings: Array<{
    formFieldKey: string;
    formFieldLabel?: string;
    listAttributeKey: string;
    createIfMissing?: boolean;
  }>;
  autoCreateContact: boolean;
  autoAddToList: boolean;
};

type UpsertQrFormListMappingInput = {
  company: HydratedDocument<ICompany>;
  qrCodeId: Types.ObjectId | string;
  listId?: Types.ObjectId | string;
  fieldMappings?: FieldMappingInput[];
  autoCreateContact?: boolean;
  autoAddToList?: boolean;
  createdBy?: Types.ObjectId | string;
};

function normalizeAttributeKey(value: string) {
  return value.trim().toLowerCase();
}

function attributeTypeFromFormField(formFieldKey: string): CustomQuestionType | 'whatsapp' | 'tag' {
  if (formFieldKey === 'rating') return 'rating';
  if (formFieldKey === 'email') return 'email';
  if (formFieldKey === 'phone') return 'phone';
  if (formFieldKey === 'whatsapp') return 'whatsapp';
  if (formFieldKey === 'tags') return 'tag';
  return 'text';
}

async function ensureMappedAttributes(
  company: HydratedDocument<ICompany>,
  listId: Types.ObjectId | string,
  fieldMappings: FieldMappingInput[]
) {
  for (const mapping of fieldMappings) {
    if (!mapping.createIfMissing) continue;
    const key = normalizeAttributeKey(mapping.listAttributeKey);
    const existing = await ContactListAttribute.findOne({ list: listId, key });
    if (existing) continue;

    await createContactListAttribute({
      companyId: company._id,
      listId,
      key,
      label: mapping.formFieldLabel || key,
      type: attributeTypeFromFormField(mapping.formFieldKey)
    });
  }
}

export async function ensureDefaultQrFormListMapping(
  company: HydratedDocument<ICompany>,
  qrCode: HydratedDocument<ICompanyQrCode>,
  createdBy?: Types.ObjectId | string
) {
  const existing = await QrFormListMapping.findOne({
    company: company._id,
    qrCode: qrCode._id
  });
  if (existing) return existing;

  const list = await ensureDefaultContactList(company, createdBy);
  return QrFormListMapping.create({
    company: company._id,
    qrCode: qrCode._id,
    list: list._id,
    fieldMappings: [],
    autoCreateContact: true,
    autoAddToList: true,
    createdBy
  });
}

export async function getQrFormListMapping(
  company: HydratedDocument<ICompany>,
  qrCodeId: Types.ObjectId | string
) {
  const mapping = await QrFormListMapping.findOne({
    company: company._id,
    qrCode: qrCodeId
  }).populate('list');
  if (mapping) return mapping;

  const qrCode = await CompanyQrCode.findOne({ _id: qrCodeId, company: company._id });
  if (!qrCode) throw new HttpError(404, 'QR form introuvable.');
  return ensureDefaultQrFormListMapping(company, qrCode);
}

export async function upsertQrFormListMapping({
  company,
  qrCodeId,
  listId,
  fieldMappings = [],
  autoCreateContact = true,
  autoAddToList = true,
  createdBy
}: UpsertQrFormListMappingInput) {
  const qrCode = await CompanyQrCode.findOne({ _id: qrCodeId, company: company._id });
  if (!qrCode) throw new HttpError(404, 'QR form introuvable.');

  const list = listId
    ? await ContactList.findOne({ _id: listId, company: company._id, archivedAt: { $exists: false } })
    : await ensureDefaultContactList(company, createdBy);
  if (!list) throw new HttpError(404, 'Liste introuvable.');

  await ensureMappedAttributes(company, list._id, fieldMappings);

  return QrFormListMapping.findOneAndUpdate(
    { company: company._id, qrCode: qrCode._id },
    {
      company: company._id,
      qrCode: qrCode._id,
      list: list._id,
      fieldMappings: fieldMappings.map((mapping) => ({
        formFieldKey: mapping.formFieldKey.trim(),
        formFieldLabel: mapping.formFieldLabel?.trim(),
        listAttributeKey: normalizeAttributeKey(mapping.listAttributeKey),
        createIfMissing: mapping.createIfMissing || false
      })),
      autoCreateContact,
      autoAddToList,
      createdBy
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export async function resolveQrFormListMappingForFeedback(
  company: HydratedDocument<ICompany>,
  qrCode?: HydratedDocument<ICompanyQrCode>
) : Promise<HydratedDocument<IQrFormListMapping> | ResolvedQrFormListMapping> {
  if (qrCode) return ensureDefaultQrFormListMapping(company, qrCode);

  const list = await ensureDefaultContactList(company);
  return {
    company: company._id,
    qrCode: undefined,
    list: list._id,
    fieldMappings: [],
    autoCreateContact: true,
    autoAddToList: true
  };
}
