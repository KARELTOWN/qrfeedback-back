import type { HydratedDocument, Types } from 'mongoose';
import { ContactList, type IContactList } from '../models/ContactList.js';
import type { ICompany } from '../models/Company.js';
import { ContactListMembership } from '../models/ContactListMembership.js';
import { HttpError } from '../utils/httpError.js';
import { ensureDefaultContactFolder } from './contactFolder.service.js';
import { ensureSystemContactListAttributes } from './contactListAttribute.service.js';

export const defaultContactListName = 'Liste par defaut';

type CreateContactListInput = {
  company: HydratedDocument<ICompany>;
  folderId?: Types.ObjectId | string;
  name: string;
  description?: string;
  createdBy?: Types.ObjectId | string;
};

export async function createContactList({
  company,
  folderId,
  name,
  description,
  createdBy
}: CreateContactListInput) {
  const folder = folderId ? undefined : await ensureDefaultContactFolder(company, createdBy);
  const finalFolderId = folderId || folder?._id;
  if (!finalFolderId) throw new HttpError(400, 'Dossier introuvable.');

  const existing = await ContactList.findOne({
    company: company._id,
    folder: finalFolderId,
    name: name.trim(),
    archivedAt: { $exists: false }
  });
  if (existing) throw new HttpError(409, 'Une liste porte deja ce nom dans ce dossier.');

  const list = await ContactList.create({
    company: company._id,
    folder: finalFolderId,
    name: name.trim(),
    description,
    createdBy
  });
  await ensureSystemContactListAttributes(list);
  return list;
}

export async function ensureDefaultContactList(
  company: HydratedDocument<ICompany>,
  createdBy?: Types.ObjectId | string
) {
  const existing = await ContactList.findOne({
    company: company._id,
    isDefault: true,
    archivedAt: { $exists: false }
  });
  if (existing) {
    await ensureSystemContactListAttributes(existing);
    return existing;
  }

  const folder = await ensureDefaultContactFolder(company, createdBy);
  try {
    const list = await ContactList.create({
      company: company._id,
      folder: folder._id,
      name: defaultContactListName,
      isDefault: true,
      createdBy
    });
    await ensureSystemContactListAttributes(list);
    return list;
  } catch (error) {
    const fallback = await ContactList.findOne({
      company: company._id,
      isDefault: true,
      archivedAt: { $exists: false }
    });
    if (fallback) {
      await ensureSystemContactListAttributes(fallback);
      return fallback;
    }
    throw error;
  }
}

export async function recalculateContactListCount(list: HydratedDocument<IContactList>) {
  const contactCount = await ContactListMembership.countDocuments({
    list: list._id,
    status: 'active'
  });
  list.contactCount = contactCount;
  list.lastCalculatedAt = new Date();
  await list.save();
  return list;
}

export async function archiveContactList(list: HydratedDocument<IContactList>) {
  if (list.isDefault) throw new HttpError(400, 'La liste par defaut ne peut pas etre archivee.');
  list.archivedAt = new Date();
  await list.save();
  return list;
}
